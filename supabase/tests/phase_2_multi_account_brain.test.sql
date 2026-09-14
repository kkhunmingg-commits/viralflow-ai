begin;
select plan(18);

select has_table('public', 'account_daily_stats', 'daily stats table exists');
select has_table('public', 'account_category_affinity', 'category affinity table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.account_daily_stats'::regclass), 'daily stats RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.account_category_affinity'::regclass), 'category affinity RLS enabled');

select policies_are('public', 'account_daily_stats', array[
  'account_daily_stats_delete_own',
  'account_daily_stats_insert_own',
  'account_daily_stats_select_own',
  'account_daily_stats_update_own'
], 'daily stats has owner CRUD policies');
select policies_are('public', 'account_category_affinity', array[
  'account_category_affinity_delete_own',
  'account_category_affinity_insert_own',
  'account_category_affinity_select_own',
  'account_category_affinity_update_own'
], 'category affinity has owner CRUD policies');

select is(private.account_effective_mode('AUTO', 999, true, true), 'GROWTH', 'AUTO under 1000 is growth');
select is(private.account_effective_mode('AUTO', 1000, false, true), 'GROWTH', 'AUTO without ecommerce is growth');
select is(private.account_effective_mode('AUTO', 1000, true, false), 'GROWTH', 'AUTO without cart is growth');
select is(private.account_effective_mode('AUTO', 1000, null, true), 'GROWTH', 'unknown ecommerce is safely growth');
select is(private.account_effective_mode('AUTO', 1000, true, null), 'GROWTH', 'unknown cart is safely growth');
select is(private.account_effective_mode('AUTO', 1000, true, true), 'AFFILIATE', 'eligible AUTO is affiliate');
select is(private.account_effective_mode('GROWTH', 5000, true, true), 'GROWTH', 'manual growth wins');
select is(private.account_effective_mode('AFFILIATE', 20, false, false), 'AFFILIATE', 'manual affiliate wins');

select ok(not has_table_privilege('anon', 'public.account_daily_stats', 'select'), 'anon cannot read daily stats');
select ok(not has_table_privilege('anon', 'public.account_category_affinity', 'select'), 'anon cannot read category affinity');
select ok(has_table_privilege('authenticated', 'public.account_daily_stats', 'select'), 'authenticated role reaches daily stats subject to RLS');
select ok(has_table_privilege('authenticated', 'public.account_category_affinity', 'select'), 'authenticated role reaches affinity subject to RLS');

select * from finish();
rollback;
