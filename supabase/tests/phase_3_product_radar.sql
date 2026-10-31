-- Run as the migration owner. All test data is rolled back.
begin;
select set_config('test.owner_a',gen_random_uuid()::text,true),
 set_config('test.owner_b',gen_random_uuid()::text,true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select current_setting(key)::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 current_setting(key)||'@example.invalid','',now(),now(),now(),'{}','{}'
from unnest(array['test.owner_a','test.owner_b']) key;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_b'),'role','authenticated')::text,true);
do $$
declare
 s jsonb;
 payload jsonb := '{"external_product_id":"rls-product","title":"RLS fixture","category_key":"home","currency":"THB","price":500,"original_price":600,"commission_rate":0.15,"commission_amount":75,"rating":4.8,"review_count":200,"units_sold":100,"status":"available","competition":0.3,"creative_potential":0.8,"image_url":null,"product_url":null,"provider_metadata":{}}';
begin
 s := public.ingest_product_observation('mock','peer-event',now()-interval '1 hour',payload);
 perform set_config('test.peer_product',s->>'product_id',true);
 perform set_config('test.peer_snapshot',s->>'id',true);
 insert into public.product_scores(owner_id,product_id,snapshot_id,calculated_at,score_version,explanation_json,sales_velocity,sales_acceleration,price_attractiveness,commission_score,rating_score,review_confidence,competition_score,creative_potential_score,data_confidence,product_momentum_score,viral_opportunity_base_score) values(current_setting('test.owner_b')::uuid,(s->>'product_id')::uuid,(s->>'id')::uuid,now(),'test-v1','{}',10,0,50,50,50,.5,50,50,.5,50,50);
end $$;

select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.owner_a'),'role','authenticated')::text,true);
do $$
declare
 s jsonb; duplicate jsonb; n bigint; t text;
 payload jsonb := '{"external_product_id":"rls-product","title":"RLS fixture","category_key":"home","currency":"THB","price":500,"original_price":600,"commission_rate":0.15,"commission_amount":75,"rating":4.8,"review_count":200,"units_sold":100,"status":"available","competition":0.3,"creative_potential":0.8,"image_url":null,"product_url":null,"provider_metadata":{}}';
begin
 -- Owner can ingest through the same invoker RPC used by the application.
 s := public.ingest_product_observation('mock','owner-event',now()-interval '1 hour',payload);
 duplicate := public.ingest_product_observation('mock','owner-event',now()-interval '1 hour',payload);
 if s->>'id' <> duplicate->>'id' then raise exception 'Duplicate event created another snapshot'; end if;
 insert into public.product_scores(owner_id,product_id,snapshot_id,calculated_at,score_version,explanation_json,sales_velocity,sales_acceleration,price_attractiveness,commission_score,rating_score,review_confidence,competition_score,creative_potential_score,data_confidence,product_momentum_score,viral_opportunity_base_score) values(current_setting('test.owner_a')::uuid,(s->>'product_id')::uuid,(s->>'id')::uuid,now(),'test-v1','{}',10,0,50,50,50,.5,50,50,.5,50,50);
 foreach t in array array['products','product_snapshots','product_scores'] loop
   execute format('select count(*) from public.%I where owner_id=$1',t) into n using current_setting('test.owner_a')::uuid;
   if n<>1 then raise exception 'Owner read failed for %',t; end if;
   execute format('select count(*) from public.%I where owner_id=$1',t) into n using current_setting('test.owner_b')::uuid;
   if n<>0 then raise exception 'Cross-owner read leaked %',t; end if;
 end loop;
 -- Changed payload with the same identity cannot overwrite the prior observation.
 begin
   perform public.ingest_product_observation('mock','owner-event',now()-interval '1 hour',jsonb_set(payload,'{units_sold}','999'));
   raise exception 'TEST_FAIL duplicate event changed';
 exception when raise_exception then
   if sqlerrm <> 'Event identity reused with a different payload' then raise; end if;
 end;
 -- Out-of-order ingestion appends a historical row but does not regress current product facts.
 perform public.ingest_product_observation('mock','older-event',now()-interval '2 hours',jsonb_set(payload,'{units_sold}','80'));
 if (select units_sold from public.products where id=(s->>'product_id')::uuid) <> 100 then raise exception 'Out-of-order event regressed product'; end if;
 begin
   insert into public.products select gen_random_uuid(),current_setting('test.owner_b')::uuid,external_provider,'forged',title,slug,category_key,image_url,product_url,currency,current_price,original_price,commission_rate,commission_amount,rating,review_count,units_sold,status,provider_metadata,first_seen_at,last_seen_at,created_at,updated_at from public.products where id=(s->>'product_id')::uuid;
   raise exception 'Cross-owner product insert allowed';
 exception when insufficient_privilege then null;
 end;
 begin
   insert into public.product_snapshots(owner_id,product_id,captured_at,ingestion_event_id,price,commission_rate,commission_amount,review_count,units_sold,status,observation_json)
   values(current_setting('test.owner_b')::uuid,current_setting('test.peer_product')::uuid,now(),'forged',500,.1,50,0,0,'available','{}');
   raise exception 'Cross-owner snapshot insert allowed';
 exception when insufficient_privilege then null;
 end;
 begin
   insert into public.product_scores(owner_id,product_id,snapshot_id,calculated_at,score_version,explanation_json,sales_velocity,sales_acceleration,price_attractiveness,commission_score,rating_score,review_confidence,competition_score,creative_potential_score,data_confidence,product_momentum_score,viral_opportunity_base_score) values(current_setting('test.owner_b')::uuid,current_setting('test.peer_product')::uuid,current_setting('test.peer_snapshot')::uuid,now(),'forged','{}',10,0,50,50,50,.5,50,50,.5,50,50);
   raise exception 'Cross-owner score insert allowed';
 exception when insufficient_privilege then null;
 end;
 begin
   insert into public.product_snapshots(owner_id,product_id,captured_at,ingestion_event_id,price,commission_rate,commission_amount,review_count,units_sold,status,observation_json)
   values(current_setting('test.owner_a')::uuid,current_setting('test.peer_product')::uuid,now(),'forged-parent',500,.1,50,0,0,'available','{}');
   raise exception 'Cross-owner parent association allowed';
 exception when foreign_key_violation then null;
 end;
 begin
   update public.products set owner_id=current_setting('test.owner_b')::uuid where id=(s->>'product_id')::uuid;
   raise exception 'Owner reassignment allowed';
 exception when insufficient_privilege then null;
 end;
 update public.products set title='should not change' where owner_id=current_setting('test.owner_b')::uuid;
 get diagnostics n = row_count;
 if n<>0 then raise exception 'Cross-owner update allowed'; end if;
 foreach t in array array['product_snapshots','product_scores'] loop
   begin
     execute format('update public.%I set owner_id=owner_id',t);
     raise exception 'Append-only update allowed on %',t;
   exception when insufficient_privilege then null;
   end;
   begin
     execute format('delete from public.%I',t);
     raise exception 'Append-only delete allowed on %',t;
   exception when insufficient_privilege then null;
   end;
 end loop;
end $$;
set local role anon;
do $$
declare t text;
begin
 foreach t in array array['products','product_snapshots','product_scores'] loop
   begin
     execute format('select * from public.%I',t);
     raise exception 'Anonymous read allowed on %',t;
   exception when insufficient_privilege then null;
   end;
 end loop;
 if has_function_privilege('anon','public.ingest_product_observation(text,text,timestamptz,jsonb)','execute') then raise exception 'Anonymous ingestion allowed'; end if;
end $$;
reset role;
select 'PASS: owner reads/writes, cross-owner isolation, anonymous denial, append-only history, retry identity, out-of-order ingestion' as phase_3_verification;
rollback;
