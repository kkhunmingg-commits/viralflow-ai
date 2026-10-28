-- Cadence policy (src/features/multi-account/cadence-policy.ts) mirrored at the publish gate:
-- a new account starts at the conservative cadence instead of waiting for three days of history,
-- the per-account cadence never exceeds TikTok's typical creator cap (15/day) or the real returned cap,
-- and two clips of one creator are never closer than 60 minutes.
create or replace function public.reserve_multi_account_publish(p_owner uuid,p_queue uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare q public.publishing_queue; a public.tiktok_accounts; c jsonb; evidence jsonb;
  minute integer; allowed integer; cadence numeric; gap numeric; history_days integer; affiliate boolean;
begin
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
  affiliate:=coalesce(a.mode<>'GROWTH',true) and a.follower_count>=1000 and a.shop_creator_eligible is true and a.ecommerce_permission is true and a.cart_enabled is true;
  -- Ceiling: Growth 3 rising to 5; Affiliate 5 + 2 per observed day up to the owner's target, never above 15.
  cadence:=case when affiliate then least(coalesce((c->>'dailyTarget')::numeric,15),5+2*history_days,15)
    else least(5,3+floor(history_days/3)) end;
  if history_days>=3 then
    select least(cadence,greatest(3,ceil(avg((d->>'posts')::numeric)*1.5))) into cadence from jsonb_array_elements(evidence->'history') d;
  end if;
  cadence:=least(cadence,coalesce((evidence->>'publishCap')::numeric,0));
  if cadence<=0 then return 'PLATFORM_CAP';end if;
  gap:=greatest(60,coalesce((c->>'minimumGapMinutes')::numeric,60),floor(allowed/(cadence*2)));
  if exists(select 1 from public.multi_account_publish_reservations where creator_identity=a.open_id and queue_id<>p_queue and reserved_at>now()-make_interval(secs=>(gap*60)::double precision))
    or exists(select 1 from public.publishing_queue pq join public.tiktok_accounts ta on ta.owner_id=pq.owner_id and ta.id=pq.tiktok_account_id where ta.open_id=a.open_id and pq.id<>p_queue and pq.started_at>now()-make_interval(secs=>(gap*60)::double precision) and pq.external_state in ('SUBMITTING','SUBMITTED_UNKNOWN','SUBMITTED','CONFIRMED')) then return 'RATE_LIMIT';end if;
  return private.reserve_multi_account_publish_limits(p_owner,p_queue);
end $$;
revoke all on function public.reserve_multi_account_publish(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_multi_account_publish(uuid,uuid) to service_role;
