-- Qualify pgcrypto under the empty search_path used by the atomic run RPC.
create or replace function public.create_auto_run_atomic(
  p_owner_id uuid,p_idempotency_key text,p_run_date date,p_video_provider text,
  p_provider_gate_reason text,p_plans jsonb
) returns public.auto_runs
language plpgsql security invoker set search_path='' as $$
declare v_run public.auto_runs; v_plan jsonb; v_account_count integer:=jsonb_array_length(p_plans); v_hash text;
begin
  if jsonb_typeof(p_plans)<>'array' then raise exception 'auto_plans_must_be_array'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  select * into v_run from public.auto_runs where owner_id=p_owner_id and idempotency_key=p_idempotency_key;
  if found then return v_run; end if;
  select * into v_run from public.auto_runs where owner_id=p_owner_id
    and state in ('STARTING','RUNNING','PAUSED','RETRY_PENDING') order by started_at desc limit 1 for update;
  if found then return v_run; end if;
  insert into public.auto_runs(owner_id,state,trigger_source,run_date,current_step,budget_usd,spent_usd,idempotency_key,started_at,metrics_json)
    values(p_owner_id,'RUNNING','MANUAL',p_run_date,'PLAN_ACCOUNTS',0,0,p_idempotency_key,now(),
      jsonb_build_object('externalCalls',0,'realPublishing',false,'paidProviders',false,'videoProvider',p_video_provider,'providerGateReason',p_provider_gate_reason))
    returning * into v_run;
  for v_plan in select value from jsonb_array_elements(p_plans) loop
    insert into public.auto_account_states(owner_id,auto_run_id,tiktok_account_id,requested_mode,effective_mode,state,current_step,next_action,blockers_json,desired_daily_candidates,desired_daily_posts,max_daily_cost_usd,generation_capacity,publish_capacity,priority)
      values(p_owner_id,v_run.id,(v_plan->>'accountId')::uuid,v_plan->>'requestedMode',v_plan->>'mode',v_plan->>'state','PLAN_ACCOUNTS',v_plan->>'nextAction',v_plan->'blockers',
        (v_plan->>'desiredCandidates')::integer,(v_plan->>'desiredPosts')::integer,(v_plan->>'maxDailyCostUsd')::numeric,
        (v_plan->>'generationCapacity')::integer,(v_plan->>'publishCapacity')::integer,(v_plan->>'priority')::integer);
    insert into public.auto_actions(owner_id,auto_run_id,tiktok_account_id,action_type,decision_source,status,payload_json,estimated_cost_usd,actual_cost_usd,idempotency_key)
      values(p_owner_id,v_run.id,(v_plan->>'accountId')::uuid,v_plan->>'nextAction',case when v_plan->>'mode'='GROWTH' then 'PHASE_9_GROWTH' else 'PHASE_8_WINNER' end,
        case when v_plan->>'state'='WAITING_FOR_APPROVAL' then 'WAITING_FOR_APPROVAL' when v_plan->>'state'='WAITING_FOR_SLOT' then 'WAITING_FOR_SLOT' when v_plan->>'state'='BLOCKED' then 'BLOCKED' else 'PLANNED' end,
        jsonb_build_object('mode',v_plan->>'mode','blockers',v_plan->'blockers','videoProvider',p_video_provider,'providerGateReason',p_provider_gate_reason),0,0,v_plan->>'actionKey');
  end loop;
  v_hash:=encode(extensions.digest(v_run.id::text||':PLAN_ACCOUNTS:'||jsonb_build_object('accountCount',v_account_count,'videoProvider',p_video_provider,'providerGateReason',p_provider_gate_reason)::text,'sha256'),'hex');
  insert into public.auto_run_steps(owner_id,auto_run_id,step,state,idempotency_key,started_at,completed_at,output_json)
    values(p_owner_id,v_run.id,'PLAN_ACCOUNTS','COMPLETED',p_idempotency_key||':PLAN_ACCOUNTS',now(),now(),jsonb_build_object('accountCount',v_account_count,'videoProvider',p_video_provider,'providerGateReason',p_provider_gate_reason));
  insert into public.auto_checkpoints(owner_id,auto_run_id,step,checkpoint_version,state_json,evidence_hash)
    values(p_owner_id,v_run.id,'PLAN_ACCOUNTS',1,jsonb_build_object('accountCount',v_account_count,'videoProvider',p_video_provider,'providerGateReason',p_provider_gate_reason),v_hash);
  return v_run;
end $$;


revoke all on function public.create_auto_run_atomic(uuid,text,date,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_auto_run_atomic(uuid,text,date,text,text,jsonb) to service_role;
