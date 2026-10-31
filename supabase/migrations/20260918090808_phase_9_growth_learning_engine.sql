-- Phase 9: account-specific Growth Learning Engine. No Auto Mode or real publishing.
create table public.growth_account_snapshots (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 tiktok_account_id uuid not null, source_snapshot_id uuid, snapshot_at timestamptz not null,
 follower_count bigint check(follower_count is null or follower_count>=0), follower_delta bigint,
 views bigint check(views is null or views>=0), engagement bigint check(engagement is null or engagement>=0),
 follower_attribution_confidence numeric(5,4) not null check(follower_attribution_confidence between 0 and 1),
 category_performance_json jsonb not null default '{}' check(jsonb_typeof(category_performance_json)='object'),
 availability_json jsonb not null default '{}' check(jsonb_typeof(availability_json)='object'),
 source text not null check(source in ('MOCK','PHASE_8_ANALYTICS','TIKTOK_DISPLAY')),
 evidence_hash text not null check(char_length(evidence_hash)=64), created_at timestamptz not null default now(),
 unique(owner_id,id), unique(owner_id,tiktok_account_id,evidence_hash),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
 foreign key(owner_id,source_snapshot_id) references public.account_analytics_snapshots(owner_id,id) on delete cascade
);

create table public.growth_strategy_profiles (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 tiktok_account_id uuid not null, growth_state text not null check(growth_state in ('NEW','LEARNING','GROWING','ACCELERATING','PLATEAU','COMMERCE_RECHECK','COMMERCE_READY','COMMERCE_BLOCKED')),
 growth_score numeric(7,4) check(growth_score is null or growth_score between 0 and 100),
 preferred_categories_json jsonb not null default '[]' check(jsonb_typeof(preferred_categories_json)='array'),
 winning_hooks_json jsonb not null default '[]' check(jsonb_typeof(winning_hooks_json)='array'),
 winning_angles_json jsonb not null default '[]' check(jsonb_typeof(winning_angles_json)='array'),
 winning_ctas_json jsonb not null default '[]' check(jsonb_typeof(winning_ctas_json)='array'),
 posting_preferences_json jsonb not null default '{}' check(jsonb_typeof(posting_preferences_json)='object'),
 exploit_ratio numeric(5,4) not null default .75 check(exploit_ratio between .5 and .95),
 exploration_ratio numeric(5,4) generated always as (1-exploit_ratio) stored,
 confidence numeric(5,4) not null check(confidence between 0 and 1), version text not null default 'growth-strategy-v1',
 evidence_cutoff_at timestamptz, updated_at timestamptz not null default now(), created_at timestamptz not null default now(),
 unique(owner_id,id), unique(owner_id,tiktok_account_id),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);

create table public.growth_experiments (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 tiktok_account_id uuid not null, hypothesis text not null check(char_length(hypothesis) between 8 and 500),
 control_json jsonb not null check(jsonb_typeof(control_json)='object'), variant_json jsonb not null check(jsonb_typeof(variant_json)='object'),
 changed_axis text not null check(changed_axis in ('CATEGORY','HOOK','ANGLE','OPENING','SCENE','CTA','VOICE_STYLE','TEMPLATE','VARIATION_TYPE','PUBLISH_TIMING')),
 status text not null default 'PROPOSED' check(status in ('PROPOSED','APPROVED','RUNNING','COMPLETED','CANCELLED')),
 originality_required boolean not null default true check(originality_required), start_at timestamptz, end_at timestamptz,
 idempotency_key text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,id), unique(owner_id,idempotency_key),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);

create table public.growth_experiment_results (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 growth_experiment_id uuid not null, winner_score_id uuid, result text not null check(result in ('CONTROL_WINS','VARIANT_WINS','NO_DIFFERENCE','INSUFFICIENT_DATA')),
 control_score numeric(7,4) check(control_score is null or control_score between 0 and 100),
 variant_score numeric(7,4) check(variant_score is null or variant_score between 0 and 100),
 confidence numeric(5,4) not null check(confidence between 0 and 1), sample_size integer not null check(sample_size>=0),
 evidence_hash text not null check(char_length(evidence_hash)=64), evaluated_at timestamptz not null, created_at timestamptz not null default now(),
 unique(owner_id,id), unique(owner_id,growth_experiment_id,evidence_hash),
 foreign key(owner_id,growth_experiment_id) references public.growth_experiments(owner_id,id) on delete cascade,
 foreign key(owner_id,winner_score_id) references public.winner_scores(owner_id,id) on delete cascade
);

create table public.growth_milestones (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 tiktok_account_id uuid not null, follower_count bigint not null check(follower_count>=0), milestone_value bigint not null check(milestone_value>0),
 milestone_type text not null check(milestone_type in ('FOLLOWER_INTERNAL','COMMERCE_AUTHORITATIVE')),
 reached_at timestamptz not null, commerce_recheck_required boolean not null default false,
 commerce_recheck_status text not null check(commerce_recheck_status in ('NOT_REQUIRED','PENDING','READY','BLOCKED','REAUTH_REQUIRED')),
 authority_source text check(authority_source is null or authority_source in ('TIKTOK_SHOP','MOCK_TIKTOK_SHOP')),
 evidence_hash text not null check(char_length(evidence_hash)=64), created_at timestamptz not null default now(),
 unique(owner_id,id), unique(owner_id,tiktok_account_id,milestone_value,evidence_hash),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);

create table public.growth_recommendations (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 tiktok_account_id uuid not null, next_action text not null check(next_action in ('TEST_NEW_CATEGORY','SCALE_HOOK','SCALE_ANGLE','CREATE_VARIATION','REDUCE_CATEGORY','WAIT_FOR_DATA','RECHECK_COMMERCE','TRANSITION_ELIGIBLE')),
 category_key text, hook text, angle text, opening text, cta text, scene_structure_json jsonb not null default '[]' check(jsonb_typeof(scene_structure_json)='array'),
 experiment_axis text, confidence numeric(5,4) not null check(confidence between 0 and 1),
 evidence_json jsonb not null check(jsonb_typeof(evidence_json)='object'), originality_required boolean not null default true check(originality_required),
 commerce_claims_allowed boolean not null default false check(commerce_claims_allowed=false),
 recommendation_version text not null default 'growth-recommendation-v1', evidence_hash text not null check(char_length(evidence_hash)=64),
 created_at timestamptz not null default now(), unique(owner_id,id), unique(owner_id,tiktok_account_id,recommendation_version,evidence_hash),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);

create index growth_snapshots_account_time_idx on public.growth_account_snapshots(owner_id,tiktok_account_id,snapshot_at desc);
create index growth_snapshots_source_idx on public.growth_account_snapshots(owner_id,source_snapshot_id) where source_snapshot_id is not null;
create index growth_profiles_state_idx on public.growth_strategy_profiles(owner_id,growth_state,growth_score desc);
create index growth_experiments_account_status_idx on public.growth_experiments(owner_id,tiktok_account_id,status,created_at desc);
create index growth_results_experiment_time_idx on public.growth_experiment_results(owner_id,growth_experiment_id,evaluated_at desc);
create index growth_results_winner_idx on public.growth_experiment_results(owner_id,winner_score_id) where winner_score_id is not null;
create index growth_milestones_account_time_idx on public.growth_milestones(owner_id,tiktok_account_id,reached_at desc);
create index growth_recommendations_account_time_idx on public.growth_recommendations(owner_id,tiktok_account_id,created_at desc);
create trigger growth_profiles_touch before update on public.growth_strategy_profiles for each row execute function private.touch_updated_at();
create trigger growth_experiments_touch before update on public.growth_experiments for each row execute function private.touch_updated_at();

alter table public.growth_account_snapshots enable row level security; alter table public.growth_strategy_profiles enable row level security;
alter table public.growth_experiments enable row level security; alter table public.growth_experiment_results enable row level security;
alter table public.growth_milestones enable row level security; alter table public.growth_recommendations enable row level security;
revoke all on public.growth_account_snapshots,public.growth_strategy_profiles,public.growth_experiments,public.growth_experiment_results,public.growth_milestones,public.growth_recommendations from public,anon,authenticated;
grant select on public.growth_account_snapshots,public.growth_strategy_profiles,public.growth_experiments,public.growth_experiment_results,public.growth_milestones,public.growth_recommendations to authenticated;
grant select,insert on public.growth_account_snapshots,public.growth_experiment_results,public.growth_milestones,public.growth_recommendations to service_role;
grant select,insert,update,delete on public.growth_strategy_profiles,public.growth_experiments to service_role;
create policy growth_snapshots_owner_read on public.growth_account_snapshots for select to authenticated using((select auth.uid())=owner_id);
create policy growth_profiles_owner_read on public.growth_strategy_profiles for select to authenticated using((select auth.uid())=owner_id);
create policy growth_experiments_owner_read on public.growth_experiments for select to authenticated using((select auth.uid())=owner_id);
create policy growth_results_owner_read on public.growth_experiment_results for select to authenticated using((select auth.uid())=owner_id);
create policy growth_milestones_owner_read on public.growth_milestones for select to authenticated using((select auth.uid())=owner_id);
create policy growth_recommendations_owner_read on public.growth_recommendations for select to authenticated using((select auth.uid())=owner_id);
comment on table public.growth_account_snapshots is 'Append-only Growth account evidence. Missing source metrics remain null/UNKNOWN.';
comment on table public.growth_experiment_results is 'Append-only controlled experiment outcomes; late evidence appends a new evaluation.';
comment on table public.growth_milestones is 'Internal follower milestones never imply commerce eligibility without authoritative evidence.';
comment on table public.growth_recommendations is 'Advisory Phase 9 output; Phase 10 may orchestrate only after separate authorization.';
