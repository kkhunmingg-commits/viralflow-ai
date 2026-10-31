-- Phase 11F: account-scoped execution lease and atomic checkpoint progression.
-- The Supabase CLI is unavailable in this workspace, so this migration is
-- created locally with the next ordered version and must be reviewed before apply.
alter table public.auto_account_states
  add column execution_lease_token uuid,
  add column execution_lease_worker text,
  add column execution_lease_expires_at timestamptz,
  add column execution_next_attempt_at timestamptz,
  add constraint auto_execution_lease_complete check (
    (execution_lease_token is null and execution_lease_worker is null and execution_lease_expires_at is null)
    or (execution_lease_token is not null and execution_lease_worker is not null and execution_lease_expires_at is not null)
  );

alter table public.auto_account_states drop constraint auto_account_states_state_check;
alter table public.auto_account_states add constraint auto_account_states_state_check check (
  state in ('STARTING','RUNNING','PAUSED','WAITING_FOR_DATA','WAITING_FOR_APPROVAL','WAITING_FOR_SLOT',
    'WAITING_FOR_PROVIDER','WAITING_FOR_RECONCILIATION','RETRY_PENDING','BLOCKED','COMPLETED','FAILED','STOPPED')
);

create or replace function public.claim_auto_execution_step(
  p_owner_id uuid, p_run_id uuid, p_account_id uuid, p_worker_id text, p_lease_seconds integer default 900,
  p_provider_ready boolean default false
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_run public.auto_runs; v_account public.auto_account_states; v_checkpoint jsonb; v_step text; v_token uuid; v_attempt integer; v_retry_at timestamptz; v_item_index integer; v_ready boolean;
begin
  if char_length(p_worker_id) not between 1 and 120 or p_lease_seconds not between 30 and 3600 then
    raise exception 'invalid_auto_execution_lease';
  end if;
  select * into v_run from public.auto_runs where id=p_run_id and owner_id=p_owner_id for share;
  if not found or v_run.state <> 'RUNNING' then return null; end if;
  select * into v_account from public.auto_account_states
    where auto_run_id=p_run_id and tiktok_account_id=p_account_id and owner_id=v_run.owner_id for update;
  if not found then return null; end if;
  if v_account.execution_lease_expires_at > now() then return null; end if;
  if v_account.execution_next_attempt_at > now() then return null; end if;
  if v_account.state='WAITING_FOR_PROVIDER' and p_provider_ready
     and v_account.blockers_json @> '["PROVIDER_UNAVAILABLE"]'::jsonb then
    update public.auto_account_states set state='RUNNING',
      blockers_json=v_account.blockers_json - 'PROVIDER_UNAVAILABLE'
      where id=v_account.id returning * into v_account;
  end if;
  if v_account.state='WAITING_FOR_APPROVAL' and v_account.current_step='PUBLISH' then
    select exists(select 1 from public.publishing_queue q
      join public.auto_checkpoints cp on cp.owner_id=q.owner_id and cp.auto_run_id=p_run_id
        and cp.tiktok_account_id=p_account_id and cp.state_json->>'queueId'=q.id::text
      where q.owner_id=p_owner_id and q.consent_id is not null) into v_ready;
    if v_ready then
      update public.auto_account_states set state='RUNNING',blockers_json='[]'::jsonb
        where id=v_account.id returning * into v_account;
    end if;
  end if;
  if v_account.state in ('WAITING_FOR_DATA','WAITING_FOR_SLOT') then
    update public.auto_account_states set state='RUNNING',blockers_json='[]'::jsonb
      where id=v_account.id returning * into v_account;
  end if;
  if v_account.state not in ('RUNNING','STARTING','RETRY_PENDING') or jsonb_array_length(v_account.blockers_json)>0 then
    return null;
  end if;
  select state_json into v_checkpoint from public.auto_checkpoints
    where owner_id=v_run.owner_id and auto_run_id=p_run_id and tiktok_account_id=p_account_id
    order by checkpoint_version desc limit 1;
  v_checkpoint:=coalesce(v_checkpoint,jsonb_build_object('itemIndex',1));
  v_item_index:=coalesce((v_checkpoint->>'itemIndex')::integer,1);
  v_step:=case when v_account.current_step='PLAN_ACCOUNTS' then 'FIND_OPPORTUNITY' else v_account.current_step end;
  if v_step not in ('FIND_OPPORTUNITY','CREATE_CREATIVE','GENERATE_VIDEO','QUALITY_CHECK',
    'COMPLIANCE_CHECK','QUEUE_PUBLISH','PUBLISH','COLLECT_ANALYTICS','LEARN') then return null; end if;
  select count(*)+1,max(next_retry_at) into v_attempt,v_retry_at from public.auto_failures
    where owner_id=v_run.owner_id and auto_run_id=p_run_id and tiktok_account_id=p_account_id and step=v_step
      and safe_context_json->>'itemIndex'=v_item_index::text;
  if v_attempt>3 or v_retry_at>now() then return null; end if;
  v_token:=gen_random_uuid();
  update public.auto_account_states set execution_lease_token=v_token,execution_lease_worker=p_worker_id,
    execution_lease_expires_at=now()+make_interval(secs=>p_lease_seconds),execution_next_attempt_at=null
    where id=v_account.id;
  return jsonb_build_object('ownerId',v_run.owner_id,'runId',p_run_id,'accountId',p_account_id,
    'mode',v_account.effective_mode,'itemIndex',v_item_index,
    'dailyTarget',v_account.desired_daily_posts,'step',v_step,'attempt',v_attempt,'leaseToken',v_token,
    'checkpoint',v_checkpoint,'operationKey',v_run.idempotency_key||':'||p_account_id::text||':'||
      coalesce(v_checkpoint->>'itemIndex','1')||':'||v_step);
end; $$;

create or replace function public.finish_auto_execution_step(
  p_owner_id uuid,p_run_id uuid,p_account_id uuid,p_lease_token uuid,
  p_step text,p_kind text,p_evidence jsonb,p_next_step text,p_next_item_index integer,
  p_wait_state text default null,p_reason text default null
) returns boolean language plpgsql security invoker set search_path='' as $$
declare v_run public.auto_runs; v_account public.auto_account_states; v_prior jsonb; v_next jsonb; v_version integer; v_key text; v_hash text; v_state text;
begin
  select * into v_run from public.auto_runs where id=p_run_id and owner_id=p_owner_id for update;
  if not found then raise exception 'auto_run_not_found'; end if;
  select * into v_account from public.auto_account_states where owner_id=p_owner_id and auto_run_id=p_run_id
    and tiktok_account_id=p_account_id for update;
  if not found or v_account.execution_lease_token is distinct from p_lease_token
     or v_account.execution_lease_expires_at <= now() then raise exception 'auto_execution_lease_lost'; end if;
  if p_step <> (case when v_account.current_step='PLAN_ACCOUNTS' then 'FIND_OPPORTUNITY' else v_account.current_step end)
     or p_next_item_index < 1 or p_next_item_index > v_account.desired_daily_posts+1
     or jsonb_typeof(p_evidence) is distinct from 'object' then raise exception 'invalid_auto_execution_result'; end if;
  if p_kind not in ('ADVANCE','WAIT','RECONCILE','SKIP_ITEM') then raise exception 'invalid_auto_execution_result'; end if;
  select state_json into v_prior from public.auto_checkpoints where owner_id=p_owner_id and auto_run_id=p_run_id
    and tiktok_account_id=p_account_id order by checkpoint_version desc limit 1;
  v_prior:=coalesce(v_prior,jsonb_build_object('itemIndex',1));
  v_next:=case when p_next_item_index > coalesce((v_prior->>'itemIndex')::integer,1)
    then jsonb_build_object('itemIndex',p_next_item_index) else v_prior || p_evidence end;
  v_next:=v_next || jsonb_build_object('itemIndex',p_next_item_index);
  v_version:=v_account.checkpoint_version+1;
  v_key:=v_run.idempotency_key||':'||p_account_id::text||':'||coalesce(v_prior->>'itemIndex','1')||':'||p_step||':'||p_kind;
  v_hash:=encode(extensions.digest(v_next::text,'sha256'),'hex');
  insert into public.auto_run_steps(owner_id,auto_run_id,tiktok_account_id,step,state,idempotency_key,
    input_json,output_json,failure_reason,started_at,completed_at)
    values(p_owner_id,p_run_id,p_account_id,p_step,
      case when p_kind='ADVANCE' then 'COMPLETED' when p_kind='SKIP_ITEM' then 'SKIPPED' else 'WAITING' end,
      v_key,jsonb_build_object('itemIndex',coalesce((v_prior->>'itemIndex')::integer,1)),p_evidence,left(p_reason,200),now(),now())
    on conflict(owner_id,idempotency_key) do nothing;
  insert into public.auto_checkpoints(owner_id,auto_run_id,tiktok_account_id,step,checkpoint_version,state_json,evidence_hash)
    values(p_owner_id,p_run_id,p_account_id,p_step,v_version,v_next,v_hash);
  v_state:=case when v_run.state='STOPPED' then 'STOPPED' when v_run.state='PAUSED' then 'PAUSED'
    when p_next_step='COMPLETE' then 'COMPLETED' when p_kind='RECONCILE' then 'WAITING_FOR_RECONCILIATION'
    when p_kind='WAIT' then p_wait_state else 'RUNNING' end;
  update public.auto_account_states set current_step=p_next_step,checkpoint_version=v_version,state=v_state,
    blockers_json=case when p_kind in ('WAIT','RECONCILE') then jsonb_build_array(coalesce(p_reason,'UNKNOWN')) else '[]'::jsonb end,
    execution_lease_token=null,execution_lease_worker=null,execution_lease_expires_at=null,
    execution_next_attempt_at=case when p_kind='WAIT' then now()+interval '5 minutes' else null end
    where id=v_account.id;
  if v_run.state='RUNNING' then
    update public.auto_runs set current_step=p_step where id=p_run_id and owner_id=p_owner_id;
    if not exists (select 1 from public.auto_account_states where owner_id=p_owner_id and auto_run_id=p_run_id
      and state not in ('COMPLETED','STOPPED','FAILED')) then
      update public.auto_runs set state='COMPLETED',completed_at=now(),current_step='COMPLETE'
        where id=p_run_id and owner_id=p_owner_id;
    end if;
  end if;
  return true;
end; $$;

create or replace function public.fail_auto_execution_step(
  p_owner_id uuid,p_run_id uuid,p_account_id uuid,p_lease_token uuid,p_step text,
  p_failure_type text,p_retryable boolean,p_reason text,p_next_state text
) returns boolean language plpgsql security invoker set search_path='' as $$
declare v_account public.auto_account_states; v_item_index integer; v_count integer;
begin
  select * into v_account from public.auto_account_states where owner_id=p_owner_id and auto_run_id=p_run_id
    and tiktok_account_id=p_account_id and execution_lease_token=p_lease_token for update;
  if not found or v_account.execution_lease_expires_at <= now() then raise exception 'auto_execution_lease_lost'; end if;
  select coalesce((state_json->>'itemIndex')::integer,1) into v_item_index from public.auto_checkpoints
    where owner_id=p_owner_id and auto_run_id=p_run_id and tiktok_account_id=p_account_id
    order by checkpoint_version desc limit 1;
  v_item_index:=coalesce(v_item_index,1);
  select count(*) into v_count from public.auto_failures where owner_id=p_owner_id and auto_run_id=p_run_id
    and tiktok_account_id=p_account_id and step=p_step and safe_context_json->>'itemIndex'=v_item_index::text;
  insert into public.auto_failures(owner_id,auto_run_id,tiktok_account_id,failure_type,step,reason,retryable,retry_count,next_retry_at,safe_context_json)
    values(p_owner_id,p_run_id,p_account_id,p_failure_type,p_step,left(p_reason,200),p_retryable,
      v_count,case when p_retryable then now()+make_interval(secs=>least(300,30*power(2,v_count)::integer)) else null end,
      jsonb_build_object('itemIndex',v_item_index));
  update public.auto_account_states set state=case when exists(
      select 1 from public.auto_runs where id=p_run_id and owner_id=p_owner_id and state='STOPPED'
    ) then 'STOPPED' else p_next_state end,
    blockers_json=case when p_retryable then '[]'::jsonb else jsonb_build_array(left(p_reason,200)) end,execution_lease_token=null,
    execution_lease_worker=null,execution_lease_expires_at=null where id=v_account.id;
  return true;
end; $$;

revoke all on function public.claim_auto_execution_step(uuid,uuid,uuid,text,integer,boolean) from public,anon,authenticated;
revoke all on function public.finish_auto_execution_step(uuid,uuid,uuid,uuid,text,text,jsonb,text,integer,text,text) from public,anon,authenticated;
revoke all on function public.fail_auto_execution_step(uuid,uuid,uuid,uuid,text,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.claim_auto_execution_step(uuid,uuid,uuid,text,integer,boolean) to service_role;
grant execute on function public.finish_auto_execution_step(uuid,uuid,uuid,uuid,text,text,jsonb,text,integer,text,text) to service_role;
grant execute on function public.fail_auto_execution_step(uuid,uuid,uuid,uuid,text,text,boolean,text,text) to service_role;

-- Preserve the execution cursor while allowing the existing controls to stop
-- the run. The run's current_step still records the operator action.
create or replace function public.transition_auto_run_atomic(p_owner_id uuid,p_run_id uuid,p_action text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_previous text; v_next text;
begin
  if p_action not in ('PAUSE','RESUME','STOP') then raise exception 'invalid_auto_action'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  select state into v_previous from public.auto_runs where owner_id=p_owner_id and id=p_run_id for update;
  if not found then raise exception 'auto_run_not_found'; end if;
  v_next:=case
    when p_action='PAUSE' and v_previous in ('RUNNING','RETRY_PENDING','WAITING_FOR_DATA','WAITING_FOR_SLOT','WAITING_FOR_PROVIDER') then 'PAUSED'
    when p_action='RESUME' and v_previous='PAUSED' then 'RUNNING'
    when p_action='STOP' and v_previous not in ('COMPLETED','FAILED','STOPPED') then 'STOPPED'
    else v_previous end;
  if v_next<>v_previous then
    update public.auto_runs set state=v_next,current_step=p_action,
      paused_at=case when p_action='PAUSE' then now() when p_action='RESUME' then null else paused_at end,
      completed_at=case when p_action='STOP' then now() else completed_at end
      where owner_id=p_owner_id and id=p_run_id;
    update public.auto_account_states
    set state=case
      when p_action='STOP' then 'STOPPED'
      when p_action='PAUSE' then 'PAUSED'
      when blockers_json ? 'PROVIDER_UNAVAILABLE' then 'WAITING_FOR_PROVIDER'
      when blockers_json ? 'RECONCILIATION_REQUIRED' then 'WAITING_FOR_RECONCILIATION'
      when blockers_json ? 'BUDGET_EXCEEDED' or blockers_json ? 'ACCOUNT_HEALTH' then 'BLOCKED'
      when blockers_json ? 'CONSENT' then 'WAITING_FOR_APPROVAL'
      when blockers_json ? 'PUBLISH_CAP' then 'WAITING_FOR_SLOT'
      when blockers_json ? 'ANALYTICS_STALE' then 'WAITING_FOR_DATA'
      when blockers_json ? 'RUN_NOT_ACTIVE' then 'RUNNING'
      when jsonb_array_length(blockers_json)>0 then 'BLOCKED'
      else 'RUNNING' end
    ,blockers_json=case when p_action='RESUME' then blockers_json - 'RUN_NOT_ACTIVE' else blockers_json end
    where owner_id=p_owner_id and auto_run_id=p_run_id
      and state not in ('COMPLETED','FAILED','STOPPED')
      and (p_action='STOP' or state<>'BLOCKED');
  end if;
  return jsonb_build_object('previous',v_previous,'state',v_next);
end; $$;
