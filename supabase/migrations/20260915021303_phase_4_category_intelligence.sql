-- Phase 4: owner-isolated category observations and versioned intelligence.
-- The stored effective_mode expression runs for authenticated account writes.
grant usage on schema private to authenticated;
grant execute on function private.account_effective_mode(text,bigint,boolean,boolean) to authenticated;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  category_key text not null check (category_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  parent_category_key text,
  provider text not null check (char_length(provider) between 1 and 50),
  status text not null default 'active' check (status in ('active','inactive')),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,provider,category_key)
);
create index categories_owner_status_idx on public.categories(owner_id,status,category_key);

create table public.category_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null,
  captured_at timestamptz not null,
  product_count integer not null check (product_count >= 0),
  active_product_count integer not null check (active_product_count >= 0 and active_product_count <= product_count),
  accelerating_product_count integer not null check (accelerating_product_count >= 0 and accelerating_product_count <= product_count),
  rising_product_count integer not null check (rising_product_count >= 0 and rising_product_count <= product_count),
  falling_product_count integer not null check (falling_product_count >= 0 and falling_product_count <= product_count),
  median_product_momentum numeric(7,4) not null check (median_product_momentum between 0 and 100),
  mean_product_momentum numeric(7,4) not null check (mean_product_momentum between 0 and 100),
  top_quartile_momentum numeric(7,4) not null check (top_quartile_momentum between 0 and 100),
  sales_delta bigint not null check (sales_delta >= 0),
  sales_velocity double precision not null check (sales_velocity >= 0 and sales_velocity < 'Infinity'),
  sales_acceleration double precision not null check (sales_acceleration between -3 and 3),
  average_commission_rate numeric(7,6) not null check (average_commission_rate between 0 and 1),
  median_commission_amount numeric(14,2) not null check (median_commission_amount >= 0),
  competition_signal numeric(5,4) not null check (competition_signal between 0 and 1),
  saturation_signal numeric(5,4) not null check (saturation_signal between 0 and 1),
  data_confidence numeric(5,4) not null check (data_confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique(owner_id,category_id,captured_at),
  unique(owner_id,category_id,id),
  foreign key(owner_id,category_id) references public.categories(owner_id,id) on delete cascade
);
create index category_snapshots_owner_time_idx on public.category_snapshots(owner_id,captured_at desc);
create index category_snapshots_category_time_idx on public.category_snapshots(owner_id,category_id,captured_at desc);

create table public.category_scores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null,
  snapshot_id uuid not null,
  calculated_at timestamptz not null,
  product_momentum_component numeric(7,4) not null check (product_momentum_component between 0 and 100),
  acceleration_component numeric(7,4) not null check (acceleration_component between 0 and 100),
  breadth_component numeric(7,4) not null check (breadth_component between 0 and 100),
  commercial_component numeric(7,4) not null check (commercial_component between 0 and 100),
  competition_component numeric(7,4) not null check (competition_component between 0 and 100),
  saturation_component numeric(7,4) not null check (saturation_component between 0 and 100),
  confidence_component numeric(7,4) not null check (confidence_component between 0 and 100),
  category_momentum_score numeric(7,4) not null check (category_momentum_score between 0 and 100),
  commercial_opportunity_score numeric(7,4) not null check (commercial_opportunity_score between 0 and 100),
  state text not null check (state in ('HOT','RISING','STABLE','FALLING','SATURATED','LOW_DATA')),
  score_version text not null check (char_length(score_version) between 1 and 100),
  explanation_json jsonb not null check (jsonb_typeof(explanation_json) = 'object'),
  created_at timestamptz not null default now(),
  unique(owner_id,snapshot_id,score_version),
  foreign key(owner_id,category_id) references public.categories(owner_id,id) on delete cascade,
  foreign key(owner_id,category_id,snapshot_id) references public.category_snapshots(owner_id,category_id,id) on delete cascade
);
create index category_scores_owner_rank_idx on public.category_scores(owner_id,category_momentum_score desc,commercial_opportunity_score desc);
create index category_scores_category_time_idx on public.category_scores(owner_id,category_id,calculated_at desc);

alter table public.account_category_affinity
  add column affinity_score numeric(5,4) not null default 0.5 check (affinity_score between 0 and 1),
  add column engagement_rate numeric(9,8) not null default 0 check (engagement_rate between 0 and 1),
  add column follow_conversion numeric(9,8) not null default 0 check (follow_conversion between 0 and 1),
  add column ctr numeric(9,8) not null default 0 check (ctr between 0 and 1),
  add column conversion_rate numeric(9,8) not null default 0 check (conversion_rate between 0 and 1),
  add column commission_per_1000_views numeric(14,4) not null default 0 check (commission_per_1000_views >= 0);
update public.account_category_affinity set affinity_score=score;
create index account_category_affinity_owner_category_idx on public.account_category_affinity(owner_id,category_key,affinity_score desc);

create trigger categories_touch_updated_at before update on public.categories
  for each row execute function private.touch_updated_at();

alter table public.categories enable row level security;
revoke all on public.categories from public,anon,authenticated;
grant select,insert,update on public.categories to authenticated;
create policy categories_select_own on public.categories for select to authenticated using ((select auth.uid())=owner_id);
create policy categories_insert_own on public.categories for insert to authenticated with check ((select auth.uid())=owner_id);
create policy categories_update_own on public.categories for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);

alter table public.category_snapshots enable row level security;
revoke all on public.category_snapshots from public,anon,authenticated;
grant select,insert on public.category_snapshots to authenticated;
create policy category_snapshots_select_own on public.category_snapshots for select to authenticated using ((select auth.uid())=owner_id);
create policy category_snapshots_insert_own on public.category_snapshots for insert to authenticated with check ((select auth.uid())=owner_id);

alter table public.category_scores enable row level security;
revoke all on public.category_scores from public,anon,authenticated;
grant select,insert on public.category_scores to authenticated;
create policy category_scores_select_own on public.category_scores for select to authenticated using ((select auth.uid())=owner_id);
create policy category_scores_insert_own on public.category_scores for insert to authenticated with check ((select auth.uid())=owner_id);

comment on table public.category_snapshots is 'Append-only robust category observations; authenticated owners may select and insert only.';
comment on table public.category_scores is 'Immutable category-momentum-v1 audit rows tied to category snapshots.';
comment on column public.account_category_affinity.affinity_score is 'Mode-aware 0-1 affinity after confidence shrinkage toward neutral 0.5.';
