begin;
select set_config('test.owner_a',gen_random_uuid()::text,true),set_config('test.owner_b',gen_random_uuid()::text,true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select current_setting(k)::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',current_setting(k)||'@example.invalid','',now(),now(),now(),'{}','{}' from unnest(array['test.owner_a','test.owner_b']) k;
-- Reuse schema-shaped fixtures from existing owner-independent records only inside rollback.
insert into public.tiktok_accounts(owner_id,external_id,display_name,username,is_mock)
values(current_setting('test.owner_a')::uuid,'phase5-rls','RLS Account','phase5.rls',true);
insert into public.products(owner_id,external_provider,external_product_id,slug,title,category_key,current_price,original_price,commission_rate,commission_amount,rating,review_count,units_sold,status,currency,first_seen_at,last_seen_at)
values(current_setting('test.owner_a')::uuid,'mock','phase5-rls','phase5-rls','RLS Product','beauty',500,600,.1,50,4.5,100,100,'available','THB',now(),now());
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_a'),'role','authenticated')::text,true);
do $$ declare a uuid;p uuid;s uuid;x uuid;n integer;
begin
 select id into a from public.tiktok_accounts where owner_id=current_setting('test.owner_a')::uuid;
 select id into p from public.products where owner_id=current_setting('test.owner_a')::uuid;
 insert into public.account_product_scores(owner_id,tiktok_account_id,product_id,run_id,calculated_at,product_component,category_component,account_category_component,commercial_component,mode_fit_component,confidence_component,freshness_component,competition_component,account_product_fit_score,final_viral_opportunity_score,effective_mode,eligible,score_version,explanation_json)
 values(current_setting('test.owner_a')::uuid,a,p,gen_random_uuid(),now(),80,80,80,80,80,80,80,80,80,70,'GROWTH',true,'account-product-fit-v1','{}') returning id into s;
 insert into public.product_assignments(owner_id,tiktok_account_id,product_id,category_key,score_id,assignment_date,rank_for_account,effective_mode,final_score,status,score_version,reason_json)
 values(current_setting('test.owner_a')::uuid,a,p,'beauty',s,current_date,1,'GROWTH',70,'CANDIDATE','account-product-fit-v1','{}') returning id into x;
 select count(*) into n from public.account_product_scores;if n<>1 then raise exception 'Owner score read failed';end if;
 update public.product_assignments set status='SELECTED' where id=x;get diagnostics n=row_count;if n<>1 then raise exception 'Owner assignment update failed';end if;
 begin update public.account_product_scores set final_viral_opportunity_score=100;raise exception 'Score update allowed';exception when insufficient_privilege then null;end;
 begin delete from public.account_product_scores;raise exception 'Score delete allowed';exception when insufficient_privilege then null;end;
 begin update public.product_assignments set owner_id=current_setting('test.owner_b')::uuid where id=x;raise exception 'Owner reassignment allowed';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_b'),'role','authenticated')::text,true);
 select count(*) into n from public.account_product_scores;if n<>0 then raise exception 'Cross-owner score read';end if;
 select count(*) into n from public.product_assignments;if n<>0 then raise exception 'Cross-owner assignment read';end if;
 update public.product_assignments set status='USED' where id=x;get diagnostics n=row_count;if n<>0 then raise exception 'Cross-owner update';end if;
 begin insert into public.product_assignments(owner_id,tiktok_account_id,product_id,category_key,score_id,assignment_date,rank_for_account,effective_mode,final_score,status,score_version,reason_json)
 values(current_setting('test.owner_a')::uuid,a,p,'beauty',s,current_date+1,1,'GROWTH',70,'CANDIDATE','account-product-fit-v1','{}');raise exception 'Cross-owner assignment insert';exception when insufficient_privilege then null;end;
 begin insert into public.account_product_scores(owner_id,tiktok_account_id,product_id,run_id,calculated_at,product_component,category_component,account_category_component,commercial_component,mode_fit_component,confidence_component,freshness_component,competition_component,account_product_fit_score,final_viral_opportunity_score,effective_mode,eligible,score_version,explanation_json)
 values(current_setting('test.owner_a')::uuid,a,p,gen_random_uuid(),now(),80,80,80,80,80,80,80,80,80,70,'GROWTH',true,'account-product-fit-v1','{}');raise exception 'Cross-owner score insert';exception when insufficient_privilege then null;end;
 -- Forged references with caller owner must fail composite foreign keys as well.
 begin insert into public.account_product_scores(owner_id,tiktok_account_id,product_id,run_id,calculated_at,product_component,category_component,account_category_component,commercial_component,mode_fit_component,confidence_component,freshness_component,competition_component,account_product_fit_score,final_viral_opportunity_score,effective_mode,eligible,score_version,explanation_json)
 values(current_setting('test.owner_b')::uuid,a,p,gen_random_uuid(),now(),80,80,80,80,80,80,80,80,80,70,'GROWTH',true,'account-product-fit-v1','{}');raise exception 'Cross-owner account/product reference';exception when foreign_key_violation then null;end;
end $$;
set local role anon;
do $$ declare t text; begin foreach t in array array['account_product_scores','product_assignments'] loop
 begin execute format('select * from public.%I',t);raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;
 begin execute format('delete from public.%I',t);raise exception 'Anonymous delete allowed';exception when insufficient_privilege then null;end;
end loop;end $$;
reset role;
select 'PASS: owner read/write, immutable scores, cross-owner reads/writes and foreign references denied, anonymous denied' as result;
rollback;
