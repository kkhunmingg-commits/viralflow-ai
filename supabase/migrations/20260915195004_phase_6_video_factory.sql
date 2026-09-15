-- Phase 6 only: zero-cost-first Video Factory, job ledger, budgets, and private media.
alter table public.tiktok_accounts
  add column max_cost_per_video_usd numeric(10,4) not null default 0 check(max_cost_per_video_usd>=0),
  add column daily_video_budget_usd numeric(12,4) not null default 0 check(daily_video_budget_usd>=0),
  add column monthly_video_budget_usd numeric(14,4) not null default 0 check(monthly_video_budget_usd>=0);

alter table public.scripts add constraint scripts_owner_identity_unique unique(owner_id,id);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid,
  creative_project_id uuid,
  asset_type text not null check(asset_type in ('IMAGE','VIDEO','AUDIO','VOICE','BACKGROUND','PRODUCT_IMAGE','GENERATED_IMAGE')),
  source_type text not null check(source_type in ('UPLOAD','PRODUCT','TEMPLATE','MOCK','GENERATED','RENDERED')),
  storage_path text not null,
  mime_type text not null,
  width integer check(width is null or width>0),
  height integer check(height is null or height>0),
  duration_seconds numeric(8,3) check(duration_seconds is null or duration_seconds>0),
  provider text not null,
  model text not null,
  checksum text not null check(char_length(checksum)=64),
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,storage_path),
  foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade,
  foreign key(owner_id,creative_project_id) references public.creative_projects(owner_id,id) on delete cascade,
  check(storage_path like 'owner/'||owner_id::text||'/%')
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  creative_project_id uuid,
  master_video_id uuid,
  video_variation_id uuid,
  idempotency_key text not null check(char_length(idempotency_key) between 8 and 200),
  job_type text not null check(job_type in ('MASTER_RENDER','VARIATION_RENDER','QUALITY_EVALUATION')),
  provider text not null,
  model text not null,
  input_json jsonb not null default '{}',
  output_json jsonb,
  status text not null default 'QUEUED' check(status in ('QUEUED','PROCESSING','COMPLETED','FAILED','RETRYING','CANCELLED')),
  attempt integer not null default 0 check(attempt>=0),
  max_attempts integer not null default 2 check(max_attempts between 1 and 5),
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,idempotency_key),
  foreign key(owner_id,creative_project_id) references public.creative_projects(owner_id,id) on delete cascade
);

create table public.master_videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null,
  product_id uuid not null,
  creative_project_id uuid not null,
  selected_script_id uuid not null,
  generation_job_id uuid,
  provider text not null,
  model text not null,
  render_strategy text not null check(render_strategy in ('REUSE_MASTER','LOCAL_TEMPLATE','FREE_CREDIT','AI_IMAGE_TO_VIDEO','PREMIUM_AI_VIDEO')),
  duration_seconds numeric(8,3) not null check(duration_seconds>0),
  width integer not null check(width>0),
  height integer not null check(height>0),
  fps numeric(8,3) not null check(fps>0),
  storage_path text,
  quality_score numeric(7,3) check(quality_score is null or quality_score between 0 and 100),
  quality_status text check(quality_status is null or quality_status in ('PASS','RETRY','REJECT')),
  quality_explanation_json jsonb not null default '{}',
  estimated_cost_usd numeric(12,6) not null default 0 check(estimated_cost_usd>=0),
  status text not null default 'QUEUED' check(status in ('QUEUED','PROCESSING','READY','APPROVED','REJECTED','FAILED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,creative_project_id),
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade,
  foreign key(owner_id,creative_project_id) references public.creative_projects(owner_id,id) on delete cascade,
  foreign key(owner_id,selected_script_id) references public.scripts(owner_id,id),
  foreign key(owner_id,generation_job_id) references public.generation_jobs(owner_id,id)
);

alter table public.generation_jobs
  add constraint generation_jobs_master_fkey foreign key(owner_id,master_video_id) references public.master_videos(owner_id,id) on delete cascade;

create table public.video_variations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  master_video_id uuid not null,
  tiktok_account_id uuid not null,
  product_id uuid not null,
  creative_project_id uuid not null,
  generation_job_id uuid,
  run_id uuid not null,
  variation_index integer not null check(variation_index between 1 and 100),
  variation_type text not null check(variation_type in ('HOOK','CROP','MOTION','OVERLAY','CTA','VOICE','SPEED','TRANSITION','BACKGROUND','COMPOSITE')),
  hook_variant text not null,
  cta_variant text not null,
  overlay_config_json jsonb not null default '{}',
  motion_config_json jsonb not null default '{}',
  scene_config_json jsonb not null default '{}',
  audio_config_json jsonb not null default '{}',
  similarity_score numeric(5,4) not null check(similarity_score between 0 and 1),
  storage_path text,
  quality_score numeric(7,3) check(quality_score is null or quality_score between 0 and 100),
  quality_status text check(quality_status is null or quality_status in ('PASS','RETRY','REJECT')),
  quality_explanation_json jsonb not null default '{}',
  estimated_cost_usd numeric(12,6) not null default 0 check(estimated_cost_usd>=0),
  status text not null default 'QUEUED' check(status in ('QUEUED','PROCESSING','READY','APPROVED','REJECTED','FAILED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,master_video_id,variation_index),
  unique(owner_id,run_id,variation_index),
  foreign key(owner_id,master_video_id) references public.master_videos(owner_id,id) on delete cascade,
  foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id) on delete cascade,
  foreign key(owner_id,product_id) references public.products(owner_id,id) on delete cascade,
  foreign key(owner_id,creative_project_id) references public.creative_projects(owner_id,id) on delete cascade,
  foreign key(owner_id,generation_job_id) references public.generation_jobs(owner_id,id)
);

alter table public.generation_jobs
  add constraint generation_jobs_variation_fkey foreign key(owner_id,video_variation_id) references public.video_variations(owner_id,id) on delete cascade;

create table public.generation_costs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  generation_job_id uuid not null,
  provider text not null,
  model text not null,
  quantity numeric(14,4) not null check(quantity>=0),
  unit text not null check(unit in ('RENDER','SECOND','IMAGE','VIDEO','TOKEN','CREDIT')),
  unit_cost_usd numeric(14,8) not null check(unit_cost_usd>=0),
  total_cost_usd numeric(14,6) not null check(total_cost_usd>=0),
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,generation_job_id,provider,model,unit),
  foreign key(owner_id,generation_job_id) references public.generation_jobs(owner_id,id) on delete cascade
);

create index media_assets_owner_product_idx on public.media_assets(owner_id,product_id,created_at desc);
create index media_assets_owner_project_idx on public.media_assets(owner_id,creative_project_id,created_at desc);
create index master_videos_owner_status_idx on public.master_videos(owner_id,status,updated_at desc);
create index master_videos_account_product_idx on public.master_videos(owner_id,tiktok_account_id,product_id);
create index video_variations_master_idx on public.video_variations(owner_id,master_video_id,variation_index);
create index video_variations_owner_status_idx on public.video_variations(owner_id,status,updated_at desc);
create index generation_jobs_owner_status_idx on public.generation_jobs(owner_id,status,created_at desc);
create index generation_jobs_project_idx on public.generation_jobs(owner_id,creative_project_id,created_at desc);
create index generation_costs_owner_time_idx on public.generation_costs(owner_id,created_at desc);
create index generation_costs_job_idx on public.generation_costs(owner_id,generation_job_id);

create trigger master_videos_touch before update on public.master_videos for each row execute function private.touch_updated_at();
create trigger video_variations_touch before update on public.video_variations for each row execute function private.touch_updated_at();

alter table public.media_assets enable row level security;
alter table public.master_videos enable row level security;
alter table public.video_variations enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.generation_costs enable row level security;

revoke all on public.media_assets,public.master_videos,public.video_variations,public.generation_jobs,public.generation_costs from public,anon,authenticated;
grant select,insert,update,delete on public.media_assets to authenticated;
grant select,insert,update on public.master_videos,public.video_variations,public.generation_jobs to authenticated;
grant select,insert on public.generation_costs to authenticated;

create policy media_assets_read on public.media_assets for select to authenticated using((select auth.uid())=owner_id);
create policy media_assets_insert on public.media_assets for insert to authenticated with check((select auth.uid())=owner_id);
create policy media_assets_update on public.media_assets for update to authenticated using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
create policy media_assets_delete on public.media_assets for delete to authenticated using((select auth.uid())=owner_id);
create policy master_videos_read on public.master_videos for select to authenticated using((select auth.uid())=owner_id);
create policy master_videos_insert on public.master_videos for insert to authenticated with check((select auth.uid())=owner_id);
create policy master_videos_update on public.master_videos for update to authenticated using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
create policy video_variations_read on public.video_variations for select to authenticated using((select auth.uid())=owner_id);
create policy video_variations_insert on public.video_variations for insert to authenticated with check((select auth.uid())=owner_id);
create policy video_variations_update on public.video_variations for update to authenticated using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
create policy generation_jobs_read on public.generation_jobs for select to authenticated using((select auth.uid())=owner_id);
create policy generation_jobs_insert on public.generation_jobs for insert to authenticated with check((select auth.uid())=owner_id);
create policy generation_jobs_update on public.generation_jobs for update to authenticated using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
create policy generation_costs_read on public.generation_costs for select to authenticated using((select auth.uid())=owner_id);
create policy generation_costs_insert on public.generation_costs for insert to authenticated with check((select auth.uid())=owner_id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('video-assets','video-assets',false,52428800,array['image/png','image/jpeg','image/x-portable-pixmap','audio/wav','audio/mpeg','video/mp4'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy video_assets_read on storage.objects for select to authenticated
using(bucket_id='video-assets' and (storage.foldername(name))[1]='owner' and (storage.foldername(name))[2]=(select auth.uid())::text);
create policy video_assets_insert on storage.objects for insert to authenticated
with check(bucket_id='video-assets' and (storage.foldername(name))[1]='owner' and (storage.foldername(name))[2]=(select auth.uid())::text);
create policy video_assets_update on storage.objects for update to authenticated
using(bucket_id='video-assets' and (storage.foldername(name))[1]='owner' and (storage.foldername(name))[2]=(select auth.uid())::text)
with check(bucket_id='video-assets' and (storage.foldername(name))[1]='owner' and (storage.foldername(name))[2]=(select auth.uid())::text);
create policy video_assets_delete on storage.objects for delete to authenticated
using(bucket_id='video-assets' and (storage.foldername(name))[1]='owner' and (storage.foldername(name))[2]=(select auth.uid())::text);

comment on table public.generation_costs is 'Append-only Video Factory cost ledger.';
comment on column public.generation_jobs.idempotency_key is 'Stable caller key used to make job retries safe.';
