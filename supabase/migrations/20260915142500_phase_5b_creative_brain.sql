-- Phase 5B only: owner-scoped Creative Brain records.
alter table public.product_assignments
  add constraint product_assignments_owner_identity_unique
  unique(owner_id,id,tiktok_account_id,product_id);

create table public.creative_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  tiktok_account_id uuid not null,
  product_id uuid not null,
  product_assignment_id uuid not null,
  mode text not null check(mode in ('GROWTH','AFFILIATE')),
  status text not null default 'DRAFT' check(status in ('DRAFT','GENERATING','READY','SELECTED','ARCHIVED','FAILED')),
  selected_angle_id uuid,
  selected_script_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,id),
  unique(owner_id,product_assignment_id),
  foreign key(owner_id,product_assignment_id,tiktok_account_id,product_id)
    references public.product_assignments(owner_id,id,tiktok_account_id,product_id) on delete cascade
);
create index creative_projects_owner_status_idx on public.creative_projects(owner_id,status,updated_at desc);
create index creative_projects_assignment_idx on public.creative_projects(owner_id,product_assignment_id);

create table public.creative_angles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  creative_project_id uuid not null,
  angle_type text not null check(angle_type in ('PROMOTION','PRICE_SHOCK','PROBLEM_SOLUTION','MUST_HAVE','REVIEW_DISCOVERY','POV','DEMONSTRATION','COMPARISON','URGENCY')),
  title text not null check(char_length(title) between 1 and 100),
  hook text not null check(char_length(hook) between 1 and 100),
  core_message text not null check(char_length(core_message) between 1 and 180),
  cta_strategy text not null check(char_length(cta_strategy) between 1 and 100),
  visual_strategy text not null check(char_length(visual_strategy) between 1 and 240),
  score numeric(7,4) not null check(score between 0 and 100),
  confidence numeric(5,4) not null check(confidence between 0 and 1),
  policy_status text not null check(policy_status in ('SAFE','REVIEW','REJECT')),
  score_explanation_json jsonb not null check(jsonb_typeof(score_explanation_json)='object'),
  is_selected boolean not null default false,
  created_at timestamptz not null default now(),
  unique(owner_id,id,creative_project_id),
  foreign key(owner_id,creative_project_id) references public.creative_projects(owner_id,id) on delete cascade
);
create index creative_angles_project_score_idx on public.creative_angles(owner_id,creative_project_id,score desc);

create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  creative_project_id uuid not null,
  creative_angle_id uuid not null,
  duration_seconds numeric(4,2) not null default 8 check(duration_seconds=8),
  hook_text text not null check(char_length(hook_text) between 1 and 100),
  voice_script text not null check(char_length(voice_script) between 1 and 180),
  overlay_text_json jsonb not null check(jsonb_typeof(overlay_text_json)='array'),
  scene_plan_json jsonb not null check(jsonb_typeof(scene_plan_json)='array'),
  cta_text text not null check(char_length(cta_text) between 1 and 100),
  caption text not null check(char_length(caption) between 1 and 300),
  hashtags_json jsonb not null check(jsonb_typeof(hashtags_json)='array'),
  language text not null default 'th',
  status text not null default 'DRAFT' check(status in ('DRAFT','SELECTED','EDITED','REJECTED')),
  version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,id,creative_project_id),
  unique(owner_id,creative_project_id,creative_angle_id),
  foreign key(owner_id,creative_project_id,creative_angle_id)
    references public.creative_angles(owner_id,creative_project_id,id) on delete cascade
);
create index scripts_project_status_idx on public.scripts(owner_id,creative_project_id,status,updated_at desc);

create table public.creative_generations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  creative_project_id uuid not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  input_tokens integer not null default 0 check(input_tokens>=0),
  output_tokens integer not null default 0 check(output_tokens>=0),
  estimated_cost numeric(12,6) not null default 0 check(estimated_cost>=0),
  raw_response_json jsonb,
  validated_output_json jsonb,
  status text not null check(status in ('SUCCEEDED','FAILED')),
  error text,
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  foreign key(owner_id,creative_project_id) references public.creative_projects(owner_id,id) on delete cascade
);
create index creative_generations_project_time_idx on public.creative_generations(owner_id,creative_project_id,created_at desc);

alter table public.creative_projects
  add foreign key(owner_id,id,selected_angle_id) references public.creative_angles(owner_id,creative_project_id,id),
  add foreign key(owner_id,id,selected_script_id) references public.scripts(owner_id,creative_project_id,id);
create trigger creative_projects_touch before update on public.creative_projects for each row execute function private.touch_updated_at();
create trigger scripts_touch before update on public.scripts for each row execute function private.touch_updated_at();

alter table public.creative_projects enable row level security;
alter table public.creative_angles enable row level security;
alter table public.scripts enable row level security;
alter table public.creative_generations enable row level security;
revoke all on public.creative_projects,public.creative_angles,public.scripts,public.creative_generations from public,anon,authenticated;
grant select,insert,update on public.creative_projects,public.creative_angles,public.scripts to authenticated;
grant select,insert on public.creative_generations to authenticated;
create policy creative_projects_read on public.creative_projects for select to authenticated using((select auth.uid())=owner_id);
create policy creative_projects_insert on public.creative_projects for insert to authenticated with check((select auth.uid())=owner_id);
create policy creative_projects_update on public.creative_projects for update to authenticated using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
create policy creative_angles_read on public.creative_angles for select to authenticated using((select auth.uid())=owner_id);
create policy creative_angles_insert on public.creative_angles for insert to authenticated with check((select auth.uid())=owner_id);
create policy creative_angles_update on public.creative_angles for update to authenticated using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
create policy scripts_read on public.scripts for select to authenticated using((select auth.uid())=owner_id);
create policy scripts_insert on public.scripts for insert to authenticated with check((select auth.uid())=owner_id);
create policy scripts_update on public.scripts for update to authenticated using((select auth.uid())=owner_id) with check((select auth.uid())=owner_id);
create policy creative_generations_read on public.creative_generations for select to authenticated using((select auth.uid())=owner_id);
create policy creative_generations_insert on public.creative_generations for insert to authenticated with check((select auth.uid())=owner_id);

create function public.save_creative_generation(p_project_id uuid,p_generation jsonb,p_angles jsonb,p_scripts jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare owner uuid:=auth.uid(); generation_id uuid;
begin
  if owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text||p_project_id::text,0));
  if not exists(select 1 from public.creative_projects where id=p_project_id and owner_id=owner)
    then raise exception 'Creative project not found' using errcode='42501'; end if;
  insert into public.creative_generations
    select * from jsonb_populate_record(null::public.creative_generations,p_generation)
    returning id into generation_id;
  insert into public.creative_angles
    select * from jsonb_populate_recordset(null::public.creative_angles,p_angles);
  insert into public.scripts
    select * from jsonb_populate_recordset(null::public.scripts,p_scripts);
  update public.creative_projects set status='READY' where id=p_project_id and owner_id=owner;
  return generation_id;
end $$;
revoke all on function public.save_creative_generation(uuid,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.save_creative_generation(uuid,jsonb,jsonb,jsonb) to authenticated;
comment on table public.creative_generations is 'Append-only provider and cost audit history for creative-brain-v1.';

