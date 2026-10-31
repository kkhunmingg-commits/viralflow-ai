create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 80),
  locale text not null default 'th-TH' check (locale in ('th-TH', 'en-US')),
  timezone text not null default 'Asia/Bangkok' check (timezone = 'Asia/Bangkok'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tiktok_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  username text not null check (username ~ '^[A-Za-z0-9._]{2,32}$'),
  external_id text,
  follower_count bigint not null default 0 check (follower_count >= 0),
  following_count bigint not null default 0 check (following_count >= 0),
  shop_creator_eligible boolean,
  ecommerce_permission boolean,
  cart_enabled boolean,
  account_status text not null default 'unknown'
    check (account_status in ('unknown', 'active', 'restricted', 'suspended', 'disconnected')),
  detected_mode text generated always as (
    case
      when follower_count >= 1000 and ecommerce_permission is true then 'affiliate'
      else 'growth'
    end
  ) stored,
  manual_mode text check (manual_mode in ('growth', 'affiliate')),
  manual_override_reason text check (
    manual_override_reason is null or char_length(manual_override_reason) between 8 and 500
  ),
  capability_checked_at timestamptz,
  daily_posting_target smallint not null default 3
    check (daily_posting_target between 0 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, username)
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid,
  provider text not null check (provider in ('supabase', 'tiktok', 'tiktok_shop', 'openai', 'video')),
  status text not null default 'disconnected'
    check (status in ('disconnected', 'pending', 'connected', 'expired', 'error', 'revoked')),
  granted_scopes text[] not null default '{}',
  capabilities jsonb not null default '{}',
  token_secret_ref text,
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, provider, tiktok_account_id),
  foreign key (owner_id, tiktok_account_id)
    references public.tiktok_accounts(owner_id, id) on delete cascade
);

create index tiktok_accounts_owner_id_idx on public.tiktok_accounts(owner_id);
create index integrations_owner_id_idx on public.integrations(owner_id);
create index integrations_account_id_idx on public.integrations(owner_id, tiktok_account_id);

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function private.touch_updated_at();

create trigger tiktok_accounts_touch_updated_at
before update on public.tiktok_accounts
for each row execute function private.touch_updated_at();

create trigger integrations_touch_updated_at
before update on public.integrations
for each row execute function private.touch_updated_at();

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Owner'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.touch_updated_at() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

insert into public.profiles (id, display_name)
select
  id,
  coalesce(
    nullif(raw_user_meta_data ->> 'display_name', ''),
    nullif(split_part(coalesce(email, ''), '@', 1), ''),
    'Owner'
  )
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.tiktok_accounts enable row level security;
alter table public.integrations enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.tiktok_accounts from anon, authenticated;
revoke all on table public.integrations from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name, locale, timezone) on table public.profiles to authenticated;
grant select, insert, update, delete on table public.tiktok_accounts to authenticated;
grant select (
  id,
  owner_id,
  tiktok_account_id,
  provider,
  status,
  granted_scopes,
  capabilities,
  verified_at,
  expires_at,
  created_at,
  updated_at
) on table public.integrations to authenticated;

create policy "profiles_select_own"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "tiktok_accounts_select_own"
on public.tiktok_accounts for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "tiktok_accounts_insert_own"
on public.tiktok_accounts for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "tiktok_accounts_update_own"
on public.tiktok_accounts for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "tiktok_accounts_delete_own"
on public.tiktok_accounts for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy "integrations_select_own"
on public.integrations for select
to authenticated
using ((select auth.uid()) = owner_id);

comment on table public.profiles is 'Owner profile created automatically from auth.users.';
comment on table public.tiktok_accounts is 'Owner-isolated TikTok account profile; permissions remain tri-state.';
comment on table public.integrations is 'Non-secret integration capability metadata. OAuth token values are never stored here.';
comment on column public.integrations.token_secret_ref is 'Server-only reference to separately protected encrypted credentials; never a token value.';

