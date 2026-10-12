-- Local-validated additive guards. Do not apply to Production as part of this audit.
-- Retain all existing evidence/budget calculations, replace only ambiguous history/day counts.
alter function public.multi_account_frequency_evidence(uuid,uuid) rename to multi_account_inventory_evidence;
create function public.multi_account_frequency_evidence(p_owner uuid,p_account uuid)
returns jsonb language sql security invoker set search_path='' as $$
 with config as (
   select coalesce(config->>'timezone','Asia/Bangkok') zone from public.account_automation_settings
   where owner_id=p_owner and tiktok_account_id=p_account
 ), latest as (
   -- One snapshot per real post, not one observation per poll. Do not learn from MOCK or unlabelled aggregates.
   select distinct on (s.external_video_id) s.* from public.video_analytics_snapshots s
   join public.tiktok_accounts a on a.owner_id=s.owner_id and a.id=s.tiktok_account_id
   where s.owner_id=p_owner and s.tiktok_account_id=p_account and not a.is_mock
     and s.source='TIKTOK_DISPLAY' and s.source_confidence>0 and s.views>0
     and s.published_at is not null and s.published_at<=now()-interval '2 hours'
     and s.published_at>=now()-interval '28 days'
     and s.source_snapshot_at>=now()-interval '7 days' and s.source_snapshot_at<=now()
   order by s.external_video_id,s.source_snapshot_at desc,s.id desc
 ), daily as (
   select (published_at at time zone coalesce((select zone from config),'Asia/Bangkok'))::date as observation_day,
     count(*) posts,sum(views) views,sum(coalesce(likes,0)+coalesce(comments,0)+coalesce(shares,0)) engagements
   from latest group by 1
 ), boundary as (
   select date_trunc('day',now() at time zone coalesce((select zone from config),'Asia/Bangkok'))
     at time zone coalesce((select zone from config),'Asia/Bangkok') start
 )
 select public.multi_account_inventory_evidence(p_owner,p_account) || jsonb_build_object(
   'history',(select coalesce(jsonb_agg(jsonb_build_object('posts',posts,'views',views,'engagements',engagements) order by observation_day),'[]') from daily),
   'historySource','TIKTOK_DISPLAY',
   'publishCap',(select case when observed_platform_cap>0 then least(effective_publish_cap,observed_platform_cap) else null end from public.account_publish_health where owner_id=p_owner and tiktok_account_id=p_account),
   -- Reviewed inventory already queued still covers demand; do not buy replacements for it.
   'ready',(select count(*) from public.master_videos m where m.owner_id=p_owner and m.tiktok_account_id=p_account and m.quality_status='PASS' and m.status in ('READY','APPROVED') and m.storage_path is not null
     and (select ec.final_status from public.publish_eligibility_checks ec where ec.owner_id=p_owner and ec.video_id=m.id order by ec.created_at desc,ec.id desc limit 1) in ('READY_FOR_REVIEW','READY_TO_PUBLISH')
     and not exists(select 1 from public.publishing_queue pq where pq.owner_id=p_owner and pq.video_id=m.id and pq.status='PUBLISHED')),
   'producedToday',(select count(*) from public.master_videos where owner_id=p_owner and tiktok_account_id=p_account and quality_status='PASS' and created_at>=(select start from boundary)),
   'publishedToday',(select count(*) from public.publishing_queue where owner_id=p_owner and tiktok_account_id=p_account and status='PUBLISHED' and completed_at>=(select start from boundary))
 );
$$;
revoke all on function public.multi_account_frequency_evidence(uuid,uuid),public.multi_account_inventory_evidence(uuid,uuid) from public,anon,authenticated;
grant execute on function public.multi_account_frequency_evidence(uuid,uuid),public.multi_account_inventory_evidence(uuid,uuid) to service_role;

alter function public.reserve_multi_account_publish(uuid,uuid) rename to reserve_multi_account_publish_limits;
create function public.reserve_multi_account_publish(p_owner uuid,p_queue uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare q public.publishing_queue; a public.tiktok_accounts; c jsonb; evidence jsonb;
  minute integer; allowed integer; cadence numeric; gap numeric; history_days integer;
begin
  -- Serialize the window/spacing check and existing reservations with the same transaction lock.
  perform 1 from public.multi_account_runtime where singleton for update;
  if not exists(select 1 from public.multi_account_runtime where singleton and enabled and execution_mode='ENABLED' and publishing_enabled) then return 'SAFE_MODE';end if;
  select * into q from public.publishing_queue where owner_id=p_owner and id=p_queue;
  select * into a from public.tiktok_accounts where owner_id=p_owner and id=q.tiktok_account_id;
  select config into c from public.account_automation_settings where owner_id=p_owner and tiktok_account_id=q.tiktok_account_id;
  if a.id is null or a.hidden_at is not null or a.authorization_status<>'authorized' or a.is_mock or a.account_status<>'active'
    or not coalesce(a.token_expires_at>now() or a.refresh_token_expires_at>now(),false) then return 'TOKEN';end if;
  if not coalesce((c->>'enabled')::boolean,false) or coalesce((c->>'paused')::boolean,false) then return 'ACCOUNT_PAUSED';end if;
  minute:=extract(hour from now() at time zone coalesce(c->>'timezone','Asia/Bangkok'))*60+extract(minute from now() at time zone coalesce(c->>'timezone','Asia/Bangkok'));
  if coalesce((c->>'spreadFullDay')::boolean,true) then allowed:=1440;
  else
    if not exists(select 1 from jsonb_array_elements(c->'windows') w where minute>=(w->>'start')::integer and minute<(w->>'end')::integer) then return 'POSTING_WINDOW';end if;
    select count(distinct n) into allowed from jsonb_array_elements(c->'windows') w cross join lateral generate_series((w->>'start')::integer,(w->>'end')::integer-1) n;
  end if;
  evidence:=public.multi_account_frequency_evidence(p_owner,a.id);
  history_days:=jsonb_array_length(evidence->'history');
  if history_days<3 then return 'FREQUENCY_DATA_REQUIRED';end if;
  -- 1.5 is the planner's maximum gradual growth factor; spacing remains conservative at every send,
  -- including overdue tasks, a changed seed, midnight, and another owner connected to the same creator.
  select least(ceil(avg((d->>'posts')::numeric)*1.5),coalesce((evidence->>'publishCap')::numeric,0)) into cadence from jsonb_array_elements(evidence->'history') d;
  if cadence<=0 then return 'PLATFORM_CAP';end if;
  gap:=greatest(1,coalesce((c->>'minimumGapMinutes')::numeric,1),floor(allowed/(cadence*2)));
  if exists(select 1 from public.multi_account_publish_reservations where creator_identity=a.open_id and queue_id<>p_queue and reserved_at>now()-make_interval(secs=>(gap*60)::double precision))
    or exists(select 1 from public.publishing_queue pq join public.tiktok_accounts ta on ta.owner_id=pq.owner_id and ta.id=pq.tiktok_account_id where ta.open_id=a.open_id and pq.id<>p_queue and pq.started_at>now()-make_interval(secs=>(gap*60)::double precision) and pq.external_state in ('SUBMITTING','SUBMITTED_UNKNOWN','SUBMITTED','CONFIRMED')) then return 'RATE_LIMIT';end if;
  return private.reserve_multi_account_publish_limits(p_owner,p_queue);
end $$;
revoke all on function public.reserve_multi_account_publish(uuid,uuid),public.reserve_multi_account_publish_limits(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_multi_account_publish(uuid,uuid) to service_role;
-- Preserve SECURITY INVOKER; the helper remains outside the exposed public RPC schema.
alter function public.reserve_multi_account_publish_limits(uuid,uuid) set schema private;
grant execute on function private.reserve_multi_account_publish_limits(uuid,uuid) to service_role;
