-- Additive; no existing tables, credentials, scheduler modes or rows change.
create table public.video_provider_settings (
 owner_id uuid primary key references public.profiles(id) on delete cascade,
 config jsonb not null default '{"mode":"AUTO","paidFallback":false,"maxCostUsd":0,"dailyBudgetUsd":0,"monthlyBudgetUsd":0,"retryLimit":2,"autoRecovery":false,"googleStatus":"ASSISTED","falModel":"fal-ai/ltx-2.3/image-to-video/fast"}',
 updated_at timestamptz not null default now()
);
create table public.video_provider_jobs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
 tiktok_account_id uuid not null, product_id uuid not null, creative_project_id uuid not null, selected_script_id uuid not null,
 generation_job_id uuid not null, master_video_id uuid,
 state text not null default 'QUEUED' check(state in ('QUEUED','WAITING_ASSISTED','WAITING_PROVIDER','RETRY_WAIT','PROCESSING','RECONCILIATION_REQUIRED','REVIEW_REQUIRED','COMPLETED','FAILED')),
 provider text check(provider in ('google_vids_omni','fal_ai')),
 submission_state text not null default 'NOT_SENT' check(submission_state in ('NOT_SENT','EXTERNAL_PENDING','SUBMITTING','ACCEPTED','CONFIRMED_FAILED')),
 provider_request_id text, checkpoint jsonb not null default '{}', decisions jsonb not null default '[]',
 retries integer not null default 0 check(retries between 0 and 3), next_retry_at timestamptz,
 lease_token uuid, lease_expires_at timestamptz, message text not null default '',
 check ((lease_token is null and lease_expires_at is null) or (lease_token is not null and lease_expires_at is not null)),
 estimated_cost_usd numeric not null default 0 check(estimated_cost_usd>=0), actual_cost_usd numeric check(actual_cost_usd>=0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,id), unique(owner_id,creative_project_id,selected_script_id),
 foreign key(owner_id,tiktok_account_id) references public.tiktok_accounts(owner_id,id),
 foreign key(owner_id,product_id) references public.products(owner_id,id),
 foreign key(owner_id,creative_project_id) references public.creative_projects(owner_id,id),
 foreign key(owner_id,selected_script_id) references public.scripts(owner_id,id),
 foreign key(owner_id,generation_job_id) references public.generation_jobs(owner_id,id),
 foreign key(owner_id,master_video_id) references public.master_videos(owner_id,id)
);
create unique index video_provider_account_lease on public.video_provider_jobs(owner_id,tiktok_account_id) where lease_token is not null;
create unique index video_provider_external_identity on public.video_provider_jobs(owner_id,provider,provider_request_id) where provider_request_id is not null;
create index video_provider_queue on public.video_provider_jobs(owner_id,state,next_retry_at,created_at);
alter table public.video_provider_settings enable row level security;
alter table public.video_provider_jobs enable row level security;
create policy video_provider_settings_read on public.video_provider_settings for select to authenticated using(owner_id=(select auth.uid()));
create policy video_provider_jobs_read on public.video_provider_jobs for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.video_provider_settings,public.video_provider_jobs from public,anon,authenticated;
grant select on public.video_provider_settings to authenticated;
grant select(id,owner_id,tiktok_account_id,product_id,creative_project_id,state,provider,message,retries,next_retry_at,estimated_cost_usd,actual_cost_usd,master_video_id,created_at,updated_at) on public.video_provider_jobs to authenticated;
grant all on public.video_provider_settings,public.video_provider_jobs to service_role;
create function public.claim_video_provider_job(p_owner_id uuid,p_job_id uuid,p_lease_token uuid)
returns public.video_provider_jobs language plpgsql security invoker set search_path='' as $$
declare v_row public.video_provider_jobs;
begin
 update public.video_provider_jobs set lease_token=null,lease_expires_at=null where owner_id=p_owner_id and lease_expires_at<now();
 update public.video_provider_jobs j set lease_token=p_lease_token,lease_expires_at=now()+interval '180 seconds'
 where j.owner_id=p_owner_id and j.id=p_job_id and j.state not in ('COMPLETED','FAILED','REVIEW_REQUIRED')
 and j.lease_token is null and (j.next_retry_at is null or j.next_retry_at<=now())
 and not exists(select 1 from public.video_provider_jobs x where x.owner_id=j.owner_id and x.tiktok_account_id=j.tiktok_account_id and x.lease_token is not null)
 returning j.* into v_row;
 return v_row;
exception when unique_violation then return null;
end $$;
revoke all on function public.claim_video_provider_job(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_video_provider_job(uuid,uuid,uuid) to service_role;
-- Owner-scoped aggregates, not a truncated client-side sum. Billing remains unknown until evidence exists.
create function public.video_provider_dashboard(p_owner_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with scoped as (
   select j.*,coalesce(r.budget_day,(j.created_at at time zone 'UTC')::date) as spend_day
   from public.video_provider_jobs j left join public.generation_budget_reservations r
     on r.owner_id=j.owner_id and r.id=nullif(j.checkpoint->>'holdId','')::uuid
   where j.owner_id=p_owner_id
 )
 select jsonb_build_object(
  'completed',count(*) filter(where state in ('COMPLETED','REVIEW_REQUIRED') and master_video_id is not null),
  'failed',count(*) filter(where state='FAILED'),
  'waiting',count(*) filter(where state not in ('COMPLETED','REVIEW_REQUIRED','FAILED')),
  'estimatedToday',coalesce(sum(estimated_cost_usd) filter(where provider='fal_ai' and submission_state in ('SUBMITTING','ACCEPTED','CONFIRMED_FAILED') and spend_day=(now() at time zone 'UTC')::date),0),
  'estimatedMonth',coalesce(sum(estimated_cost_usd) filter(where provider='fal_ai' and submission_state in ('SUBMITTING','ACCEPTED','CONFIRMED_FAILED') and spend_day>=date_trunc('month',now() at time zone 'UTC')::date),0),
  'actualToday',sum(actual_cost_usd) filter(where spend_day=(now() at time zone 'UTC')::date),
  'actualMonth',sum(actual_cost_usd) filter(where spend_day>=date_trunc('month',now() at time zone 'UTC')::date),
  'unbilledMonth',count(*) filter(where provider='fal_ai' and submission_state in ('SUBMITTING','ACCEPTED','CONFIRMED_FAILED') and actual_cost_usd is null and spend_day>=date_trunc('month',now() at time zone 'UTC')::date)
 ) from scoped
$$;
revoke all on function public.video_provider_dashboard(uuid) from public,anon,authenticated;
grant execute on function public.video_provider_dashboard(uuid) to service_role;
