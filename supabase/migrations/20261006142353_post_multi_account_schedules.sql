-- Account-scoped POST automation. Existing evidence/history is retained.
alter table public.auto_runs
  add column tiktok_account_id uuid,
  add column posting_mode text not null default 'AUTO' check(posting_mode in ('AUTO','DRAFT','EXPORT')),
  add column schedule_slot_key text,
  add constraint auto_runs_account_owner_fk foreign key(owner_id,tiktok_account_id)
    references public.tiktok_accounts(owner_id,id);

update public.auto_runs r set tiktok_account_id=s.tiktok_account_id
from (select auto_run_id,(array_agg(tiktok_account_id))[1] tiktok_account_id
      from public.auto_account_states group by auto_run_id having count(*)=1) s
where r.id=s.auto_run_id;
-- Terminal legacy parents cannot leave an account reserved forever.
update public.auto_account_states s set state=r.state
from public.auto_runs r where r.id=s.auto_run_id and r.owner_id=s.owner_id
  and r.state in ('COMPLETED','STOPPED','FAILED')
  and s.state not in ('COMPLETED','STOPPED','FAILED');
-- Align old account cursors with their actual append-only evidence; no evidence is rewritten.
update public.auto_account_states s set checkpoint_version=cp.version
from (select owner_id,auto_run_id,tiktok_account_id,max(checkpoint_version) version
      from public.auto_checkpoints where tiktok_account_id is not null group by owner_id,auto_run_id,tiktok_account_id) cp
where s.owner_id=cp.owner_id and s.auto_run_id=cp.auto_run_id and s.tiktok_account_id=cp.tiktok_account_id and s.checkpoint_version<cp.version;
drop index public.auto_runs_one_active_per_owner_idx;
-- Waiting, paused and blocked work keeps its account reservation.
create unique index auto_account_states_one_active_per_account_idx
  on public.auto_account_states(owner_id,tiktok_account_id)
  where state not in ('COMPLETED','STOPPED','FAILED');
create unique index auto_runs_one_active_per_account_idx
  on public.auto_runs(owner_id,tiktok_account_id)
  where tiktok_account_id is not null and state not in ('COMPLETED','STOPPED','FAILED');
create unique index auto_runs_schedule_slot_unique_idx on public.auto_runs(owner_id,schedule_slot_key)
  where schedule_slot_key is not null;
alter table public.auto_account_states add column last_execution_scan_at timestamptz;
create index auto_accounts_execution_fair_scan_idx on public.auto_account_states(last_execution_scan_at,tiktok_account_id)
 where state not in ('COMPLETED','STOPPED','FAILED','PAUSED','BLOCKED');

create or replace function private.keep_post_run_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.owner_id is distinct from old.owner_id or new.tiktok_account_id is distinct from old.tiktok_account_id
   or new.posting_mode is distinct from old.posting_mode or new.schedule_slot_key is distinct from old.schedule_slot_key
   or new.run_date is distinct from old.run_date or new.idempotency_key is distinct from old.idempotency_key then
   raise exception 'post_run_identity_immutable'; end if;
 return new;
end $$;
create trigger auto_runs_post_identity before update on public.auto_runs for each row execute function private.keep_post_run_identity();

create table public.post_account_schedules (
 owner_id uuid not null references public.profiles(id), tiktok_account_id uuid not null,
 posting_mode text not null default 'EXPORT' check(posting_mode in ('AUTO','DRAFT','EXPORT')),
 creative_mode text not null default 'AUTO' check(creative_mode in ('AUTO','GROWTH','AFFILIATE')),
 clips_per_day integer not null check(clips_per_day between 1 and 20),
 active_start integer not null check(active_start between 0 and 1439),
 active_end integer not null check(active_end between 1 and 1440),
 timezone text not null, min_spacing_minutes integer not null check(min_spacing_minutes between 1 and 1440),
 allowed_days integer[] not null check(cardinality(allowed_days) between 1 and 7 and allowed_days <@ array[0,1,2,3,4,5,6]),
 enabled boolean not null default false,
 daily_budget_usd numeric(12,4) not null check(daily_budget_usd between 0 and 1000),
 next_due_at timestamptz, revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(owner_id,tiktok_account_id),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id),
 check(active_end>active_start),
 check((clips_per_day-1)*min_spacing_minutes < active_end-active_start)
);
create index post_schedules_due_idx on public.post_account_schedules(next_due_at,owner_id,tiktok_account_id) where enabled;
create trigger post_schedules_touch before update on public.post_account_schedules
  for each row execute function private.touch_updated_at();

create table public.post_schedule_slots (
 owner_id uuid not null, tiktok_account_id uuid not null, local_date date not null,
 ordinal integer not null check(ordinal between 1 and 20),
 slot_key text not null, scheduled_at timestamptz not null, expires_at timestamptz not null,
 posting_mode text not null check(posting_mode in ('AUTO','DRAFT','EXPORT')),
 state text not null default 'PENDING' check(state in ('PENDING','CLAIMED','RUNNING','DONE','MISSED','FAILED','DISABLED')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 lease_token uuid, lease_expires_at timestamptz, next_attempt_at timestamptz,
 auto_run_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(owner_id,tiktok_account_id,local_date,ordinal), unique(owner_id,slot_key),
 foreign key(owner_id,tiktok_account_id) references public.post_account_schedules(owner_id,tiktok_account_id),
 foreign key(owner_id,auto_run_id) references public.auto_runs(owner_id,id),
 check(expires_at>scheduled_at),
 check((lease_token is null and lease_expires_at is null) or (lease_token is not null and lease_expires_at is not null))
);
create index post_slots_due_idx on public.post_schedule_slots(state,next_attempt_at,scheduled_at);
create trigger post_slots_touch before update on public.post_schedule_slots
  for each row execute function private.touch_updated_at();

alter table public.post_account_schedules enable row level security;
alter table public.post_schedule_slots enable row level security;
revoke all on public.post_account_schedules,public.post_schedule_slots from public,anon,authenticated;
grant select on public.post_account_schedules,public.post_schedule_slots to authenticated;
grant select,insert,update,delete on public.post_account_schedules,public.post_schedule_slots to service_role;
create policy post_schedules_owner_read on public.post_account_schedules for select to authenticated using((select auth.uid())=owner_id);
create policy post_slots_owner_read on public.post_schedule_slots for select to authenticated using((select auth.uid())=owner_id);

create or replace function public.create_auto_run_atomic(
 p_owner_id uuid,p_idempotency_key text,p_run_date date,p_video_provider text,p_provider_gate_reason text,p_plans jsonb
) returns public.auto_runs language plpgsql security invoker set search_path='' as $$
declare v_run public.auto_runs; v_plan jsonb; v_account uuid; v_hash text; v_mode text;
begin
 if jsonb_typeof(p_plans) is distinct from 'array' or jsonb_array_length(p_plans)<>1 then
   raise exception 'one_account_per_auto_run_required'; end if;
 v_plan:=p_plans->0; v_account:=(v_plan->>'accountId')::uuid;
 v_mode:=coalesce(v_plan->>'postingMode','AUTO');
 if v_mode not in ('AUTO','DRAFT','EXPORT') then raise exception 'invalid_posting_mode'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':post:'||v_account::text,0));
 if not exists(select 1 from public.tiktok_accounts where id=v_account and owner_id=p_owner_id and hidden_at is null) then
   raise exception 'account_not_found'; end if;
 select * into v_run from public.auto_runs where owner_id=p_owner_id and idempotency_key=p_idempotency_key;
 if found then
   if not exists(select 1 from public.auto_account_states where owner_id=p_owner_id and auto_run_id=v_run.id and tiktok_account_id=v_account) then
     raise exception 'auto_idempotency_account_mismatch'; end if;
   return v_run;
 end if;
 select r.* into v_run from public.auto_runs r join public.auto_account_states s on s.auto_run_id=r.id and s.owner_id=r.owner_id
   where s.owner_id=p_owner_id and s.tiktok_account_id=v_account and s.state not in ('COMPLETED','STOPPED','FAILED')
   order by r.started_at desc limit 1 for update of r;
 if found then return v_run; end if;
 if exists(select 1 from public.auto_account_states where owner_id=p_owner_id and tiktok_account_id=v_account
   and state in ('COMPLETED','STOPPED','FAILED') and execution_lease_expires_at>now())
   or exists(select 1 from public.generation_budget_reservations where owner_id=p_owner_id and tiktok_account_id=v_account
     and ((state='RESERVED' and (expires_at>now() or provider_submission_state<>'REQUEST_NOT_SENT'))
       or state<>'SETTLED' and provider_submission_state in ('SUBMITTING','SUBMITTED_UNKNOWN','SUBMITTED','CONFIRMED'))) then
   raise exception 'post_account_reconciliation_required'; end if;
 if v_plan ? 'scheduleSlotKey' and not exists(select 1 from public.post_schedule_slots slot
   join public.post_account_schedules schedule on schedule.owner_id=slot.owner_id and schedule.tiktok_account_id=slot.tiktok_account_id
   where slot.owner_id=p_owner_id and slot.tiktok_account_id=v_account and slot.slot_key=v_plan->>'scheduleSlotKey'
     and slot.local_date=p_run_date and slot.posting_mode=v_mode and slot.state='CLAIMED' and slot.lease_expires_at>now() and schedule.enabled) then
   raise exception 'post_schedule_not_claimed'; end if;
 insert into public.auto_runs(owner_id,tiktok_account_id,posting_mode,schedule_slot_key,state,trigger_source,run_date,current_step,budget_usd,spent_usd,idempotency_key,started_at,metrics_json)
 values(p_owner_id,v_account,v_mode,v_plan->>'scheduleSlotKey','RUNNING',case when v_plan ? 'scheduleSlotKey' then 'SCHEDULED' else 'MANUAL' end,
   p_run_date,'PLAN_ACCOUNTS',0,0,p_idempotency_key,now(),jsonb_build_object('externalCalls',0,'realPublishing',false,'paidProviders',false,
     'videoProvider',p_video_provider,'providerGateReason',p_provider_gate_reason,'postingMode',v_mode)) returning * into v_run;
 insert into public.auto_account_states(owner_id,auto_run_id,tiktok_account_id,requested_mode,effective_mode,state,current_step,next_action,blockers_json,
   desired_daily_candidates,desired_daily_posts,max_daily_cost_usd,generation_capacity,publish_capacity,priority,checkpoint_version)
 values(p_owner_id,v_run.id,v_account,v_plan->>'requestedMode',v_plan->>'mode',v_plan->>'state','PLAN_ACCOUNTS',v_plan->>'nextAction',v_plan->'blockers',
   (v_plan->>'desiredCandidates')::integer,(v_plan->>'desiredPosts')::integer,(v_plan->>'maxDailyCostUsd')::numeric,
   (v_plan->>'generationCapacity')::integer,(v_plan->>'publishCapacity')::integer,(v_plan->>'priority')::integer,1);
 insert into public.auto_actions(owner_id,auto_run_id,tiktok_account_id,action_type,decision_source,status,payload_json,estimated_cost_usd,actual_cost_usd,idempotency_key)
 values(p_owner_id,v_run.id,v_account,v_plan->>'nextAction',case when v_plan->>'mode'='GROWTH' then 'PHASE_9_GROWTH' else 'PHASE_8_WINNER' end,
   case when v_plan->>'state'='WAITING_FOR_APPROVAL' then 'WAITING_FOR_APPROVAL' when v_plan->>'state'='WAITING_FOR_SLOT' then 'WAITING_FOR_SLOT' when v_plan->>'state'='BLOCKED' then 'BLOCKED' else 'PLANNED' end,
   jsonb_build_object('mode',v_plan->>'mode','blockers',v_plan->'blockers','postingMode',v_mode),0,0,v_plan->>'actionKey');
 v_hash:=encode(extensions.digest(v_run.id::text||':PLAN_ACCOUNTS:'||v_account::text,'sha256'),'hex');
 insert into public.auto_run_steps(owner_id,auto_run_id,tiktok_account_id,step,state,idempotency_key,started_at,completed_at,output_json)
 values(p_owner_id,v_run.id,v_account,'PLAN_ACCOUNTS','COMPLETED',p_idempotency_key||':PLAN_ACCOUNTS',now(),now(),jsonb_build_object('accountCount',1,'postingMode',v_mode));
 insert into public.auto_checkpoints(owner_id,auto_run_id,tiktok_account_id,step,checkpoint_version,state_json,evidence_hash)
 values(p_owner_id,v_run.id,v_account,'PLAN_ACCOUNTS',1,jsonb_build_object('accountCount',1,'postingMode',v_mode),v_hash);
 return v_run;
end $$;

create or replace function public.upsert_post_account_schedule(p_owner_id uuid,p_account_id uuid,p_config jsonb)
returns public.post_account_schedules language plpgsql security invoker set search_path='' as $$
declare v_schedule public.post_account_schedules; v_limit numeric; v_hard integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':post:'||p_account_id::text,0));
 select daily_video_budget_usd,daily_post_hard_limit into v_limit,v_hard from public.tiktok_accounts
 where owner_id=p_owner_id and id=p_account_id and hidden_at is null;
 if not found then raise exception 'account_not_found'; end if;
 if (p_config->>'clipsPerDay')::integer>v_hard or (p_config->>'dailyBudgetUsd')::numeric>v_limit then
   raise exception 'post_schedule_exceeds_account_limits'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_config->>'timezone') then raise exception 'invalid_timezone'; end if;
 insert into public.post_account_schedules(owner_id,tiktok_account_id,posting_mode,creative_mode,clips_per_day,active_start,active_end,timezone,min_spacing_minutes,allowed_days,enabled,daily_budget_usd,next_due_at)
 values(p_owner_id,p_account_id,p_config->>'postingMode',p_config->>'creativeMode',(p_config->>'clipsPerDay')::integer,
   (p_config->>'activeStart')::integer,(p_config->>'activeEnd')::integer,p_config->>'timezone',(p_config->>'minSpacingMinutes')::integer,
   array(select jsonb_array_elements_text(p_config->'allowedDays')::integer),(p_config->>'enabled')::boolean,(p_config->>'dailyBudgetUsd')::numeric,now())
 on conflict(owner_id,tiktok_account_id) do update set posting_mode=excluded.posting_mode,creative_mode=excluded.creative_mode,
   clips_per_day=excluded.clips_per_day,active_start=excluded.active_start,active_end=excluded.active_end,timezone=excluded.timezone,
   min_spacing_minutes=excluded.min_spacing_minutes,allowed_days=excluded.allowed_days,enabled=excluded.enabled,
   daily_budget_usd=excluded.daily_budget_usd,next_due_at=now(),revision=post_account_schedules.revision+1
 returning * into v_schedule;
 update public.post_schedule_slots set state='DISABLED',lease_token=null,lease_expires_at=null
 where owner_id=p_owner_id and tiktok_account_id=p_account_id and state in ('PENDING','CLAIMED') and not v_schedule.enabled;
 return v_schedule;
end $$;

-- Single-account controls also isolate legacy runs that contain multiple accounts.
create or replace function public.control_post_account(p_owner_id uuid,p_account_id uuid,p_action text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_run public.auto_runs; v_state public.auto_account_states; v_next text;
begin
 if p_action not in ('START','STOP','RETRY') then raise exception 'invalid_post_account_action'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':post:'||p_account_id::text,0));
 if not exists(select 1 from public.tiktok_accounts where owner_id=p_owner_id and id=p_account_id and hidden_at is null) then raise exception 'account_not_found'; end if;
 if p_action='START' and not exists(select 1 from public.post_account_schedules where owner_id=p_owner_id and tiktok_account_id=p_account_id) then raise exception 'post_schedule_required'; end if;
 update public.post_account_schedules set enabled=(p_action<>'STOP'),next_due_at=now()
 where owner_id=p_owner_id and tiktok_account_id=p_account_id;
 select r.* into v_run from public.auto_runs r join public.auto_account_states s on r.id=s.auto_run_id and r.owner_id=s.owner_id
 where s.owner_id=p_owner_id and s.tiktok_account_id=p_account_id and s.state not in ('COMPLETED','STOPPED','FAILED')
 order by r.started_at desc limit 1 for update of r;
 if found then
   select * into v_state from public.auto_account_states where owner_id=p_owner_id and auto_run_id=v_run.id and tiktok_account_id=p_account_id for update;
   if p_action='STOP' then v_next:='STOPPED';
   elsif v_state.state='PAUSED' then
     v_next:=case when v_state.blockers_json ? 'PROVIDER_UNAVAILABLE' then 'WAITING_FOR_PROVIDER'
       when v_state.blockers_json ? 'RECONCILIATION_REQUIRED' then 'WAITING_FOR_RECONCILIATION'
       when jsonb_array_length(v_state.blockers_json - 'RUN_NOT_ACTIVE')>0 then 'BLOCKED' else 'RUNNING' end;
   elsif p_action='RETRY' and v_state.state='RETRY_PENDING' then v_next:='RETRY_PENDING';
   else v_next:=v_state.state; end if;
   -- Never clear provider/budget/safety blockers or attempt history on retry.
   update public.auto_account_states set state=v_next,
     blockers_json=case when p_action='START' then blockers_json - 'RUN_NOT_ACTIVE' else blockers_json end,
     execution_next_attempt_at=case when p_action='RETRY' and state='RETRY_PENDING' then now() else execution_next_attempt_at end
   where id=v_state.id;
   if p_action='STOP' then
     if not exists(select 1 from public.auto_account_states where auto_run_id=v_run.id and owner_id=p_owner_id and state not in ('COMPLETED','STOPPED','FAILED')) then
       update public.auto_runs set state='STOPPED',completed_at=now(),current_step='STOP' where id=v_run.id and owner_id=p_owner_id;
     end if;
   elsif v_run.state='PAUSED' then
     update public.auto_runs set state='RUNNING',paused_at=null where id=v_run.id and owner_id=p_owner_id;
   end if;
 end if;
 if p_action='STOP' then
   update public.post_schedule_slots set state='DISABLED',lease_token=null,lease_expires_at=null
   where owner_id=p_owner_id and tiktok_account_id=p_account_id and state in ('PENDING','CLAIMED');
 else
   -- Resume unused slots; consumed/failed slots are never replayed by START.
   update public.post_schedule_slots set state='PENDING' where owner_id=p_owner_id and tiktok_account_id=p_account_id
     and state='DISABLED' and auto_run_id is null and attempts<3 and expires_at>now();
 end if;
 return jsonb_build_object('runId',v_run.id,'state',coalesce(v_next,'IDLE'),'enabled',p_action<>'STOP');
end $$;

create or replace function public.materialize_post_schedule_slots(
 p_owner_id uuid,p_account_id uuid,p_revision integer,p_slots jsonb,p_next_due timestamptz
) returns integer language plpgsql security invoker set search_path='' as $$
declare v_schedule public.post_account_schedules; v_slot jsonb; v_count integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':post:'||p_account_id::text,0));
 select * into v_schedule from public.post_account_schedules where owner_id=p_owner_id and tiktok_account_id=p_account_id for update;
 if not found or not v_schedule.enabled or v_schedule.revision<>p_revision then return 0; end if;
 if jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots)>20 then raise exception 'invalid_schedule_slots'; end if;
 for v_slot in select value from jsonb_array_elements(p_slots) loop
   insert into public.post_schedule_slots(owner_id,tiktok_account_id,local_date,ordinal,slot_key,scheduled_at,expires_at,posting_mode)
   values(p_owner_id,p_account_id,(v_slot->>'localDate')::date,(v_slot->>'ordinal')::integer,v_slot->>'key',
     (v_slot->>'scheduledAt')::timestamptz,(v_slot->>'expiresAt')::timestamptz,v_schedule.posting_mode)
   on conflict(owner_id,tiktok_account_id,local_date,ordinal) do update set state='PENDING',
     scheduled_at=excluded.scheduled_at,expires_at=excluded.expires_at,posting_mode=excluded.posting_mode
   where post_schedule_slots.state in ('PENDING','DISABLED') and post_schedule_slots.attempts=0 and post_schedule_slots.auto_run_id is null;
   v_count:=v_count+1;
 end loop;
 -- A lower daily target or a removed weekday cannot leave stale pending slots enabled.
 update public.post_schedule_slots set state='DISABLED' where owner_id=p_owner_id and tiktok_account_id=p_account_id
   and state='PENDING' and auto_run_id is null
   and local_date=coalesce((p_slots->0->>'localDate')::date,(now() at time zone v_schedule.timezone)::date)
   and (ordinal>v_schedule.clips_per_day or jsonb_array_length(p_slots)=0);
 update public.post_account_schedules set next_due_at=p_next_due where owner_id=p_owner_id and tiktok_account_id=p_account_id;
 return v_count;
end $$;

create table public.post_outputs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),
 tiktok_account_id uuid not null, auto_run_id uuid not null, item_index integer not null check(item_index>0),
 video_id uuid not null, product_id uuid not null, publishing_queue_id uuid,
 posting_mode text not null check(posting_mode in ('AUTO','DRAFT','EXPORT')),
 status text not null default 'READY' check(status in ('READY','SCHEDULED','DRAFT_UPLOADED','WAITING_FOR_USER','PUBLISHED','FAILED','REVIEW_REQUIRED')),
 caption text not null check(char_length(caption)<=2200),
 hashtags_json jsonb not null default '[]' check(jsonb_typeof(hashtags_json)='array'),
 product_reference_json jsonb not null default '{}' check(jsonb_typeof(product_reference_json)='object'),
 suggested_post_at timestamptz, published_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,id), unique(owner_id,auto_run_id,tiktok_account_id,item_index),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id),
 foreign key(owner_id,auto_run_id,tiktok_account_id) references public.auto_account_states(owner_id,auto_run_id,tiktok_account_id),
 foreign key(owner_id,video_id) references public.master_videos(owner_id,id),
 foreign key(owner_id,product_id) references public.products(owner_id,id),
 foreign key(owner_id,publishing_queue_id) references public.publishing_queue(owner_id,id)
);
create index post_outputs_account_recent_idx on public.post_outputs(owner_id,tiktok_account_id,created_at desc);
alter table public.post_outputs enable row level security;
revoke all on public.post_outputs from public,anon,authenticated;
grant select on public.post_outputs to authenticated;
grant select,insert,update on public.post_outputs to service_role;
create policy post_outputs_owner_read on public.post_outputs for select to authenticated using((select auth.uid())=owner_id);

create or replace function private.validate_post_output() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.auto_runs r join public.auto_account_states s on s.auto_run_id=r.id and s.owner_id=r.owner_id
   where r.id=new.auto_run_id and r.owner_id=new.owner_id and s.tiktok_account_id=new.tiktok_account_id and r.posting_mode=new.posting_mode)
   or not exists(select 1 from public.master_videos where owner_id=new.owner_id and id=new.video_id and tiktok_account_id=new.tiktok_account_id and product_id=new.product_id)
   or (new.publishing_queue_id is not null and not exists(select 1 from public.publishing_queue where owner_id=new.owner_id
     and id=new.publishing_queue_id and tiktok_account_id=new.tiktok_account_id and video_id=new.video_id and video_kind='MASTER'
     and ((new.posting_mode='DRAFT' and publish_mode='DRAFT_UPLOAD')
       or (new.posting_mode='AUTO' and (publish_mode='DIRECT_POST' or publish_mode='DRAFT_UPLOAD' and exists(
         select 1 from public.tiktok_accounts where owner_id=new.owner_id and id=new.tiktok_account_id and is_mock)))))) then raise exception 'post_output_scope_mismatch'; end if;
 if new.posting_mode='EXPORT' and (new.publishing_queue_id is not null or new.status in ('PUBLISHED','DRAFT_UPLOADED','WAITING_FOR_USER')) then raise exception 'post_export_has_no_platform_publication'; end if;
 if tg_op='UPDATE' and (new.owner_id is distinct from old.owner_id or new.tiktok_account_id is distinct from old.tiktok_account_id
   or new.auto_run_id is distinct from old.auto_run_id or new.item_index is distinct from old.item_index
   or new.posting_mode is distinct from old.posting_mode or new.video_id is distinct from old.video_id or new.product_id is distinct from old.product_id
   or new.caption is distinct from old.caption or new.hashtags_json is distinct from old.hashtags_json or new.product_reference_json is distinct from old.product_reference_json
   or new.publishing_queue_id is distinct from old.publishing_queue_id) then raise exception 'post_output_identity_immutable'; end if;
 if new.status='PUBLISHED' and not exists(select 1 from public.publishing_queue where owner_id=new.owner_id and id=new.publishing_queue_id
   and tiktok_account_id=new.tiktok_account_id and video_id=new.video_id and status='PUBLISHED') then raise exception 'post_output_publication_not_attested'; end if;
 return new;
end $$;
create trigger post_output_scope before insert or update on public.post_outputs for each row execute function private.validate_post_output();
create trigger post_outputs_touch before update on public.post_outputs for each row execute function private.touch_updated_at();

create or replace function private.sync_post_output_publication() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 update public.post_outputs set status=case when new.status='PUBLISHED' then 'PUBLISHED'
   when new.status='DRAFT_DELIVERED' then 'WAITING_FOR_USER'
   when new.status in ('FAILED','CANCELLED') then 'FAILED' else status end,
   published_at=case when new.status='PUBLISHED' then new.completed_at else published_at end
 where owner_id=new.owner_id and tiktok_account_id=new.tiktok_account_id and publishing_queue_id=new.id and video_id=new.video_id
   and status<>'PUBLISHED' and new.status in ('PUBLISHED','DRAFT_DELIVERED','FAILED','CANCELLED');
 return new;
end $$;
create trigger publishing_queue_post_result after update of status on public.publishing_queue
 for each row when(old.status is distinct from new.status) execute function private.sync_post_output_publication();

create or replace function public.claim_post_schedule_slot(p_owner_id uuid,p_account_id uuid,p_now timestamptz)
returns public.post_schedule_slots language plpgsql security invoker set search_path='' as $$
declare v_slot public.post_schedule_slots;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':post:'||p_account_id::text,0));
 if not exists(select 1 from public.post_account_schedules where owner_id=p_owner_id and tiktok_account_id=p_account_id and enabled) then return null; end if;
 -- Account has unfinished work: retain its slot and do not create another generation.
 if exists(select 1 from public.auto_account_states where owner_id=p_owner_id and tiktok_account_id=p_account_id and state not in ('COMPLETED','STOPPED','FAILED')) then return null; end if;
 if exists(select 1 from public.auto_runs r join public.post_account_schedules s on s.owner_id=r.owner_id and s.tiktok_account_id=r.tiktok_account_id
   where r.owner_id=p_owner_id and r.tiktok_account_id=p_account_id
     and r.started_at>p_now-make_interval(mins=>s.min_spacing_minutes)) then return null; end if;
 if exists(select 1 from public.auto_account_states where owner_id=p_owner_id and tiktok_account_id=p_account_id
   and state in ('COMPLETED','STOPPED','FAILED') and execution_lease_expires_at>now())
   or exists(select 1 from public.generation_budget_reservations where owner_id=p_owner_id and tiktok_account_id=p_account_id
     and ((state='RESERVED' and (expires_at>now() or provider_submission_state<>'REQUEST_NOT_SENT'))
       or state<>'SETTLED' and provider_submission_state in ('SUBMITTING','SUBMITTED_UNKNOWN','SUBMITTED','CONFIRMED'))) then return null; end if;
 update public.post_schedule_slots set state='FAILED',lease_token=null,lease_expires_at=null
 where owner_id=p_owner_id and tiktok_account_id=p_account_id and state='CLAIMED' and lease_expires_at<=p_now and attempts>=3;
 update public.post_schedule_slots set state='PENDING',lease_token=null,lease_expires_at=null
 where owner_id=p_owner_id and tiktok_account_id=p_account_id and state='CLAIMED' and lease_expires_at<=p_now and attempts<3;
 update public.post_schedule_slots set state='MISSED' where owner_id=p_owner_id and tiktok_account_id=p_account_id and state='PENDING' and expires_at<=p_now;
 select * into v_slot from public.post_schedule_slots where owner_id=p_owner_id and tiktok_account_id=p_account_id
   and state='PENDING' and attempts<3 and scheduled_at<=p_now and expires_at>p_now and (next_attempt_at is null or next_attempt_at<=p_now)
   order by scheduled_at desc,ordinal desc limit 1 for update;
 if not found then return null; end if;
 -- Coalesce missed work instead of generating an unbounded catch-up burst.
 update public.post_schedule_slots set state='MISSED' where owner_id=p_owner_id and tiktok_account_id=p_account_id and state='PENDING'
   and scheduled_at<v_slot.scheduled_at;
 update public.post_schedule_slots set state='CLAIMED',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=p_now+interval '3 minutes'
   where owner_id=p_owner_id and slot_key=v_slot.slot_key returning * into v_slot;
 return v_slot;
end $$;

create or replace function public.settle_post_schedule_slot(
 p_owner_id uuid,p_account_id uuid,p_slot_key text,p_lease_token uuid,p_run_id uuid,p_failed boolean
) returns boolean language plpgsql security invoker set search_path='' as $$
declare v_slot public.post_schedule_slots;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':post:'||p_account_id::text,0));
 select * into v_slot from public.post_schedule_slots where owner_id=p_owner_id and tiktok_account_id=p_account_id and slot_key=p_slot_key for update;
 if not found or v_slot.state<>'CLAIMED' or v_slot.lease_token is distinct from p_lease_token then return false; end if;
 if p_run_id is not null and not exists(select 1 from public.auto_runs where owner_id=p_owner_id and id=p_run_id
   and tiktok_account_id=p_account_id and schedule_slot_key=p_slot_key) then raise exception 'schedule_run_mismatch'; end if;
 update public.post_schedule_slots set state=case when not exists(select 1 from public.post_account_schedules where owner_id=p_owner_id and tiktok_account_id=p_account_id and enabled) then 'DISABLED'
   when p_run_id is not null then 'RUNNING' when p_failed and attempts>=3 then 'FAILED' else 'PENDING' end,
   auto_run_id=p_run_id,lease_token=null,lease_expires_at=null,
   next_attempt_at=case when p_run_id is null then now()+make_interval(secs=>least(300,30*power(2,attempts-1)::integer)) else null end
 where owner_id=p_owner_id and slot_key=p_slot_key;
 return true;
end $$;

-- Recovery links a run created just before a worker crash without replaying its slot.
create or replace function public.reconcile_post_schedule_slots() returns integer
language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
 update public.post_schedule_slots s set auto_run_id=r.id,
   state=case when r.state='COMPLETED' then 'DONE' when r.state in ('STOPPED','FAILED') then 'FAILED' else 'RUNNING' end,
   lease_token=null,lease_expires_at=null
 from public.auto_runs r where r.owner_id=s.owner_id and r.tiktok_account_id=s.tiktok_account_id and r.schedule_slot_key=s.slot_key
   and (s.state in ('CLAIMED','PENDING') or s.state='RUNNING' and r.state in ('COMPLETED','STOPPED','FAILED'));
 get diagnostics v_count=row_count;
 return v_count;
end $$;

revoke all on function public.upsert_post_account_schedule(uuid,uuid,jsonb),public.control_post_account(uuid,uuid,text),
 public.materialize_post_schedule_slots(uuid,uuid,integer,jsonb,timestamptz),public.claim_post_schedule_slot(uuid,uuid,timestamptz),
 public.settle_post_schedule_slot(uuid,uuid,text,uuid,uuid,boolean),public.reconcile_post_schedule_slots()
 from public,anon,authenticated;
grant execute on function public.upsert_post_account_schedule(uuid,uuid,jsonb),public.control_post_account(uuid,uuid,text),
 public.materialize_post_schedule_slots(uuid,uuid,integer,jsonb,timestamptz),public.claim_post_schedule_slot(uuid,uuid,timestamptz),
 public.settle_post_schedule_slot(uuid,uuid,text,uuid,uuid,boolean),public.reconcile_post_schedule_slots() to service_role;

-- The same production lease RPC is reused; only trusted persisted POST fields are added.
alter function public.claim_auto_execution_step(uuid,uuid,uuid,text,integer,boolean) set schema private;
alter function private.claim_auto_execution_step(uuid,uuid,uuid,text,integer,boolean) rename to claim_auto_execution_step_v11f;
grant usage on schema private to service_role;
create or replace function public.claim_auto_execution_step(
 p_owner_id uuid,p_run_id uuid,p_account_id uuid,p_worker_id text,p_lease_seconds integer default 900,p_provider_ready boolean default false
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_claim jsonb; v_run public.auto_runs; v_slot public.post_schedule_slots;
begin
 v_claim:=private.claim_auto_execution_step_v11f(p_owner_id,p_run_id,p_account_id,p_worker_id,p_lease_seconds,p_provider_ready);
 if v_claim is null then return null; end if;
 select * into v_run from public.auto_runs where owner_id=p_owner_id and id=p_run_id;
 select * into v_slot from public.post_schedule_slots where owner_id=p_owner_id and tiktok_account_id=p_account_id and slot_key=v_run.schedule_slot_key;
 return v_claim || jsonb_build_object('postingMode',v_run.posting_mode,'runDate',v_run.run_date,
   'scheduledFor',v_slot.scheduled_at,'slotOrdinal',v_slot.ordinal);
end $$;

-- A completed external call may still persist evidence after STOP/PAUSE, but it
-- must never revive the account or release another account's run/lease.
create or replace function private.keep_post_account_control() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.state='STOPPED' then new.state:='STOPPED';
 elsif old.state='PAUSED' and new.state not in ('PAUSED','STOPPED')
   and (new.checkpoint_version<>old.checkpoint_version
     or old.execution_lease_token is not null and new.execution_lease_token is null) then
   new.state:='PAUSED';
 end if;
 return new;
end $$;
create trigger post_account_control_preserved before update on public.auto_account_states
 for each row execute function private.keep_post_account_control();

create or replace function private.finish_terminal_post_run() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.state in ('COMPLETED','FAILED','STOPPED') and not exists(select 1 from public.auto_account_states
   where owner_id=new.owner_id and auto_run_id=new.auto_run_id and state not in ('COMPLETED','FAILED','STOPPED')) then
   update public.auto_runs set state=case when new.state='STOPPED' then 'STOPPED'
     when exists(select 1 from public.auto_account_states where owner_id=new.owner_id and auto_run_id=new.auto_run_id and state='FAILED') then 'FAILED'
     else 'COMPLETED' end,completed_at=now()
   where owner_id=new.owner_id and id=new.auto_run_id and state not in ('COMPLETED','FAILED','STOPPED');
 end if;
 return new;
end $$;
create trigger post_run_terminal after update of state on public.auto_account_states
 for each row execute function private.finish_terminal_post_run();

-- Terminal failure now updates the parent too; keep run -> account lock order
-- consistent with finish/STOP even for a historical multi-account parent.
alter function public.fail_auto_execution_step(uuid,uuid,uuid,uuid,text,text,boolean,text,text) set schema private;
alter function private.fail_auto_execution_step(uuid,uuid,uuid,uuid,text,text,boolean,text,text) rename to fail_auto_execution_step_v11f;
create or replace function public.fail_auto_execution_step(
 p_owner_id uuid,p_run_id uuid,p_account_id uuid,p_lease_token uuid,p_step text,
 p_failure_type text,p_retryable boolean,p_reason text,p_next_state text
) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.auto_runs where owner_id=p_owner_id and id=p_run_id for update;
 if not found then raise exception 'auto_run_not_found'; end if;
 return private.fail_auto_execution_step_v11f(p_owner_id,p_run_id,p_account_id,p_lease_token,p_step,p_failure_type,p_retryable,p_reason,p_next_state);
end $$;

-- Legacy run-wide controls are accepted only when there is one account. New
-- customer controls always address the account directly.
create or replace function public.transition_auto_run_atomic(p_owner_id uuid,p_run_id uuid,p_action text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_previous text; v_next text; v_account uuid;
begin
 if p_action not in ('PAUSE','RESUME','STOP') then raise exception 'invalid_auto_action'; end if;
 if (select count(*) from public.auto_account_states where owner_id=p_owner_id and auto_run_id=p_run_id)<>1 then
   raise exception 'account_scoped_control_required'; end if;
 select tiktok_account_id into v_account from public.auto_account_states where owner_id=p_owner_id and auto_run_id=p_run_id;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':post:'||v_account::text,0));
 select state into v_previous from public.auto_runs where owner_id=p_owner_id and id=p_run_id for update;
 if not found then raise exception 'auto_run_not_found'; end if;
 if p_action='STOP' then
   if v_previous not in ('COMPLETED','FAILED','STOPPED') then perform public.control_post_account(p_owner_id,v_account,'STOP'); end if;
   return jsonb_build_object('previous',v_previous,'state',case when v_previous in ('COMPLETED','FAILED','STOPPED') then v_previous else 'STOPPED' end);
 end if;
 v_next:=case when p_action='PAUSE' and v_previous in ('RUNNING','RETRY_PENDING','WAITING_FOR_DATA','WAITING_FOR_SLOT','WAITING_FOR_PROVIDER') then 'PAUSED'
   when p_action='RESUME' and v_previous='PAUSED' then 'RUNNING' else v_previous end;
 if v_next<>v_previous then
   update public.auto_runs set state=v_next,current_step=p_action,
     paused_at=case when p_action='PAUSE' then now() when p_action='RESUME' then null else paused_at end
     where owner_id=p_owner_id and id=p_run_id;
   update public.auto_account_states set state=case
     when p_action='PAUSE' then 'PAUSED'
     when blockers_json ? 'PROVIDER_UNAVAILABLE' then 'WAITING_FOR_PROVIDER'
     when blockers_json ? 'RECONCILIATION_REQUIRED' then 'WAITING_FOR_RECONCILIATION'
     when blockers_json ? 'BUDGET_EXCEEDED' or blockers_json ? 'ACCOUNT_HEALTH' then 'BLOCKED'
     when blockers_json ? 'CONSENT' then 'WAITING_FOR_APPROVAL'
     when blockers_json ? 'PUBLISH_CAP' then 'WAITING_FOR_SLOT'
     when blockers_json ? 'ANALYTICS_STALE' then 'WAITING_FOR_DATA'
     when jsonb_array_length(blockers_json - 'RUN_NOT_ACTIVE')>0 then 'BLOCKED' else 'RUNNING' end,
     blockers_json=case when p_action='RESUME' then blockers_json - 'RUN_NOT_ACTIVE' else blockers_json end
   where owner_id=p_owner_id and auto_run_id=p_run_id and state not in ('COMPLETED','FAILED','STOPPED') and state<>'BLOCKED';
 end if;
 return jsonb_build_object('previous',v_previous,'state',v_next);
end $$;

revoke all on function public.claim_auto_execution_step(uuid,uuid,uuid,text,integer,boolean),
 public.transition_auto_run_atomic(uuid,uuid,text),private.claim_auto_execution_step_v11f(uuid,uuid,uuid,text,integer,boolean),
 public.fail_auto_execution_step(uuid,uuid,uuid,uuid,text,text,boolean,text,text),private.fail_auto_execution_step_v11f(uuid,uuid,uuid,uuid,text,text,boolean,text,text),
 private.keep_post_run_identity(),private.validate_post_output(),private.sync_post_output_publication(),
 private.keep_post_account_control(),private.finish_terminal_post_run() from public,anon,authenticated;
grant execute on function public.claim_auto_execution_step(uuid,uuid,uuid,text,integer,boolean),
 public.transition_auto_run_atomic(uuid,uuid,text),private.claim_auto_execution_step_v11f(uuid,uuid,uuid,text,integer,boolean),
 public.fail_auto_execution_step(uuid,uuid,uuid,uuid,text,text,boolean,text,text),private.fail_auto_execution_step_v11f(uuid,uuid,uuid,uuid,text,text,boolean,text,text),
 private.keep_post_run_identity(),private.validate_post_output(),private.sync_post_output_publication(),
 private.keep_post_account_control(),private.finish_terminal_post_run() to service_role;
