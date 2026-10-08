-- Extend the existing ledger: one clip/job owns at most a primary and fallback
-- operation. Reserve both attempts against the same cumulative clip/job cap.
-- This file is local until explicitly applied by the deployment operator.

-- falPolicy contains server-attested fal spend caps. Owner reads remain available,
-- but client writes must not create/alter those snapshots or change their provider.
-- Restrictive policies also protect databases retaining the original owner write
-- policies; do not restore grants revoked by Phase 11F or alter non-fal behavior.
alter table public.generation_jobs enable row level security;
create policy fal_generation_jobs_server_insert on public.generation_jobs
  as restrictive for insert to authenticated with check(provider<>'fal');
create policy fal_generation_jobs_server_update on public.generation_jobs
  as restrictive for update to authenticated using(provider<>'fal') with check(provider<>'fal');
create policy fal_generation_jobs_server_delete on public.generation_jobs
  as restrictive for delete to authenticated using(provider<>'fal');

create index generation_budget_job_idx
  on public.generation_budget_reservations(owner_id,generation_job_id)
  where generation_job_id is not null;

create or replace function public.reserve_generation_budget(
  p_owner_id uuid,p_tiktok_account_id uuid,p_generation_job_id uuid,p_auto_run_id uuid,
  p_run_key text,p_logical_operation_key text,p_provider text,p_model text,p_reserved_usd numeric,
  p_per_video_cap_usd numeric,p_daily_cap_usd numeric,p_monthly_cap_usd numeric,
  p_run_cap_usd numeric,p_account_cap_usd numeric,p_provider_cap_usd numeric,
  p_budget_day date,p_budget_month date,p_ttl_seconds integer default 900
) returns public.generation_budget_reservations
language plpgsql security invoker set search_path='' as $$
declare
  v_row public.generation_budget_reservations;
  v_reopen boolean := false;
  v_day numeric; v_month numeric; v_run numeric; v_account numeric; v_provider numeric;
  v_job_cost numeric; v_job_cap numeric; v_slots integer;
begin
  if p_reserved_usd<=0 or p_ttl_seconds<60 or p_ttl_seconds>86400
    or least(p_per_video_cap_usd,p_daily_cap_usd,p_monthly_cap_usd,p_run_cap_usd,p_account_cap_usd,p_provider_cap_usd)<=0
    or p_budget_month<>date_trunc('month',p_budget_month)::date then raise exception 'invalid_budget_reservation'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  select * into v_row from public.generation_budget_reservations
    where owner_id=p_owner_id and logical_operation_key=p_logical_operation_key;
  if found then
    if v_row.generation_job_id is distinct from p_generation_job_id
      or v_row.tiktok_account_id is distinct from p_tiktok_account_id
      or v_row.auto_run_id is distinct from p_auto_run_id
      or v_row.run_key is distinct from p_run_key
      or v_row.provider is distinct from p_provider or v_row.model is distinct from p_model
      or v_row.reserved_usd is distinct from p_reserved_usd then
      raise exception 'budget_operation_identity_conflict';
    end if;
    if v_row.state not in ('RELEASED','EXPIRED') then return v_row; end if;
    if v_row.provider_request_id is not null then raise exception 'provider_charge_must_be_reconciled'; end if;
    -- A known pre-submit failure reuses its original logical slot, never a new one.
    v_reopen := true;
  end if;
  if p_reserved_usd>p_per_video_cap_usd then raise exception 'per_video_budget_exceeded'; end if;
  if p_generation_job_id is not null and p_provider='fal' then
    select count(*),coalesce(sum(case when state='SETTLED' then actual_usd
      when state='RESERVED' then reserved_usd else 0 end),0),
      least(p_per_video_cap_usd,coalesce(min(per_video_cap_usd),p_per_video_cap_usd))
      into v_slots,v_job_cost,v_job_cap
      from public.generation_budget_reservations
      where owner_id=p_owner_id and generation_job_id=p_generation_job_id and provider='fal';
    if not v_reopen and v_slots>=2 then raise exception 'paid_generation_attempt_limit_exceeded'; end if;
    if exists(select 1 from public.generation_budget_reservations
      where owner_id=p_owner_id and generation_job_id=p_generation_job_id
        and provider='fal' and logical_operation_key<>p_logical_operation_key and state='RESERVED') then
      raise exception 'paid_generation_previous_attempt_pending';
    end if;
    if v_job_cost+p_reserved_usd>v_job_cap then raise exception 'per_video_budget_exceeded'; end if;
  end if;
  select coalesce(sum(case when state='SETTLED' then actual_usd else reserved_usd end),0) into v_day
    from public.generation_budget_reservations where owner_id=p_owner_id and budget_day=p_budget_day and state in ('RESERVED','SETTLED');
  select coalesce(sum(case when state='SETTLED' then actual_usd else reserved_usd end),0) into v_month
    from public.generation_budget_reservations where owner_id=p_owner_id and budget_month=p_budget_month and state in ('RESERVED','SETTLED');
  select coalesce(sum(case when state='SETTLED' then actual_usd else reserved_usd end),0) into v_run
    from public.generation_budget_reservations where owner_id=p_owner_id and run_key=p_run_key and state in ('RESERVED','SETTLED');
  select coalesce(sum(case when state='SETTLED' then actual_usd else reserved_usd end),0) into v_account
    from public.generation_budget_reservations where owner_id=p_owner_id and tiktok_account_id=p_tiktok_account_id and budget_day=p_budget_day and state in ('RESERVED','SETTLED');
  select coalesce(sum(case when state='SETTLED' then actual_usd else reserved_usd end),0) into v_provider
    from public.generation_budget_reservations where owner_id=p_owner_id and provider=p_provider and budget_day=p_budget_day and state in ('RESERVED','SETTLED');
  if v_day+p_reserved_usd>p_daily_cap_usd then raise exception 'daily_budget_exceeded'; end if;
  if v_month+p_reserved_usd>p_monthly_cap_usd then raise exception 'monthly_budget_exceeded'; end if;
  if v_run+p_reserved_usd>p_run_cap_usd then raise exception 'run_budget_exceeded'; end if;
  if v_account+p_reserved_usd>p_account_cap_usd then raise exception 'account_budget_exceeded'; end if;
  if v_provider+p_reserved_usd>p_provider_cap_usd then raise exception 'provider_budget_exceeded'; end if;
  if v_reopen then
    update public.generation_budget_reservations set
      state='RESERVED',provider_submission_state='REQUEST_NOT_SENT',released_at=null,
      per_video_cap_usd=least(per_video_cap_usd,p_per_video_cap_usd),
      daily_cap_usd=p_daily_cap_usd,monthly_cap_usd=p_monthly_cap_usd,run_cap_usd=p_run_cap_usd,
      account_cap_usd=p_account_cap_usd,provider_cap_usd=p_provider_cap_usd,
      budget_day=p_budget_day,budget_month=p_budget_month,expires_at=now()+make_interval(secs=>p_ttl_seconds)
      where owner_id=p_owner_id and id=v_row.id returning * into v_row;
    return v_row;
  end if;
  insert into public.generation_budget_reservations(
    owner_id,tiktok_account_id,generation_job_id,auto_run_id,run_key,logical_operation_key,provider,model,
    reserved_usd,per_video_cap_usd,daily_cap_usd,monthly_cap_usd,run_cap_usd,account_cap_usd,provider_cap_usd,
    budget_day,budget_month,expires_at
  ) values (
    p_owner_id,p_tiktok_account_id,p_generation_job_id,p_auto_run_id,p_run_key,p_logical_operation_key,p_provider,p_model,
    p_reserved_usd,coalesce(v_job_cap,p_per_video_cap_usd),p_daily_cap_usd,p_monthly_cap_usd,p_run_cap_usd,p_account_cap_usd,p_provider_cap_usd,
    p_budget_day,p_budget_month,now()+make_interval(secs=>p_ttl_seconds)
  ) returning * into v_row;
  return v_row;
end $$;

create or replace function public.mark_generation_submitted(p_owner_id uuid,p_reservation_id uuid,p_provider_request_id text)
returns public.generation_budget_reservations language plpgsql security invoker set search_path='' as $$
declare v_row public.generation_budget_reservations;
begin
  if p_provider_request_id is null or btrim(p_provider_request_id)='' then raise exception 'budget_provider_request_invalid'; end if;
  update public.generation_budget_reservations set provider_submission_state='SUBMITTED',
    provider_request_id=coalesce(provider_request_id,p_provider_request_id)
    where owner_id=p_owner_id and id=p_reservation_id and state='RESERVED'
      and provider_submission_state in ('SUBMITTING','SUBMITTED_UNKNOWN','SUBMITTED')
      and (provider_request_id is null or provider_request_id=p_provider_request_id)
      returning * into v_row;
  if not found then raise exception 'budget_submission_state_conflict'; end if;
  return v_row;
end $$;

create or replace function public.mark_generation_unknown(p_owner_id uuid,p_reservation_id uuid,p_provider_request_id text default null)
returns public.generation_budget_reservations language plpgsql security invoker set search_path='' as $$
declare v_row public.generation_budget_reservations;
begin
  update public.generation_budget_reservations set provider_submission_state='SUBMITTED_UNKNOWN',
    provider_request_id=coalesce(provider_request_id,p_provider_request_id)
    where owner_id=p_owner_id and id=p_reservation_id and state='RESERVED'
      and provider_submission_state in ('SUBMITTING','SUBMITTED_UNKNOWN','SUBMITTED')
      and (provider_request_id is null or p_provider_request_id is null or provider_request_id=p_provider_request_id)
      returning * into v_row;
  if not found then raise exception 'budget_unknown_state_conflict'; end if;
  return v_row;
end $$;

create or replace function public.settle_generation_budget(
  p_owner_id uuid,p_reservation_id uuid,p_actual_usd numeric,p_provider_request_id text default null
) returns public.generation_budget_reservations
language plpgsql security invoker set search_path='' as $$
declare v_row public.generation_budget_reservations;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  select * into v_row from public.generation_budget_reservations where owner_id=p_owner_id and id=p_reservation_id for update;
  if not found then raise exception 'budget_reservation_not_found'; end if;
  if v_row.provider_request_id is not null and p_provider_request_id is not null
    and v_row.provider_request_id<>p_provider_request_id then raise exception 'budget_provider_request_conflict'; end if;
  if v_row.state='SETTLED' then
    if v_row.actual_usd is distinct from p_actual_usd then raise exception 'budget_settlement_amount_conflict'; end if;
    return v_row;
  end if;
  if v_row.state<>'RESERVED' or p_actual_usd is null or p_actual_usd<0 or p_actual_usd>v_row.reserved_usd then raise exception 'invalid_budget_settlement'; end if;
  update public.generation_budget_reservations set state='SETTLED',actual_usd=p_actual_usd,settled_at=now(),
    provider_submission_state='CONFIRMED',provider_request_id=coalesce(provider_request_id,p_provider_request_id)
    where owner_id=p_owner_id and id=p_reservation_id returning * into v_row;
  if v_row.generation_job_id is not null then
    insert into public.generation_costs(owner_id,generation_job_id,provider,model,quantity,unit,unit_cost_usd,total_cost_usd)
      values(v_row.owner_id,v_row.generation_job_id,v_row.provider,v_row.model,1,'VIDEO',p_actual_usd,p_actual_usd)
      on conflict(owner_id,generation_job_id,provider,model,unit) do update set
        quantity=public.generation_costs.quantity+excluded.quantity,
        total_cost_usd=public.generation_costs.total_cost_usd+excluded.total_cost_usd,
        unit_cost_usd=(public.generation_costs.total_cost_usd+excluded.total_cost_usd)
          /(public.generation_costs.quantity+excluded.quantity);
  end if;
  if v_row.auto_run_id is not null then
    update public.auto_runs set spent_usd=spent_usd+p_actual_usd
      where owner_id=p_owner_id and id=v_row.auto_run_id and spent_usd+p_actual_usd<=budget_usd;
    if not found then raise exception 'auto_run_budget_settlement_conflict'; end if;
  end if;
  return v_row;
end $$;

create or replace function public.release_generation_budget(
  p_owner_id uuid,p_reservation_id uuid,p_known_not_submitted boolean default false
) returns public.generation_budget_reservations
language plpgsql security invoker set search_path='' as $$
declare v_row public.generation_budget_reservations;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  select * into v_row from public.generation_budget_reservations where owner_id=p_owner_id and id=p_reservation_id for update;
  if not found then raise exception 'budget_reservation_not_found'; end if;
  if v_row.state in ('RELEASED','EXPIRED') then return v_row; end if;
  if v_row.state='SETTLED' then raise exception 'settled_budget_cannot_be_released'; end if;
  if v_row.provider_request_id is not null or
    (v_row.provider_submission_state<>'REQUEST_NOT_SENT' and
      (v_row.provider_submission_state<>'SUBMITTING' or not coalesce(p_known_not_submitted,false))) then
    raise exception 'provider_charge_must_be_reconciled';
  end if;
  update public.generation_budget_reservations set state='RELEASED',released_at=now(),provider_submission_state='FAILED'
    where owner_id=p_owner_id and id=p_reservation_id returning * into v_row;
  return v_row;
end $$;

-- Media can be downloaded concurrently during recovery. Only the current
-- attempt may publish its master/result; a late primary cannot replace fallback.
create or replace function public.persist_fal_master(
  p_owner_id uuid,p_job_id uuid,p_expected_attempt integer,p_master_payload jsonb,
  p_job_output jsonb,p_complete boolean
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_job public.generation_jobs;
  v_incoming public.master_videos;
  v_master public.master_videos;
  v_output jsonb;
  v_attempts jsonb;
begin
  select * into v_job from public.generation_jobs
    where owner_id=p_owner_id and id=p_job_id for update;
  if not found then raise exception 'fal_generation_job_not_found'; end if;
  v_incoming := jsonb_populate_record(null::public.master_videos,p_master_payload);
  if p_expected_attempt is null or p_expected_attempt not between 0 and 2
    or v_incoming.owner_id is distinct from p_owner_id
    or v_incoming.generation_job_id is distinct from p_job_id
    or v_incoming.creative_project_id is distinct from v_job.creative_project_id
    or v_incoming.provider is distinct from 'fal' then
    raise exception 'fal_master_persistence_input_invalid';
  end if;
  select * into v_master from public.master_videos
    where owner_id=p_owner_id and creative_project_id=v_incoming.creative_project_id;
  if v_job.attempt<>p_expected_attempt or v_job.status='CANCELLED'
    or (v_master.quality_status='PASS' and v_incoming.quality_status is distinct from 'PASS') then
    return jsonb_build_object('accepted',false,'master',case when v_master.id is null then null else to_jsonb(v_master) end);
  end if;
  insert into public.master_videos(
    id,owner_id,tiktok_account_id,product_id,creative_project_id,selected_script_id,generation_job_id,
    provider,model,render_strategy,duration_seconds,width,height,fps,storage_path,quality_score,
    quality_status,quality_explanation_json,estimated_cost_usd,status
  ) values (
    v_incoming.id,v_incoming.owner_id,v_incoming.tiktok_account_id,v_incoming.product_id,
    v_incoming.creative_project_id,v_incoming.selected_script_id,v_incoming.generation_job_id,
    v_incoming.provider,v_incoming.model,v_incoming.render_strategy,v_incoming.duration_seconds,
    v_incoming.width,v_incoming.height,v_incoming.fps,v_incoming.storage_path,v_incoming.quality_score,
    v_incoming.quality_status,coalesce(v_incoming.quality_explanation_json,'{}'::jsonb),
    coalesce(v_incoming.estimated_cost_usd,0),v_incoming.status
  ) on conflict(owner_id,creative_project_id) do update set
    tiktok_account_id=excluded.tiktok_account_id,product_id=excluded.product_id,
    selected_script_id=excluded.selected_script_id,generation_job_id=excluded.generation_job_id,
    provider=excluded.provider,model=excluded.model,render_strategy=excluded.render_strategy,
    duration_seconds=excluded.duration_seconds,width=excluded.width,height=excluded.height,fps=excluded.fps,
    storage_path=excluded.storage_path,quality_score=excluded.quality_score,quality_status=excluded.quality_status,
    quality_explanation_json=excluded.quality_explanation_json,estimated_cost_usd=excluded.estimated_cost_usd,
    status=excluded.status
    returning * into v_master;
  -- A result writes only its own attempt; keep all other durable attempt evidence.
  select coalesce(jsonb_agg(entry order by (entry->>'attempt')::integer),'[]'::jsonb) into v_attempts from (
    select distinct on (entry->>'attempt') entry from (
      select value as entry,0 as priority from jsonb_array_elements(coalesce(v_job.output_json->'attempts','[]'::jsonb))
      union all
      select value as entry,1 as priority from jsonb_array_elements(coalesce(p_job_output->'attempts','[]'::jsonb))
        where value->>'attempt'=p_expected_attempt::text
    ) entries where entry->>'attempt' in ('1','2')
    order by entry->>'attempt',priority desc
  ) unique_attempts;
  v_output := coalesce(v_job.output_json,'{}'::jsonb)||coalesce(p_job_output,'{}'::jsonb)
    ||jsonb_build_object('attempts',v_attempts,'masterId',v_master.id);
  update public.generation_jobs set master_video_id=v_master.id,model=v_master.model,output_json=v_output,
    status=case when p_complete then 'COMPLETED' else status end,
    completed_at=case when p_complete then now() else completed_at end
    where owner_id=p_owner_id and id=p_job_id;
  return jsonb_build_object('accepted',true,'master',to_jsonb(v_master));
end $$;

-- Read before reserving/submitting. Older databases lack this marker, so new
-- server code fails closed until all guards in this migration are committed.
create or replace function public.fal_budget_guard_version()
returns text language sql immutable security invoker set search_path='' as $$
  select 'fal-generation-budget-guards-v1'::text;
$$;

-- CREATE OR REPLACE preserves privileges; repeat the service-only grants explicitly.
grant select,insert,update on public.generation_costs,public.generation_jobs,public.master_videos to service_role;
revoke all on function public.reserve_generation_budget(uuid,uuid,uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,date,date,integer) from public,anon,authenticated;
revoke all on function public.mark_generation_submitted(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.mark_generation_unknown(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.settle_generation_budget(uuid,uuid,numeric,text) from public,anon,authenticated;
revoke all on function public.release_generation_budget(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.persist_fal_master(uuid,uuid,integer,jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.fal_budget_guard_version() from public,anon,authenticated;
grant execute on function public.reserve_generation_budget(uuid,uuid,uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,date,date,integer) to service_role;
grant execute on function public.mark_generation_submitted(uuid,uuid,text) to service_role;
grant execute on function public.mark_generation_unknown(uuid,uuid,text) to service_role;
grant execute on function public.settle_generation_budget(uuid,uuid,numeric,text) to service_role;
grant execute on function public.release_generation_budget(uuid,uuid,boolean) to service_role;
grant execute on function public.persist_fal_master(uuid,uuid,integer,jsonb,jsonb,boolean) to service_role;
grant execute on function public.fal_budget_guard_version() to service_role;
