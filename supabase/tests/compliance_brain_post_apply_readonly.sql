-- Read-only hosted verification. No customer payloads, identifiers or secrets.
select jsonb_build_object(
  'tables', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
    'rls',c.relrowsecurity,'anon_select',has_table_privilege('anon',c.oid,'SELECT'),
    'authenticated_insert',has_table_privilege('authenticated',c.oid,'INSERT'),
    'authenticated_update',has_table_privilege('authenticated',c.oid,'UPDATE'),
    'authenticated_delete',has_table_privilege('authenticated',c.oid,'DELETE')) order by n.nspname,c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relname like 'compliance_brain_%' and c.relkind='r'),
  'owner_read_policies', (select jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,
    'role',roles,'command',cmd,'owner_scoped',coalesce(qual like '%auth.uid()%owner_id%' or qual like '%owner_id%auth.uid()%',false)) order by tablename,policyname)
    from pg_policies where schemaname='public' and tablename like 'compliance_brain_%'),
  'functions', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
    'arguments',pg_get_function_identity_arguments(p.oid),'security_definer',p.prosecdef,
    'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
    'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE')) order by n.nspname,p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname like '%compliance_brain%' and p.prokind='f'),
  'decision_raw_columns_blocked', not has_column_privilege('authenticated','public.compliance_brain_decisions','reasons','SELECT')
    and not has_column_privilege('authenticated','public.compliance_brain_decisions','rewrites_json','SELECT'),
  'claim_policy_evidence_counts', jsonb_build_object(
    'policies',(select count(*) from public.compliance_brain_policy_versions),
    'active_policies',(select count(*) from public.compliance_brain_policy_versions where status='ACTIVE'),
    'claims',(select count(*) from public.compliance_brain_claims),
    'evidence',(select count(*) from public.compliance_brain_evidence)),
  'customer_counts', jsonb_build_object(
    'profiles',(select count(*) from public.profiles),'accounts',(select count(*) from public.tiktok_accounts),
    'products',(select count(*) from public.products),'auto_runs',(select count(*) from public.auto_runs)),
  'scheduler', (select jsonb_build_object('mode',execution_mode,'enabled',enabled,
    'last_success',last_successful_tick_at,'last_error',last_error_code) from private.post_scheduler_runtime where singleton),
  'cron', (select jsonb_build_object('active',active,'schedule',schedule,
    'uses_existing_safe_tick',lower(command)='select public.tick_post_account_automation();')
    from cron.job where jobname='viralflow-post-account-automation')
) as result;
