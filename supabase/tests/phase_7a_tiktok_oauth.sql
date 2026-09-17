begin;
select plan(14);

select has_table('public', 'tiktok_oauth_credentials', 'server token table exists');
select has_table('public', 'tiktok_oauth_states', 'server OAuth state table exists');
select ok((select relrowsecurity from pg_class where oid='public.tiktok_oauth_credentials'::regclass), 'token RLS enabled');
select ok((select relforcerowsecurity from pg_class where oid='public.tiktok_oauth_credentials'::regclass), 'token RLS forced');
select ok((select relrowsecurity from pg_class where oid='public.tiktok_oauth_states'::regclass), 'state RLS enabled');
select policies_are('public', 'tiktok_oauth_credentials', array[]::text[], 'token table has no browser policy');
select policies_are('public', 'tiktok_oauth_states', array[]::text[], 'state table has no browser policy');
select ok(not has_table_privilege('anon','public.tiktok_oauth_credentials','select'), 'anonymous cannot read tokens');
select ok(not has_table_privilege('authenticated','public.tiktok_oauth_credentials','select'), 'authenticated cannot read tokens');
select ok(not has_table_privilege('authenticated','public.tiktok_oauth_states','insert'), 'browser cannot mint OAuth state');
select ok(has_table_privilege('service_role','public.tiktok_oauth_credentials','select'), 'service role can read encrypted tokens');
select ok(not has_function_privilege('authenticated','public.consume_tiktok_oauth_state(text,uuid)','execute'), 'browser cannot consume state RPC');
select ok(has_function_privilege('service_role','public.consume_tiktok_oauth_state(text,uuid)','execute'), 'service role can consume state RPC');
select ok(
  exists(select 1 from pg_indexes where schemaname='public' and indexname='tiktok_accounts_open_id_unique_idx'),
  'open_id duplicate ownership conflict is database-enforced'
);

select * from finish();
rollback;
