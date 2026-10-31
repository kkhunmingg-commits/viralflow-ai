begin;
-- Create a temporary verified fixture owner through Auth Admin API and seed one
-- selected Creative Project / passing master before running. Never edit auth.users.
select set_config('test.owner',(select id::text from public.profiles order by created_at desc limit 1),true),
       set_config('test.other',gen_random_uuid()::text,true);
do $$begin if current_setting('test.owner',true) is null then raise exception 'Admin API fixture owner required';end if;end$$;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner'),'role','authenticated')::text,true);
do $$
declare a uuid;cp uuid;m uuid;n int;t text;
begin
 select id into a from public.tiktok_accounts where owner_id=current_setting('test.owner')::uuid limit 1;
 select id into cp from public.creative_projects where owner_id=current_setting('test.owner')::uuid limit 1;
 select id into m from public.master_videos where owner_id=current_setting('test.owner')::uuid limit 1;
 if a is null or cp is null or m is null then raise exception 'Phase 6 fixture required';end if;
 insert into public.content_compliance_checks(owner_id,video_id,creative_project_id,tiktok_account_id,claim_status,product_truth_status,aigc_status,policy_status,overall_status,issues_json,explanation_json)
 values(current_setting('test.owner')::uuid,m,cp,a,'PASS','PASS','DISCLOSE','PASS','PASS','[]','{}');
 insert into public.originality_checks(owner_id,video_id,tiktok_account_id,same_account_similarity,cross_account_similarity,hook_similarity,scene_similarity,audio_similarity,overall_similarity,originality_status,matched_video_ids_json)
 values(current_setting('test.owner')::uuid,m,a,0,0,.1,.1,.1,.1,'ORIGINAL','[]');
 insert into public.account_publish_health(owner_id,tiktok_account_id,requested_mode,effective_mode,account_status,authorization_status,daily_target,daily_hard_limit,internal_safety_limit,effective_publish_cap,posts_today,failed_posts_today,health_status,blockers_json)
 values(current_setting('test.owner')::uuid,a,'AUTO','GROWTH','READY','authorized',10,15,10,10,0,0,'READY','[]');
 insert into public.publish_eligibility_checks(owner_id,video_id,tiktok_account_id,compliance_pass,originality_pass,quality_pass,account_health_pass,creator_limit_pass,shop_permission_pass,user_approval_required,user_approved,final_status,blockers_json)
 values(current_setting('test.owner')::uuid,m,a,true,true,true,true,true,true,true,false,'READY_FOR_REVIEW','[]');
 foreach t in array array['content_compliance_checks','originality_checks','account_publish_health','publish_eligibility_checks'] loop execute format('select count(*) from public.%I',t) into n;if n<>1 then raise exception 'owner read failed for %',t;end if;end loop;
 foreach t in array array['content_compliance_checks','originality_checks','publish_eligibility_checks'] loop
   begin execute format('update public.%I set owner_id=owner_id',t);raise exception 'append-only update allowed on %',t;exception when insufficient_privilege then null;end;
   begin execute format('delete from public.%I',t);raise exception 'append-only delete allowed on %',t;exception when insufficient_privilege then null;end;
 end loop;
 update public.account_publish_health set posts_today=1 where tiktok_account_id=a;get diagnostics n=row_count;if n<>1 then raise exception 'owner health update failed';end if;
 perform set_config('request.jwt.claims',json_build_object('sub',current_setting('test.other'),'role','authenticated')::text,true);
 foreach t in array array['content_compliance_checks','originality_checks','account_publish_health','publish_eligibility_checks'] loop execute format('select count(*) from public.%I',t) into n;if n<>0 then raise exception 'cross-owner read leaked %',t;end if;end loop;
 update public.account_publish_health set posts_today=9 where tiktok_account_id=a;get diagnostics n=row_count;if n<>0 then raise exception 'cross-owner health update allowed';end if;
 begin insert into public.publish_eligibility_checks(owner_id,video_id,tiktok_account_id,compliance_pass,originality_pass,quality_pass,account_health_pass,creator_limit_pass,shop_permission_pass,user_approval_required,user_approved,final_status,blockers_json) values(current_setting('test.other')::uuid,m,a,true,true,true,true,true,true,true,false,'READY_FOR_REVIEW','[]');raise exception 'forged account association allowed';exception when foreign_key_violation then null;end;
end $$;
set local role anon;
do $$declare t text;n int;begin foreach t in array array['content_compliance_checks','originality_checks','account_publish_health','publish_eligibility_checks'] loop begin execute format('select count(*) from public.%I',t) into n;raise exception 'anonymous read allowed on %',t;exception when insufficient_privilege then null;end;end loop;end$$;
reset role;
select 'PASS: owner access, cross-owner/anonymous denial, immutable evidence, mutable owner health, forged-ID denial' as result;
rollback;
