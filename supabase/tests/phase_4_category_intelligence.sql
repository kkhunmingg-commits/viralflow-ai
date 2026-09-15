-- Run as migration owner. All verification data is rolled back.
begin;
select set_config('test.owner_a',gen_random_uuid()::text,true),set_config('test.owner_b',gen_random_uuid()::text,true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select current_setting(key)::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',current_setting(key)||'@example.invalid','',now(),now(),now(),'{}','{}' from unnest(array['test.owner_a','test.owner_b']) key;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_b'),'role','authenticated')::text,true);
insert into public.categories(owner_id,category_key,display_name,provider,status,first_seen_at,last_seen_at)
values(current_setting('test.owner_b')::uuid,'peer-category','Peer','mock','active',now(),now());

select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_a'),'role','authenticated')::text,true);
do $$ declare c uuid;s uuid;n bigint;t text;
begin
 insert into public.categories(owner_id,category_key,display_name,provider,status,first_seen_at,last_seen_at)
 values(current_setting('test.owner_a')::uuid,'owner-category','Owner','mock','active',now(),now()) returning id into c;
 insert into public.category_snapshots(owner_id,category_id,captured_at,product_count,active_product_count,accelerating_product_count,rising_product_count,falling_product_count,median_product_momentum,mean_product_momentum,top_quartile_momentum,sales_delta,sales_velocity,sales_acceleration,average_commission_rate,median_commission_amount,competition_signal,saturation_signal,data_confidence)
 values(current_setting('test.owner_a')::uuid,c,now(),4,4,2,3,0,60,62,75,400,20,.4,.15,60,.3,.25,.8) returning id into s;
 insert into public.category_scores(owner_id,category_id,snapshot_id,calculated_at,product_momentum_component,acceleration_component,breadth_component,commercial_component,competition_component,saturation_component,confidence_component,category_momentum_score,commercial_opportunity_score,state,score_version,explanation_json)
 values(current_setting('test.owner_a')::uuid,c,s,now(),65,70,70,75,70,75,80,72,74,'HOT','category-momentum-v1','{}');
 foreach t in array array['categories','category_snapshots','category_scores'] loop execute format('select count(*) from public.%I',t) into n;if n<>1 then raise exception 'Owner isolation failed for %: %',t,n;end if;end loop;
 update public.categories set display_name='Updated' where id=c;get diagnostics n=row_count;if n<>1 then raise exception 'Owner category update failed';end if;
 update public.categories set display_name='forged' where owner_id=current_setting('test.owner_b')::uuid;get diagnostics n=row_count;if n<>0 then raise exception 'Cross-owner update allowed';end if;
 begin insert into public.categories(owner_id,category_key,display_name,provider,status,first_seen_at,last_seen_at) values(current_setting('test.owner_b')::uuid,'forged','Forged','mock','active',now(),now());raise exception 'Cross-owner insert allowed';exception when insufficient_privilege then null;end;
 begin insert into public.category_snapshots(owner_id,category_id,captured_at,product_count,active_product_count,accelerating_product_count,rising_product_count,falling_product_count,median_product_momentum,mean_product_momentum,top_quartile_momentum,sales_delta,sales_velocity,sales_acceleration,average_commission_rate,median_commission_amount,competition_signal,saturation_signal,data_confidence) values(current_setting('test.owner_b')::uuid,c,now(),0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);raise exception 'Cross-owner snapshot insert allowed';exception when insufficient_privilege then null;end;
 foreach t in array array['category_snapshots','category_scores'] loop begin execute format('update public.%I set owner_id=owner_id',t);raise exception 'Append-only update allowed on %',t;exception when insufficient_privilege then null;end;begin execute format('delete from public.%I',t);raise exception 'Append-only delete allowed on %',t;exception when insufficient_privilege then null;end;end loop;
end $$;
set local role anon;
do $$ declare t text;begin foreach t in array array['categories','category_snapshots','category_scores'] loop begin execute format('select * from public.%I',t);raise exception 'Anonymous read allowed on %',t;exception when insufficient_privilege then null;end;end loop;end $$;
reset role;
select 'PASS: owner CRUD for categories, owner read/append history, cross-owner and anonymous denial, immutable history' as phase_4_verification;
rollback;
