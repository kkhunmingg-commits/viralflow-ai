-- Classification is independent of enrollment: no account ceiling, no opt-in by discovery.
create table public.auto_account_discovery(
 owner_id uuid not null,tiktok_account_id uuid not null,
 mode text not null default 'GROWTH' check(mode in ('GROWTH','AFFILIATE')),
 reason text not null default 'FOLLOWERS_UNKNOWN', followers bigint check(followers>=0),
 verified boolean not null default false, can_execute boolean not null default false,
 affiliate_allowed boolean not null default false, observed_at timestamptz,valid_until timestamptz,
 next_sync_at timestamptz not null default now(), failures integer not null default 0,
 lease_token uuid,lease_expires_at timestamptz,
 primary key(owner_id,tiktok_account_id),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);
alter table public.auto_account_discovery enable row level security;
revoke all on public.auto_account_discovery from public,anon,authenticated;
grant all on public.auto_account_discovery to service_role;
create index auto_account_discovery_due on public.auto_account_discovery(next_sync_at,owner_id,tiktok_account_id);

create function public.claim_auto_account_sync(p_token uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.auto_account_discovery; a public.tiktok_accounts; opted boolean; commerce jsonb;
begin
 insert into public.auto_account_discovery(owner_id,tiktok_account_id)
 select owner_id,id from public.tiktok_accounts where not is_mock and hidden_at is null and authorization_status='authorized'
 on conflict do nothing;
 select s.* into d from public.auto_account_discovery s join public.tiktok_accounts acct on acct.owner_id=s.owner_id and acct.id=s.tiktok_account_id
 where s.next_sync_at<=now() and (s.lease_expires_at is null or s.lease_expires_at<now())
 and not acct.is_mock and acct.hidden_at is null and acct.authorization_status='authorized'
 order by s.next_sync_at,s.owner_id,s.tiktok_account_id limit 1 for update of s skip locked;
 if d.owner_id is null then return null;end if;
 select * into a from public.tiktok_accounts where owner_id=d.owner_id and id=d.tiktok_account_id;
 select coalesce(bool_or(coalesce((config->>'enabled')::boolean,false) and not coalesce((config->>'paused')::boolean,false)),false)
 into opted from public.account_automation_settings where owner_id=d.owner_id and tiktok_account_id=d.tiktok_account_id;
 opted:=opted or exists(select 1 from public.growth_pilot_allowlist where owner_id=d.owner_id and tiktok_account_id=d.tiktok_account_id and enabled);
 -- Reuse existing Shop provenance; mock, unapproved or stale profiles cannot grant Affiliate.
 select jsonb_build_object('at',p.synced_at,'source',c.provider,'authorized',c.authorization_status='AUTHORIZED' and c.api_access_status='AVAILABLE' and c.token_expires_at>now(),
 'eligible',p.affiliate_eligible and p.commerce_status='AFFILIATE_READY','ecommerce',p.ecommerce_permission,'cart',p.cart_permission) into commerce
 from public.creator_commerce_profiles p join public.tiktok_shop_connections c on c.owner_id=p.owner_id and c.id=p.shop_connection_id
 where p.owner_id=d.owner_id and p.tiktok_account_id=d.tiktok_account_id and not c.is_mock and c.provider='tiktok_shop'
 and p.synced_at<=now() and p.synced_at>=now()-interval '24 hours';
 update public.auto_account_discovery set lease_token=p_token,lease_expires_at=now()+interval '60 seconds',can_execute=false
 where owner_id=d.owner_id and tiktok_account_id=d.tiktok_account_id;
 return jsonb_build_object('owner',d.owner_id,'account',d.tiktok_account_id,'identity',a.open_id,'previousMode',d.mode,
 'optedIn',opted,'connected',a.account_status='active','scopes',a.granted_scopes,'commerce',commerce,
 'manualVideoIds',(select coalesce(jsonb_agg(post_id order by last_capture nulls first,post_id),'[]') from(
 select distinct regexp_replace(slot->>'postUrl','^.*/video/','') post_id,
 (select max(source_snapshot_at) from public.video_analytics_snapshots snap where snap.owner_id=d.owner_id and snap.tiktok_account_id=d.tiktok_account_id and snap.source='TIKTOK_DISPLAY' and snap.external_video_id=regexp_replace(slot->>'postUrl','^.*/video/','')) last_capture
 from public.growth_pilot_plans plan cross join lateral jsonb_array_elements(plan.slots) slot
 where plan.owner_id=d.owner_id and plan.tiktok_account_id=d.tiktok_account_id and plan.local_day>=current_date-28 and slot->>'state'='MANUAL_REPORTED'
 and exists(select 1 from public.growth_pilot_allowlist where owner_id=d.owner_id and tiktok_account_id=d.tiktok_account_id and enabled)
 ) reported));
end $$;

create function public.record_auto_account_sync(p_owner uuid,p_account uuid,p_token uuid,p_result jsonb)returns boolean
language plpgsql security invoker set search_path='' as $$
declare d public.auto_account_discovery; a public.tiktok_accounts; opted boolean; valid boolean; stamp timestamptz; conflict boolean;
begin
 select * into d from public.auto_account_discovery where owner_id=p_owner and tiktok_account_id=p_account and lease_token=p_token and lease_expires_at>now() for update;
 if d.owner_id is null then return false;end if;
 select * into a from public.tiktok_accounts where owner_id=p_owner and id=p_account for update;
 select coalesce(bool_or(coalesce((config->>'enabled')::boolean,false) and not coalesce((config->>'paused')::boolean,false)),false)
 into opted from public.account_automation_settings where owner_id=p_owner and tiktok_account_id=p_account;
 opted:=opted or exists(select 1 from public.growth_pilot_allowlist where owner_id=p_owner and tiktok_account_id=p_account and enabled);
 stamp:=(p_result->>'observedAt')::timestamptz;
 conflict:=coalesce(d.observed_at=stamp and d.followers is distinct from (p_result->>'followers')::bigint,false);
 valid:=coalesce((p_result->>'verified')::boolean,false) and stamp<=now() and stamp>=now()-interval '24 hours'
 and not conflict and (d.observed_at is null or stamp>=d.observed_at) and not a.is_mock and a.hidden_at is null and a.authorization_status='authorized';
 update public.auto_account_discovery set mode=case when not coalesce(valid,false) and not coalesce((p_result->>'commerceRevoked')::boolean,false) then d.mode else p_result->>'mode' end,reason=case when conflict then 'FOLLOWER_OBSERVATION_CONFLICT' else p_result->>'reason' end,
 followers=case when valid then (p_result->>'followers')::bigint else null end,verified=coalesce(valid,false),
 can_execute=coalesce(valid and opted and a.account_status='active' and (p_result->>'canExecute')::boolean,false),
 affiliate_allowed=coalesce(valid and (p_result->>'affiliateAllowed')::boolean,false),observed_at=case when valid then stamp else observed_at end,
 valid_until=case when valid then least((p_result->>'validUntil')::timestamptz,stamp+interval '24 hours') else null end,
 failures=case when valid then 0 else failures+1 end,
 next_sync_at=now()+case when p_result->>'failure'='FOLLOWER_SYNC_FAILED' then make_interval(mins=>least(360,5*(2^least(6,failures))::integer)) else interval '12 hours' end,
 lease_token=null,lease_expires_at=null where owner_id=p_owner and tiktok_account_id=p_account;
 if valid then
  insert into public.account_analytics_snapshots(owner_id,tiktok_account_id,source,source_snapshot_at,follower_count,source_confidence,availability_json)
  values(p_owner,p_account,'TIKTOK_DISPLAY',stamp,(p_result->>'followers')::bigint,1,'{"followers":"AVAILABLE"}') on conflict do nothing;
 end if;
 -- No historical jobs, analytics, attachments or external IDs are deleted. Only enrolled accounts change execution mode.
 if opted and valid then
  update public.tiktok_accounts set mode='AUTO',follower_count=(p_result->>'followers')::bigint,
  shop_creator_eligible=(p_result->>'affiliateAllowed')::boolean,ecommerce_permission=(p_result->>'affiliateAllowed')::boolean,
  cart_enabled=(p_result->>'affiliateAllowed')::boolean where owner_id=p_owner and id=p_account;
 elsif opted and coalesce((p_result->>'commerceRevoked')::boolean,false) and p_result->>'mode'='GROWTH' and d.mode='AFFILIATE' then
  update public.tiktok_accounts set shop_creator_eligible=false,ecommerce_permission=false,cart_enabled=false where owner_id=p_owner and id=p_account;
 end if;
 return true;
end $$;
revoke all on function public.claim_auto_account_sync(uuid),public.record_auto_account_sync(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_auto_account_sync(uuid),public.record_auto_account_sync(uuid,uuid,uuid,jsonb) to service_role;

create function private.growth_plan_requires_verified_account()returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from jsonb_array_elements(new.slots) slot where slot->>'state'='ASSISTED') and not exists(
 select 1 from public.auto_account_discovery where owner_id=new.owner_id and tiktok_account_id=new.tiktok_account_id and can_execute and verified and mode='GROWTH' and valid_until>now() and (lease_expires_at is null or lease_expires_at<=now())) then raise exception 'GROWTH_ACCOUNT_EVIDENCE_REQUIRED';end if;
 return new;
end $$;
revoke all on function private.growth_plan_requires_verified_account() from public,anon,authenticated;
create trigger growth_plan_requires_verified_account before insert or update on public.growth_pilot_plans for each row execute function private.growth_plan_requires_verified_account();

create function public.record_growth_manual_analytics(p_owner uuid,p_account uuid,p_token uuid,p_observations jsonb)returns boolean
language plpgsql security invoker set search_path='' as $$
declare row jsonb;
begin
 if not exists(select 1 from public.auto_account_discovery d where d.owner_id=p_owner and d.tiktok_account_id=p_account and d.lease_token=p_token and d.lease_expires_at>now())
 or not exists(select 1 from public.growth_pilot_allowlist where owner_id=p_owner and tiktok_account_id=p_account and enabled)
 or not exists(select 1 from public.tiktok_accounts where owner_id=p_owner and id=p_account and authorization_status='authorized' and hidden_at is null and not is_mock and 'video.list'=any(granted_scopes)) then return false;end if;
 for row in select value from jsonb_array_elements(p_observations) loop
  if row->>'source'<>'TIKTOK_DISPLAY' or (row->>'sourceConfidence')::numeric<=0 or (row->>'publishedAt')::timestamptz>now() or (row->>'capturedAt')::timestamptz>now() then return false;end if;
  if not exists(select 1 from public.growth_pilot_plans plan cross join lateral jsonb_array_elements(plan.slots) slot where plan.owner_id=p_owner and plan.tiktok_account_id=p_account and slot->>'state'='MANUAL_REPORTED' and regexp_replace(slot->>'postUrl','^.*/video/','')=row->>'externalVideoId') then return false;end if;
 end loop;
 insert into public.video_analytics_snapshots(owner_id,tiktok_account_id,video_id,video_kind,external_video_id,source,source_confidence,source_snapshot_at,published_at,views,likes,comments,shares,availability_json)
 select p_owner,p_account,(r->>'videoId')::uuid,'EXTERNAL',r->>'externalVideoId','TIKTOK_DISPLAY',(r->>'sourceConfidence')::numeric,(r->>'capturedAt')::timestamptz,(r->>'publishedAt')::timestamptz,(r->>'views')::bigint,(r->>'likes')::bigint,(r->>'comments')::bigint,(r->>'shares')::bigint,
 '{"watchTime":"UNKNOWN","retention":"UNKNOWN","completionRate":"UNKNOWN","followersGained":"UNKNOWN","orders":"UNKNOWN"}' from jsonb_array_elements(p_observations) r
 on conflict(owner_id,source,external_video_id,source_snapshot_at)do nothing;
 return true;
end $$;
revoke all on function public.record_growth_manual_analytics(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_growth_manual_analytics(uuid,uuid,uuid,jsonb) to service_role;
