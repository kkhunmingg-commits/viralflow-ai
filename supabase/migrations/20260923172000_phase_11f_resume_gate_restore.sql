-- Resume preserves the account's original blockers instead of claiming work
-- is running. Stop closes every nonterminal account, including blocked ones.
create or replace function public.transition_auto_run_atomic(p_owner_id uuid,p_run_id uuid,p_action text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_previous text; v_next text;
begin
  if p_action not in ('PAUSE','RESUME','STOP') then raise exception 'invalid_auto_action'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  select state into v_previous from public.auto_runs where owner_id=p_owner_id and id=p_run_id for update;
  if not found then raise exception 'auto_run_not_found'; end if;
  v_next:=case
    when p_action='PAUSE' and v_previous in ('RUNNING','RETRY_PENDING','WAITING_FOR_DATA','WAITING_FOR_SLOT','WAITING_FOR_PROVIDER') then 'PAUSED'
    when p_action='RESUME' and v_previous='PAUSED' then 'RUNNING'
    when p_action='STOP' and v_previous not in ('COMPLETED','FAILED','STOPPED') then 'STOPPED'
    else v_previous end;
  if v_next<>v_previous then
    update public.auto_runs set state=v_next,current_step=p_action,
      paused_at=case when p_action='PAUSE' then now() when p_action='RESUME' then null else paused_at end,
      completed_at=case when p_action='STOP' then now() else completed_at end
      where owner_id=p_owner_id and id=p_run_id;
    update public.auto_account_states
    set state=case
      when p_action='STOP' then 'STOPPED'
      when p_action='PAUSE' then 'PAUSED'
      when blockers_json ? 'PROVIDER_UNAVAILABLE' then 'WAITING_FOR_PROVIDER'
      when blockers_json ? 'BUDGET_EXCEEDED' or blockers_json ? 'ACCOUNT_HEALTH' then 'BLOCKED'
      when blockers_json ? 'CONSENT' then 'WAITING_FOR_APPROVAL'
      when blockers_json ? 'PUBLISH_CAP' then 'WAITING_FOR_SLOT'
      when blockers_json ? 'ANALYTICS_STALE' then 'WAITING_FOR_DATA'
      when jsonb_array_length(blockers_json)>0 then 'BLOCKED'
      else 'RUNNING' end,
      current_step=p_action
    where owner_id=p_owner_id and auto_run_id=p_run_id
      and state not in ('COMPLETED','FAILED','STOPPED')
      and (p_action='STOP' or state<>'BLOCKED');
  end if;
  return jsonb_build_object('previous',v_previous,'state',v_next);
end $$;

revoke all on function public.transition_auto_run_atomic(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.transition_auto_run_atomic(uuid,uuid,text) to service_role;
