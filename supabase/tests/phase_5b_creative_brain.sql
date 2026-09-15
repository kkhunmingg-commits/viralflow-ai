begin;
-- Create the owner fixture with the supported Supabase Auth Admin API before running
-- this script. The test never writes to auth.users and rolls back all public data.
select set_config('test.owner_a',(select id::text from public.profiles order by created_at limit 1),true),
       set_config('test.owner_b',gen_random_uuid()::text,true);
do $$ begin
  if current_setting('test.owner_a',true) is null then
    raise exception 'Create a verified fixture user through Supabase Auth Admin API first';
  end if;
end $$;
insert into public.tiktok_accounts(owner_id,external_id,display_name,username,is_mock)
values(current_setting('test.owner_a')::uuid,'phase5b-rls','Creative RLS','creative.rls',true);
insert into public.products(owner_id,external_provider,external_product_id,slug,title,category_key,current_price,original_price,commission_rate,commission_amount,rating,review_count,units_sold,status,currency,first_seen_at,last_seen_at)
values(current_setting('test.owner_a')::uuid,'mock','phase5b-rls','phase5b-rls','Creative Product','beauty',500,600,.1,50,4.5,100,100,'available','THB',now(),now());
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_a'),'role','authenticated')::text,true);
do $$ declare a uuid;p uuid;score uuid;assignment uuid;project uuid;angle uuid;script uuid;generation uuid;n integer;
begin
 select id into a from public.tiktok_accounts where owner_id=current_setting('test.owner_a')::uuid;
 select id into p from public.products where owner_id=current_setting('test.owner_a')::uuid;
 insert into public.account_product_scores(owner_id,tiktok_account_id,product_id,run_id,calculated_at,product_component,category_component,account_category_component,commercial_component,mode_fit_component,confidence_component,freshness_component,competition_component,account_product_fit_score,final_viral_opportunity_score,effective_mode,eligible,score_version,explanation_json)
 values(current_setting('test.owner_a')::uuid,a,p,gen_random_uuid(),now(),80,80,80,80,80,80,80,80,80,70,'GROWTH',true,'account-product-fit-v1','{}') returning id into score;
 insert into public.product_assignments(owner_id,tiktok_account_id,product_id,category_key,score_id,assignment_date,rank_for_account,effective_mode,final_score,status,score_version,reason_json)
 values(current_setting('test.owner_a')::uuid,a,p,'beauty',score,current_date,1,'GROWTH',70,'CANDIDATE','account-product-fit-v1','{}') returning id into assignment;
 insert into public.creative_projects(owner_id,tiktok_account_id,product_id,product_assignment_id,mode)
 values(current_setting('test.owner_a')::uuid,a,p,assignment,'GROWTH') returning id into project;
 insert into public.creative_angles(owner_id,creative_project_id,angle_type,title,hook,core_message,cta_strategy,visual_strategy,score,confidence,policy_status,score_explanation_json)
 values(current_setting('test.owner_a')::uuid,project,'POV','POV','หยุดดู','สาธิตสินค้า','ติดตาม','ถ่ายแนวตั้ง',80,.8,'SAFE','{}') returning id into angle;
 insert into public.scripts(owner_id,creative_project_id,creative_angle_id,hook_text,voice_script,overlay_text_json,scene_plan_json,cta_text,caption,hashtags_json,version)
 values(current_setting('test.owner_a')::uuid,project,angle,'หยุดดู','หยุดดู สาธิตสินค้า ติดตาม','[]','[]','ติดตาม','แนวคิด','["#test","#creative"]','creative-concept-v1') returning id into script;
 insert into public.creative_generations(owner_id,creative_project_id,provider,model,prompt_version,status)
 values(current_setting('test.owner_a')::uuid,project,'mock','fixture','creative-brain-v1','SUCCEEDED') returning id into generation;
 update public.creative_projects set selected_angle_id=angle,selected_script_id=script,status='SELECTED' where id=project;
 select count(*) into n from public.creative_projects;if n<>1 then raise exception 'Owner project read failed';end if;
 select count(*) into n from public.creative_angles;if n<>1 then raise exception 'Owner angle read failed';end if;
 select count(*) into n from public.scripts;if n<>1 then raise exception 'Owner script read failed';end if;
 select count(*) into n from public.creative_generations;if n<>1 then raise exception 'Owner generation read failed';end if;
 begin update public.creative_generations set model='tampered';raise exception 'Generation update allowed';exception when insufficient_privilege then null;end;
 begin delete from public.creative_generations;raise exception 'Generation delete allowed';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_b'),'role','authenticated')::text,true);
 select count(*) into n from public.creative_projects;if n<>0 then raise exception 'Cross-owner project read';end if;
 select count(*) into n from public.creative_angles;if n<>0 then raise exception 'Cross-owner angle read';end if;
 select count(*) into n from public.scripts;if n<>0 then raise exception 'Cross-owner script read';end if;
 select count(*) into n from public.creative_generations;if n<>0 then raise exception 'Cross-owner generation read';end if;
 update public.scripts set caption='forged' where id=script;get diagnostics n=row_count;if n<>0 then raise exception 'Cross-owner script update';end if;
 begin insert into public.creative_projects(owner_id,tiktok_account_id,product_id,product_assignment_id,mode)
 values(current_setting('test.owner_a')::uuid,a,p,assignment,'GROWTH');raise exception 'Cross-owner insert';exception when insufficient_privilege then null;end;
 begin insert into public.creative_projects(owner_id,tiktok_account_id,product_id,product_assignment_id,mode)
 values(current_setting('test.owner_b')::uuid,a,p,assignment,'GROWTH');raise exception 'Forged references accepted';exception when foreign_key_violation then null;end;
end $$;
set local role anon;
do $$ declare t text;begin foreach t in array array['creative_projects','creative_angles','scripts','creative_generations'] loop
 begin execute format('select * from public.%I',t);raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;
 begin execute format('delete from public.%I',t);raise exception 'Anonymous delete allowed';exception when insufficient_privilege then null;end;
end loop;end $$;
reset role;
select 'PASS: Creative Brain owner lifecycle, immutable generations, cross-owner/forged/anonymous access denied' as result;
rollback;
