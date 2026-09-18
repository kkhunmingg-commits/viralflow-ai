begin;
select plan(32);

select has_table('public','tiktok_shop_connections','Shop connections exist');
select has_table('public','creator_commerce_profiles','Creator commerce profiles exist');
select has_table('public','shop_products','Shop products exist');
select has_table('public','shop_product_snapshots','Shop product snapshots exist');
select has_table('public','shop_product_permissions','Shop product permissions exist');
select has_table('public','account_product_commerce_eligibility','Commerce eligibility evidence exists');
select has_table('public','shoppable_content_intents','Shoppable intent metadata exists');

select ok((select relrowsecurity from pg_class where oid='public.tiktok_shop_connections'::regclass),'connections RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.creator_commerce_profiles'::regclass),'profiles RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.shop_products'::regclass),'products RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.shop_product_snapshots'::regclass),'snapshots RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.shop_product_permissions'::regclass),'permissions RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.account_product_commerce_eligibility'::regclass),'eligibility RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.shoppable_content_intents'::regclass),'intents RLS enabled');

select policies_are('public','tiktok_shop_connections',array['shop_connections_owner_read'],'connections are owner readable');
select policies_are('public','creator_commerce_profiles',array['commerce_profiles_owner_read'],'profiles are owner readable');
select policies_are('public','shop_products',array['shop_products_owner_read'],'products are owner readable');
select policies_are('public','shop_product_snapshots',array['shop_snapshots_owner_read'],'snapshots are owner readable');
select policies_are('public','shop_product_permissions',array['shop_permissions_owner_read'],'permissions are owner readable');
select policies_are('public','account_product_commerce_eligibility',array['commerce_eligibility_owner_read'],'eligibility is owner readable');
select policies_are('public','shoppable_content_intents',array['shoppable_intents_owner_read'],'intents are owner readable');

select ok(not has_table_privilege('anon','public.shop_products','select'),'anonymous cannot read products');
select ok(not has_table_privilege('anon','public.shoppable_content_intents','select'),'anonymous cannot read intents');
select ok(has_table_privilege('authenticated','public.shop_products','select'),'authenticated owner can read through RLS');
select ok(not has_table_privilege('authenticated','public.shop_products','insert'),'browser cannot forge products');
select ok(not has_table_privilege('authenticated','public.shop_product_permissions','update'),'browser cannot forge permissions');
select ok(not has_table_privilege('authenticated','public.account_product_commerce_eligibility','insert'),'browser cannot forge eligibility');
select ok(not has_table_privilege('authenticated','public.shoppable_content_intents','insert'),'browser cannot forge intents');
select ok(has_table_privilege('service_role','public.shop_products','insert'),'server can synchronize products');
select ok(has_table_privilege('service_role','public.account_product_commerce_eligibility','insert'),'server can append eligibility');
select ok(not has_table_privilege('service_role','public.shop_product_snapshots','update'),'snapshot history is append-only');
select ok(not has_table_privilege('service_role','public.account_product_commerce_eligibility','update'),'eligibility history is append-only');

select * from finish();
rollback;
