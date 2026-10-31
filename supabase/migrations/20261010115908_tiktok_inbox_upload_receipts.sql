-- Independent Inbox receipts; does not change Direct Post queues or approval flags.
create table public.tiktok_inbox_uploads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  tiktok_account_id uuid not null,
  idempotency_key uuid not null,
  media_sha256 text not null check (media_sha256 ~ '^[a-f0-9]{64}$'),
  video_size integer not null check (video_size between 1000 and 4000000),
  status text not null default 'RESERVED' check (status in (
    'RESERVED','INITIALIZED','UPLOADED','SEND_TO_USER_INBOX','PUBLISH_COMPLETE','FAILED','RECONCILIATION_REQUIRED'
  )),
  provider_publish_id text check (provider_publish_id is null or char_length(provider_publish_id) <= 64),
  uploaded_bytes bigint not null default 0 check (uploaded_bytes >= 0),
  fail_reason text,
  error_code text,
  log_id text,
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, tiktok_account_id, idempotency_key),
  unique (owner_id, tiktok_account_id, media_sha256),
  foreign key (owner_id, tiktok_account_id) references public.tiktok_accounts(owner_id,id)
);
alter table public.tiktok_inbox_uploads enable row level security;
revoke all on public.tiktok_inbox_uploads from anon, authenticated;
grant select on public.tiktok_inbox_uploads to authenticated;
grant all on public.tiktok_inbox_uploads to service_role;
create policy inbox_receipts_owner_read on public.tiktok_inbox_uploads
  for select to authenticated using ((select auth.uid()) = owner_id);
create index inbox_receipts_account_time on public.tiktok_inbox_uploads(owner_id,tiktok_account_id,created_at desc);
comment on table public.tiktok_inbox_uploads is
  'Server-managed Inbox receipts; never store access tokens or signed upload URLs. Inbox delivery is not publication.';
