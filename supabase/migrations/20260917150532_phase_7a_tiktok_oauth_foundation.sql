-- Phase 7A only: TikTok OAuth identity, permission metadata, creator cache, and server-only credentials.
alter table public.tiktok_accounts
  alter column username drop not null,
  drop constraint tiktok_accounts_username_check,
  add constraint tiktok_accounts_username_check
    check (username is null or username ~ '^[A-Za-z0-9._]{2,32}$');

alter table public.tiktok_accounts
  add column open_id text,
  add column union_id text,
  add column avatar_url text,
  add column connection_status text not null default 'DISCONNECTED'
    check (connection_status in ('CONNECTED','PARTIAL','READY_FOR_UPLOAD','READY_FOR_DIRECT_POST','PRIVATE_ONLY','REAUTH_REQUIRED','DISCONNECTED')),
  add column token_expires_at timestamptz,
  add column refresh_token_expires_at timestamptz,
  add column granted_scopes text[] not null default '{}',
  add column missing_scopes text[] not null default '{}',
  add column creator_info_sync_at timestamptz,
  add column creator_info_cache_expires_at timestamptz,
  add column creator_max_video_duration integer
    check (creator_max_video_duration is null or creator_max_video_duration > 0),
  add column privacy_level_options text[] not null default '{}',
  add column comment_disabled boolean,
  add column duet_disabled boolean,
  add column stitch_disabled boolean,
  add column direct_post_status text not null default 'UNAVAILABLE'
    check (direct_post_status in ('UNAVAILABLE','MISSING_SCOPE','PRIVATE_ONLY','READY')),
  add column upload_status text not null default 'UNAVAILABLE'
    check (upload_status in ('UNAVAILABLE','MISSING_SCOPE','READY')),
  add column video_publish_approval_status text not null default 'UNKNOWN'
    check (video_publish_approval_status in ('UNKNOWN','NOT_APPROVED','APPROVED')),
  add column video_upload_approval_status text not null default 'UNKNOWN'
    check (video_upload_approval_status in ('UNKNOWN','NOT_APPROVED','APPROVED')),
  add column audit_status text not null default 'UNAUDITED'
    check (audit_status in ('UNAUDITED','IN_REVIEW','AUDITED')),
  add column last_auth_error text,
  add column last_sync_error text,
  add column disconnected_at timestamptz;

create unique index tiktok_accounts_open_id_unique_idx
on public.tiktok_accounts(open_id)
where open_id is not null;

create index tiktok_accounts_owner_connection_idx
on public.tiktok_accounts(owner_id, connection_status);

create table public.tiktok_oauth_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null unique,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  access_token_tag text not null,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  refresh_token_tag text not null,
  key_version smallint not null default 1 check (key_version > 0),
  token_type text not null default 'Bearer' check (token_type = 'Bearer'),
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, tiktok_account_id)
    references public.tiktok_accounts(owner_id, id) on delete cascade
);

create index tiktok_oauth_credentials_owner_idx
on public.tiktok_oauth_credentials(owner_id, tiktok_account_id);

create table public.tiktok_oauth_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  state_hash text not null unique check (char_length(state_hash) = 64),
  requested_scopes text[] not null,
  return_path text not null default '/accounts'
    check (return_path ~ '^/accounts(?:/.*)?$'),
  mock_scenario text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index tiktok_oauth_states_owner_expires_idx
on public.tiktok_oauth_states(owner_id, expires_at desc);

create trigger tiktok_oauth_credentials_touch_updated_at
before update on public.tiktok_oauth_credentials
for each row execute function private.touch_updated_at();

alter table public.tiktok_oauth_credentials enable row level security;
alter table public.tiktok_oauth_credentials force row level security;
alter table public.tiktok_oauth_states enable row level security;
alter table public.tiktok_oauth_states force row level security;

revoke all on table public.tiktok_oauth_credentials from public, anon, authenticated;
revoke all on table public.tiktok_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on table public.tiktok_oauth_credentials to service_role;
grant select, insert, update, delete on table public.tiktok_oauth_states to service_role;

-- OAuth-managed account fields cannot be forged by a browser session.
revoke insert, update on table public.tiktok_accounts from authenticated;
grant insert (
  owner_id, display_name, username, external_id, follower_count, following_count,
  shop_creator_eligible, ecommerce_permission, cart_enabled, account_status,
  manual_override_reason, capability_checked_at, daily_post_target, mode,
  daily_post_hard_limit, authorization_status, preferred_categories,
  account_notes, last_synced_at, is_mock, max_cost_per_video_usd,
  daily_video_budget_usd, monthly_video_budget_usd
) on table public.tiktok_accounts to authenticated;
grant update (
  display_name, username, external_id, follower_count, following_count,
  shop_creator_eligible, ecommerce_permission, cart_enabled, account_status,
  manual_override_reason, capability_checked_at, daily_post_target, mode,
  daily_post_hard_limit, authorization_status, preferred_categories,
  account_notes, last_synced_at, is_mock, max_cost_per_video_usd,
  daily_video_budget_usd, monthly_video_budget_usd
) on table public.tiktok_accounts to authenticated;

create or replace function public.consume_tiktok_oauth_state(
  p_state_hash text,
  p_owner_id uuid
)
returns table (
  state_id uuid,
  requested_scopes text[],
  return_path text,
  mock_scenario text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.tiktok_oauth_states
  set consumed_at = now()
  where state_hash = p_state_hash
    and owner_id = p_owner_id
    and consumed_at is null
    and expires_at > now()
  returning id, tiktok_oauth_states.requested_scopes,
    tiktok_oauth_states.return_path, tiktok_oauth_states.mock_scenario;
end;
$$;

revoke all on function public.consume_tiktok_oauth_state(text, uuid)
from public, anon, authenticated;
grant execute on function public.consume_tiktok_oauth_state(text, uuid)
to service_role;

comment on table public.tiktok_oauth_credentials is
  'Server-only AES-GCM encrypted TikTok credentials. No browser role has privileges or an RLS policy.';
comment on table public.tiktok_oauth_states is
  'Server-only one-time OAuth state hashes with expiry and replay protection.';
comment on function public.consume_tiktok_oauth_state(text, uuid) is
  'Atomically consumes one unexpired OAuth state for the authenticated callback owner; service role only.';
comment on column public.tiktok_accounts.connection_status is
  'OAuth/content-posting readiness; independent from AUTO/GROWTH/AFFILIATE business mode.';
comment on column public.tiktok_accounts.audit_status is
  'Direct Post audit status. UNAUDITED remains private-only even when video.publish is granted.';
