-- Phase 6C only: pre-publish compliance, originality, account health, and eligibility history.
create table public.content_compliance_checks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null,
  creative_project_id uuid not null,
  tiktok_account_id uuid not null,
  claim_status text not null check(claim_status in ('PASS','REVIEW','REJECT')),
  product_truth_status text not null check(product_truth_status in ('PASS','REVIEW','REJECT')),
  aigc_status text not null check(aigc_status in ('PASS','DISCLOSE','REVIEW')),
  policy_status text not null check(policy_status in ('PASS','REVIEW','REJECT')),
  overall_status text not null check(overall_status in ('PASS','REVIEW','REJECT')),
  issues_json jsonb not null default '[]' check(jsonb_typeof(issues_json)='array'),
  explanation_json jsonb not null default '{}' check(jsonb_typeof(explanation_json)='object'),
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  foreign key(owner_id,creative_project_id) references public.creative_projects(owner_id,id) on delete cascade,
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);

create table public.originality_checks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null,
  tiktok_account_id uuid not null,
  same_account_similarity numeric(5,4) not null check(same_account_similarity between 0 and 1),
  cross_account_similarity numeric(5,4) not null check(cross_account_similarity between 0 and 1),
  hook_similarity numeric(5,4) not null check(hook_similarity between 0 and 1),
  scene_similarity numeric(5,4) not null check(scene_similarity between 0 and 1),
  audio_similarity numeric(5,4) not null check(audio_similarity between 0 and 1),
  overall_similarity numeric(5,4) not null check(overall_similarity between 0 and 1),
  originality_status text not null check(originality_status in ('ORIGINAL','ACCEPTABLE_VARIATION','TOO_SIMILAR','REJECT')),
  matched_video_ids_json jsonb not null default '[]' check(jsonb_typeof(matched_video_ids_json)='array'),
  explanation_json jsonb not null default '{}' check(jsonb_typeof(explanation_json)='object'),
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);

create table public.account_publish_health (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null,
  requested_mode text not null check(requested_mode in ('AUTO','GROWTH','AFFILIATE')),
  effective_mode text not null check(effective_mode in ('GROWTH','AFFILIATE')),
  account_status text not null check(account_status in ('READY','LIMITED','PAUSED','BLOCKED','DISCONNECTED')),
  authorization_status text not null,
  daily_target smallint not null check(daily_target between 0 and 20),
  daily_hard_limit smallint not null check(daily_hard_limit between 0 and 20),
  observed_platform_cap smallint check(observed_platform_cap is null or observed_platform_cap between 0 and 20),
  internal_safety_limit smallint not null default 10 check(internal_safety_limit between 0 and 20),
  effective_publish_cap smallint not null check(effective_publish_cap between 0 and 20),
  posts_today smallint not null default 0 check(posts_today between 0 and 20),
  failed_posts_today smallint not null default 0 check(failed_posts_today between 0 and 20),
  last_creator_info_sync_at timestamptz,
  last_shop_health_sync_at timestamptz,
  health_status text not null check(health_status in ('READY','LIMITED','PAUSED','BLOCKED','DISCONNECTED')),
  blockers_json jsonb not null default '[]' check(jsonb_typeof(blockers_json)='array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,tiktok_account_id),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);

create table public.publish_eligibility_checks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null,
  tiktok_account_id uuid not null,
  compliance_pass boolean not null,
  originality_pass boolean not null,
  quality_pass boolean not null,
  account_health_pass boolean not null,
  creator_limit_pass boolean not null,
  shop_permission_pass boolean not null,
  user_approval_required boolean not null default true check(user_approval_required),
  user_approved boolean not null default false,
  final_status text not null check(final_status in ('READY_FOR_REVIEW','READY_TO_PUBLISH','QUEUED_NEXT_DAY','HOLD','REGENERATE','REJECT','ACCOUNT_BLOCKED')),
  check(final_status <> 'READY_TO_PUBLISH' or user_approved),
  blockers_json jsonb not null default '[]' check(jsonb_typeof(blockers_json)='array'),
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade
);

create index content_compliance_owner_status_idx on public.content_compliance_checks(owner_id,overall_status,checked_at desc);
create index content_compliance_video_idx on public.content_compliance_checks(owner_id,video_id,checked_at desc);
create index originality_owner_status_idx on public.originality_checks(owner_id,originality_status,created_at desc);
create index originality_video_idx on public.originality_checks(owner_id,video_id,created_at desc);
create index publish_health_owner_status_idx on public.account_publish_health(owner_id,health_status,updated_at desc);
create index publish_eligibility_owner_status_idx on public.publish_eligibility_checks(owner_id,final_status,created_at desc);
create index publish_eligibility_video_idx on public.publish_eligibility_checks(owner_id,video_id,created_at desc);

create trigger account_publish_health_touch before update on public.account_publish_health for each row execute function private.touch_updated_at();

alter table public.content_compliance_checks enable row level security;
alter table public.originality_checks enable row level security;
alter table public.account_publish_health enable row level security;
alter table public.publish_eligibility_checks enable row level security;

revoke all on public.content_compliance_checks,public.originality_checks,public.account_publish_health,public.publish_eligibility_checks from public,anon,authenticated;
grant select,insert on public.content_compliance_checks,public.originality_checks,public.publish_eligibility_checks to authenticated;
grant select,insert,update on public.account_publish_health to authenticated;

create policy content_compliance_read on public.content_compliance_checks for select to authenticated using((select auth.uid())=owner_id);
create policy content_compliance_insert on public.content_compliance_checks for insert to authenticated with check((select auth.uid())=owner_id);
create policy originality_read on public.originality_checks for select to authenticated using((select auth.uid())=owner_id);
create policy originality_insert on public.originality_checks for insert to authenticated with check((select auth.uid())=owner_id);
create policy publish_health_read on public.account_publish_health for select to authenticated using((select auth.uid())=owner_id);
create policy publish_health_insert on public.account_publish_health for insert to authenticated with check((select auth.uid())=owner_id);
create policy publish_health_update on public.account_publish_health for update to authenticated using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
create policy publish_eligibility_read on public.publish_eligibility_checks for select to authenticated using((select auth.uid())=owner_id);
create policy publish_eligibility_insert on public.publish_eligibility_checks for insert to authenticated with check((select auth.uid())=owner_id);

comment on table public.content_compliance_checks is 'Append-only Phase 6C content and product-truth compliance evidence.';
comment on table public.originality_checks is 'Append-only metadata-first originality and cross-account duplication evidence.';
comment on table public.account_publish_health is 'Local publish-readiness cache; future approved TikTok adapters may refresh authoritative fields.';
comment on table public.publish_eligibility_checks is 'Append-only fail-closed pre-publish gate. User approval is always required.';
