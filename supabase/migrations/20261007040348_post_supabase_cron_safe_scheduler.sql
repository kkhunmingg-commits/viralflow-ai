-- Database-owned scheduling proof. No HTTP, Edge Function, provider or posting call.
-- A SAFE job is real orchestration evidence, never a generated/published output.
create table if not exists private.post_scheduler_runtime (
 singleton boolean primary key default true check(singleton),
 execution_mode text not null default 'SAFE' check(execution_mode in ('SAFE','LIVE')),
 enabled boolean not null default true,
 max_concurrent_accounts integer not null default 3 check(max_concurrent_accounts between 1 and 3),
 last_tick_at timestamptz, last_successful_tick_at timestamptz, last_error_code text,
 next_run_at timestamptz, cron_job_id bigint, cron_interval text not null default '* * * * *',
 updated_at timestamptz not null default now()
);
insert into private.post_scheduler_runtime(singleton) values(true) on conflict(singleton) do nothing;
create table if not exists private.post_scheduler_ticks (
 id uuid primary key default gen_random_uuid(), started_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz, tick_time timestamptz not null, test_owner_id uuid references public.profiles(id) on delete cascade,
 execution_mode text not null check(execution_mode in ('SAFE','LIVE')),
 status text not null check(status in ('RUNNING','SUCCEEDED','FAILED','DISABLED','LIVE_EXECUTOR_REQUIRED')),
 due_accounts integer not null default 0, claimed_jobs integer not null default 0,
 skipped_duplicate integer not null default 0, recovered_jobs integer not null default 0,
 failures integer not null default 0, queued_accounts integer not null default 0,
 next_run_at timestamptz, error_code text
);
create index if not exists post_scheduler_ticks_recent_idx on private.post_scheduler_ticks(started_at desc);
alter table private.post_scheduler_runtime enable row level security;
alter table private.post_scheduler_ticks enable row level security;
revoke all on private.post_scheduler_runtime,private.post_scheduler_ticks from public,anon,authenticated,service_role;
grant select on private.post_scheduler_runtime to service_role;
grant select,insert,update,delete on private.post_scheduler_ticks to service_role;
-- The tick may update health only, not execution mode, activation or capacity.
grant update(last_tick_at,last_successful_tick_at,last_error_code,next_run_at,updated_at)
 on private.post_scheduler_runtime to service_role;

create or replace function public.get_post_automation_execution_mode() returns text
language sql stable security invoker set search_path='' as $$
 select coalesce((select execution_mode from private.post_scheduler_runtime where singleton),'SAFE');
$$;

-- One persisted worker capacity applies to every caller of the production lease RPC.
-- The account lock and unique indexes remain the logical-job/idempotency guards.
create or replace function private.enforce_post_execution_capacity() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_limit integer;
begin
 if new.execution_lease_token is not null and new.execution_lease_expires_at>now()
   and new.execution_lease_token is distinct from old.execution_lease_token then
   perform pg_advisory_xact_lock(hashtextextended('viralflow:post:execution-capacity',0));
   select max_concurrent_accounts into v_limit from private.post_scheduler_runtime where singleton;
   if (select count(*) from public.auto_account_states where id<>new.id and execution_lease_token is not null
       and execution_lease_expires_at>now())>=coalesce(v_limit,3) then
     raise exception 'post_execution_capacity_exceeded';
   end if;
 end if;
 return new;
end $$;
create or replace trigger post_execution_capacity before update of execution_lease_token on public.auto_account_states
 for each row execute function private.enforce_post_execution_capacity();

create or replace function public.claim_auto_execution_step(
 p_owner_id uuid,p_run_id uuid,p_account_id uuid,p_worker_id text,p_lease_seconds integer default 900,p_provider_ready boolean default false
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_claim jsonb; v_run public.auto_runs; v_slot public.post_schedule_slots; v_limit integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('viralflow:post:execution-capacity',0));
 select max_concurrent_accounts into v_limit from private.post_scheduler_runtime where singleton;
 if (select count(*) from public.auto_account_states where execution_lease_token is not null
     and execution_lease_expires_at>now())>=coalesce(v_limit,3) then return null; end if;
 v_claim:=private.claim_auto_execution_step_v11f(p_owner_id,p_run_id,p_account_id,p_worker_id,p_lease_seconds,p_provider_ready);
 if v_claim is null then return null; end if;
 select * into v_run from public.auto_runs where owner_id=p_owner_id and id=p_run_id;
 select * into v_slot from public.post_schedule_slots where owner_id=p_owner_id and tiktok_account_id=p_account_id and slot_key=v_run.schedule_slot_key;
 return v_claim || jsonb_build_object('postingMode',v_run.posting_mode,'runDate',v_run.run_date,
   'scheduledFor',v_slot.scheduled_at,'slotOrdinal',v_slot.ordinal);
end $$;

-- Same minute timeline as the TypeScript planner: earliest real UTC minute after
-- each requested local target, with actual-time spacing across DST gaps/folds.
create or replace function private.plan_post_account_schedule(p_schedule public.post_account_schedules,p_now timestamptz)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_date date:=(p_now at time zone p_schedule.timezone)::date; v_day date;
 v_slots jsonb:='[]'; v_day_slots jsonb; v_candidates timestamptz[]; v_expiry timestamptz;
 v_spacing integer; v_previous timestamptz; v_time timestamptz; v_target integer;
 v_offset integer; v_ordinal integer; v_next timestamptz;
begin
 v_spacing:=case when p_schedule.clips_per_day=1 then 0 else greatest(p_schedule.min_spacing_minutes,
   (p_schedule.active_end-p_schedule.active_start)/p_schedule.clips_per_day) end;
 for v_offset in 0..8 loop
   v_day:=v_date+v_offset; v_day_slots:='[]'; v_previous:=null;
   if extract(dow from v_day)::integer=any(p_schedule.allowed_days) then
     select array_agg(ts order by ts),max(ts)+interval '1 minute' into v_candidates,v_expiry
     from generate_series((v_day::timestamp at time zone 'UTC')-interval '14 hours',
       (v_day::timestamp at time zone 'UTC')+interval '38 hours',interval '1 minute') ts
     where (ts at time zone p_schedule.timezone)::date=v_day
       and extract(hour from ts at time zone p_schedule.timezone)::integer*60+
         extract(minute from ts at time zone p_schedule.timezone)::integer>=p_schedule.active_start
       and extract(hour from ts at time zone p_schedule.timezone)::integer*60+
         extract(minute from ts at time zone p_schedule.timezone)::integer<p_schedule.active_end;
     for v_ordinal in 1..p_schedule.clips_per_day loop
       v_target:=p_schedule.active_start+(v_ordinal-1)*v_spacing;
       select min(ts) into v_time from unnest(v_candidates) ts
       where extract(hour from ts at time zone p_schedule.timezone)::integer*60+
         extract(minute from ts at time zone p_schedule.timezone)::integer>=v_target
         and (v_previous is null or ts>=v_previous+make_interval(mins=>p_schedule.min_spacing_minutes));
       exit when v_time is null;
       v_day_slots:=v_day_slots||jsonb_build_array(jsonb_build_object('localDate',v_day,'ordinal',v_ordinal,
         'key','post:'||p_schedule.tiktok_account_id::text||':'||v_day::text||':'||v_ordinal::text,
         'scheduledAt',v_time,'expiresAt',v_expiry));
       if v_time>p_now and v_next is null then v_next:=v_time; end if;
       v_previous:=v_time;
     end loop;
   end if;
   if v_offset=0 then v_slots:=v_day_slots; end if;
   exit when v_next is not null;
 end loop;
 if v_next is null then raise exception 'invalid_post_schedule'; end if;
 return jsonb_build_object('slots',v_slots,'nextDue',v_next);
end $$;

-- A crash before finish consumes a bounded attempt on the SAME run/step.
-- This only recovers database SAFE jobs. Unknown real submissions keep their
-- existing reconciliation guards and are never resubmitted here.
create or replace function private.recover_safe_post_execution(p_now timestamptz,p_owner_id uuid default null)
returns integer language plpgsql security invoker set search_path='' as $$
declare v_record record; v_attempts integer; v_count integer:=0; v_step text;
begin
 for v_record in select s.* from public.auto_account_states s join public.auto_runs r
   on r.owner_id=s.owner_id and r.id=s.auto_run_id
   where r.metrics_json->>'executionMode'='SAFE' and (p_owner_id is null or s.owner_id=p_owner_id)
     and s.state not in ('COMPLETED','STOPPED','FAILED','PAUSED','BLOCKED','WAITING_FOR_RECONCILIATION')
     and s.execution_lease_token is not null and s.execution_lease_expires_at<=p_now
   order by s.execution_lease_expires_at limit 30 loop
   -- Keep the same run -> account row-lock order as finish/failure/STOP.
   perform 1 from public.auto_runs where owner_id=v_record.owner_id and id=v_record.auto_run_id for update;
   perform 1 from public.auto_account_states where id=v_record.id and execution_lease_token=v_record.execution_lease_token
     and execution_lease_expires_at<=p_now for update;
   if not found then continue; end if;
   v_step:=case when v_record.current_step='PLAN_ACCOUNTS' then 'FIND_OPPORTUNITY' else v_record.current_step end;
   select count(*) into v_attempts from public.auto_failures where owner_id=v_record.owner_id
     and auto_run_id=v_record.auto_run_id and tiktok_account_id=v_record.tiktok_account_id and step=v_step
     and safe_context_json->>'itemIndex'='1';
   insert into public.auto_failures(owner_id,auto_run_id,tiktok_account_id,failure_type,step,reason,retryable,retry_count,next_retry_at,safe_context_json)
   values(v_record.owner_id,v_record.auto_run_id,v_record.tiktok_account_id,'TRANSIENT',v_step,'SAFE_EXECUTION_LEASE_EXPIRED',v_attempts<2,
     least(v_attempts,5),case when v_attempts<2 then p_now+make_interval(secs=>30*power(2,v_attempts)::integer) end,
     jsonb_build_object('itemIndex',1,'executionMode','SAFE','staleLease',true));
   update public.auto_account_states set state=case when v_attempts>=2 then 'FAILED' else 'RETRY_PENDING' end,
     blockers_json=case when v_attempts>=2 then '["SAFE_EXECUTION_RETRY_EXHAUSTED"]'::jsonb else '[]'::jsonb end,
     execution_lease_token=null,execution_lease_worker=null,execution_lease_expires_at=null,
     execution_next_attempt_at=case when v_attempts<2 then p_now+make_interval(secs=>30*power(2,v_attempts)::integer) end
   where id=v_record.id;
   v_count:=v_count+1;
 end loop;
 return v_count;
end $$;

create or replace function private.halt_safe_post_run(p_owner_id uuid,p_run_id uuid,p_account_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_claim jsonb;
begin
 if public.get_post_automation_execution_mode()<>'SAFE' or not exists(select 1 from public.auto_runs
   where owner_id=p_owner_id and id=p_run_id and metrics_json->>'executionMode'='SAFE') then return false; end if;
 v_claim:=public.claim_auto_execution_step(p_owner_id,p_run_id,p_account_id,'supabase-cron-safe',180,true);
 if v_claim is null then return false; end if;
 -- No fabricated product, script, video, analytics or publication evidence.
 return public.finish_auto_execution_step(p_owner_id,p_run_id,p_account_id,(v_claim->>'leaseToken')::uuid,
   v_claim->>'step','WAIT',jsonb_build_object('executionMode','SAFE','blockedBoundary','EXTERNAL_EXECUTION','externalCalls',0),
   v_claim->>'step',(v_claim->>'itemIndex')::integer,'WAITING_FOR_PROVIDER','SAFE_EXECUTION_BOUNDARY');
end $$;

create or replace function public.tick_post_account_automation(
 p_now timestamptz default now(),p_limit integer default 3,p_owner_id uuid default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_runtime private.post_scheduler_runtime; v_tick uuid; v_schedule public.post_account_schedules;
 v_account public.tiktok_accounts; v_plan jsonb; v_slot public.post_schedule_slots; v_run public.auto_runs; v_claim jsonb;
 v_due integer:=0; v_claimed integer:=0; v_duplicate integer:=0; v_recovered integer:=0; v_failures integer:=0; v_queued integer:=0;
 v_limit integer; v_next timestamptz; v_mode text; v_state text; v_blockers jsonb; v_status text:='SUCCEEDED'; v_error text;
 v_linked integer; v_worked integer:=0; v_existing record; v_before_claimed integer; v_before_worked integer;
begin
 if p_now is null or p_limit is null or p_limit<1 then raise exception 'invalid_post_tick'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended('viralflow:post:scheduler-tick',0)) then
   return jsonb_build_object('status','BUSY','mode',public.get_post_automation_execution_mode(),
     'claimedJobs',0,'skippedDuplicate',1,'failures',0);
 end if;
 -- Match public claim's capacity -> run -> account lock order, including recovery.
 perform pg_advisory_xact_lock(hashtextextended('viralflow:post:execution-capacity',0));
 select * into v_runtime from private.post_scheduler_runtime where singleton for share;
 if not found then raise exception 'post_scheduler_runtime_missing'; end if;
 v_limit:=least(3,p_limit,v_runtime.max_concurrent_accounts);
 if not v_runtime.enabled then v_status:='DISABLED';
 elsif v_runtime.execution_mode<>'SAFE' then v_status:='LIVE_EXECUTOR_REQUIRED'; end if;
 insert into private.post_scheduler_ticks(tick_time,test_owner_id,execution_mode,status)
 values(p_now,p_owner_id,v_runtime.execution_mode,'RUNNING') returning id into v_tick;
 update private.post_scheduler_runtime set last_tick_at=clock_timestamp(),updated_at=clock_timestamp()
 where singleton and p_owner_id is null;
 begin
   if v_status='SUCCEEDED' then
     v_recovered:=private.recover_safe_post_execution(p_now,p_owner_id);
     -- Scope proof recovery as well as creation; never rewrite another owner's test data.
     update public.post_schedule_slots s set auto_run_id=r.id,
       state=case when r.state='COMPLETED' then 'DONE' when r.state in ('STOPPED','FAILED') then 'FAILED' else 'RUNNING' end,
       lease_token=null,lease_expires_at=null
     from public.auto_runs r where r.owner_id=s.owner_id and r.tiktok_account_id=s.tiktok_account_id and r.schedule_slot_key=s.slot_key
       and (p_owner_id is null or s.owner_id=p_owner_id)
       and (s.state in ('CLAIMED','PENDING') or s.state='RUNNING' and r.state in ('COMPLETED','STOPPED','FAILED'));
     get diagnostics v_linked=row_count;
     v_recovered:=v_recovered+v_linked;
     -- A crash after create/settle but before execution resumes the existing job.
     for v_existing in select s.owner_id,s.auto_run_id,s.tiktok_account_id from public.auto_account_states s
       join public.auto_runs r on r.owner_id=s.owner_id and r.id=s.auto_run_id
       left join public.post_schedule_slots slot on slot.owner_id=s.owner_id and slot.tiktok_account_id=s.tiktok_account_id
         and slot.auto_run_id=s.auto_run_id and slot.slot_key=r.schedule_slot_key
       where r.metrics_json->>'executionMode'='SAFE' and r.state='RUNNING'
         and (p_owner_id is null or s.owner_id=p_owner_id)
         and (r.schedule_slot_key is null or slot.scheduled_at<=p_now)
         and s.state in ('STARTING','RUNNING','RETRY_PENDING')
         and (s.execution_next_attempt_at is null or s.execution_next_attempt_at<=now())
         and (s.execution_lease_expires_at is null or s.execution_lease_expires_at<=now())
       order by s.last_execution_scan_at nulls first,s.tiktok_account_id limit v_limit loop
       begin
         if private.halt_safe_post_run(v_existing.owner_id,v_existing.auto_run_id,v_existing.tiktok_account_id) then
           v_worked:=v_worked+1; v_recovered:=v_recovered+1;
           update public.auto_account_states set last_execution_scan_at=clock_timestamp() where owner_id=v_existing.owner_id
             and auto_run_id=v_existing.auto_run_id and tiktok_account_id=v_existing.tiktok_account_id;
         end if;
       exception when others then
         v_failures:=v_failures+1;
         insert into private.post_scheduler_ticks(tick_time,test_owner_id,execution_mode,status,finished_at,failures,error_code)
         values(p_now,v_existing.owner_id,'SAFE','FAILED',clock_timestamp(),1,sqlstate);
       end;
     end loop;
     for v_schedule in select schedule.* from public.post_account_schedules schedule
       join public.tiktok_accounts account on account.owner_id=schedule.owner_id and account.id=schedule.tiktok_account_id
       where schedule.enabled and account.hidden_at is null and (p_owner_id is null or schedule.owner_id=p_owner_id)
         and (schedule.next_due_at is null or schedule.next_due_at<=p_now or exists(select 1 from public.post_schedule_slots slot
           where slot.owner_id=schedule.owner_id and slot.tiktok_account_id=schedule.tiktok_account_id
             and slot.state in ('PENDING','CLAIMED') and slot.scheduled_at<=p_now and slot.expires_at>p_now))
       order by schedule.next_due_at nulls first,schedule.owner_id,schedule.tiktok_account_id limit 30 loop
       v_due:=v_due+1;
       begin
         v_plan:=private.plan_post_account_schedule(v_schedule,p_now);
         perform public.materialize_post_schedule_slots(v_schedule.owner_id,v_schedule.tiktok_account_id,v_schedule.revision,
           v_plan->'slots',(v_plan->>'nextDue')::timestamptz);
         if v_claimed>=v_limit or v_worked>=v_limit then v_queued:=v_queued+1; continue; end if;
         -- Keep materialized slots outside the claim/create subtransaction so a
         -- failed create has durable bounded retry evidence after rollback.
         v_before_claimed:=v_claimed; v_before_worked:=v_worked;
         begin
         v_slot:=public.claim_post_schedule_slot(v_schedule.owner_id,v_schedule.tiktok_account_id,p_now);
         if v_slot.slot_key is null then v_duplicate:=v_duplicate+1; continue; end if;
         select * into v_account from public.tiktok_accounts where owner_id=v_schedule.owner_id and id=v_schedule.tiktok_account_id;
         v_mode:=case when v_schedule.creative_mode='GROWTH' then 'GROWTH'
           when v_account.effective_mode='AFFILIATE' and not v_account.is_mock then 'AFFILIATE' else 'GROWTH' end;
         v_blockers:='[]'; v_state:='RUNNING';
         if not ((v_schedule.posting_mode='EXPORT' and v_account.account_status in ('active','disconnected','unknown'))
           or v_account.account_status='active' and v_account.authorization_status='authorized') then
           v_blockers:='["ACCOUNT_HEALTH"]'; v_state:='BLOCKED';
         end if;
         v_run:=public.create_operator_auto_run_atomic(v_schedule.owner_id,
           encode(extensions.digest('post-safe:'||v_schedule.owner_id::text||':'||v_slot.slot_key,'sha256'),'hex'),
           v_slot.local_date,'UNAVAILABLE','SAFE_EXECUTION_BOUNDARY',jsonb_build_array(jsonb_build_object(
             'accountId',v_schedule.tiktok_account_id,'requestedMode',v_schedule.creative_mode,'mode',v_mode,
             'state',v_state,'nextAction','WAIT_FOR_PROVIDER','blockers',v_blockers,'desiredCandidates',15,'desiredPosts',1,
             'maxDailyCostUsd',v_schedule.daily_budget_usd,'generationCapacity',0,'publishCapacity',0,'priority',50,
             'actionKey','post-safe:'||v_slot.slot_key,'postingMode',v_slot.posting_mode,'scheduleSlotKey',v_slot.slot_key)),v_schedule.daily_budget_usd);
         if v_run.schedule_slot_key is distinct from v_slot.slot_key then
           perform public.settle_post_schedule_slot(v_schedule.owner_id,v_schedule.tiktok_account_id,v_slot.slot_key,v_slot.lease_token,null,false);
           v_duplicate:=v_duplicate+1; continue;
         end if;
         update public.auto_runs set metrics_json=metrics_json||jsonb_build_object('executionMode','SAFE','externalCalls',0,
           'realPublishing',false,'paidProviders',false) where owner_id=v_schedule.owner_id and id=v_run.id;
         perform public.settle_post_schedule_slot(v_schedule.owner_id,v_schedule.tiktok_account_id,v_slot.slot_key,v_slot.lease_token,v_run.id,false);
         v_claimed:=v_claimed+1;
         if v_state='BLOCKED' then continue; end if;
         if private.halt_safe_post_run(v_schedule.owner_id,v_run.id,v_schedule.tiktok_account_id) then
           v_worked:=v_worked+1;
         else v_queued:=v_queued+1; end if;
       exception when others then
         v_claimed:=v_before_claimed; v_worked:=v_before_worked;
         v_failures:=v_failures+1;
         -- The account subtransaction rolls back its claim; other accounts continue.
         -- Persist bounded failure evidence on any pre-existing eligible claim.
         update public.post_schedule_slots set attempts=least(3,attempts+1),
           state=case when attempts+1>=3 then 'FAILED' else 'PENDING' end,
           lease_token=null,lease_expires_at=null,next_attempt_at=p_now+make_interval(secs=>least(300,30*power(2,attempts)::integer))
         where owner_id=v_schedule.owner_id and tiktok_account_id=v_schedule.tiktok_account_id
           and slot_key=(select slot_key from public.post_schedule_slots where owner_id=v_schedule.owner_id
             and tiktok_account_id=v_schedule.tiktok_account_id and state in ('PENDING','CLAIMED')
             and scheduled_at<=p_now and expires_at>p_now and (lease_expires_at is null or lease_expires_at<=p_now)
             order by scheduled_at desc,ordinal desc limit 1)
           and state in ('PENDING','CLAIMED') and scheduled_at<=p_now and expires_at>p_now
           and (next_attempt_at is null or next_attempt_at<=p_now) and attempts<3;
         insert into private.post_scheduler_ticks(tick_time,test_owner_id,execution_mode,status,finished_at,failures,error_code)
         values(p_now,v_schedule.owner_id,'SAFE','FAILED',clock_timestamp(),1,sqlstate);
         end;
       exception when others then
         v_failures:=v_failures+1;
         insert into private.post_scheduler_ticks(tick_time,test_owner_id,execution_mode,status,finished_at,failures,error_code)
         values(p_now,v_schedule.owner_id,'SAFE','FAILED',clock_timestamp(),1,sqlstate);
       end;
     end loop;
   end if;
   select min(next_due_at) into v_next from public.post_account_schedules where enabled and (p_owner_id is null or owner_id=p_owner_id);
   update private.post_scheduler_runtime set last_successful_tick_at=case when v_status='SUCCEEDED' and v_failures=0 then clock_timestamp() else last_successful_tick_at end,
     last_error_code=case when v_failures>0 then 'POST_ACCOUNT_TICK_FAILED' end,next_run_at=v_next,updated_at=clock_timestamp()
     where singleton and p_owner_id is null;
 exception when others then
   v_status:='FAILED'; v_error:=sqlstate; v_failures:=v_failures+1;
   update private.post_scheduler_runtime set last_error_code=v_error,updated_at=clock_timestamp()
   where singleton and p_owner_id is null;
 end;
 update private.post_scheduler_ticks set status=case when v_failures>0 then 'FAILED' else v_status end,finished_at=clock_timestamp(),
   due_accounts=v_due,claimed_jobs=v_claimed,skipped_duplicate=v_duplicate,recovered_jobs=v_recovered,failures=v_failures,
   queued_accounts=v_queued,next_run_at=v_next,error_code=v_error where id=v_tick;
 -- Retain this new module's diagnostics for 14 days in bounded batches. No user,
 -- job, financial, publication or other cron history is deleted.
 delete from private.post_scheduler_ticks where id in (select id from private.post_scheduler_ticks
   where started_at<clock_timestamp()-interval '14 days' and (p_owner_id is null or test_owner_id=p_owner_id)
   order by started_at limit 1000);
 return jsonb_build_object('tickId',v_tick,'mode',v_runtime.execution_mode,'status',case when v_failures>0 then 'FAILED' else v_status end,
   'dueAccounts',v_due,'claimedJobs',v_claimed,'skippedDuplicate',v_duplicate,'recoveredJobs',v_recovered,
   'failures',v_failures,'queuedAccounts',v_queued,'nextRun',v_next);
end $$;

create or replace function public.get_post_scheduler_health() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('mode',r.execution_mode,'enabled',r.enabled,'maximumConcurrentAccounts',r.max_concurrent_accounts,
   'lastTick',r.last_tick_at,'lastSuccessfulTick',r.last_successful_tick_at,'lastErrorCode',r.last_error_code,
   'nextRun',r.next_run_at,'cronJobId',r.cron_job_id,'interval',r.cron_interval,
   'latestTick',(select to_jsonb(t) from private.post_scheduler_ticks t where test_owner_id is null order by started_at desc limit 1))
 from private.post_scheduler_runtime r where singleton;
$$;

revoke all on function public.get_post_automation_execution_mode(),public.get_post_scheduler_health(),
 public.tick_post_account_automation(timestamptz,integer,uuid),private.plan_post_account_schedule(public.post_account_schedules,timestamptz),
 private.recover_safe_post_execution(timestamptz,uuid),private.enforce_post_execution_capacity(),private.halt_safe_post_run(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_post_automation_execution_mode(),public.get_post_scheduler_health(),
 public.tick_post_account_automation(timestamptz,integer,uuid),private.plan_post_account_schedule(public.post_account_schedules,timestamptz),
 private.recover_safe_post_execution(timestamptz,uuid),private.enforce_post_execution_capacity(),private.halt_safe_post_run(uuid,uuid,uuid) to service_role;
revoke all on function public.claim_auto_execution_step(uuid,uuid,uuid,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.claim_auto_execution_step(uuid,uuid,uuid,text,integer,boolean) to service_role;

-- Supabase has pg_cron available. Isolated PostgreSQL engines may not provide it;
-- the same pure SQL tick is still testable there without inventing a live cron.
do $$ declare v_job bigint; begin
 if not exists(select 1 from pg_catalog.pg_extension where extname='pg_cron')
   and exists(select 1 from pg_catalog.pg_available_extensions where name='pg_cron') then
   create extension if not exists pg_cron;
 end if;
 if to_regclass('cron.job') is not null then
   execute 'select jobid from cron.job where jobname=$1' into v_job using 'viralflow-post-account-automation';
   if v_job is null then
     execute 'select cron.schedule($1,$2,$3)' into v_job using 'viralflow-post-account-automation','* * * * *','SELECT public.tick_post_account_automation();';
   else
     execute 'select cron.alter_job($1,schedule:=$2,command:=$3,active:=true)' using v_job,'* * * * *','SELECT public.tick_post_account_automation();';
   end if;
   update private.post_scheduler_runtime set cron_job_id=v_job,cron_interval='* * * * *' where singleton;
 end if;
end $$;
