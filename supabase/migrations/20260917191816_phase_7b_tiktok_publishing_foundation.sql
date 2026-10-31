-- Phase 7B only: owner-isolated TikTok publishing queue, consent, attempts, and status ledger.
create table public.publishing_queue (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null,
  video_id uuid not null,
  video_kind text not null check (video_kind in ('MASTER','VARIATION')),
  publish_mode text not null check (publish_mode in ('DRAFT_UPLOAD','DIRECT_POST')),
  source_method text not null default 'FILE_UPLOAD'
    check (source_method in ('FILE_UPLOAD','PULL_FROM_URL')),
  pull_from_url text,
  scheduled_for timestamptz,
  priority smallint not null default 50 check (priority between 0 and 100),
  status text not null default 'DRAFT' check (status in (
    'DRAFT','REVIEW_REQUIRED','APPROVED','QUEUED','WAITING_FOR_SLOT','UPLOADING',
    'PROCESSING','DRAFT_DELIVERED','PUBLISHED','RETRYING','FAILED','CANCELLED','REJECTED'
  )),
  caption_snapshot text not null default '' check (char_length(caption_snapshot) <= 2200),
  privacy_level text,
  disable_comment boolean not null default false,
  disable_duet boolean not null default false,
  disable_stitch boolean not null default false,
  is_aigc boolean not null default false,
  commercial_content_json jsonb not null default '{}'
    check (jsonb_typeof(commercial_content_json) = 'object'),
  compliance_check_id uuid,
  originality_check_id uuid,
  eligibility_check_id uuid,
  consent_id uuid,
  provider_publish_id text check (provider_publish_id is null or char_length(provider_publish_id) <= 64),
  provider_status text,
  uploaded_bytes bigint not null default 0 check (uploaded_bytes >= 0),
  published_post_ids_json jsonb not null default '[]'
    check (jsonb_typeof(published_post_ids_json) = 'array'),
  retry_count smallint not null default 0 check (retry_count between 0 and 10),
  max_retries smallint not null default 3 check (max_retries between 0 and 10),
  next_retry_at timestamptz,
  last_error_code text,
  last_error_message text,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, idempotency_key),
  foreign key (owner_id, tiktok_account_id)
    references public.tiktok_accounts(owner_id, id) on delete cascade,
  foreign key (owner_id, compliance_check_id)
    references public.content_compliance_checks(owner_id, id),
  foreign key (owner_id, originality_check_id)
    references public.originality_checks(owner_id, id),
  foreign key (owner_id, eligibility_check_id)
    references public.publish_eligibility_checks(owner_id, id),
  check (source_method <> 'PULL_FROM_URL' or pull_from_url is not null),
  check (status not in ('APPROVED','QUEUED','UPLOADING','PROCESSING','DRAFT_DELIVERED','PUBLISHED','RETRYING') or consent_id is not null)
);

create table public.publish_consents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  publishing_queue_id uuid not null,
  tiktok_account_id uuid not null,
  consent_version integer not null default 1 check (consent_version > 0),
  explicit_consent boolean not null check (explicit_consent),
  caption_snapshot text not null check (char_length(caption_snapshot) <= 2200),
  privacy_level text,
  interaction_settings_json jsonb not null default '{}'
    check (jsonb_typeof(interaction_settings_json) = 'object'),
  commercial_content_json jsonb not null default '{}'
    check (jsonb_typeof(commercial_content_json) = 'object'),
  is_aigc boolean not null default false,
  consent_hash text not null check (char_length(consent_hash) = 64),
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, publishing_queue_id, consent_version),
  unique (owner_id, publishing_queue_id, consent_hash),
  foreign key (owner_id, publishing_queue_id)
    references public.publishing_queue(owner_id, id) on delete cascade,
  foreign key (owner_id, tiktok_account_id)
    references public.tiktok_accounts(owner_id, id) on delete cascade
);

alter table public.publishing_queue
  add constraint publishing_queue_consent_fkey
  foreign key (owner_id, consent_id)
  references public.publish_consents(owner_id, id);

create table public.publish_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  publishing_queue_id uuid not null,
  attempt_number smallint not null check (attempt_number between 1 and 11),
  operation text not null check (operation in ('PREPARE','INIT_UPLOAD','TRANSFER','FETCH_STATUS','WEBHOOK','CANCEL')),
  provider text not null default 'tiktok' check (provider in ('tiktok','mock')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 240),
  request_json jsonb not null default '{}'
    check (jsonb_typeof(request_json) = 'object'),
  response_json jsonb
    check (response_json is null or jsonb_typeof(response_json) = 'object'),
  http_status smallint check (http_status is null or http_status between 100 and 599),
  status text not null check (status in ('STARTED','SUCCEEDED','FAILED','RETRYABLE')),
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, idempotency_key),
  foreign key (owner_id, publishing_queue_id)
    references public.publishing_queue(owner_id, id) on delete cascade
);

create table public.publish_status_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  publishing_queue_id uuid not null,
  publish_attempt_id uuid,
  source text not null check (source in ('SYSTEM','USER','TIKTOK_API','TIKTOK_WEBHOOK','MOCK')),
  from_status text,
  to_status text not null check (to_status in (
    'DRAFT','REVIEW_REQUIRED','APPROVED','QUEUED','WAITING_FOR_SLOT','UPLOADING',
    'PROCESSING','DRAFT_DELIVERED','PUBLISHED','RETRYING','FAILED','CANCELLED','REJECTED'
  )),
  provider_event_id text,
  provider_status text,
  reason_code text,
  metadata_json jsonb not null default '{}'
    check (jsonb_typeof(metadata_json) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, publishing_queue_id)
    references public.publishing_queue(owner_id, id) on delete cascade,
  foreign key (owner_id, publish_attempt_id)
    references public.publish_attempts(owner_id, id)
);

create unique index publishing_queue_provider_publish_unique_idx
on public.publishing_queue(owner_id, tiktok_account_id, provider_publish_id)
where provider_publish_id is not null;
create index publishing_queue_owner_status_schedule_idx
on public.publishing_queue(owner_id, status, scheduled_for, priority desc, created_at);
create index publishing_queue_account_status_idx
on public.publishing_queue(owner_id, tiktok_account_id, status, scheduled_for);
create index publishing_queue_video_idx
on public.publishing_queue(owner_id, video_id, created_at desc);
create index publishing_queue_compliance_check_idx
on public.publishing_queue(owner_id, compliance_check_id) where compliance_check_id is not null;
create index publishing_queue_originality_check_idx
on public.publishing_queue(owner_id, originality_check_id) where originality_check_id is not null;
create index publishing_queue_eligibility_check_idx
on public.publishing_queue(owner_id, eligibility_check_id) where eligibility_check_id is not null;
create index publishing_queue_consent_idx
on public.publishing_queue(owner_id, consent_id) where consent_id is not null;
create index publish_consents_queue_idx
on public.publish_consents(owner_id, publishing_queue_id, consented_at desc);
create index publish_consents_account_idx
on public.publish_consents(owner_id, tiktok_account_id, consented_at desc);
create index publish_attempts_queue_idx
on public.publish_attempts(owner_id, publishing_queue_id, attempt_number desc);
create index publish_status_events_queue_idx
on public.publish_status_events(owner_id, publishing_queue_id, occurred_at desc);
create index publish_status_events_attempt_idx
on public.publish_status_events(owner_id, publish_attempt_id) where publish_attempt_id is not null;
create unique index publish_status_events_provider_event_unique_idx
on public.publish_status_events(owner_id, provider_event_id)
where provider_event_id is not null;

create trigger publishing_queue_touch_updated_at
before update on public.publishing_queue
for each row execute function private.touch_updated_at();

alter table public.publishing_queue enable row level security;
alter table public.publish_attempts enable row level security;
alter table public.publish_status_events enable row level security;
alter table public.publish_consents enable row level security;

revoke all on table public.publishing_queue, public.publish_attempts,
  public.publish_status_events, public.publish_consents
from public, anon, authenticated;
grant select on table public.publishing_queue, public.publish_attempts,
  public.publish_status_events, public.publish_consents
to authenticated;
grant select, insert, update, delete on table public.publishing_queue to service_role;
grant select, insert, update on table public.publish_attempts to service_role;
grant select, insert on table public.publish_status_events, public.publish_consents to service_role;

create policy publishing_queue_owner_read on public.publishing_queue
for select to authenticated using ((select auth.uid()) = owner_id);
create policy publish_attempts_owner_read on public.publish_attempts
for select to authenticated using ((select auth.uid()) = owner_id);
create policy publish_status_events_owner_read on public.publish_status_events
for select to authenticated using ((select auth.uid()) = owner_id);
create policy publish_consents_owner_read on public.publish_consents
for select to authenticated using ((select auth.uid()) = owner_id);

comment on table public.publishing_queue is
  'Phase 7B server-managed publishing state. DRAFT_DELIVERED is not equivalent to PUBLISHED.';
comment on table public.publish_attempts is
  'Append-only, redacted provider operation ledger with stable idempotency keys.';
comment on table public.publish_status_events is
  'Append-only queue status history and idempotent TikTok webhook event ledger.';
comment on table public.publish_consents is
  'Append-only explicit user consent snapshots bound to exact publishing settings.';
