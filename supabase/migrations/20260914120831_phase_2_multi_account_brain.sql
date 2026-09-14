create function private.account_effective_mode(
  requested_mode text,
  followers bigint,
  has_ecommerce_permission boolean,
  has_cart boolean
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case upper(coalesce(requested_mode, 'AUTO'))
    when 'GROWTH' then 'GROWTH'
    when 'AFFILIATE' then 'AFFILIATE'
    else case
      when coalesce(followers, 0) >= 1000
        and has_ecommerce_permission is true
        and has_cart is true
      then 'AFFILIATE'
      else 'GROWTH'
    end
  end
$$;

revoke all on function private.account_effective_mode(text, bigint, boolean, boolean)
from public, anon, authenticated;

alter table public.tiktok_accounts
  add column mode text not null default 'AUTO'
    check (mode in ('AUTO', 'GROWTH', 'AFFILIATE'));

update public.tiktok_accounts
set mode = case manual_mode
  when 'growth' then 'GROWTH'
  when 'affiliate' then 'AFFILIATE'
  else 'AUTO'
end;

alter table public.tiktok_accounts
  drop column detected_mode,
  drop column manual_mode;

alter table public.tiktok_accounts
  rename column daily_posting_target to daily_post_target;

alter table public.tiktok_accounts
  add column effective_mode text generated always as (
    private.account_effective_mode(mode, follower_count, ecommerce_permission, cart_enabled)
  ) stored,
  add column daily_post_hard_limit smallint not null default 15
    check (daily_post_hard_limit between 0 and 20),
  add column authorization_status text not null default 'disconnected'
    check (authorization_status in ('disconnected', 'pending', 'authorized', 'expired', 'revoked', 'error')),
  add column preferred_categories text[] not null default '{}',
  add column account_notes text
    check (account_notes is null or char_length(account_notes) <= 1000),
  add column last_synced_at timestamptz,
  add column is_mock boolean not null default false,
  add constraint tiktok_accounts_daily_post_limit
    check (daily_post_target <= daily_post_hard_limit);

create index tiktok_accounts_owner_effective_mode_idx
on public.tiktok_accounts(owner_id, effective_mode);

create table public.account_daily_stats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null,
  stat_date date not null,
  followers_start bigint not null default 0 check (followers_start >= 0),
  followers_end bigint not null default 0 check (followers_end >= 0),
  followers_gained bigint generated always as (followers_end - followers_start) stored,
  views bigint not null default 0 check (views >= 0),
  likes bigint not null default 0 check (likes >= 0),
  comments bigint not null default 0 check (comments >= 0),
  shares bigint not null default 0 check (shares >= 0),
  posts_published integer not null default 0 check (posts_published >= 0),
  posts_failed integer not null default 0 check (posts_failed >= 0),
  product_clicks bigint not null default 0 check (product_clicks >= 0),
  orders bigint not null default 0 check (orders >= 0),
  gmv numeric(14, 2) not null default 0 check (gmv >= 0),
  commission numeric(14, 2) not null default 0 check (commission >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, tiktok_account_id, stat_date),
  foreign key (owner_id, tiktok_account_id)
    references public.tiktok_accounts(owner_id, id) on delete cascade
);

create index account_daily_stats_owner_date_idx
on public.account_daily_stats(owner_id, stat_date desc);
create index account_daily_stats_account_date_idx
on public.account_daily_stats(owner_id, tiktok_account_id, stat_date desc);

create table public.account_category_affinity (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null,
  category_key text not null check (category_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  score numeric(5, 4) not null default 0 check (score between 0 and 1),
  confidence numeric(5, 4) not null default 0 check (confidence between 0 and 1),
  sample_size integer not null default 0 check (sample_size >= 0),
  views bigint not null default 0 check (views >= 0),
  engagements bigint not null default 0 check (engagements >= 0),
  followers_gained bigint not null default 0,
  product_clicks bigint not null default 0 check (product_clicks >= 0),
  orders bigint not null default 0 check (orders >= 0),
  gmv numeric(14, 2) not null default 0 check (gmv >= 0),
  commission numeric(14, 2) not null default 0 check (commission >= 0),
  last_calculated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, tiktok_account_id, category_key),
  foreign key (owner_id, tiktok_account_id)
    references public.tiktok_accounts(owner_id, id) on delete cascade
);

create index account_category_affinity_owner_account_score_idx
on public.account_category_affinity(owner_id, tiktok_account_id, score desc);

create trigger account_daily_stats_touch_updated_at
before update on public.account_daily_stats
for each row execute function private.touch_updated_at();

create trigger account_category_affinity_touch_updated_at
before update on public.account_category_affinity
for each row execute function private.touch_updated_at();

alter table public.account_daily_stats enable row level security;
alter table public.account_category_affinity enable row level security;

revoke all on table public.account_daily_stats from anon, authenticated;
revoke all on table public.account_category_affinity from anon, authenticated;
grant select, insert, update, delete on table public.account_daily_stats to authenticated;
grant select, insert, update, delete on table public.account_category_affinity to authenticated;

create policy "account_daily_stats_select_own"
on public.account_daily_stats for select to authenticated
using ((select auth.uid()) = owner_id);
create policy "account_daily_stats_insert_own"
on public.account_daily_stats for insert to authenticated
with check ((select auth.uid()) = owner_id);
create policy "account_daily_stats_update_own"
on public.account_daily_stats for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
create policy "account_daily_stats_delete_own"
on public.account_daily_stats for delete to authenticated
using ((select auth.uid()) = owner_id);

create policy "account_category_affinity_select_own"
on public.account_category_affinity for select to authenticated
using ((select auth.uid()) = owner_id);
create policy "account_category_affinity_insert_own"
on public.account_category_affinity for insert to authenticated
with check ((select auth.uid()) = owner_id);
create policy "account_category_affinity_update_own"
on public.account_category_affinity for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);
create policy "account_category_affinity_delete_own"
on public.account_category_affinity for delete to authenticated
using ((select auth.uid()) = owner_id);

comment on column public.tiktok_accounts.effective_mode is
  'Stored result of the centralized AUTO/GROWTH/AFFILIATE mode calculation.';
comment on column public.tiktok_accounts.is_mock is
  'Development-created account record. No production TikTok credential is attached.';
comment on table public.account_daily_stats is
  'Owner-isolated per-account daily performance facts.';
comment on table public.account_category_affinity is
  'Owner-isolated manual or learned category performance affinity.';
