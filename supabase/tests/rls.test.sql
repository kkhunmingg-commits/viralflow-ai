begin;
select plan(12);

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'tiktok_accounts', 'tiktok_accounts exists');
select has_table('public', 'integrations', 'integrations exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.tiktok_accounts'::regclass),
  'tiktok_accounts has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.integrations'::regclass),
  'integrations has RLS enabled'
);

select policies_are(
  'public',
  'profiles',
  array['profiles_select_own', 'profiles_update_own'],
  'profiles has explicit owner policies'
);
select policies_are(
  'public',
  'tiktok_accounts',
  array[
    'tiktok_accounts_delete_own',
    'tiktok_accounts_insert_own',
    'tiktok_accounts_select_own',
    'tiktok_accounts_update_own'
  ],
  'accounts has CRUD owner policies'
);
select policies_are(
  'public',
  'integrations',
  array['integrations_select_own'],
  'integrations is read-only to its owner'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'select'),
  'anon cannot select profiles'
);
select ok(
  not has_table_privilege('anon', 'public.tiktok_accounts', 'select'),
  'anon cannot select accounts'
);
select ok(
  not has_table_privilege('authenticated', 'public.integrations', 'insert'),
  'clients cannot insert integration trust records'
);

select * from finish();
rollback;

