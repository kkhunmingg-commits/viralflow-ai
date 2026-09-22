-- Phase 11B: crash-safe external publishing and atomic paid-generation budgets.

alter table public.publishing_queue
  add column external_operation_key text,
  add column external_state text,
  add column lease_token uuid,
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add column reconciliation_required_at timestamptz;

update public.publishing_queue
set external_operation_key = 'tiktok:' || id::text,
    external_state = case
      when status in ('PUBLISHED','DRAFT_DELIVERED') then 'CONFIRMED'
      when provider_publish_id is not null then 'SUBMITTED'
      when status = 'FAILED' then 'FAILED_FINAL'
      when status = 'RETRYING' then 'FAILED_RETRYABLE'
      else 'READY'
    end;

alter table public.publishing_queue
  alter column external_operation_key set default ('tiktok:' || gen_random_uuid()::text),
  alter column external_state set default 'READY',
  alter column external_operation_key set not null,
  alter column external_state set not null,
  add constraint publishing_queue_external_operation_key_length
    check (char_length(external_operation_key) between 8 and 240),
  add constraint publishing_queue_external_state_check check (external_state in (
    'READY','RESERVING','SUBMITTING','SUBMITTED_UNKNOWN','SUBMITTED','CONFIRMED',
    'FAILED_RETRYABLE','FAILED_FINAL'
  )),
  add constraint publishing_queue_lease_complete check (
    (lease_token is null and lease_owner is null and lease_expires_at is null)
    or (lease_token is not null and lease_owner is not null and lease_expires_at is not null)
  );

alter table public.publishing_queue drop constraint if exists publishing_queue_status_check;
alter table public.publishing_queue add constraint publishing_queue_status_check check (status in (
  'DRAFT','REVIEW_REQUIRED','APPROVED','QUEUED','WAITING_FOR_SLOT','UPLOADING','PROCESSING',
  'DRAFT_DELIVERED','PUBLISHED','RETRYING','FAILED','CANCELLED','REJECTED','WAITING_FOR_RECONCILIATION'
));
alter table public.publish_status_events drop constraint if exists publish_status_events_to_status_check;
alter table public.publish_status_events add constraint publish_status_events_to_status_check check (to_status in (
  'DRAFT','REVIEW_REQUIRED','APPROVED','QUEUED','WAITING_FOR_SLOT','UPLOADING','PROCESSING',
  'DRAFT_DELIVERED','PUBLISHED','RETRYING','FAILED','CANCELLED','REJECTED','WAITING_FOR_RECONCILIATION'
));

create unique index publishing_queue_external_operation_unique_idx
  on public.publishing_queue(owner_id, external_operation_key);
create index publishing_queue_recovery_idx
  on public.publishing_queue(external_state, lease_expires_at)
  where external_state in ('RESERVING','SUBMITTING','SUBMITTED_UNKNOWN');

create table public.generation_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null,
  generation_job_id uuid,
  auto_run_id uuid,
  run_key text not null check (char_length(run_key) between 8 and 240),
  logical_operation_key text not null check (char_length(logical_operation_key) between 8 and 240),
  provider text not null check (char_length(provider) between 1 and 100),
  model text not null check (char_length(model) between 1 and 200),
  reserved_usd numeric(14,6) not null check (reserved_usd > 0),
  actual_usd numeric(14,6) check (actual_usd is null or actual_usd >= 0),
  per_video_cap_usd numeric(14,6) not null check (per_video_cap_usd > 0),
  daily_cap_usd numeric(14,6) not null check (daily_cap_usd > 0),
  monthly_cap_usd numeric(14,6) not null check (monthly_cap_usd > 0),
  run_cap_usd numeric(14,6) not null check (run_cap_usd > 0),
  account_cap_usd numeric(14,6) not null check (account_cap_usd > 0),
  provider_cap_usd numeric(14,6) not null check (provider_cap_usd > 0),
  budget_day date not null,
  budget_month date not null check (budget_month = date_trunc('month', budget_month)::date),
  state text not null default 'RESERVED' check (state in ('RESERVED','SETTLED','RELEASED','EXPIRED')),
  provider_submission_state text not null default 'REQUEST_NOT_SENT' check (provider_submission_state in (
    'REQUEST_NOT_SENT','SUBMITTING','SUBMITTED_UNKNOWN','SUBMITTED','CONFIRMED','FAILED'
  )),
  provider_request_id text,
  expires_at timestamptz not null,
  settled_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,logical_operation_key),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,generation_job_id) references public.generation_jobs(owner_id,id),
  foreign key(owner_id,auto_run_id) references public.auto_runs(owner_id,id),
  check (actual_usd is null or actual_usd <= reserved_usd),
  check ((state = 'SETTLED' and actual_usd is not null and settled_at is not null)
    or state <> 'SETTLED'),
  check ((state in ('RELEASED','EXPIRED') and released_at is not null)
    or state not in ('RELEASED','EXPIRED'))
);

create index generation_budget_owner_day_idx
  on public.generation_budget_reservations(owner_id,budget_day,state);
create index generation_budget_owner_month_idx
  on public.generation_budget_reservations(owner_id,budget_month,state);
create index generation_budget_account_idx
  on public.generation_budget_reservations(owner_id,tiktok_account_id,budget_day,state);
create index generation_budget_provider_idx
  on public.generation_budget_reservations(owner_id,provider,budget_day,state);
create index generation_budget_run_idx
  on public.generation_budget_reservations(owner_id,run_key,state);
create index generation_budget_recovery_idx
  on public.generation_budget_reservations(state,provider_submission_state,expires_at)
  where state = 'RESERVED';

create trigger generation_budget_reservations_touch
before update on public.generation_budget_reservations
for each row execute function private.touch_updated_at();

alter table public.generation_budget_reservations enable row level security;
revoke all on table public.generation_budget_reservations from public,anon,authenticated;
grant select on table public.generation_budget_reservations to authenticated;
grant select,insert,update on table public.generation_budget_reservations to service_role;
create policy generation_budget_reservations_owner_read
  on public.generation_budget_reservations for select to authenticated
  using ((select auth.uid()) = owner_id);

create or replace function public.enqueue_publish_atomic(
  p_owner_id uuid,p_tiktok_account_id uuid,p_video_id uuid,p_video_kind text,p_publish_mode text,
  p_source_method text,p_pull_from_url text,p_caption text,p_priority integer,p_scheduled_for timestamptz,
  p_idempotency_key text,p_external_operation_key text
) returns public.publishing_queue
language plpgsql security invoker set search_path = '' as $$
declare v_queue public.publishing_queue; v_inserted boolean:=false;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || p_idempotency_key,0));
  select * into v_queue from public.publishing_queue where owner_id=p_owner_id and idempotency_key=p_idempotency_key;
  if found then return v_queue; end if;
  insert into public.publishing_queue(owner_id,tiktok_account_id,video_id,video_kind,publish_mode,source_method,pull_from_url,caption_snapshot,priority,scheduled_for,status,idempotency_key,external_operation_key)
    values(p_owner_id,p_tiktok_account_id,p_video_id,p_video_kind,p_publish_mode,p_source_method,p_pull_from_url,p_caption,p_priority,p_scheduled_for,'REVIEW_REQUIRED',p_idempotency_key,p_external_operation_key)
    returning * into v_queue;
  v_inserted:=true;
  if v_inserted then
    insert into public.publish_status_events(owner_id,publishing_queue_id,source,from_status,to_status,reason_code)
      values(p_owner_id,v_queue.id,'USER','DRAFT','REVIEW_REQUIRED','QUEUED_FOR_REVIEW');
  end if;
  return v_queue;
end $$;

create or replace function public.claim_publish_operation(
  p_owner_id uuid, p_queue_id uuid, p_worker_id text, p_lease_seconds integer default 90
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_queue public.publishing_queue;
  v_attempt public.publish_attempts;
  v_token uuid := gen_random_uuid();
begin
  if p_lease_seconds < 15 or p_lease_seconds > 900 or char_length(p_worker_id) not between 1 and 120 then
    raise exception 'invalid_publish_lease';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || p_queue_id::text,0));
  select * into v_queue from public.publishing_queue
    where owner_id=p_owner_id and id=p_queue_id for update;
  if not found then raise exception 'publish_queue_not_found'; end if;
  if v_queue.external_state in ('SUBMITTED_UNKNOWN','SUBMITTED','CONFIRMED') then
    return jsonb_build_object('claimed',false,'reason','RECONCILE_OR_COMPLETE','queue',to_jsonb(v_queue));
  end if;
  if v_queue.lease_expires_at is not null and v_queue.lease_expires_at > now() then
    return jsonb_build_object('claimed',false,'reason','LEASE_HELD','queue',to_jsonb(v_queue));
  end if;
  if v_queue.status not in ('APPROVED','QUEUED','RETRYING')
     or v_queue.external_state not in ('READY','FAILED_RETRYABLE') then
    return jsonb_build_object('claimed',false,'reason','NOT_CLAIMABLE','queue',to_jsonb(v_queue));
  end if;
  update public.publishing_queue set
    external_state='RESERVING', lease_token=v_token, lease_owner=p_worker_id,
    lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
    started_at=coalesce(started_at,now()), claimed_at=now()
    where owner_id=p_owner_id and id=p_queue_id returning * into v_queue;
  insert into public.publish_attempts(
    owner_id,publishing_queue_id,attempt_number,operation,provider,idempotency_key,request_json,status
  ) values (
    p_owner_id,p_queue_id,v_queue.retry_count+1,'INIT_UPLOAD','tiktok',
    v_queue.external_operation_key || ':attempt:' || (v_queue.retry_count+1)::text,
    jsonb_build_object('external_operation_key',v_queue.external_operation_key), 'STARTED'
  ) on conflict(owner_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key
  returning * into v_attempt;
  return jsonb_build_object('claimed',true,'leaseToken',v_token,'attemptId',v_attempt.id,'queue',to_jsonb(v_queue));
end $$;

create or replace function public.begin_publish_submission(
  p_owner_id uuid, p_queue_id uuid, p_lease_token uuid
) returns public.publishing_queue
language plpgsql security invoker set search_path = '' as $$
declare v_queue public.publishing_queue;
begin
  update public.publishing_queue set external_state='SUBMITTING', status='UPLOADING'
  where owner_id=p_owner_id and id=p_queue_id and lease_token=p_lease_token
    and lease_expires_at > now() and external_state='RESERVING'
  returning * into v_queue;
  if not found then raise exception 'publish_lease_lost'; end if;
  return v_queue;
end $$;

create or replace function public.record_publish_submission(
  p_owner_id uuid, p_queue_id uuid, p_lease_token uuid, p_attempt_id uuid,
  p_provider_publish_id text, p_provider_status text
) returns public.publishing_queue
language plpgsql security invoker set search_path = '' as $$
declare v_queue public.publishing_queue; v_from text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || p_queue_id::text,0));
  select status into v_from from public.publishing_queue where owner_id=p_owner_id and id=p_queue_id for update;
  update public.publishing_queue set
    provider_publish_id=p_provider_publish_id, provider_status=p_provider_status,
    external_state='SUBMITTED', status='PROCESSING', lease_token=null,lease_owner=null,lease_expires_at=null
  where owner_id=p_owner_id and id=p_queue_id and lease_token=p_lease_token and external_state='SUBMITTING'
  returning * into v_queue;
  if not found then raise exception 'publish_submission_state_conflict'; end if;
  update public.publish_attempts set status='SUCCEEDED',response_json=jsonb_build_object('publish_id',p_provider_publish_id),completed_at=now()
    where owner_id=p_owner_id and id=p_attempt_id and publishing_queue_id=p_queue_id;
  insert into public.publish_status_events(owner_id,publishing_queue_id,publish_attempt_id,source,from_status,to_status,provider_status,reason_code)
    values(p_owner_id,p_queue_id,p_attempt_id,'TIKTOK_API',v_from,'PROCESSING',p_provider_status,'PROVIDER_SUBMISSION_ACCEPTED');
  return v_queue;
end $$;

create or replace function public.record_publish_unknown(
  p_owner_id uuid, p_queue_id uuid, p_lease_token uuid, p_attempt_id uuid, p_error_code text
) returns public.publishing_queue
language plpgsql security invoker set search_path = '' as $$
declare v_queue public.publishing_queue; v_from text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || p_queue_id::text,0));
  select status into v_from from public.publishing_queue where owner_id=p_owner_id and id=p_queue_id for update;
  update public.publishing_queue set
    external_state='SUBMITTED_UNKNOWN',status='WAITING_FOR_RECONCILIATION',
    reconciliation_required_at=now(),last_error_code=left(p_error_code,200),
    lease_token=null,lease_owner=null,lease_expires_at=null
  where owner_id=p_owner_id and id=p_queue_id and lease_token=p_lease_token
    and external_state='SUBMITTING' returning * into v_queue;
  if not found then raise exception 'publish_unknown_state_conflict'; end if;
  update public.publish_attempts set status='RETRYABLE',error_code=left(p_error_code,200),completed_at=now()
    where owner_id=p_owner_id and id=p_attempt_id and publishing_queue_id=p_queue_id;
  insert into public.publish_status_events(owner_id,publishing_queue_id,publish_attempt_id,source,from_status,to_status,reason_code)
    values(p_owner_id,p_queue_id,p_attempt_id,'SYSTEM',v_from,'WAITING_FOR_RECONCILIATION','PROVIDER_SUBMISSION_UNKNOWN');
  return v_queue;
end $$;

create or replace function public.record_publish_failure(
  p_owner_id uuid, p_queue_id uuid, p_lease_token uuid, p_attempt_id uuid,
  p_error_code text, p_retryable boolean
) returns public.publishing_queue
language plpgsql security invoker set search_path = '' as $$
declare v_queue public.publishing_queue; v_from text; v_to text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || p_queue_id::text,0));
  select status into v_from from public.publishing_queue where owner_id=p_owner_id and id=p_queue_id for update;
  v_to := case when p_retryable then 'RETRYING' else 'FAILED' end;
  update public.publishing_queue set
    external_state=case when p_retryable then 'FAILED_RETRYABLE' else 'FAILED_FINAL' end,
    status=v_to,retry_count=retry_count+1,
    next_retry_at=case when p_retryable then now()+make_interval(secs=>least(3600,30*(2^least(retry_count,6))::integer)) else null end,
    last_error_code=left(p_error_code,200),lease_token=null,lease_owner=null,lease_expires_at=null
  where owner_id=p_owner_id and id=p_queue_id and lease_token=p_lease_token
    and external_state='RESERVING' returning * into v_queue;
  if not found then raise exception 'publish_failure_state_conflict'; end if;
  update public.publish_attempts set status=case when p_retryable then 'RETRYABLE' else 'FAILED' end,
    error_code=left(p_error_code,200),completed_at=now()
    where owner_id=p_owner_id and id=p_attempt_id and publishing_queue_id=p_queue_id;
  insert into public.publish_status_events(owner_id,publishing_queue_id,publish_attempt_id,source,from_status,to_status,reason_code)
    values(p_owner_id,p_queue_id,p_attempt_id,'SYSTEM',v_from,v_to,left(p_error_code,200));
  return v_queue;
end $$;

create or replace function public.transition_publish_queue_atomic(
  p_owner_id uuid,p_queue_id uuid,p_expected_status text,p_to_status text,p_patch jsonb default '{}'
) returns public.publishing_queue
language plpgsql security invoker set search_path = '' as $$
declare v_queue public.publishing_queue;
begin
  update public.publishing_queue set
    status=p_to_status,
    compliance_check_id=case when p_patch ? 'compliance_check_id' then (p_patch->>'compliance_check_id')::uuid else compliance_check_id end,
    originality_check_id=case when p_patch ? 'originality_check_id' then (p_patch->>'originality_check_id')::uuid else originality_check_id end,
    eligibility_check_id=case when p_patch ? 'eligibility_check_id' then (p_patch->>'eligibility_check_id')::uuid else eligibility_check_id end,
    consent_id=case when p_patch ? 'consent_id' then (p_patch->>'consent_id')::uuid else consent_id end,
    caption_snapshot=coalesce(p_patch->>'caption_snapshot',caption_snapshot),
    privacy_level=case when p_patch ? 'privacy_level' then p_patch->>'privacy_level' else privacy_level end,
    disable_comment=coalesce((p_patch->>'disable_comment')::boolean,disable_comment),
    disable_duet=coalesce((p_patch->>'disable_duet')::boolean,disable_duet),
    disable_stitch=coalesce((p_patch->>'disable_stitch')::boolean,disable_stitch),
    is_aigc=coalesce((p_patch->>'is_aigc')::boolean,is_aigc),
    commercial_content_json=coalesce(p_patch->'commercial_content_json',commercial_content_json),
    provider_status=coalesce(p_patch->>'provider_status',provider_status),
    provider_publish_id=case when p_patch ? 'provider_publish_id' then p_patch->>'provider_publish_id' else provider_publish_id end,
    uploaded_bytes=coalesce((p_patch->>'uploaded_bytes')::bigint,uploaded_bytes),
    published_post_ids_json=coalesce(p_patch->'published_post_ids_json',published_post_ids_json),
    last_error_code=case when p_patch ? 'last_error_code' then p_patch->>'last_error_code' else last_error_code end,
    completed_at=case when p_patch ? 'completed_at' then (p_patch->>'completed_at')::timestamptz else completed_at end,
    scheduled_for=case when p_patch ? 'scheduled_for' then (p_patch->>'scheduled_for')::timestamptz else scheduled_for end,
    next_retry_at=case when p_patch ? 'next_retry_at' then (p_patch->>'next_retry_at')::timestamptz else next_retry_at end,
    retry_count=coalesce((p_patch->>'retry_count')::integer,retry_count),
    started_at=case when p_patch ? 'started_at' then (p_patch->>'started_at')::timestamptz else started_at end,
    claimed_at=case when p_patch ? 'claimed_at' then (p_patch->>'claimed_at')::timestamptz else claimed_at end,
    cancelled_at=case when p_patch ? 'cancelled_at' then (p_patch->>'cancelled_at')::timestamptz else cancelled_at end,
    external_state=case when p_to_status in ('PUBLISHED','DRAFT_DELIVERED') then 'CONFIRMED'
      when p_to_status='FAILED' then 'FAILED_FINAL' else external_state end
  where owner_id=p_owner_id and id=p_queue_id and status=p_expected_status returning * into v_queue;
  if not found then raise exception 'publish_transition_conflict'; end if;
  insert into public.publish_status_events(owner_id,publishing_queue_id,source,from_status,to_status,provider_status,reason_code)
    values(p_owner_id,p_queue_id,coalesce(p_patch->>'source','SYSTEM'),p_expected_status,p_to_status,
      p_patch->>'provider_status',p_patch->>'reason_code');
  return v_queue;
end $$;

create or replace function public.apply_publish_webhook_atomic(
  p_queue_id uuid,p_event_id text,p_to_status text,p_provider_status text,p_reason_code text,
  p_post_id text,p_occurred_at timestamptz
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_queue public.publishing_queue; v_inserted uuid;
begin
  select * into v_queue from public.publishing_queue where id=p_queue_id for update;
  if not found then return jsonb_build_object('matched',false,'duplicate',false); end if;
  insert into public.publish_status_events(owner_id,publishing_queue_id,source,from_status,to_status,provider_event_id,provider_status,reason_code,metadata_json,occurred_at)
    values(v_queue.owner_id,v_queue.id,'TIKTOK_WEBHOOK',v_queue.status,p_to_status,p_event_id,p_provider_status,p_reason_code,
      jsonb_build_object('post_id',p_post_id),p_occurred_at)
    on conflict(owner_id,provider_event_id) where provider_event_id is not null do nothing returning id into v_inserted;
  if v_inserted is null then return jsonb_build_object('matched',true,'duplicate',true); end if;
  update public.publishing_queue set status=p_to_status,provider_status=p_provider_status,
    published_post_ids_json=case when p_post_id is null then published_post_ids_json else jsonb_build_array(p_post_id) end,
    last_error_code=p_reason_code,completed_at=case when p_to_status in ('FAILED','DRAFT_DELIVERED','PUBLISHED') then now() else completed_at end,
    external_state=case when p_to_status in ('DRAFT_DELIVERED','PUBLISHED') then 'CONFIRMED'
      when p_to_status='FAILED' then 'FAILED_FINAL' else 'SUBMITTED' end,
    lease_token=null,lease_owner=null,lease_expires_at=null
    where owner_id=v_queue.owner_id and id=v_queue.id;
  return jsonb_build_object('matched',true,'duplicate',false);
end $$;

create or replace function public.recover_publish_operations(p_now timestamptz default now()) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_reserving integer; v_submitting integer;
begin
  with recovered as (
    update public.publishing_queue set external_state='FAILED_RETRYABLE',status='RETRYING',
      lease_token=null,lease_owner=null,lease_expires_at=null,last_error_code='LEASE_EXPIRED_BEFORE_SUBMISSION'
    where external_state='RESERVING' and lease_expires_at<=p_now returning 1
  ) select count(*) into v_reserving from recovered;
  with uncertain as (
    update public.publishing_queue set external_state='SUBMITTED_UNKNOWN',status='WAITING_FOR_RECONCILIATION',
      reconciliation_required_at=p_now,lease_token=null,lease_owner=null,lease_expires_at=null,
      last_error_code='LEASE_EXPIRED_AFTER_SUBMISSION_STARTED'
    where external_state='SUBMITTING' and lease_expires_at<=p_now returning 1
  ) select count(*) into v_submitting from uncertain;
  return jsonb_build_object('retryable',v_reserving,'submittedUnknown',v_submitting);
end $$;

create or replace function public.reserve_generation_budget(
  p_owner_id uuid,p_tiktok_account_id uuid,p_generation_job_id uuid,p_auto_run_id uuid,
  p_run_key text,p_logical_operation_key text,p_provider text,p_model text,p_reserved_usd numeric,
  p_per_video_cap_usd numeric,p_daily_cap_usd numeric,p_monthly_cap_usd numeric,
  p_run_cap_usd numeric,p_account_cap_usd numeric,p_provider_cap_usd numeric,
  p_budget_day date,p_budget_month date,p_ttl_seconds integer default 900
) returns public.generation_budget_reservations
language plpgsql security invoker set search_path = '' as $$
declare v_row public.generation_budget_reservations; v_day numeric; v_month numeric; v_run numeric; v_account numeric; v_provider numeric;
begin
  if p_reserved_usd<=0 or p_ttl_seconds<60 or p_ttl_seconds>86400
    or least(p_per_video_cap_usd,p_daily_cap_usd,p_monthly_cap_usd,p_run_cap_usd,p_account_cap_usd,p_provider_cap_usd)<=0
    or p_budget_month<>date_trunc('month',p_budget_month)::date then raise exception 'invalid_budget_reservation'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  select * into v_row from public.generation_budget_reservations
    where owner_id=p_owner_id and logical_operation_key=p_logical_operation_key;
  if found then return v_row; end if;
  if p_reserved_usd>p_per_video_cap_usd then raise exception 'per_video_budget_exceeded'; end if;
  select coalesce(sum(case when state='SETTLED' then actual_usd else reserved_usd end),0) into v_day
    from public.generation_budget_reservations where owner_id=p_owner_id and budget_day=p_budget_day and state in ('RESERVED','SETTLED');
  select coalesce(sum(case when state='SETTLED' then actual_usd else reserved_usd end),0) into v_month
    from public.generation_budget_reservations where owner_id=p_owner_id and budget_month=p_budget_month and state in ('RESERVED','SETTLED');
  select coalesce(sum(case when state='SETTLED' then actual_usd else reserved_usd end),0) into v_run
    from public.generation_budget_reservations where owner_id=p_owner_id and run_key=p_run_key and state in ('RESERVED','SETTLED');
  select coalesce(sum(case when state='SETTLED' then actual_usd else reserved_usd end),0) into v_account
    from public.generation_budget_reservations where owner_id=p_owner_id and tiktok_account_id=p_tiktok_account_id and budget_day=p_budget_day and state in ('RESERVED','SETTLED');
  select coalesce(sum(case when state='SETTLED' then actual_usd else reserved_usd end),0) into v_provider
    from public.generation_budget_reservations where owner_id=p_owner_id and provider=p_provider and budget_day=p_budget_day and state in ('RESERVED','SETTLED');
  if v_day+p_reserved_usd>p_daily_cap_usd then raise exception 'daily_budget_exceeded'; end if;
  if v_month+p_reserved_usd>p_monthly_cap_usd then raise exception 'monthly_budget_exceeded'; end if;
  if v_run+p_reserved_usd>p_run_cap_usd then raise exception 'run_budget_exceeded'; end if;
  if v_account+p_reserved_usd>p_account_cap_usd then raise exception 'account_budget_exceeded'; end if;
  if v_provider+p_reserved_usd>p_provider_cap_usd then raise exception 'provider_budget_exceeded'; end if;
  insert into public.generation_budget_reservations(
    owner_id,tiktok_account_id,generation_job_id,auto_run_id,run_key,logical_operation_key,provider,model,
    reserved_usd,per_video_cap_usd,daily_cap_usd,monthly_cap_usd,run_cap_usd,account_cap_usd,provider_cap_usd,
    budget_day,budget_month,expires_at
  ) values (
    p_owner_id,p_tiktok_account_id,p_generation_job_id,p_auto_run_id,p_run_key,p_logical_operation_key,p_provider,p_model,
    p_reserved_usd,p_per_video_cap_usd,p_daily_cap_usd,p_monthly_cap_usd,p_run_cap_usd,p_account_cap_usd,p_provider_cap_usd,
    p_budget_day,p_budget_month,now()+make_interval(secs=>p_ttl_seconds)
  ) returning * into v_row;
  return v_row;
end $$;

create or replace function public.begin_generation_submission(p_owner_id uuid,p_reservation_id uuid)
returns public.generation_budget_reservations language plpgsql security invoker set search_path='' as $$
declare v_row public.generation_budget_reservations;
begin
  update public.generation_budget_reservations set provider_submission_state='SUBMITTING'
    where owner_id=p_owner_id and id=p_reservation_id and state='RESERVED'
      and provider_submission_state='REQUEST_NOT_SENT' and expires_at>now() returning * into v_row;
  if not found then raise exception 'budget_reservation_not_submittable'; end if;
  return v_row;
end $$;

create or replace function public.mark_generation_submitted(p_owner_id uuid,p_reservation_id uuid,p_provider_request_id text)
returns public.generation_budget_reservations language plpgsql security invoker set search_path='' as $$
declare v_row public.generation_budget_reservations;
begin
  update public.generation_budget_reservations set provider_submission_state='SUBMITTED',provider_request_id=p_provider_request_id
    where owner_id=p_owner_id and id=p_reservation_id and state='RESERVED'
      and provider_submission_state in ('SUBMITTING','SUBMITTED_UNKNOWN','SUBMITTED') returning * into v_row;
  if not found then raise exception 'budget_submission_state_conflict'; end if;
  return v_row;
end $$;

create or replace function public.mark_generation_unknown(p_owner_id uuid,p_reservation_id uuid,p_provider_request_id text default null)
returns public.generation_budget_reservations language plpgsql security invoker set search_path='' as $$
declare v_row public.generation_budget_reservations;
begin
  update public.generation_budget_reservations set provider_submission_state='SUBMITTED_UNKNOWN',
    provider_request_id=coalesce(p_provider_request_id,provider_request_id)
    where owner_id=p_owner_id and id=p_reservation_id and state='RESERVED'
      and provider_submission_state in ('SUBMITTING','SUBMITTED_UNKNOWN') returning * into v_row;
  if not found then raise exception 'budget_unknown_state_conflict'; end if;
  return v_row;
end $$;

create or replace function public.settle_generation_budget(
  p_owner_id uuid,p_reservation_id uuid,p_actual_usd numeric,p_provider_request_id text default null
) returns public.generation_budget_reservations
language plpgsql security invoker set search_path='' as $$
declare v_row public.generation_budget_reservations;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  select * into v_row from public.generation_budget_reservations where owner_id=p_owner_id and id=p_reservation_id for update;
  if not found then raise exception 'budget_reservation_not_found'; end if;
  if v_row.state='SETTLED' then
    if v_row.actual_usd<>p_actual_usd then raise exception 'budget_settlement_amount_conflict'; end if;
    return v_row;
  end if;
  if v_row.state<>'RESERVED' or p_actual_usd<0 or p_actual_usd>v_row.reserved_usd then raise exception 'invalid_budget_settlement'; end if;
  update public.generation_budget_reservations set state='SETTLED',actual_usd=p_actual_usd,settled_at=now(),
    provider_submission_state='CONFIRMED',provider_request_id=coalesce(p_provider_request_id,provider_request_id)
    where owner_id=p_owner_id and id=p_reservation_id returning * into v_row;
  if v_row.generation_job_id is not null then
    insert into public.generation_costs(owner_id,generation_job_id,provider,model,quantity,unit,unit_cost_usd,total_cost_usd)
      values(v_row.owner_id,v_row.generation_job_id,v_row.provider,v_row.model,1,'VIDEO',p_actual_usd,p_actual_usd)
      on conflict(owner_id,generation_job_id,provider,model,unit) do nothing;
  end if;
  if v_row.auto_run_id is not null then
    update public.auto_runs set spent_usd=spent_usd+p_actual_usd
      where owner_id=p_owner_id and id=v_row.auto_run_id and spent_usd+p_actual_usd<=budget_usd;
    if not found then raise exception 'auto_run_budget_settlement_conflict'; end if;
  end if;
  return v_row;
end $$;

create or replace function public.release_generation_budget(
  p_owner_id uuid,p_reservation_id uuid,p_known_not_submitted boolean default false
) returns public.generation_budget_reservations
language plpgsql security invoker set search_path='' as $$
declare v_row public.generation_budget_reservations;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  select * into v_row from public.generation_budget_reservations where owner_id=p_owner_id and id=p_reservation_id for update;
  if not found then raise exception 'budget_reservation_not_found'; end if;
  if v_row.state in ('RELEASED','EXPIRED') then return v_row; end if;
  if v_row.state='SETTLED' then raise exception 'settled_budget_cannot_be_released'; end if;
  if v_row.provider_submission_state<>'REQUEST_NOT_SENT' and not p_known_not_submitted then
    raise exception 'provider_charge_must_be_reconciled';
  end if;
  update public.generation_budget_reservations set state='RELEASED',released_at=now(),provider_submission_state='FAILED'
    where owner_id=p_owner_id and id=p_reservation_id returning * into v_row;
  return v_row;
end $$;

create or replace function public.recover_generation_budget_reservations(p_now timestamptz default now()) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_expired integer; v_unknown integer;
begin
  with expired as (
    update public.generation_budget_reservations set state='EXPIRED',released_at=p_now
      where state='RESERVED' and provider_submission_state='REQUEST_NOT_SENT' and expires_at<=p_now returning 1
  ) select count(*) into v_expired from expired;
  with uncertain as (
    update public.generation_budget_reservations set provider_submission_state='SUBMITTED_UNKNOWN'
      where state='RESERVED' and provider_submission_state='SUBMITTING' and expires_at<=p_now returning 1
  ) select count(*) into v_unknown from uncertain;
  return jsonb_build_object('expiredBeforeSubmission',v_expired,'heldForReconciliation',v_unknown);
end $$;

create or replace function public.create_auto_run_atomic(
  p_owner_id uuid,p_idempotency_key text,p_run_date date,p_video_provider text,
  p_provider_gate_reason text,p_plans jsonb
) returns public.auto_runs
language plpgsql security invoker set search_path='' as $$
declare v_run public.auto_runs; v_plan jsonb; v_account_count integer:=jsonb_array_length(p_plans); v_hash text;
begin
  if jsonb_typeof(p_plans)<>'array' then raise exception 'auto_plans_must_be_array'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  select * into v_run from public.auto_runs where owner_id=p_owner_id and idempotency_key=p_idempotency_key;
  if found then return v_run; end if;
  select * into v_run from public.auto_runs where owner_id=p_owner_id
    and state in ('STARTING','RUNNING','PAUSED','RETRY_PENDING') order by started_at desc limit 1 for update;
  if found then return v_run; end if;
  insert into public.auto_runs(owner_id,state,trigger_source,run_date,current_step,budget_usd,spent_usd,idempotency_key,started_at,metrics_json)
    values(p_owner_id,'RUNNING','MANUAL',p_run_date,'PLAN_ACCOUNTS',0,0,p_idempotency_key,now(),
      jsonb_build_object('externalCalls',0,'realPublishing',false,'paidProviders',false,'videoProvider',p_video_provider,'providerGateReason',p_provider_gate_reason))
    returning * into v_run;
  for v_plan in select value from jsonb_array_elements(p_plans) loop
    insert into public.auto_account_states(owner_id,auto_run_id,tiktok_account_id,requested_mode,effective_mode,state,current_step,next_action,blockers_json,desired_daily_candidates,desired_daily_posts,max_daily_cost_usd,generation_capacity,publish_capacity,priority)
      values(p_owner_id,v_run.id,(v_plan->>'accountId')::uuid,v_plan->>'requestedMode',v_plan->>'mode',v_plan->>'state','PLAN_ACCOUNTS',v_plan->>'nextAction',v_plan->'blockers',
        (v_plan->>'desiredCandidates')::integer,(v_plan->>'desiredPosts')::integer,(v_plan->>'maxDailyCostUsd')::numeric,
        (v_plan->>'generationCapacity')::integer,(v_plan->>'publishCapacity')::integer,(v_plan->>'priority')::integer);
    insert into public.auto_actions(owner_id,auto_run_id,tiktok_account_id,action_type,decision_source,status,payload_json,estimated_cost_usd,actual_cost_usd,idempotency_key)
      values(p_owner_id,v_run.id,(v_plan->>'accountId')::uuid,v_plan->>'nextAction',case when v_plan->>'mode'='GROWTH' then 'PHASE_9_GROWTH' else 'PHASE_8_WINNER' end,
        case when v_plan->>'state'='WAITING_FOR_APPROVAL' then 'WAITING_FOR_APPROVAL' when v_plan->>'state'='WAITING_FOR_SLOT' then 'WAITING_FOR_SLOT' when v_plan->>'state'='BLOCKED' then 'BLOCKED' else 'PLANNED' end,
        jsonb_build_object('mode',v_plan->>'mode','blockers',v_plan->'blockers','videoProvider',p_video_provider,'providerGateReason',p_provider_gate_reason),0,0,v_plan->>'actionKey');
  end loop;
  v_hash:=encode(digest(v_run.id::text||':PLAN_ACCOUNTS:'||jsonb_build_object('accountCount',v_account_count,'videoProvider',p_video_provider,'providerGateReason',p_provider_gate_reason)::text,'sha256'),'hex');
  insert into public.auto_run_steps(owner_id,auto_run_id,step,state,idempotency_key,started_at,completed_at,output_json)
    values(p_owner_id,v_run.id,'PLAN_ACCOUNTS','COMPLETED',p_idempotency_key||':PLAN_ACCOUNTS',now(),now(),jsonb_build_object('accountCount',v_account_count,'videoProvider',p_video_provider,'providerGateReason',p_provider_gate_reason));
  insert into public.auto_checkpoints(owner_id,auto_run_id,step,checkpoint_version,state_json,evidence_hash)
    values(p_owner_id,v_run.id,'PLAN_ACCOUNTS',1,jsonb_build_object('accountCount',v_account_count,'videoProvider',p_video_provider,'providerGateReason',p_provider_gate_reason),v_hash);
  return v_run;
end $$;

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
    update public.auto_account_states set state=v_next,current_step=p_action
      where owner_id=p_owner_id and auto_run_id=p_run_id and state not in ('COMPLETED','FAILED','BLOCKED');
  end if;
  return jsonb_build_object('previous',v_previous,'state',v_next);
end $$;

revoke all on function public.claim_publish_operation(uuid,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.enqueue_publish_atomic(uuid,uuid,uuid,text,text,text,text,text,integer,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.begin_publish_submission(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.record_publish_submission(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.record_publish_unknown(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.record_publish_failure(uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.transition_publish_queue_atomic(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.apply_publish_webhook_atomic(uuid,text,text,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.recover_publish_operations(timestamptz) from public,anon,authenticated;
revoke all on function public.reserve_generation_budget(uuid,uuid,uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,date,date,integer) from public,anon,authenticated;
revoke all on function public.begin_generation_submission(uuid,uuid) from public,anon,authenticated;
revoke all on function public.mark_generation_submitted(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.mark_generation_unknown(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.settle_generation_budget(uuid,uuid,numeric,text) from public,anon,authenticated;
revoke all on function public.release_generation_budget(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.recover_generation_budget_reservations(timestamptz) from public,anon,authenticated;
revoke all on function public.create_auto_run_atomic(uuid,text,date,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.transition_auto_run_atomic(uuid,uuid,text) from public,anon,authenticated;

grant execute on function public.claim_publish_operation(uuid,uuid,text,integer) to service_role;
grant execute on function public.enqueue_publish_atomic(uuid,uuid,uuid,text,text,text,text,text,integer,timestamptz,text,text) to service_role;
grant execute on function public.begin_publish_submission(uuid,uuid,uuid) to service_role;
grant execute on function public.record_publish_submission(uuid,uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.record_publish_unknown(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.record_publish_failure(uuid,uuid,uuid,uuid,text,boolean) to service_role;
grant execute on function public.transition_publish_queue_atomic(uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.apply_publish_webhook_atomic(uuid,text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.recover_publish_operations(timestamptz) to service_role;
grant execute on function public.reserve_generation_budget(uuid,uuid,uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,date,date,integer) to service_role;
grant execute on function public.begin_generation_submission(uuid,uuid) to service_role;
grant execute on function public.mark_generation_submitted(uuid,uuid,text) to service_role;
grant execute on function public.mark_generation_unknown(uuid,uuid,text) to service_role;
grant execute on function public.settle_generation_budget(uuid,uuid,numeric,text) to service_role;
grant execute on function public.release_generation_budget(uuid,uuid,boolean) to service_role;
grant execute on function public.recover_generation_budget_reservations(timestamptz) to service_role;
grant execute on function public.create_auto_run_atomic(uuid,text,date,text,text,jsonb) to service_role;
grant execute on function public.transition_auto_run_atomic(uuid,uuid,text) to service_role;

comment on table public.generation_budget_reservations is
  'Phase 11B owner-scoped atomic holds. Unknown provider submissions remain reserved until reconciliation.';
comment on column public.publishing_queue.external_operation_key is
  'Stable logical operation key reused across retries; it is not a claim that TikTok supports provider idempotency.';
