-- Existing fal execution already requires this guard. No runtime flags, rows or credentials change.
create function public.fal_budget_guard_version() returns text
language plpgsql stable security invoker set search_path='' as $$
begin
  if to_regprocedure('public.reserve_generation_budget(uuid,uuid,uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,date,date,integer)') is null
    or to_regprocedure('public.begin_generation_submission(uuid,uuid)') is null
    or to_regprocedure('public.mark_generation_submitted(uuid,uuid,text)') is null
    or to_regprocedure('public.mark_generation_unknown(uuid,uuid,text)') is null
    or to_regprocedure('public.settle_generation_budget(uuid,uuid,numeric,text)') is null
    or to_regprocedure('public.release_generation_budget(uuid,uuid,boolean)') is null then
    raise exception 'fal_budget_guard_not_ready';
  end if;
  return 'fal-generation-budget-guards-v1';
end $$;
revoke all on function public.fal_budget_guard_version() from public,anon,authenticated;
grant execute on function public.fal_budget_guard_version() to service_role;
