-- Additive local migration only. Existing owner RLS, leases and SAFE Cron remain unchanged.
alter table public.video_provider_jobs drop constraint video_provider_jobs_provider_check;
alter table public.video_provider_jobs add constraint video_provider_jobs_provider_check
  check (provider in ('google_vids_omni','gemini_omni_api','fal_ai'));

create function public.gemini_video_guard_version() returns text
language sql stable security invoker set search_path = ''
as $$ select 'gemini-omni-budget-v1'::text $$;
revoke all on function public.gemini_video_guard_version() from public,anon,authenticated;
grant execute on function public.gemini_video_guard_version() to service_role;
