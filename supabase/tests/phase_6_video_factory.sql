begin;
-- Create a verified fixture owner through Supabase Auth Admin API and seed its
-- selected Creative Project before running. This test never writes auth.users.
select set_config('test.owner',(select id::text from public.profiles order by created_at desc limit 1),true),
       set_config('test.other',gen_random_uuid()::text,true);
do $$begin if current_setting('test.owner',true) is null then raise exception 'Admin API fixture owner required';end if;end$$;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner'),'role','authenticated')::text,true);
do $$
declare a uuid;p uuid;cp uuid;s uuid;j uuid;m uuid;n int;
begin
 select id into a from public.tiktok_accounts where owner_id=current_setting('test.owner')::uuid limit 1;
 select id into p from public.products where owner_id=current_setting('test.owner')::uuid limit 1;
 select id,selected_script_id into cp,s from public.creative_projects where owner_id=current_setting('test.owner')::uuid limit 1;
 if cp is null or s is null then raise exception 'Selected Creative Project fixture required';end if;
 insert into public.generation_jobs(owner_id,creative_project_id,idempotency_key,job_type,provider,model,status)
 values(current_setting('test.owner')::uuid,cp,'phase6-rls-master','MASTER_RENDER','local-ffmpeg','fixture','QUEUED') returning id into j;
 insert into public.master_videos(owner_id,tiktok_account_id,product_id,creative_project_id,selected_script_id,generation_job_id,provider,model,render_strategy,duration_seconds,width,height,fps,quality_score,quality_status,status)
 values(current_setting('test.owner')::uuid,a,p,cp,s,j,'local-ffmpeg','fixture','LOCAL_TEMPLATE',8,1080,1920,30,100,'PASS','READY') returning id into m;
 update public.generation_jobs set master_video_id=m,status='COMPLETED' where id=j;
 insert into public.media_assets(owner_id,product_id,creative_project_id,asset_type,source_type,storage_path,mime_type,width,height,duration_seconds,provider,model,checksum)
 values(current_setting('test.owner')::uuid,p,cp,'VIDEO','RENDERED','owner/'||current_setting('test.owner')||'/masters/'||m||'/test.mp4','video/mp4',1080,1920,8,'local-ffmpeg','fixture',repeat('a',64));
 insert into public.video_variations(owner_id,master_video_id,tiktok_account_id,product_id,creative_project_id,run_id,variation_index,variation_type,hook_variant,cta_variant,similarity_score,quality_score,quality_status,status)
 values(current_setting('test.owner')::uuid,m,a,p,cp,gen_random_uuid(),1,'HOOK','new hook','new cta',.5,100,'PASS','READY');
 insert into public.generation_costs(owner_id,generation_job_id,provider,model,quantity,unit,unit_cost_usd,total_cost_usd)
 values(current_setting('test.owner')::uuid,j,'local-ffmpeg','fixture',1,'RENDER',0,0);
 begin insert into public.generation_jobs(owner_id,idempotency_key,job_type,provider,model) values(current_setting('test.owner')::uuid,'phase6-rls-master','MASTER_RENDER','x','x');raise exception 'duplicate job accepted';exception when unique_violation then null;end;
 begin insert into public.master_videos(owner_id,tiktok_account_id,product_id,creative_project_id,selected_script_id,provider,model,render_strategy,duration_seconds,width,height,fps) values(current_setting('test.owner')::uuid,a,p,cp,s,'x','x','LOCAL_TEMPLATE',8,1080,1920,30);raise exception 'duplicate master accepted';exception when unique_violation then null;end;
 begin update public.generation_costs set total_cost_usd=99;raise exception 'cost history update allowed';exception when insufficient_privilege then null;end;
 begin delete from public.generation_costs;raise exception 'cost history delete allowed';exception when insufficient_privilege then null;end;
 insert into storage.objects(bucket_id,name,owner_id) values('video-assets','owner/'||current_setting('test.owner')||'/masters/'||m||'/rls.mp4',current_setting('test.owner'));
 perform set_config('request.jwt.claims',json_build_object('sub',current_setting('test.other'),'role','authenticated')::text,true);
 foreach n in array array[
   (select count(*)::int from public.media_assets),(select count(*)::int from public.master_videos),
   (select count(*)::int from public.video_variations),(select count(*)::int from public.generation_jobs),
   (select count(*)::int from public.generation_costs),(select count(*)::int from storage.objects where bucket_id='video-assets')
 ] loop if n<>0 then raise exception 'cross-owner data visible';end if;end loop;
 update public.master_videos set status='APPROVED' where id=m;get diagnostics n=row_count;if n<>0 then raise exception 'cross-owner update';end if;
 begin insert into storage.objects(bucket_id,name,owner_id) values('video-assets','owner/'||current_setting('test.owner')||'/forged.mp4',current_setting('test.other'));raise exception 'forged storage path accepted';exception when insufficient_privilege then null;end;
end $$;
set local role anon;
do $$declare n int;begin begin select count(*) into n from public.master_videos;raise exception 'anonymous read allowed';exception when insufficient_privilege then null;end;select count(*) into n from storage.objects where bucket_id='video-assets';if n<>0 then raise exception 'anonymous storage visible';end if;end$$;
reset role;
select 'PASS: Phase 6 owner lifecycle, cross-owner/anonymous denial, private storage, immutable costs, and retry keys' as result;
rollback;
