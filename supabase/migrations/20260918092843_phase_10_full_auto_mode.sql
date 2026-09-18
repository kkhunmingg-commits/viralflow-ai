-- Phase 10: durable, approval-aware Full Auto Mode orchestration.
create table public.auto_runs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 state text not null check(state in ('IDLE','STARTING','RUNNING','PAUSED','WAITING_FOR_DATA','WAITING_FOR_APPROVAL','WAITING_FOR_SLOT','WAITING_FOR_PROVIDER','RETRY_PENDING','BLOCKED','COMPLETED','FAILED','STOPPED')),
 trigger_source text not null default 'MANUAL' check(trigger_source in ('MANUAL','SCHEDULED','RECOVERY','MOCK')),
 run_date date not null, current_step text not null default 'INITIALIZE', attempt integer not null default 1 check(attempt between 1 and 6),
 budget_usd numeric(12,4) not null default 0 check(budget_usd>=0), spent_usd numeric(12,4) not null default 0 check(spent_usd>=0 and spent_usd<=budget_usd),
 metrics_json jsonb not null default '{}' check(jsonb_typeof(metrics_json)='object'), blockers_json jsonb not null default '[]' check(jsonb_typeof(blockers_json)='array'),
 idempotency_key text not null, started_at timestamptz, updated_at timestamptz not null default now(), completed_at timestamptz, paused_at timestamptz,
 unique(owner_id,id), unique(owner_id,idempotency_key)
);

create table public.auto_run_steps (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 auto_run_id uuid not null, tiktok_account_id uuid, step text not null, state text not null check(state in ('PENDING','RUNNING','WAITING','COMPLETED','FAILED','SKIPPED')),
 attempt integer not null default 1 check(attempt between 1 and 6), input_json jsonb not null default '{}' check(jsonb_typeof(input_json)='object'),
 output_json jsonb not null default '{}' check(jsonb_typeof(output_json)='object'), failure_reason text, idempotency_key text not null,
 started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(), unique(owner_id,id), unique(owner_id,idempotency_key),
 foreign key(owner_id,auto_run_id) references public.auto_runs(owner_id,id) on delete cascade,
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);

create table public.auto_account_states (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 auto_run_id uuid not null, tiktok_account_id uuid not null, requested_mode text not null check(requested_mode in ('GROWTH','AFFILIATE','AUTO')),
 effective_mode text not null check(effective_mode in ('GROWTH','AFFILIATE')), state text not null check(state in ('STARTING','RUNNING','PAUSED','WAITING_FOR_DATA','WAITING_FOR_APPROVAL','WAITING_FOR_SLOT','WAITING_FOR_PROVIDER','RETRY_PENDING','BLOCKED','COMPLETED','FAILED','STOPPED')),
 current_step text not null, next_action text, blockers_json jsonb not null default '[]' check(jsonb_typeof(blockers_json)='array'),
 desired_daily_candidates integer not null default 15 check(desired_daily_candidates between 0 and 100), desired_daily_posts integer not null default 3 check(desired_daily_posts between 0 and 20),
 max_daily_cost_usd numeric(12,4) not null default 0 check(max_daily_cost_usd>=0), generated_today integer not null default 0 check(generated_today>=0),
 queued_today integer not null default 0 check(queued_today>=0), published_today integer not null default 0 check(published_today>=0),
 generation_capacity integer not null default 0 check(generation_capacity>=0), publish_capacity integer not null default 0 check(publish_capacity>=0), priority integer not null default 50 check(priority between 0 and 100),
 checkpoint_version integer not null default 0 check(checkpoint_version>=0), updated_at timestamptz not null default now(), created_at timestamptz not null default now(),
 unique(owner_id,id), unique(owner_id,auto_run_id,tiktok_account_id),
 foreign key(owner_id,auto_run_id) references public.auto_runs(owner_id,id) on delete cascade,
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);

create table public.auto_actions (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 auto_run_id uuid not null, tiktok_account_id uuid not null, action_type text not null, decision_source text not null,
 status text not null check(status in ('PLANNED','READY','WAITING_FOR_APPROVAL','WAITING_FOR_SLOT','BLOCKED','COMPLETED','CANCELLED')),
 controlled_axis text, payload_json jsonb not null default '{}' check(jsonb_typeof(payload_json)='object'),
 estimated_cost_usd numeric(12,4) not null default 0 check(estimated_cost_usd>=0), actual_cost_usd numeric(12,4) not null default 0 check(actual_cost_usd>=0),
 idempotency_key text not null, created_at timestamptz not null default now(), unique(owner_id,id), unique(owner_id,idempotency_key),
 foreign key(owner_id,auto_run_id) references public.auto_runs(owner_id,id) on delete cascade,
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);

create table public.auto_failures (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 auto_run_id uuid not null, tiktok_account_id uuid, failure_type text not null check(failure_type in ('TRANSIENT','PERMISSION','BUDGET','PROVIDER','COMPLIANCE','ACCOUNT','PUBLISH','ANALYTICS','UNKNOWN')),
 step text not null, reason text not null, retryable boolean not null, retry_count integer not null default 0 check(retry_count between 0 and 5), next_retry_at timestamptz,
 safe_context_json jsonb not null default '{}' check(jsonb_typeof(safe_context_json)='object'), created_at timestamptz not null default now(), unique(owner_id,id),
 foreign key(owner_id,auto_run_id) references public.auto_runs(owner_id,id) on delete cascade,
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);

create table public.auto_checkpoints (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 auto_run_id uuid not null, tiktok_account_id uuid, step text not null, checkpoint_version integer not null check(checkpoint_version>0),
 state_json jsonb not null check(jsonb_typeof(state_json)='object'), evidence_hash text not null check(char_length(evidence_hash)=64), created_at timestamptz not null default now(),
 unique(owner_id,id), unique(owner_id,auto_run_id,tiktok_account_id,checkpoint_version),
 foreign key(owner_id,auto_run_id) references public.auto_runs(owner_id,id) on delete cascade,
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);

create index auto_runs_owner_state_idx on public.auto_runs(owner_id,state,updated_at desc);
create unique index auto_runs_one_active_per_owner_idx on public.auto_runs(owner_id) where state in ('STARTING','RUNNING','PAUSED','RETRY_PENDING');
create index auto_steps_run_idx on public.auto_run_steps(owner_id,auto_run_id,created_at);
create index auto_account_states_run_idx on public.auto_account_states(owner_id,auto_run_id,state,priority desc);
create index auto_actions_run_idx on public.auto_actions(owner_id,auto_run_id,status,created_at);
create index auto_failures_run_idx on public.auto_failures(owner_id,auto_run_id,created_at desc);
create index auto_checkpoints_run_idx on public.auto_checkpoints(owner_id,auto_run_id,checkpoint_version desc);
create trigger auto_runs_touch before update on public.auto_runs for each row execute function private.touch_updated_at();
create trigger auto_account_states_touch before update on public.auto_account_states for each row execute function private.touch_updated_at();

alter table public.auto_runs enable row level security; alter table public.auto_run_steps enable row level security;
alter table public.auto_account_states enable row level security; alter table public.auto_actions enable row level security;
alter table public.auto_failures enable row level security; alter table public.auto_checkpoints enable row level security;
revoke all on public.auto_runs,public.auto_run_steps,public.auto_account_states,public.auto_actions,public.auto_failures,public.auto_checkpoints from public,anon,authenticated;
grant select on public.auto_runs,public.auto_run_steps,public.auto_account_states,public.auto_actions,public.auto_failures,public.auto_checkpoints to authenticated;
grant select,insert,update,delete on public.auto_runs,public.auto_account_states to service_role;
grant select,insert on public.auto_run_steps,public.auto_actions,public.auto_failures,public.auto_checkpoints to service_role;
create policy auto_runs_owner_read on public.auto_runs for select to authenticated using((select auth.uid())=owner_id);
create policy auto_steps_owner_read on public.auto_run_steps for select to authenticated using((select auth.uid())=owner_id);
create policy auto_account_states_owner_read on public.auto_account_states for select to authenticated using((select auth.uid())=owner_id);
create policy auto_actions_owner_read on public.auto_actions for select to authenticated using((select auth.uid())=owner_id);
create policy auto_failures_owner_read on public.auto_failures for select to authenticated using((select auth.uid())=owner_id);
create policy auto_checkpoints_owner_read on public.auto_checkpoints for select to authenticated using((select auth.uid())=owner_id);
comment on table public.auto_run_steps is 'Append-only orchestration step history; safe to replay after restart.';
comment on table public.auto_actions is 'Append-only bounded decisions; real provider and publishing calls remain flag-gated.';
comment on table public.auto_failures is 'Append-only classified failures with bounded retry metadata and no secrets.';
comment on table public.auto_checkpoints is 'Append-only recovery evidence for resume from the last safe step.';
