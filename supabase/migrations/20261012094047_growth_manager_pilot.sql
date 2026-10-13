-- One selected experimental account, not an account-registration ceiling. Disabled until owner opt-in.
create table public.growth_pilot_allowlist(
 singleton boolean primary key default true check(singleton),owner_id uuid not null,
 tiktok_account_id uuid not null,enabled boolean not null default false,health_confirmed boolean not null default false,
 policy jsonb not null check(jsonb_typeof(policy)='object'),started_at timestamptz,
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);
create table public.growth_pilot_plans(
 owner_id uuid not null,tiktok_account_id uuid not null,local_day date not null,decision jsonb not null,slots jsonb not null,
 evidence_hash text not null,changed_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(owner_id,tiktok_account_id,local_day),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
 check(jsonb_typeof(slots)='array' and jsonb_typeof(decision)='object')
);
alter table public.growth_pilot_allowlist enable row level security;
alter table public.growth_pilot_plans enable row level security;
revoke all on public.growth_pilot_allowlist,public.growth_pilot_plans from public,anon,authenticated;
grant all on public.growth_pilot_allowlist,public.growth_pilot_plans to service_role;
-- Customer access is through authenticated, owner-scoped actions with sanitized projections only.

create function public.growth_pilot_facts(p_owner uuid) returns jsonb language sql security invoker set search_path='' as $$
 with pilot as (select * from public.growth_pilot_allowlist where owner_id=p_owner),
 a as (select a.* from public.tiktok_accounts a join pilot p on p.owner_id=a.owner_id and p.tiktok_account_id=a.id),
 snapshots as (
 select distinct on(s.external_video_id) s.* from public.video_analytics_snapshots s join pilot p on p.owner_id=s.owner_id and p.tiktok_account_id=s.tiktok_account_id
 where s.source='TIKTOK_DISPLAY' and s.source_confidence>0 and s.published_at is not null and s.source_snapshot_at<=now() and s.source_snapshot_at>=now()-interval '7 days' and s.published_at>=now()-interval '28 days'
 order by s.external_video_id,s.source_snapshot_at desc,s.id desc
 ), topics as (
 select regexp_replace(slot->>'postUrl','^.*/video/','') post_id,slot->>'topic' topic from public.growth_pilot_plans plan join pilot p using(owner_id,tiktok_account_id) cross join lateral jsonb_array_elements(plan.slots) slot where slot->>'state'='MANUAL_REPORTED'
 )
 select case when (select count(*) from pilot)=0 then null else jsonb_build_object(
 'pilot',(select to_jsonb(p) from pilot p),
 'topicEvidence',(select coalesce(jsonb_agg(jsonb_build_object('name',c.display_name,'key',c.category_key,'source','tiktok_shop','capturedAt',s.captured_at,'authorized',true,'confidence',s.data_confidence,'momentum',s.median_product_momentum,'accountEffect',null)),'[]')
 from public.categories c join lateral (select * from public.category_snapshots s where s.owner_id=c.owner_id and s.category_id=c.id and s.captured_at<=now() and s.captured_at>=now()-interval '7 days' order by s.captured_at desc limit 1) s on true
 where c.owner_id=p_owner and c.provider='tiktok_shop' and c.status='active' and s.data_confidence>0
 and exists(select 1 from public.tiktok_shop_connections conn join pilot p on p.owner_id=conn.owner_id and p.tiktok_account_id=conn.tiktok_account_id
 where not conn.is_mock and conn.provider='tiktok_shop' and conn.authorization_status='AUTHORIZED' and conn.api_access_status='AVAILABLE' and conn.last_synced_at>=now()-interval '24 hours' and conn.last_synced_at<=now())),
 'account',(select jsonb_build_object('name',display_name,'username',username,'isMock',is_mock,'authorization',authorization_status,'status',account_status,'hidden',hidden_at is not null,'audit',audit_status,'directPost',direct_post_status,'publishGranted','video.publish'=any(granted_scopes),'tokenReady',token_expires_at>now() or refresh_token_expires_at>now()) from a),
 'health',(select h.health_status from public.account_publish_health h join pilot p using(owner_id,tiktok_account_id)),
 'publishCap',(select case when observed_platform_cap>=0 then least(effective_publish_cap,observed_platform_cap) else null end from public.account_publish_health h join pilot p using(owner_id,tiktok_account_id)),
 'posts',(select coalesce(jsonb_agg(jsonb_build_object('id',s.external_video_id,'source',s.source,'confidence',s.source_confidence,'publishedAt',s.published_at,'capturedAt',s.source_snapshot_at,'topic',t.topic,'views',s.views,'likes',s.likes,'comments',s.comments,'shares',s.shares,'averageWatchTime',null,'retention',null,'completionRate',null,'followersGained',null)),'[]') from snapshots s left join topics t on t.post_id=s.external_video_id),
 'followers',(select coalesce(jsonb_agg(jsonb_build_object('at',s.source_snapshot_at,'count',s.follower_count,'source',s.source) order by s.source_snapshot_at),'[]') from public.account_analytics_snapshots s join pilot p using(owner_id,tiktok_account_id) where s.source='TIKTOK_DISPLAY' and s.source_confidence>0 and s.follower_count is not null and s.source_snapshot_at<=now() and s.source_snapshot_at>=coalesce(p.started_at,now()-interval '28 days')-interval '1 day'),
 'lastPublishedAt',(select max(completed_at) from public.publishing_queue q join pilot p using(owner_id,tiktok_account_id) where q.status='PUBLISHED'),
 'publishedToday',(select count(*) from public.publishing_queue q join pilot p using(owner_id,tiktok_account_id) left join public.account_automation_settings c using(owner_id,tiktok_account_id) where q.status='PUBLISHED' and q.completed_at>=date_trunc('day',now() at time zone coalesce(c.config->>'timezone','Asia/Bangkok')) at time zone coalesce(c.config->>'timezone','Asia/Bangkok'))
 ) end;
$$;

create function public.save_growth_pilot_plan(p_owner uuid,p_day date,p_decision jsonb,p_slots jsonb,p_hash text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare p public.growth_pilot_allowlist; old public.growth_pilot_plans; prior public.growth_pilot_plans;
begin
 select * into p from public.growth_pilot_allowlist where singleton and owner_id=p_owner for update;
 if p.owner_id is null or not p.enabled then return false;end if;
 if not exists(select 1 from public.tiktok_accounts a where a.owner_id=p.owner_id and a.id=p.tiktok_account_id and not a.is_mock and a.hidden_at is null and a.authorization_status='authorized' and a.account_status='active') then return false;end if;
 select * into old from public.growth_pilot_plans where owner_id=p_owner and tiktok_account_id=p.tiktok_account_id and local_day=p_day for update;
 if old.evidence_hash=p_hash then return true;end if;
 if old.slots is not null then
   -- Preserve recorded manual outcomes across replanning, retries and process restarts.
   select coalesce(jsonb_agg(slot order by (slot->>'ordinal')::int),'[]') into p_slots from (
     select value slot from jsonb_array_elements(old.slots) where value->>'state'='MANUAL_REPORTED'
     union all select fresh from jsonb_array_elements(p_slots) fresh where not exists(select 1 from jsonb_array_elements(old.slots) recorded where recorded->>'state'='MANUAL_REPORTED' and recorded->>'ordinal'=fresh->>'ordinal')
   ) merged;
 end if;
 select * into prior from public.growth_pilot_plans where owner_id=p_owner and tiktok_account_id=p.tiktok_account_id and local_day<p_day order by local_day desc limit 1;
 insert into public.growth_pilot_plans(owner_id,tiktok_account_id,local_day,decision,slots,evidence_hash,changed_at)values(p_owner,p.tiktok_account_id,p_day,p_decision,p_slots,p_hash,case when prior.decision->>'recommended'=p_decision->>'recommended' then prior.changed_at else now() end)
 on conflict(owner_id,tiktok_account_id,local_day)do update set decision=excluded.decision,slots=excluded.slots,evidence_hash=excluded.evidence_hash,
 changed_at=case when (growth_pilot_plans.decision->>'recommended')::int is distinct from (excluded.decision->>'recommended')::int then now() else growth_pilot_plans.changed_at end,updated_at=now();
 return true;
end $$;

-- All existing paid generation paths use the atomic budget ledger. Deny a new hold for the Pilot,
-- even if a caller accidentally selects fal or a browser calls the existing paid UI directly.
create function private.growth_pilot_no_paid_hold() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.state='RESERVED' and (tg_op='INSERT' or old.state is distinct from 'RESERVED') and exists(select 1 from public.growth_pilot_allowlist where singleton and enabled and owner_id=new.owner_id and tiktok_account_id=new.tiktok_account_id) then raise exception 'GROWTH_PILOT_PAID_DISABLED';end if;
 return new;
end $$;
revoke all on function private.growth_pilot_no_paid_hold() from public,anon,authenticated;
create trigger growth_pilot_no_paid_hold before insert or update on public.generation_budget_reservations for each row execute function private.growth_pilot_no_paid_hold();
revoke all on function public.growth_pilot_facts(uuid),public.save_growth_pilot_plan(uuid,date,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.growth_pilot_facts(uuid),public.save_growth_pilot_plan(uuid,date,jsonb,jsonb,text) to service_role;

create function public.report_growth_pilot_manual_post(p_owner uuid,p_day date,p_ordinal integer,p_url text)returns boolean language plpgsql security invoker set search_path='' as $$
declare p public.growth_pilot_allowlist; plan public.growth_pilot_plans;
begin
 select * into p from public.growth_pilot_allowlist where singleton and owner_id=p_owner and enabled for update;
 if p.owner_id is null or p_url!~'^https://www[.]tiktok[.]com/@[a-zA-Z0-9_.]+/video/[0-9]{1,40}$' then return false;end if;
 if not exists(select 1 from public.tiktok_accounts a where a.owner_id=p_owner and a.id=p.tiktok_account_id and lower(a.username)=lower(split_part(split_part(p_url,'/@',2),'/video/',1))) then return false;end if;
 select * into plan from public.growth_pilot_plans where owner_id=p_owner and tiktok_account_id=p.tiktok_account_id and local_day=p_day for update;
 if plan.owner_id is null or not exists(select 1 from jsonb_array_elements(plan.slots) s where (s->>'ordinal')::int=p_ordinal) then return false;end if;
 if exists(select 1 from jsonb_array_elements(plan.slots) s where (s->>'ordinal')::int=p_ordinal and s->>'state'='MANUAL_REPORTED') then return false;end if;
 if exists(select 1 from public.growth_pilot_plans prior cross join lateral jsonb_array_elements(prior.slots) s where prior.owner_id=p_owner and prior.tiktok_account_id=p.tiktok_account_id and s->>'postUrl'=p_url) then return false;end if;
 update public.growth_pilot_plans set slots=(select jsonb_agg(case when (s->>'ordinal')::int=p_ordinal then s||jsonb_build_object('state','MANUAL_REPORTED','postUrl',p_url,'reportedAt',now()) else s end order by (s->>'ordinal')::int) from jsonb_array_elements(plan.slots) s),updated_at=now() where owner_id=p_owner and tiktok_account_id=p.tiktok_account_id and local_day=p_day;
 return true;
end $$;
revoke all on function public.report_growth_pilot_manual_post(uuid,date,integer,text) from public,anon,authenticated;
grant execute on function public.report_growth_pilot_manual_post(uuid,date,integer,text) to service_role;
