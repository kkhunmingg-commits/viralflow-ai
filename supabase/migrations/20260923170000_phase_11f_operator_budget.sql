-- The operator's daily cap is installed in the same transaction as the run plan.
-- Existing Phase 11B idempotency and active-run lock remain the source of truth.
create or replace function public.create_operator_auto_run_atomic(
  p_owner_id uuid, p_idempotency_key text, p_run_date date, p_video_provider text,
  p_provider_gate_reason text, p_plans jsonb, p_budget_usd numeric
) returns public.auto_runs
language plpgsql security invoker set search_path='' as $$
declare v_run public.auto_runs; v_plan jsonb; v_limit numeric; v_hard_limit integer; v_effective_mode text;
begin
  if p_budget_usd is null or p_budget_usd < 0 or p_budget_usd > 1000
    or jsonb_typeof(p_plans) is distinct from 'array'
    or jsonb_array_length(p_plans) <> 1 then
    raise exception 'invalid_operator_selection';
  end if;
  v_plan := p_plans->0;
  select daily_video_budget_usd, daily_post_hard_limit, effective_mode
    into v_limit, v_hard_limit, v_effective_mode
    from public.tiktok_accounts
    where id=(v_plan->>'accountId')::uuid and owner_id=p_owner_id;
  if not found then raise exception 'account_not_found'; end if;
  if (v_plan->>'desiredPosts')::integer < 1
    or (v_plan->>'desiredPosts')::integer > v_hard_limit
    or (v_plan->>'maxDailyCostUsd')::numeric <> p_budget_usd
    or p_budget_usd > v_limit
    or (v_plan->>'requestedMode')='AFFILIATE' and v_effective_mode <> 'AFFILIATE' then
    raise exception 'operator_selection_exceeds_account_limits';
  end if;
  v_run := public.create_auto_run_atomic(
    p_owner_id, p_idempotency_key, p_run_date, p_video_provider,
    p_provider_gate_reason, p_plans
  );
  if v_run.idempotency_key = p_idempotency_key and v_run.budget_usd = 0 then
    update public.auto_runs set budget_usd=p_budget_usd
      where id=v_run.id and owner_id=p_owner_id and budget_usd=0
      returning * into v_run;
  end if;
  return v_run;
end $$;

revoke all on function public.create_operator_auto_run_atomic(uuid,text,date,text,text,jsonb,numeric)
  from public,anon,authenticated;
grant execute on function public.create_operator_auto_run_atomic(uuid,text,date,text,text,jsonb,numeric)
  to service_role;

-- Execution, cost, approval and compliance evidence are server-attested.
-- Authenticated owners retain owner-scoped reads; mutation happens only after
-- the server action authenticates and verifies ownership.
revoke insert,update,delete on public.media_assets,public.master_videos,
  public.video_variations,public.generation_jobs,public.generation_costs,
  public.content_compliance_checks,public.originality_checks,
  public.account_publish_health,public.publish_eligibility_checks
  from authenticated;

drop policy if exists media_assets_insert on public.media_assets;
drop policy if exists media_assets_update on public.media_assets;
drop policy if exists media_assets_delete on public.media_assets;
drop policy if exists master_videos_insert on public.master_videos;
drop policy if exists master_videos_update on public.master_videos;
drop policy if exists video_variations_insert on public.video_variations;
drop policy if exists video_variations_update on public.video_variations;
drop policy if exists generation_jobs_insert on public.generation_jobs;
drop policy if exists generation_jobs_update on public.generation_jobs;
drop policy if exists generation_costs_insert on public.generation_costs;
drop policy if exists content_compliance_insert on public.content_compliance_checks;
drop policy if exists originality_insert on public.originality_checks;
drop policy if exists publish_health_insert on public.account_publish_health;
drop policy if exists publish_health_update on public.account_publish_health;
drop policy if exists publish_eligibility_insert on public.publish_eligibility_checks;
drop policy if exists video_assets_insert on storage.objects;
drop policy if exists video_assets_update on storage.objects;
drop policy if exists video_assets_delete on storage.objects;

-- Account authorization and observed analytics must never be forged by a
-- publishable-key client. Server actions remain owner-scoped for mock edits.
revoke insert,update,delete on public.tiktok_accounts,public.account_daily_stats from authenticated;
drop policy if exists "tiktok_accounts_insert_own" on public.tiktok_accounts;
drop policy if exists "tiktok_accounts_update_own" on public.tiktok_accounts;
drop policy if exists "tiktok_accounts_delete_own" on public.tiktok_accounts;
drop policy if exists "account_daily_stats_insert_own" on public.account_daily_stats;
drop policy if exists "account_daily_stats_update_own" on public.account_daily_stats;
drop policy if exists "account_daily_stats_delete_own" on public.account_daily_stats;
