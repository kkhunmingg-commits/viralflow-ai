-- Phase 11C: durable operator work, recovery heartbeat, and deduplicated alerts.
-- All mutations are service-only. The owner can read their own incidents and audit trail.

create table public.operations_scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  window_key text not null unique check (char_length(window_key) between 8 and 100),
  state text not null check (state in ('RUNNING','COMPLETED','FAILED')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary_json jsonb not null default '{}' check (jsonb_typeof(summary_json)='object'),
  error_code text check (error_code is null or char_length(error_code)<=100)
);
create index operations_scheduler_recent_idx on public.operations_scheduler_runs(started_at desc);
alter table public.operations_scheduler_runs enable row level security;
revoke all on public.operations_scheduler_runs from public,anon,authenticated;
grant select,insert,update on public.operations_scheduler_runs to service_role;
create policy operations_scheduler_service on public.operations_scheduler_runs
  for all to service_role using (true) with check (true);

create table public.operations_webhook_failures (
  minute_bucket timestamptz primary key,
  failure_count integer not null default 1 check (failure_count > 0),
  last_reason_code text not null check (char_length(last_reason_code) between 3 and 100)
);
alter table public.operations_webhook_failures enable row level security;
revoke all on public.operations_webhook_failures from public,anon,authenticated;
grant select,insert,update on public.operations_webhook_failures to service_role;
create policy operations_webhook_failures_service on public.operations_webhook_failures
  for all to service_role using (true) with check (true);

create or replace function public.record_operations_webhook_failure(p_reason_code text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_reason_code not in ('INVALID_SIGNATURE','INVALID_BODY','PROCESSING_FAILED','RATE_LIMITED') then
    raise exception 'invalid_webhook_failure_code'; end if;
  insert into public.operations_webhook_failures(minute_bucket,last_reason_code)
    values(pg_catalog.date_trunc('minute',now()),p_reason_code)
    on conflict(minute_bucket) do update set
      failure_count=public.operations_webhook_failures.failure_count+1,
      last_reason_code=excluded.last_reason_code;
end $$;
revoke all on function public.record_operations_webhook_failure(text) from public,anon,authenticated;
grant execute on function public.record_operations_webhook_failure(text) to service_role;

create table public.operations_incidents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  subject_type text not null check (subject_type in ('PUBLISH','BUDGET','AUTO_RUN','GENERATION_JOB','WEBHOOK')),
  subject_id uuid not null,
  tiktok_account_id uuid,
  auto_run_id uuid,
  provider text,
  provider_operation_id text,
  classification text not null check (classification in ('AUTO_RECOVERABLE','RECONCILIATION_REQUIRED','FINAL_FAILURE')),
  lifecycle text not null default 'OPEN' check (lifecycle in ('OPEN','ACKNOWLEDGED','RESOLVED')),
  reason_code text not null check (char_length(reason_code) between 3 and 100),
  recommended_action text not null check (recommended_action in ('WAIT','RECHECK_STATUS','MARK_CONFIRMED','MARK_FAILED','RELEASE_SAFE_RESERVATION','REQUEUE_SAFE_OPERATION','ACKNOWLEDGE')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  last_attempt_at timestamptz,
  occurrence_count integer not null default 1 check (occurrence_count>0),
  unique(owner_id,id),
  unique(owner_id,subject_type,subject_id),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete set null (tiktok_account_id),
  foreign key(owner_id,auto_run_id) references public.auto_runs(owner_id,id) on delete set null (auto_run_id)
);
create index operations_incidents_owner_open_idx
  on public.operations_incidents(owner_id,lifecycle,classification,last_seen_at desc);
create index operations_incidents_account_idx
  on public.operations_incidents(owner_id,tiktok_account_id,last_seen_at desc)
  where tiktok_account_id is not null;
alter table public.operations_incidents enable row level security;
revoke all on public.operations_incidents from public,anon,authenticated;
grant select on public.operations_incidents to authenticated;
grant select,insert,update on public.operations_incidents to service_role;
create policy operations_incidents_owner_read on public.operations_incidents
  for select to authenticated using ((select auth.uid())=owner_id);

create table public.operations_action_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  incident_id uuid not null,
  actor_id uuid,
  action text not null check (action in ('ACKNOWLEDGE','RECHECK_STATUS','MARK_CONFIRMED','MARK_FAILED','RELEASE_SAFE_RESERVATION','REQUEUE_SAFE_OPERATION','RESOLVE')),
  idempotency_key uuid not null,
  evidence_hash text check (evidence_hash is null or evidence_hash ~ '^[a-f0-9]{64}$'),
  outcome text not null check (outcome in ('ACCEPTED','COMPLETED','BLOCKED')),
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,idempotency_key),
  foreign key(owner_id,incident_id) references public.operations_incidents(owner_id,id) on delete cascade,
  foreign key(actor_id) references public.profiles(id) on delete set null
);
create index operations_actions_incident_idx
  on public.operations_action_events(owner_id,incident_id,created_at desc);
alter table public.operations_action_events enable row level security;
revoke all on public.operations_action_events from public,anon,authenticated;
grant select on public.operations_action_events to authenticated;
grant select,insert on public.operations_action_events to service_role;
create policy operations_actions_owner_read on public.operations_action_events
  for select to authenticated using ((select auth.uid())=owner_id);

create table public.operations_alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  rule_code text not null check (char_length(rule_code) between 3 and 100),
  subject_key text not null check (char_length(subject_key) between 3 and 160),
  severity text not null check (severity in ('INFO','WARN','CRITICAL')),
  state text not null default 'OPEN' check (state in ('OPEN','ACKNOWLEDGED','RESOLVED')),
  occurrence_count integer not null default 1 check (occurrence_count>0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(owner_id,rule_code,subject_key)
);
create index operations_alerts_owner_open_idx
  on public.operations_alerts(owner_id,state,severity,last_seen_at desc);
alter table public.operations_alerts enable row level security;
revoke all on public.operations_alerts from public,anon,authenticated;
grant select on public.operations_alerts to authenticated;
grant select,insert,update on public.operations_alerts to service_role;
create policy operations_alerts_owner_read on public.operations_alerts
  for select to authenticated using ((select auth.uid())=owner_id);

create or replace function public.claim_operations_scheduler_window(p_window_key text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_run public.operations_scheduler_runs;
begin
  if char_length(p_window_key) not between 8 and 100 then raise exception 'invalid_scheduler_window'; end if;
  insert into public.operations_scheduler_runs(window_key,state)
    values(p_window_key,'RUNNING') on conflict(window_key) do nothing
    returning * into v_run;
  if found then return true; end if;
  update public.operations_scheduler_runs set state='RUNNING',started_at=now(),completed_at=null,error_code=null
    where window_key=p_window_key and state in ('RUNNING','FAILED')
      and started_at<now()-interval '15 minutes' returning * into v_run;
  return found;
end $$;

create or replace function public.finish_operations_scheduler_window(
  p_window_key text,p_success boolean,p_summary jsonb,p_error_code text default null
) returns void language plpgsql security invoker set search_path='' as $$
begin
  update public.operations_scheduler_runs set
    state=case when p_success then 'COMPLETED' else 'FAILED' end,
    completed_at=now(),summary_json=coalesce(p_summary,'{}'::jsonb),
    error_code=case when p_success then null else left(p_error_code,100) end
    where window_key=p_window_key and state='RUNNING';
  if not found then raise exception 'scheduler_window_not_claimed'; end if;
end $$;

create or replace function public.upsert_operations_incident(
  p_owner_id uuid,p_subject_type text,p_subject_id uuid,p_account_id uuid,p_run_id uuid,
  p_provider text,p_provider_operation_id text,p_classification text,p_reason_code text,p_recommended_action text
) returns public.operations_incidents
language plpgsql security invoker set search_path='' as $$
declare v_incident public.operations_incidents;
begin
  insert into public.operations_incidents(
    owner_id,subject_type,subject_id,tiktok_account_id,auto_run_id,provider,provider_operation_id,
    classification,reason_code,recommended_action
  ) values (
    p_owner_id,p_subject_type,p_subject_id,p_account_id,p_run_id,left(p_provider,100),left(p_provider_operation_id,200),
    p_classification,p_reason_code,p_recommended_action
  ) on conflict(owner_id,subject_type,subject_id) do update set
    tiktok_account_id=excluded.tiktok_account_id,auto_run_id=excluded.auto_run_id,
    provider=excluded.provider,provider_operation_id=excluded.provider_operation_id,
    classification=excluded.classification,reason_code=excluded.reason_code,
    recommended_action=excluded.recommended_action,last_seen_at=now(),
    occurrence_count=case when public.operations_incidents.reason_code=excluded.reason_code
      then public.operations_incidents.occurrence_count else public.operations_incidents.occurrence_count+1 end,
    lifecycle=case when public.operations_incidents.reason_code<>excluded.reason_code then 'OPEN'
      else public.operations_incidents.lifecycle end,
    resolved_at=case when public.operations_incidents.reason_code<>excluded.reason_code then null
      else public.operations_incidents.resolved_at end
  returning * into v_incident;
  return v_incident;
end $$;

create or replace function public.upsert_operations_alert(
  p_owner_id uuid,p_rule_code text,p_subject_key text,p_severity text
) returns public.operations_alerts
language plpgsql security invoker set search_path='' as $$
declare v_alert public.operations_alerts;
begin
  insert into public.operations_alerts(owner_id,rule_code,subject_key,severity)
    values(p_owner_id,p_rule_code,p_subject_key,p_severity)
  on conflict(owner_id,rule_code,subject_key) do update set
    severity=excluded.severity,last_seen_at=now(),
    occurrence_count=public.operations_alerts.occurrence_count+1,
    state=case when public.operations_alerts.state='RESOLVED' then 'OPEN' else public.operations_alerts.state end,
    resolved_at=null
  returning * into v_alert;
  return v_alert;
end $$;

create or replace function public.apply_operations_manual_action(
  p_owner_id uuid,p_actor_id uuid,p_incident_id uuid,p_action text,p_idempotency_key uuid,
  p_evidence_hash text default null,p_external_id text default null
) returns public.operations_incidents
language plpgsql security invoker set search_path='' as $$
declare v_incident public.operations_incidents; v_existing public.operations_action_events; v_queue public.publishing_queue;
begin
  if p_actor_id<>p_owner_id then raise exception 'operator_owner_mismatch'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text||':'||p_idempotency_key::text,0));
  select * into v_existing from public.operations_action_events
    where owner_id=p_owner_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.incident_id<>p_incident_id or v_existing.action<>p_action then
      raise exception 'idempotency_key_conflict'; end if;
    select * into v_incident from public.operations_incidents where owner_id=p_owner_id and id=p_incident_id;
    if not found then raise exception 'incident_not_found'; end if;
    return v_incident;
  end if;
  select * into v_incident from public.operations_incidents
    where owner_id=p_owner_id and id=p_incident_id for update;
  if not found then raise exception 'incident_not_found'; end if;
  if v_incident.lifecycle='RESOLVED' and p_action<>'RESOLVE' then raise exception 'incident_already_resolved'; end if;

  if p_action='ACKNOWLEDGE' then
    update public.operations_incidents set lifecycle='ACKNOWLEDGED',last_attempt_at=now()
      where id=v_incident.id;
  elsif p_action='RECHECK_STATUS' then
    if v_incident.subject_type<>'PUBLISH' or v_incident.provider_operation_id is null then
      raise exception 'external_status_unavailable'; end if;
    update public.operations_incidents set last_attempt_at=now() where id=v_incident.id;
  elsif p_action='MARK_CONFIRMED' then
    if v_incident.subject_type<>'PUBLISH' or v_incident.classification<>'RECONCILIATION_REQUIRED'
       or p_evidence_hash is null or p_external_id is null or char_length(p_external_id) not between 1 and 64 then
      raise exception 'confirmation_evidence_required'; end if;
    select * into v_queue from public.publishing_queue
      where owner_id=p_owner_id and id=v_incident.subject_id for update;
    if not found or v_queue.external_state<>'SUBMITTED_UNKNOWN' then raise exception 'publish_not_uncertain'; end if;
    update public.publishing_queue set provider_publish_id=p_external_id,
      provider_status='OPERATOR_CONFIRMED_PROVIDER_ID',external_state='SUBMITTED',status='PROCESSING',
      reconciliation_required_at=null where owner_id=p_owner_id and id=v_queue.id;
    insert into public.publish_status_events(owner_id,publishing_queue_id,source,from_status,to_status,reason_code)
      values(p_owner_id,v_queue.id,'SYSTEM',v_queue.status,'PROCESSING','OPERATOR_ATTACHED_PROVIDER_ID');
    update public.operations_incidents set lifecycle='RESOLVED',resolved_at=now(),last_attempt_at=now(),
      provider_operation_id=p_external_id where id=v_incident.id;
  elsif p_action='MARK_FAILED' then
    if v_incident.subject_type<>'PUBLISH' or v_incident.classification<>'RECONCILIATION_REQUIRED'
       or p_evidence_hash is null then raise exception 'failure_evidence_required'; end if;
    select * into v_queue from public.publishing_queue
      where owner_id=p_owner_id and id=v_incident.subject_id for update;
    if not found or v_queue.external_state<>'SUBMITTED_UNKNOWN' then raise exception 'publish_not_uncertain'; end if;
    update public.publishing_queue set status='FAILED',external_state='FAILED_FINAL',
      last_error_code='OPERATOR_MARKED_FINAL',reconciliation_required_at=null where owner_id=p_owner_id and id=v_queue.id;
    insert into public.publish_status_events(owner_id,publishing_queue_id,source,from_status,to_status,reason_code)
      values(p_owner_id,v_queue.id,'SYSTEM',v_queue.status,'FAILED','OPERATOR_MARKED_FINAL');
    update public.operations_incidents set lifecycle='RESOLVED',resolved_at=now(),last_attempt_at=now()
      where id=v_incident.id;
  elsif p_action='RELEASE_SAFE_RESERVATION' then
    if v_incident.subject_type<>'BUDGET' or v_incident.classification<>'AUTO_RECOVERABLE'
      or p_evidence_hash is null then raise exception 'unsafe_budget_release_blocked'; end if;
    perform public.release_generation_budget(p_owner_id,v_incident.subject_id,false);
    update public.operations_incidents set lifecycle='RESOLVED',resolved_at=now(),last_attempt_at=now()
      where id=v_incident.id;
  elsif p_action='REQUEUE_SAFE_OPERATION' then
    if v_incident.subject_type<>'PUBLISH' or v_incident.classification<>'AUTO_RECOVERABLE' then
      raise exception 'unsafe_requeue_blocked'; end if;
    select * into v_queue from public.publishing_queue
      where owner_id=p_owner_id and id=v_incident.subject_id for update;
    if not found or v_queue.external_state<>'FAILED_RETRYABLE' or v_queue.provider_publish_id is not null then
      raise exception 'unsafe_requeue_blocked'; end if;
    update public.publishing_queue set status='RETRYING',next_retry_at=null where owner_id=p_owner_id and id=v_queue.id;
    update public.operations_incidents set lifecycle='RESOLVED',resolved_at=now(),last_attempt_at=now()
      where id=v_incident.id;
  elsif p_action='RESOLVE' then
    if v_incident.classification<>'FINAL_FAILURE' or p_evidence_hash is null then
      raise exception 'dead_letter_evidence_required'; end if;
    update public.operations_incidents set lifecycle='RESOLVED',resolved_at=now(),last_attempt_at=now()
      where id=v_incident.id;
  else raise exception 'invalid_operator_action';
  end if;
  insert into public.operations_action_events(owner_id,incident_id,actor_id,action,idempotency_key,evidence_hash,outcome)
    values(p_owner_id,p_incident_id,p_actor_id,p_action,p_idempotency_key,p_evidence_hash,'COMPLETED');
  select * into v_incident from public.operations_incidents where id=p_incident_id;
  return v_incident;
end $$;

revoke all on function public.claim_operations_scheduler_window(text) from public,anon,authenticated;
revoke all on function public.finish_operations_scheduler_window(text,boolean,jsonb,text) from public,anon,authenticated;
revoke all on function public.upsert_operations_incident(uuid,text,uuid,uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.upsert_operations_alert(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.apply_operations_manual_action(uuid,uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_operations_scheduler_window(text) to service_role;
grant execute on function public.finish_operations_scheduler_window(text,boolean,jsonb,text) to service_role;
grant execute on function public.upsert_operations_incident(uuid,text,uuid,uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function public.upsert_operations_alert(uuid,text,text,text) to service_role;
grant execute on function public.apply_operations_manual_action(uuid,uuid,uuid,text,uuid,text,text) to service_role;
