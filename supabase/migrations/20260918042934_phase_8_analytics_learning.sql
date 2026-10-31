-- Phase 8: owner-isolated analytics, winner detection, and learning evidence.
-- Metrics stay nullable when an upstream scope or source does not provide them.

create table public.video_analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null,
  video_id uuid not null,
  video_kind text not null check (video_kind in ('MASTER','VARIATION','EXTERNAL')),
  external_video_id text not null check (char_length(external_video_id) between 1 and 200),
  product_id uuid,
  category_id uuid,
  creative_project_id uuid,
  creative_angle_id uuid,
  script_id uuid,
  source text not null check (source in ('MOCK','TIKTOK_DISPLAY','TIKTOK_SHOP_ANALYTICS')),
  source_snapshot_at timestamptz not null,
  published_at timestamptz,
  duration_seconds numeric(8,3) check (duration_seconds is null or duration_seconds > 0),
  views bigint check (views is null or views >= 0),
  likes bigint check (likes is null or likes >= 0),
  comments bigint check (comments is null or comments >= 0),
  shares bigint check (shares is null or shares >= 0),
  favorites bigint check (favorites is null or favorites >= 0),
  clicks bigint check (clicks is null or clicks >= 0),
  orders bigint check (orders is null or orders >= 0),
  items_sold bigint check (items_sold is null or items_sold >= 0),
  gmv numeric(16,2) check (gmv is null or gmv >= 0),
  commission numeric(16,2) check (commission is null or commission >= 0),
  currency text check (currency is null or currency in ('THB','USD')),
  availability_json jsonb not null default '{}' check (jsonb_typeof(availability_json) = 'object'),
  source_confidence numeric(5,4) not null check (source_confidence between 0 and 1),
  raw_metadata_json jsonb not null default '{}' check (jsonb_typeof(raw_metadata_json) = 'object'),
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,source,external_video_id,source_snapshot_at),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade,
  foreign key(owner_id,category_id) references public.categories(owner_id,id) on delete cascade,
  foreign key(owner_id,creative_project_id) references public.creative_projects(owner_id,id) on delete cascade
);

create table public.account_analytics_snapshots (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null, source text not null check(source in ('MOCK','TIKTOK_DISPLAY','TIKTOK_SHOP_ANALYTICS')),
  source_snapshot_at timestamptz not null, follower_count bigint check(follower_count is null or follower_count>=0),
  following_count bigint check(following_count is null or following_count>=0), total_likes bigint check(total_likes is null or total_likes>=0),
  video_count bigint check(video_count is null or video_count>=0), profile_views bigint check(profile_views is null or profile_views>=0),
  follower_delta bigint, availability_json jsonb not null default '{}' check(jsonb_typeof(availability_json)='object'),
  source_confidence numeric(5,4) not null check(source_confidence between 0 and 1), created_at timestamptz not null default now(),
  unique(owner_id,id), unique(owner_id,tiktok_account_id,source,source_snapshot_at),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);

create table public.product_performance_snapshots (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null, product_id uuid not null, external_product_id text not null,
  source text not null check(source in ('MOCK','TIKTOK_SHOP_ANALYTICS')), source_snapshot_at timestamptz not null,
  impressions bigint check(impressions is null or impressions>=0), views bigint check(views is null or views>=0),
  clicks bigint check(clicks is null or clicks>=0), orders bigint check(orders is null or orders>=0),
  items_sold bigint check(items_sold is null or items_sold>=0), gmv numeric(16,2) check(gmv is null or gmv>=0),
  commission numeric(16,2) check(commission is null or commission>=0), currency text check(currency is null or currency in ('THB','USD')),
  availability_json jsonb not null default '{}' check(jsonb_typeof(availability_json)='object'),
  source_confidence numeric(5,4) not null check(source_confidence between 0 and 1), created_at timestamptz not null default now(),
  unique(owner_id,id), unique(owner_id,tiktok_account_id,product_id,source,source_snapshot_at),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade
);

create table public.affiliate_conversion_events (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null, product_id uuid, external_order_id text not null, external_event_id text not null,
  external_video_id text, event_type text not null check(event_type in ('ORDER_CREATED','ORDER_SETTLED','ORDER_CANCELLED','COMMISSION_UPDATED')),
  attribution_type text, quantity integer check(quantity is null or quantity>=0), gmv numeric(16,2) check(gmv is null or gmv>=0),
  estimated_commission numeric(16,2) check(estimated_commission is null or estimated_commission>=0),
  settled_commission numeric(16,2) check(settled_commission is null or settled_commission>=0), currency text check(currency is null or currency in ('THB','USD')),
  occurred_at timestamptz not null, received_at timestamptz not null default now(), source text not null default 'TIKTOK_SHOP_AFFILIATE',
  raw_metadata_json jsonb not null default '{}' check(jsonb_typeof(raw_metadata_json)='object'),
  unique(owner_id,id), unique(owner_id,source,external_event_id),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade
);

create table public.winner_scores (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null, video_snapshot_id uuid not null, video_id uuid not null, video_kind text not null,
  mode text not null check(mode in ('GROWTH','AFFILIATE')), growth_score numeric(7,4) check(growth_score is null or growth_score between 0 and 100),
  affiliate_score numeric(7,4) check(affiliate_score is null or affiliate_score between 0 and 100),
  final_score numeric(7,4) check(final_score is null or final_score between 0 and 100),
  decision text not null check(decision in ('STOP','WATCH','SCALE','INSUFFICIENT_DATA')),
  confidence numeric(5,4) not null check(confidence between 0 and 1), sample_factor numeric(5,4) not null check(sample_factor between 0 and 1),
  freshness_factor numeric(5,4) not null check(freshness_factor between 0 and 1), account_baseline_json jsonb not null,
  components_json jsonb not null, explanation_json jsonb not null, score_version text not null default 'winner-detection-v1',
  evidence_hash text not null check(char_length(evidence_hash)=64), evaluated_at timestamptz not null, created_at timestamptz not null default now(),
  unique(owner_id,id), unique(owner_id,video_id,video_kind,score_version,evidence_hash),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,video_snapshot_id) references public.video_analytics_snapshots(owner_id,id) on delete cascade
);

create table public.learning_signals (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null, winner_score_id uuid not null, signal_key text not null,
  dimension_type text not null check(dimension_type in ('CATEGORY','PRODUCT','HOOK','ANGLE','SCENE','CTA','TEMPLATE','PROVIDER','VARIATION','PUBLISH_TIMING')),
  dimension_value text not null, mode text not null check(mode in ('GROWTH','AFFILIATE')), effect numeric(7,4) not null check(effect between -1 and 1),
  weight numeric(7,4) not null check(weight between 0 and 1), confidence numeric(5,4) not null check(confidence between 0 and 1),
  decay_factor numeric(5,4) not null check(decay_factor between 0 and 1), sample_size integer not null check(sample_size>=1),
  observed_at timestamptz not null, expires_at timestamptz, metadata_json jsonb not null default '{}' check(jsonb_typeof(metadata_json)='object'),
  created_at timestamptz not null default now(), unique(owner_id,id), unique(owner_id,signal_key),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,winner_score_id) references public.winner_scores(owner_id,id) on delete cascade
);

create table public.experiment_variants (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null, source_video_id uuid not null, source_winner_score_id uuid not null,
  variation_axis text not null check(variation_axis in ('HOOK','SCENE','CTA','TEMPLATE','PUBLISH_TIMING')),
  control_value text not null, variant_value text not null, originality_required boolean not null default true check(originality_required),
  status text not null default 'PROPOSED' check(status in ('PROPOSED','APPROVED','RUNNING','COMPLETED','CANCELLED')),
  idempotency_key text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id,id), unique(owner_id,idempotency_key),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,source_winner_score_id) references public.winner_scores(owner_id,id) on delete cascade
);

create table public.learning_decisions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null, winner_score_id uuid not null,
  decision_type text not null check(decision_type in ('PRESERVE','BOOST','SUPPRESS','TEST_VARIANT','STOP')),
  target_brain text not null check(target_brain in ('PRODUCT','CATEGORY','ASSIGNMENT','CREATIVE','VIDEO','PUBLISHING')),
  target_key text not null, adjustment numeric(7,4) check(adjustment is null or adjustment between -0.25 and 0.25),
  confidence numeric(5,4) not null check(confidence between 0 and 1), rationale text not null,
  evidence_hash text not null check(char_length(evidence_hash)=64), decision_version text not null default 'learning-loop-v1',
  decided_at timestamptz not null, created_at timestamptz not null default now(),
  unique(owner_id,id), unique(owner_id,tiktok_account_id,target_brain,target_key,decision_version,evidence_hash),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,winner_score_id) references public.winner_scores(owner_id,id) on delete cascade
);

create index video_analytics_owner_time_idx on public.video_analytics_snapshots(owner_id,source_snapshot_at desc);
create index video_analytics_account_video_idx on public.video_analytics_snapshots(owner_id,tiktok_account_id,video_id,source_snapshot_at desc);
create index account_analytics_owner_account_idx on public.account_analytics_snapshots(owner_id,tiktok_account_id,source_snapshot_at desc);
create index product_performance_owner_product_idx on public.product_performance_snapshots(owner_id,product_id,source_snapshot_at desc);
create index affiliate_conversion_owner_time_idx on public.affiliate_conversion_events(owner_id,occurred_at desc);
create index winner_scores_owner_decision_idx on public.winner_scores(owner_id,decision,final_score desc);
create index winner_scores_account_time_idx on public.winner_scores(owner_id,tiktok_account_id,evaluated_at desc);
create index learning_signals_account_dimension_idx on public.learning_signals(owner_id,tiktok_account_id,dimension_type,observed_at desc);
create index experiment_variants_owner_status_idx on public.experiment_variants(owner_id,status,created_at desc);
create index learning_decisions_owner_time_idx on public.learning_decisions(owner_id,decided_at desc);
create trigger experiment_variants_touch before update on public.experiment_variants for each row execute function private.touch_updated_at();

alter table public.video_analytics_snapshots enable row level security;
alter table public.account_analytics_snapshots enable row level security;
alter table public.product_performance_snapshots enable row level security;
alter table public.affiliate_conversion_events enable row level security;
alter table public.winner_scores enable row level security;
alter table public.learning_signals enable row level security;
alter table public.experiment_variants enable row level security;
alter table public.learning_decisions enable row level security;

revoke all on public.video_analytics_snapshots,public.account_analytics_snapshots,public.product_performance_snapshots,
  public.affiliate_conversion_events,public.winner_scores,public.learning_signals,public.experiment_variants,public.learning_decisions
  from public,anon,authenticated;
grant select on public.video_analytics_snapshots,public.account_analytics_snapshots,public.product_performance_snapshots,
  public.affiliate_conversion_events,public.winner_scores,public.learning_signals,public.experiment_variants,public.learning_decisions to authenticated;

create policy video_analytics_read on public.video_analytics_snapshots for select to authenticated using((select auth.uid())=owner_id);
create policy account_analytics_read on public.account_analytics_snapshots for select to authenticated using((select auth.uid())=owner_id);
create policy product_performance_read on public.product_performance_snapshots for select to authenticated using((select auth.uid())=owner_id);
create policy affiliate_conversion_read on public.affiliate_conversion_events for select to authenticated using((select auth.uid())=owner_id);
create policy winner_scores_read on public.winner_scores for select to authenticated using((select auth.uid())=owner_id);
create policy learning_signals_read on public.learning_signals for select to authenticated using((select auth.uid())=owner_id);
create policy experiment_variants_read on public.experiment_variants for select to authenticated using((select auth.uid())=owner_id);
create policy learning_decisions_read on public.learning_decisions for select to authenticated using((select auth.uid())=owner_id);

comment on table public.video_analytics_snapshots is 'Append-only raw and availability-aware per-video analytics evidence.';
comment on table public.affiliate_conversion_events is 'Immutable delayed affiliate attribution events, idempotent by provider event id.';
comment on table public.winner_scores is 'Versioned account-relative winner decisions; source facts remain unchanged.';
comment on table public.learning_signals is 'Account-local, decayed learning evidence; never a global shortcut.';
comment on table public.learning_decisions is 'Append-only bounded adjustments layered onto existing brains.';
