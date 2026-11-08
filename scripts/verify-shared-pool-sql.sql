-- Proof for the shared Google account pool (20261108180000_shared_flow_pool.sql) on a scratch PostgreSQL 15+:
-- psql -f scripts/verify-shared-pool-sql.sql (run from the repo root, in an empty database).
\set ON_ERROR_STOP 1
\set QUIET 1
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema private; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.profiles(id uuid primary key);
create table public.tiktok_accounts(id uuid primary key, owner_id uuid, unique(owner_id,id));
create table public.products(id uuid primary key, owner_id uuid, unique(owner_id,id));
\i supabase/migrations/20261028150000_flow_farm_semi_auto.sql
\i supabase/migrations/20261104120000_drama_studio.sql
\i supabase/migrations/20261104160000_drama_accounts.sql
\i supabase/migrations/20261104180000_drama_repair_accounts.sql
\i supabase/migrations/20261104200000_drama_review.sql
\i supabase/migrations/20261105190000_drama_takes.sql
\i supabase/migrations/20261108160000_product_link_clips.sql
\i supabase/migrations/20261108180000_shared_flow_pool.sql
\set O '''00000000-0000-4000-8000-000000000001'''
insert into profiles values (:O);
insert into tiktok_accounts values ('10000000-0000-4000-8000-000000000001',:O),('10000000-0000-4000-8000-000000000002',:O);
-- A belongs to channel 1, B to channel 2, R is a repair account (no channel).
insert into flow_accounts(id,owner_id,tiktok_account_id,label,purpose,priority) values
 ('20000000-0000-4000-8000-00000000000a',:O,'10000000-0000-4000-8000-000000000001','A','CLIP',1),
 ('20000000-0000-4000-8000-00000000000b',:O,'10000000-0000-4000-8000-000000000002','B','CLIP',1),
 ('20000000-0000-4000-8000-00000000000c',:O,null,'R','REPAIR',100);
create function pg_temp.claim(p_label text) returns text language sql as $$
  select coalesce((select title from public.claim_flow_clip('00000000-0000-4000-8000-000000000001',(select id from public.flow_accounts where label=p_label))), '-') $$;
create function pg_temp.expect(got text, want text, what text) returns void language plpgsql as $$
  begin if got is distinct from want then raise exception '% : got %, want %', what, got, want; end if; raise notice 'ok: %', what; end $$;
create function pg_temp.promo(p_title text, p_channel int) returns void language sql as $$
  insert into public.flow_clips(owner_id,tiktok_account_id,batch_id,kind,title,prompt,caption) values ('00000000-0000-4000-8000-000000000001',
   ('10000000-0000-4000-8000-00000000000'||p_channel)::uuid, gen_random_uuid(),'GROWTH',p_title,'p','c') $$;

-- 1. A promo clip of channel 1 can be made by channel 2's account and by the repair account (it used to wait for A).
select pg_temp.promo('promo-1', 1);
select pg_temp.expect(pg_temp.claim('B'), 'promo-1', 'channel 2 account makes channel 1 promo clip');
select pg_temp.promo('promo-2', 1);
select pg_temp.expect(pg_temp.claim('R'), 'promo-2', 'repair account makes promo clip');
-- 2. An account takes its own channel's clips first.
select pg_temp.promo('other-channel', 1); select pg_temp.promo('own-channel', 2);
select pg_temp.expect(pg_temp.claim('B'), 'own-channel', 'own channel first');
update flow_clips set status='DISCARDED' where status='QUEUED';
update flow_clips set status='FAILED' where status='GENERATING';

-- 3. A drama series due to start today (4 shots) keeps one account that can still make a whole episode.
insert into drama_series(id,owner_id,tiktok_account_id,genre,title,logline,total_episodes,shots_per_episode,bible)
 values ('30000000-0000-4000-8000-000000000001',:O,'10000000-0000-4000-8000-000000000001','HORROR','t','l',10,4,'{}');
select pg_temp.expect((select string_agg(label||':'||open_clip,',' order by label) from flow_pool_status(:O)), 'A:true,B:true,R:true', 'three full accounts, one episode due: all open');
update flow_accounts set clips_today=2, clips_today_on=(now() at time zone 'Asia/Bangkok')::date where label in ('A','B');
select pg_temp.expect((select string_agg(label||':'||left_today||':'||open_clip,',' order by label) from flow_pool_status(:O)), 'A:3:true,B:3:true,R:5:false', 'only R can make a whole episode: kept for drama');
select pg_temp.promo('promo-3', 1);
select pg_temp.expect(pg_temp.claim('R'), '-', 'R refuses promo while drama needs it');
select pg_temp.expect(pg_temp.claim('A'), 'promo-3', 'A (part used) makes the promo clip');

-- 4. Once the episode is on R, R keeps back the shots still to make and only lends the rest.
insert into drama_episodes(id,owner_id,series_id,number,phase,title,summary,caption,started_on)
 values ('40000000-0000-4000-8000-000000000001',:O,'30000000-0000-4000-8000-000000000001',1,'HOOK','t','s','c',(now() at time zone 'Asia/Bangkok')::date);
insert into drama_shots(owner_id,series_id,episode_id,position,prompt,reference_mode,status)
 select :O,'30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',g,'p','NONE','PLANNED' from generate_series(1,4) g;
select pg_temp.expect((select drama_waiting::text from flow_pool_status(:O) limit 1), '1', 'open episode with no account yet still waits');
insert into flow_clips(id,owner_id,tiktok_account_id,batch_id,kind,title,prompt,caption,required_flow_account_id) values
 ('50000000-0000-4000-8000-000000000001',:O,'10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','DRAMA_SHOT','shot-1','p','c','20000000-0000-4000-8000-00000000000c');
update drama_shots set status='QUEUED', flow_clip_id='50000000-0000-4000-8000-000000000001' where position=1;
select pg_temp.expect((select drama_reserved||':'||free_today||':'||open_clip from flow_pool_status(:O) where label='R'), '4:1:true', 'R keeps 4 shots, lends 1');
select pg_temp.promo('promo-4', 2);
select pg_temp.expect(pg_temp.claim('R'), 'shot-1', 'drama shot goes first');
select pg_temp.expect(pg_temp.claim('R'), 'promo-4', 'then R lends its spare credit');
update flow_accounts set clips_today=1, clips_today_on=(now() at time zone 'Asia/Bangkok')::date where label='R';
select pg_temp.promo('promo-5', 2);
select pg_temp.expect((select drama_reserved||':'||free_today||':'||open_clip from flow_pool_status(:O) where label='R'), '4:0:false', 'R has nothing spare');
select pg_temp.expect(pg_temp.claim('R'), '-', 'R refuses promo');
select pg_temp.expect(pg_temp.claim('B'), 'promo-5', 'B makes it');

-- 5. Skips: a promo clip is skipped only when every account is out today.
select pg_temp.promo('promo-6', 1);
update flow_accounts set exhausted_on=(now() at time zone 'Asia/Bangkok')::date where label in ('A','B');
select pg_temp.expect(skip_unreachable_flow_clips(:O,(now() at time zone 'Asia/Bangkok')::date)::text, '0', 'R still has credits: nothing skipped');
update flow_accounts set exhausted_on=(now() at time zone 'Asia/Bangkok')::date;
select pg_temp.expect((skip_unreachable_flow_clips(:O,(now() at time zone 'Asia/Bangkok')::date) >= 1)::text, 'true', 'all out: skipped');
-- 6. Only the service role may read the pool.
set role authenticated;
do $$ begin perform public.flow_pool_status('00000000-0000-4000-8000-000000000001'); raise exception 'should fail'; exception when insufficient_privilege then null; end $$;
reset role;
\echo shared pool proof passed
