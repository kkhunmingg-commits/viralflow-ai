-- Proof for the flow farm migration on a scratch PostgreSQL 15+: psql -f scripts/verify-flow-farm-sql.sql (run from the repo root).
\set ON_ERROR_STOP 1
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema private; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.profiles(id uuid primary key);
create table public.tiktok_accounts(id uuid primary key, owner_id uuid, unique(owner_id,id));
create table public.products(id uuid primary key, owner_id uuid, unique(owner_id,id));
\i supabase/migrations/20261028150000_flow_farm_semi_auto.sql
insert into profiles values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
insert into tiktok_accounts values ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
insert into flow_accounts(id,owner_id,tiktok_account_id,label) values ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','flow-1');
-- at most 5 Google accounts per TikTok account
insert into flow_accounts(owner_id,tiktok_account_id,label) select '00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','extra'||g from generate_series(1,4) g;
do $$ begin insert into flow_accounts(owner_id,tiktok_account_id,label) values ('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','sixth'); raise exception 'should fail'; exception when others then if sqlerrm not like '%FLOW_ACCOUNT_LIMIT_5%' then raise; end if; end $$;
delete from flow_accounts where label like 'extra%';
-- a clip of TikTok account 2 is never made by account 1's Google account
insert into flow_clips(owner_id,tiktok_account_id,batch_id,kind,title,prompt,caption,created_at) values ('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',gen_random_uuid(),'GROWTH','other','p','c',now()-interval '1 hour');
insert into flow_clips(owner_id,tiktok_account_id,batch_id,kind,title,prompt,caption) select '00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',gen_random_uuid(),'GROWTH','t'||g,'p','c' from generate_series(1,3) g;
select id is not null as claimed, status, flow_account_id from claim_flow_clip('00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
select count(*) filter (where status='GENERATING') gen, count(*) filter (where status='QUEUED') queued from flow_clips;
do $$ begin if exists(select 1 from flow_clips where title='other' and status<>'QUEUED') then raise exception 'claimed another account''s clip'; end if; end $$;
-- wrong owner's flow account is refused
do $$ begin perform claim_flow_clip('00000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001'); raise exception 'should fail'; exception when others then if sqlerrm not like '%FLOW_ACCOUNT_UNAVAILABLE%' then raise; end if; end $$;
-- READY requires a file
do $$ begin update flow_clips set status='READY' where status='GENERATING'; raise exception 'should fail'; exception when check_violation then null; end $$;
update flow_clips set status='READY', storage_path='owner/00000000-0000-4000-8000-000000000001/flow-clips/x.mp4', video_sha256=repeat('a',64) where status='GENERATING';
-- duplicate video refused
do $$ begin update flow_clips set status='READY', storage_path='owner/00000000-0000-4000-8000-000000000001/flow-clips/y.mp4', video_sha256=repeat('a',64) where id=(select id from flow_clips where status='QUEUED' limit 1); raise exception 'should fail'; exception when unique_violation then null; end $$;
-- another owner's path refused
do $$ begin update flow_clips set storage_path='owner/00000000-0000-4000-8000-000000000002/flow-clips/x.mp4' where status='READY'; raise exception 'should fail'; exception when check_violation then null; end $$;
-- RLS: owner sees own rows, other sees none; authenticated cannot call claim
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select count(*) as owner_sees from flow_clips;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
select count(*) as other_sees from flow_clips;
do $$ begin perform claim_flow_clip('00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'); raise exception 'should fail'; exception when insufficient_privilege then null; end $$;
do $$ begin update flow_clips set status='POSTED'; raise exception 'should fail'; exception when insufficient_privilege then null; end $$;
reset role;
-- posted rows drop the file
update flow_clips set status='POSTED', posted_at=now(), storage_path=null, file_deleted_at=now() where status='READY';
select status, storage_path is null as file_gone from flow_clips where status='POSTED';
-- out of credits: account 1's queue is skipped; account 2 (no Google account linked) waits for setup instead
update flow_accounts set exhausted_on=current_date;
select skip_unreachable_flow_clips('00000000-0000-4000-8000-000000000001', current_date) as skipped;
do $$ begin
  if exists(select 1 from flow_clips where tiktok_account_id='10000000-0000-4000-8000-000000000001' and status='QUEUED') then raise exception 'not skipped'; end if;
  if not exists(select 1 from flow_clips where title='other' and status='QUEUED') then raise exception 'unlinked account skipped'; end if;
end $$;
select 'ALL_SQL_CHECKS_PASSED';
