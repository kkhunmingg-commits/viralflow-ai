-- Additive, disabled by default. No alteration of Production Cron or TikTok flags.
create table public.account_automation_settings (
 owner_id uuid not null references public.profiles(id) on delete cascade,
 tiktok_account_id uuid not null, config jsonb not null default '{"enabled":false,"paused":false,"minimumGapMinutes":1,"timezone":"Asia/Bangkok","spreadFullDay":true,"windows":[{"start":0,"end":1440}],"categories":[],"audienceMinutes":[],"priority":50,"dailyBudgetUsd":0,"providerPreference":"AUTO"}',
 updated_at timestamptz not null default now(), primary key(owner_id,tiktok_account_id),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
 check(jsonb_typeof(config)='object')
);
create table public.multi_account_runtime (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 execution_mode text not null default 'SAFE' check(execution_mode in ('SAFE','ENABLED')),
 app_audit_status text not null default 'UNAUDITED' check(app_audit_status in ('UNAUDITED','IN_REVIEW','AUDITED')),
 audited_creator_cap integer check(audited_creator_cap > 0), publishing_enabled boolean not null default false,
 planner_token uuid,planner_expires_at timestamptz,planner_cursor_owner uuid,planner_cursor_account uuid,
 updated_at timestamptz not null default now()
);
insert into public.multi_account_runtime(singleton) values(true);
create table public.multi_account_work (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 tiktok_account_id uuid not null, kind text not null check(kind in ('GENERATE','PUBLISH','RECONCILE')),
 local_day date not null, ordinal integer not null check(ordinal>0), due_at timestamptz not null,
 available_at timestamptz not null, priority integer not null default 50 check(priority between 0 and 100),
 state text not null default 'WAITING' check(state in ('WAITING','CLAIMED','COMPLETE','FAILED','CANCELLED','REVIEW_REQUIRED')),
 reason text, attempts integer not null default 0 check(attempts>=0),
 lease_token uuid, lease_expires_at timestamptz, last_claimed_at timestamptz,
 provider_job_id uuid, publishing_queue_id uuid, creative_project_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,id), unique(owner_id,tiktok_account_id,local_day,kind,ordinal),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
 foreign key(owner_id,provider_job_id) references public.video_provider_jobs(owner_id,id),
 foreign key(owner_id,publishing_queue_id) references public.publishing_queue(owner_id,id),
 foreign key(owner_id,creative_project_id) references public.creative_projects(owner_id,id),
 check((lease_token is null)=(lease_expires_at is null))
);
create unique index multi_account_generation_project on public.multi_account_work(owner_id,creative_project_id) where kind='GENERATE' and creative_project_id is not null;
create unique index multi_account_publish_queue on public.multi_account_work(owner_id,publishing_queue_id,kind) where publishing_queue_id is not null;
create unique index multi_account_provider_reconcile on public.multi_account_work(owner_id,provider_job_id) where kind='RECONCILE' and provider_job_id is not null;
create index multi_account_due on public.multi_account_work(kind,available_at,due_at,priority desc) where state in ('WAITING','CLAIMED');
create index multi_account_owner_day on public.multi_account_work(owner_id,local_day,tiktok_account_id);
create index multi_account_account_lease on public.multi_account_work(owner_id,tiktok_account_id,lease_expires_at) where lease_token is not null;
create table public.multi_account_publish_reservations (
 queue_id uuid primary key references public.publishing_queue(id), owner_id uuid not null,
 tiktok_account_id uuid not null, creator_identity text not null, reserved_at timestamptz not null default now(),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);
create index multi_account_creator_window on public.multi_account_publish_reservations(reserved_at,creator_identity);
create index multi_account_creator_account on public.multi_account_publish_reservations(tiktok_account_id,reserved_at);
create table public.multi_account_worker_health (
 worker_id uuid primary key, last_seen timestamptz not null default now(), result jsonb not null default '{}'
);
alter table public.account_automation_settings enable row level security;
alter table public.multi_account_work enable row level security;
alter table public.multi_account_runtime enable row level security;
alter table public.multi_account_publish_reservations enable row level security;
alter table public.multi_account_worker_health enable row level security;
create policy automation_owner_read on public.account_automation_settings for select to authenticated using(owner_id=(select auth.uid()));
create policy automation_work_owner_read on public.multi_account_work for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.account_automation_settings,public.multi_account_work,public.multi_account_runtime,public.multi_account_publish_reservations,public.multi_account_worker_health from public,anon,authenticated;
grant select on public.account_automation_settings to authenticated;
grant select(id,owner_id,tiktok_account_id,kind,local_day,ordinal,due_at,available_at,priority,state,reason,attempts,created_at,updated_at) on public.multi_account_work to authenticated;
grant all on public.account_automation_settings,public.multi_account_work,public.multi_account_runtime,public.multi_account_publish_reservations,public.multi_account_worker_health to service_role;

create function public.claim_multi_account_work(p_kind text,p_token uuid,p_lease_seconds integer default 180)
returns public.multi_account_work language plpgsql security invoker set search_path='' as $$
declare chosen public.multi_account_work;
begin
 if p_lease_seconds not between 30 and 600 then raise exception 'invalid_lease'; end if;
 -- Lock the runtime row to serialize the short account-lease selection across pooled workers.
 perform 1 from public.multi_account_runtime where singleton for update;
 update public.multi_account_work w set state='CANCELLED',reason='EXPIRED_PLAN',updated_at=now()
 from public.account_automation_settings s where w.owner_id=s.owner_id and w.tiktok_account_id=s.tiktok_account_id
 and w.kind='GENERATE' and w.state='WAITING' and w.provider_job_id is null and w.lease_token is null
 and w.local_day<(now() at time zone (s.config->>'timezone'))::date;
 update public.multi_account_work set lease_token=null,lease_expires_at=null,state='WAITING',updated_at=now()
 where state='CLAIMED' and lease_expires_at<=now();
 select w.* into chosen from public.multi_account_work w
 join public.account_automation_settings s using(owner_id,tiktok_account_id)
 join public.tiktok_accounts a on a.owner_id=w.owner_id and a.id=w.tiktok_account_id
 where w.kind=p_kind and w.state='WAITING' and w.available_at<=now()
 and (p_kind='RECONCILE' or (coalesce((s.config->>'enabled')::boolean,false) and not coalesce((s.config->>'paused')::boolean,false) and a.hidden_at is null and a.authorization_status='authorized'))
 and not exists(select 1 from public.multi_account_work other where other.owner_id=w.owner_id and other.tiktok_account_id=w.tiktok_account_id and other.lease_expires_at>now())
 -- Deadline first; last account claim breaks ties for fair service, then configured priority.
 order by w.due_at,(select max(last_claimed_at) from public.multi_account_work h where h.owner_id=w.owner_id and h.tiktok_account_id=w.tiktok_account_id) nulls first,w.priority desc,w.id
 for update of w skip locked limit 1;
 if chosen.id is null then return null; end if;
 update public.multi_account_work set state='CLAIMED',lease_token=p_token,lease_expires_at=now()+make_interval(secs=>p_lease_seconds),last_claimed_at=now(),updated_at=now(),attempts=attempts+1 where id=chosen.id returning * into chosen;
 return chosen;
end $$;

create function public.finish_multi_account_work(p_owner uuid,p_id uuid,p_token uuid,p_state text,p_reason text,p_retry_at timestamptz default null,p_provider_job uuid default null,p_publish_queue uuid default null,p_project uuid default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if p_state not in ('WAITING','COMPLETE','FAILED','CANCELLED','REVIEW_REQUIRED') then raise exception 'invalid_state'; end if;
 update public.multi_account_work set state=p_state,reason=p_reason,available_at=coalesce(p_retry_at,available_at),
 provider_job_id=coalesce(p_provider_job,provider_job_id),publishing_queue_id=coalesce(p_publish_queue,publishing_queue_id),creative_project_id=coalesce(p_project,creative_project_id),
 lease_token=null,lease_expires_at=null,updated_at=now()
 where owner_id=p_owner and id=p_id and lease_token=p_token and lease_expires_at>now();
 get diagnostics n=row_count;return n=1;
end $$;

create function public.reserve_multi_account_publish(p_owner uuid,p_queue uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare q public.publishing_queue; a public.tiktok_accounts; r public.multi_account_runtime;
 cap integer; active integer; used integer; identity text;
begin
 select * into r from public.multi_account_runtime where singleton for update;
 if not r.enabled or r.execution_mode<>'ENABLED' or not r.publishing_enabled then return 'SAFE_MODE';end if;
 select * into q from public.publishing_queue where owner_id=p_owner and id=p_queue;
 if q.id is null or q.consent_id is null or q.publish_mode<>'DIRECT_POST' then return 'CONSENT_REQUIRED';end if;
 select * into a from public.tiktok_accounts where owner_id=p_owner and id=q.tiktok_account_id;
 if a.open_id is null or a.hidden_at is not null or a.authorization_status<>'authorized' then return 'TOKEN';end if;
 if q.privacy_level is null then return 'CONSENT_REQUIRED';end if;
 if (r.app_audit_status<>'AUDITED' or a.audit_status is distinct from 'AUDITED') and q.privacy_level<>'SELF_ONLY' then return 'PRIVATE_ONLY';end if;
 cap:=case when r.app_audit_status='AUDITED' then r.audited_creator_cap else 5 end;
 if cap is null then return 'APP_CAP_UNKNOWN';end if;
 identity:=a.open_id; -- Service-only table: never sent to the customer.
 select count(distinct creator)::int into active from (
 select creator_identity creator from public.multi_account_publish_reservations where reserved_at>now()-interval '24 hours'
 union select ta.open_id from public.publishing_queue pq join public.tiktok_accounts ta on ta.id=pq.tiktok_account_id where pq.started_at>now()-interval '24 hours' and pq.external_state in ('SUBMITTING','SUBMITTED_UNKNOWN','SUBMITTED','CONFIRMED')
 ) creators where creator<>identity;
 if active>=cap then return 'APP_CAP';end if;
 select min(h.effective_publish_cap) into cap from public.account_publish_health h join public.tiktok_accounts ta on ta.owner_id=h.owner_id and ta.id=h.tiktok_account_id where ta.open_id=identity;
 if cap is null or cap<1 then return 'PLATFORM_CAP';end if;
 select count(distinct queue_id)::int into used from (
 select queue_id from public.multi_account_publish_reservations where creator_identity=identity and reserved_at>now()-interval '24 hours'
 union select pq.id from public.publishing_queue pq join public.tiktok_accounts ta on ta.id=pq.tiktok_account_id where ta.open_id=identity and pq.started_at>now()-interval '24 hours' and pq.external_state in ('SUBMITTING','SUBMITTED_UNKNOWN','SUBMITTED','CONFIRMED')
 ) consumed where queue_id<>p_queue;
 if used>=cap then return 'PLATFORM_CAP';end if;
 -- One init at a time per creator; conservatively slower than the documented 6/minute limit.
 if exists(select 1 from public.multi_account_publish_reservations where creator_identity=identity and reserved_at>now()-interval '1 minute' and queue_id<>p_queue)
 or exists(select 1 from public.publishing_queue pq join public.tiktok_accounts ta on ta.id=pq.tiktok_account_id where ta.open_id=identity and pq.started_at>now()-interval '1 minute' and pq.id<>p_queue and pq.external_state in ('SUBMITTING','SUBMITTED_UNKNOWN','SUBMITTED','CONFIRMED')) then return 'RATE_LIMIT';end if;
 insert into public.multi_account_publish_reservations(queue_id,owner_id,tiktok_account_id,creator_identity) values(q.id,p_owner,a.id,identity) on conflict(queue_id) do nothing;
 return 'READY';
end $$;

create function private.pause_multi_account_removed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.hidden_at is not null or new.authorization_status in ('revoked','disconnected') then
 update public.account_automation_settings set config=jsonb_set(config,'{paused}','true'),updated_at=now() where owner_id=new.owner_id and tiktok_account_id=new.id;
 update public.multi_account_work set state='CANCELLED',reason='ACCOUNT_PAUSED',lease_token=null,lease_expires_at=null,updated_at=now()
 where owner_id=new.owner_id and tiktok_account_id=new.id and state in ('WAITING','CLAIMED') and kind<>'RECONCILE' and provider_job_id is null;
 end if;return new;
end $$;
create trigger multi_account_removed after update of hidden_at,authorization_status on public.tiktok_accounts for each row execute function private.pause_multi_account_removed();
revoke all on function private.pause_multi_account_removed() from public,anon,authenticated;
revoke all on function public.claim_multi_account_work(text,uuid,integer),public.finish_multi_account_work(uuid,uuid,uuid,text,text,timestamptz,uuid,uuid,uuid),public.reserve_multi_account_publish(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_multi_account_work(text,uuid,integer),public.finish_multi_account_work(uuid,uuid,uuid,text,text,timestamptz,uuid,uuid,uuid),public.reserve_multi_account_publish(uuid,uuid) to service_role;

create function public.plan_multi_account_work(p_rows jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare item jsonb; n integer:=0; slot integer;
begin
 for item in select value from jsonb_array_elements(p_rows) loop
 if item->>'kind'='RECONCILE' then
 if exists(select 1 from public.multi_account_work where owner_id=(item->>'ownerId')::uuid and kind='RECONCILE' and (publishing_queue_id=(item->>'queueId')::uuid or provider_job_id=(item->>'providerJobId')::uuid)) then continue;end if;
 select coalesce(max(ordinal),0)+1 into slot from public.multi_account_work where owner_id=(item->>'ownerId')::uuid and tiktok_account_id=(item->>'accountId')::uuid and kind='RECONCILE' and local_day=(item->>'day')::date;
 item:=jsonb_set(item,'{ordinal}',to_jsonb(slot));
 end if;
 if not exists(select 1 from public.account_automation_settings s join public.tiktok_accounts a on a.owner_id=s.owner_id and a.id=s.tiktok_account_id
 where s.owner_id=(item->>'ownerId')::uuid and s.tiktok_account_id=(item->>'accountId')::uuid
 and (item->>'kind'='RECONCILE' or ((s.config->>'enabled')::boolean and not (s.config->>'paused')::boolean and a.hidden_at is null and a.authorization_status='authorized'))) then continue;end if;
 insert into public.multi_account_work(owner_id,tiktok_account_id,kind,local_day,ordinal,due_at,available_at,priority,publishing_queue_id,provider_job_id)
 values((item->>'ownerId')::uuid,(item->>'accountId')::uuid,item->>'kind',(item->>'day')::date,(item->>'ordinal')::int,(item->>'dueAt')::timestamptz,(item->>'availableAt')::timestamptz,(item->>'priority')::int,(item->>'queueId')::uuid,(item->>'providerJobId')::uuid)
 on conflict do nothing;n:=n+1;
 -- Never overwrite a completed ordinal, an external operation or a lease during replanning.
 update public.multi_account_work set due_at=(item->>'dueAt')::timestamptz,available_at=(item->>'availableAt')::timestamptz,priority=(item->>'priority')::int
 where owner_id=(item->>'ownerId')::uuid and tiktok_account_id=(item->>'accountId')::uuid and kind=item->>'kind' and local_day=(item->>'day')::date and ordinal=(item->>'ordinal')::int and state='WAITING' and lease_token is null and provider_job_id is null and publishing_queue_id is null and reason is null;
 end loop;return n;
end $$;
create function public.multi_account_overview(p_owner uuid) returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name,'username',a.username,'connected',a.authorization_status='authorized' and a.account_status='active' and not a.is_mock,'tokenReady',a.token_expires_at>now() or a.refresh_token_expires_at>now(),'config',s.config,
 'produced',(select count(*) from public.master_videos m where m.owner_id=p_owner and m.tiktok_account_id=a.id and (m.created_at at time zone coalesce(s.config->>'timezone','Asia/Bangkok'))::date=(now() at time zone coalesce(s.config->>'timezone','Asia/Bangkok'))::date and m.storage_path is not null),
 'ready',(select count(*) from public.master_videos m where m.owner_id=p_owner and m.tiktok_account_id=a.id and m.quality_status='PASS' and m.status in ('READY','APPROVED') and m.storage_path is not null and (select ec.final_status from public.publish_eligibility_checks ec where ec.owner_id=p_owner and ec.video_id=m.id order by ec.created_at desc,ec.id desc limit 1) in ('READY_FOR_REVIEW','READY_TO_PUBLISH') and not exists(select 1 from public.publishing_queue pq where pq.owner_id=p_owner and pq.video_id=m.id and pq.status not in ('CANCELLED','REJECTED','FAILED'))),
 'published',(select count(*) from public.publishing_queue pq where pq.owner_id=p_owner and pq.tiktok_account_id=a.id and pq.status='PUBLISHED' and (pq.completed_at at time zone coalesce(s.config->>'timezone','Asia/Bangkok'))::date=(now() at time zone coalesce(s.config->>'timezone','Asia/Bangkok'))::date),
 'lastPublish',(select max(completed_at) from public.publishing_queue pq where pq.owner_id=p_owner and pq.tiktok_account_id=a.id and pq.status='PUBLISHED'),
 'nextPublish',(select min(due_at) from public.multi_account_work w where w.owner_id=p_owner and w.tiktok_account_id=a.id and w.kind='PUBLISH' and w.state in ('WAITING','CLAIMED')),
 'waiting',(select count(*) from public.multi_account_work w where w.owner_id=p_owner and w.tiktok_account_id=a.id and w.state in ('WAITING','CLAIMED')),
 'failed',(select count(*) from public.multi_account_work w where w.owner_id=p_owner and w.tiktok_account_id=a.id and w.state='FAILED'),
 'publishCap',(select effective_publish_cap from public.account_publish_health h where h.owner_id=p_owner and h.tiktok_account_id=a.id),
 'estimatedToday',(select coalesce(sum(r.reserved_usd),0) from public.generation_budget_reservations r where r.owner_id=p_owner and r.tiktok_account_id=a.id and r.budget_day=current_date and r.state in ('RESERVED','SETTLED')),
 'actualToday',(select case when count(*) filter(where r.state='RESERVED' and r.actual_usd is null)>0 then null else sum(r.actual_usd) end from public.generation_budget_reservations r where r.owner_id=p_owner and r.tiktok_account_id=a.id and r.budget_day=current_date and r.state in ('RESERVED','SETTLED'))
 ) order by a.created_at),'[]'::jsonb)
 from public.tiktok_accounts a left join public.account_automation_settings s on s.owner_id=a.owner_id and s.tiktok_account_id=a.id where a.owner_id=p_owner and a.hidden_at is null;
$$;
create index multi_account_ready_master on public.master_videos(owner_id,tiktok_account_id,created_at) where storage_path is not null;
create index multi_account_publish_history on public.publishing_queue(owner_id,tiktok_account_id,completed_at) where status='PUBLISHED';
create index multi_account_global_publish_window on public.publishing_queue(started_at,tiktok_account_id) where external_state in ('SUBMITTING','SUBMITTED_UNKNOWN','SUBMITTED','CONFIRMED');
revoke all on function public.plan_multi_account_work(jsonb),public.multi_account_overview(uuid) from public,anon,authenticated;
grant execute on function public.plan_multi_account_work(jsonb),public.multi_account_overview(uuid) to service_role;

create function public.claim_multi_account_planner(p_token uuid) returns public.multi_account_runtime language plpgsql security invoker set search_path='' as $$
declare r public.multi_account_runtime;
begin
 select * into r from public.multi_account_runtime where singleton for update;
 if not r.enabled or r.planner_expires_at>now() then return null;end if;
 update public.multi_account_runtime set planner_token=p_token,planner_expires_at=now()+interval '90 seconds' where singleton returning * into r;
 return r;
end $$;
create function public.multi_account_monitor() returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('waiting',(select count(*) from public.multi_account_work where state='WAITING'),'leased',(select count(*) from public.multi_account_work where lease_expires_at>now()),'expiredLeases',(select count(*) from public.multi_account_work where lease_expires_at<=now()),'review',(select count(*) from public.multi_account_work where state='REVIEW_REQUIRED'),
 'budgetHeld',(select coalesce(sum(reserved_usd),0) from public.generation_budget_reservations where state='RESERVED' and budget_day=current_date),'billingUnconfirmed',(select count(*) from public.generation_budget_reservations where state='RESERVED' and actual_usd is null),
 'googleAssistedCapacity',null,'googleHealthSource','OWNER_REPORTED','assistedOwners',(select count(*) from public.video_provider_settings where config->>'googleStatus'='ASSISTED'),'providerInFlight',(select count(*) from public.video_provider_jobs where provider='fal_ai' and state='PROCESSING'));
$$;
revoke all on function public.claim_multi_account_planner(uuid),public.multi_account_monitor() from public,anon,authenticated;
grant execute on function public.claim_multi_account_planner(uuid),public.multi_account_monitor() to service_role;

create table public.multi_account_day_seeds (
 owner_id uuid not null, tiktok_account_id uuid not null,local_day date not null,seed uuid not null default gen_random_uuid(),
 primary key(owner_id,tiktok_account_id,local_day),foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);
alter table public.multi_account_day_seeds enable row level security;
revoke all on public.multi_account_day_seeds from public,anon,authenticated;
grant all on public.multi_account_day_seeds to service_role;
create function public.multi_account_day_seed(p_owner uuid,p_account uuid,p_day date) returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 insert into public.multi_account_day_seeds(owner_id,tiktok_account_id,local_day)values(p_owner,p_account,p_day)on conflict do nothing;
 select seed into result from public.multi_account_day_seeds where owner_id=p_owner and tiktok_account_id=p_account and local_day=p_day;return result;
end $$;
create function public.multi_account_frequency_evidence(p_owner uuid,p_account uuid) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object(
 'history',(select coalesce(jsonb_agg(jsonb_build_object('posts',posts_published,'views',views,'engagements',likes+comments+shares) order by stat_date),'[]') from public.account_daily_stats where owner_id=p_owner and tiktok_account_id=p_account and stat_date>=current_date-28),
 'publishCap',(select effective_publish_cap from public.account_publish_health where owner_id=p_owner and tiktok_account_id=p_account),
 'producedToday',(select count(*) from public.master_videos where owner_id=p_owner and tiktok_account_id=p_account and quality_status='PASS' and created_at>=date_trunc('day',now())),
 'publishedToday',(select count(*) from public.publishing_queue where owner_id=p_owner and tiktok_account_id=p_account and status='PUBLISHED' and completed_at>=date_trunc('day',now())),
 'budgetSpentToday',(select coalesce(sum(case when state='SETTLED' then actual_usd else reserved_usd end),0) from public.generation_budget_reservations where owner_id=p_owner and tiktok_account_id=p_account and state in ('RESERVED','SETTLED') and budget_day=current_date),
 'ready',(select count(*) from public.master_videos m where m.owner_id=p_owner and m.tiktok_account_id=p_account and m.quality_status='PASS' and m.status in ('READY','APPROVED') and m.storage_path is not null and (select ec.final_status from public.publish_eligibility_checks ec where ec.owner_id=p_owner and ec.video_id=m.id order by ec.created_at desc,ec.id desc limit 1) in ('READY_FOR_REVIEW','READY_TO_PUBLISH') and not exists(select 1 from public.publishing_queue pq where pq.owner_id=p_owner and pq.video_id=m.id and pq.status not in ('CANCELLED','REJECTED','FAILED'))),
 'candidates',(select count(*) from public.creative_projects cp where cp.owner_id=p_owner and cp.tiktok_account_id=p_account and cp.selected_script_id is not null and not exists(select 1 from public.master_videos m where m.owner_id=p_owner and m.creative_project_id=cp.id) and not exists(select 1 from public.multi_account_work w where w.owner_id=p_owner and w.creative_project_id=cp.id)),
 'estimatedUnitCost',(select coalesce(actual_cost_usd,(checkpoint->'request'->>'estimateUsd')::numeric) from public.video_provider_jobs where owner_id=p_owner and tiktok_account_id=p_account and provider='fal_ai' and checkpoint->'request'->>'estimateUsd' is not null order by created_at desc limit 1),
 'measuredGenerationPerDay',(select case when count(*) filter(where state='COMPLETED')=0 then null else 86400/nullif(avg(extract(epoch from(updated_at-created_at))),0)*count(*) filter(where state='COMPLETED')/count(*) end from public.video_provider_jobs where owner_id=p_owner and tiktok_account_id=p_account and provider='fal_ai' and state in ('COMPLETED','FAILED','REVIEW_REQUIRED') and updated_at>created_at and created_at>=now()-interval '28 days')
 );
$$;
revoke all on function public.multi_account_day_seed(uuid,uuid,date),public.multi_account_frequency_evidence(uuid,uuid) from public,anon,authenticated;
grant execute on function public.multi_account_day_seed(uuid,uuid,date),public.multi_account_frequency_evidence(uuid,uuid) to service_role;
create function public.multi_account_advice_inputs(p_owner uuid) returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(a.id,public.multi_account_frequency_evidence(p_owner,a.id)),'{}') from public.tiktok_accounts a where a.owner_id=p_owner and a.hidden_at is null;
$$;
revoke all on function public.multi_account_advice_inputs(uuid) from public,anon,authenticated;
grant execute on function public.multi_account_advice_inputs(uuid) to service_role;
create index multi_account_latest_eligibility on public.publish_eligibility_checks(owner_id,video_id,created_at desc);
create index multi_account_provider_measurement on public.video_provider_jobs(owner_id,tiktok_account_id,created_at desc) where provider='fal_ai';
