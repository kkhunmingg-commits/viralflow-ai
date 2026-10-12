import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {runWorkerPool} from '../src/features/multi-account/worker.ts';
import {MultiAccountPublishingScheduler,localDay} from '../src/features/multi-account/scheduler.ts';
import {accountAutomationSchema} from '../src/features/multi-account/contracts.ts';
import {runReadinessDay} from './readiness-day-simulation.mjs';
import {verifyGrowthManagerSql} from './growth-manager-sql-proof.mjs';
const {PGlite}=await import(pathToFileURL(process.argv[2]?.startsWith('--')?'node_modules/@electric-sql/pglite/dist/index.js':process.argv[2]??'node_modules/@electric-sql/pglite/dist/index.js').href);
const db=new PGlite(),owner=randomUUID(),other=randomUUID(),accountIds=Array.from({length:50},()=>randomUUID());
let checks=0;const ok=value=>{assert.ok(value);checks++;},denied=async sql=>{await assert.rejects(db.exec(sql));checks++;};
const started=performance.now(),timings=[];
try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;
 grant usage on schema public,auth,private to anon,authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key);insert into profiles values('${owner}'),('${other}');
 create table tiktok_accounts(id uuid primary key,owner_id uuid,display_name text,username text,account_status text default 'active',is_mock boolean default false,created_at timestamptz default now(),open_id text,hidden_at timestamptz,authorization_status text default 'authorized',audit_status text default 'UNAUDITED',token_expires_at timestamptz default now()+interval '1 day',refresh_token_expires_at timestamptz default now()+interval '1 month',unique(owner_id,id));
 create table video_provider_jobs(id uuid primary key,owner_id uuid,tiktok_account_id uuid,provider text,state text,checkpoint jsonb default '{}',actual_cost_usd numeric,created_at timestamptz default now(),updated_at timestamptz default now(),unique(owner_id,id));
 create table creative_projects(id uuid primary key,owner_id uuid,tiktok_account_id uuid,selected_script_id uuid,unique(owner_id,id));
 create table video_provider_settings(owner_id uuid primary key,config jsonb default '{}');
 create table master_videos(id uuid primary key,owner_id uuid,tiktok_account_id uuid,creative_project_id uuid,storage_path text,quality_status text,status text,created_at timestamptz default now());
 create table publishing_queue(id uuid primary key,owner_id uuid,tiktok_account_id uuid,video_id uuid,consent_id uuid,publish_mode text,privacy_level text,status text,external_state text,started_at timestamptz,completed_at timestamptz,unique(owner_id,id));
 create table account_publish_health(owner_id uuid,tiktok_account_id uuid,effective_publish_cap integer,observed_platform_cap integer);
 create table generation_budget_reservations(owner_id uuid,tiktok_account_id uuid,budget_day date,state text,reserved_usd numeric,actual_usd numeric);`);
 await db.exec('create table account_daily_stats(owner_id uuid,tiktok_account_id uuid,stat_date date,posts_published integer,views integer,likes integer,comments integer,shares integer)');
 await db.exec('create table publish_eligibility_checks(id uuid,owner_id uuid,video_id uuid,final_status text,created_at timestamptz default now())');
 await db.exec('create table video_analytics_snapshots(id uuid default gen_random_uuid(),owner_id uuid,tiktok_account_id uuid,external_video_id text,source text,source_confidence numeric,source_snapshot_at timestamptz,published_at timestamptz,views bigint,likes bigint,comments bigint,shares bigint)');
 const simulate=process.argv.includes('--simulate-day');
 if(simulate)await db.exec('create table private.audit_clock(at timestamptz);insert into private.audit_clock values(now());grant all on private.audit_clock to service_role;create function private.audit_now() returns timestamptz language sql stable as $$select at from private.audit_clock$$;grant execute on function private.audit_now() to service_role');
 if(simulate){const exec=db.exec.bind(db),query=db.query.bind(db),clock=sql=>sql.replace(/(?<![.\w])now\(\)/g,'private.audit_now()');db.exec=(sql,...args)=>exec(clock(sql),...args);db.query=(sql,...args)=>query(clock(sql),...args);}
 for(const path of ['supabase/migrations/20261012063500_multi_account_publishing_scheduler.sql','supabase/migrations/20261012082042_multi_account_readiness_guards.sql']){
   const sql=await readFile(path,'utf8');await db.exec(sql);checks++;
 }
 for(const [i,id] of accountIds.entries()) await db.exec(`insert into tiktok_accounts(id,owner_id,display_name,open_id)values('${id}','${owner}','Automated fixture ${i}','fixture-creator-${i}');insert into account_automation_settings(owner_id,tiktok_account_id)values('${owner}','${id}');insert into account_publish_health values('${owner}','${id}',2,2);`);
 await db.exec(`grant all on all tables in schema public to service_role;update account_automation_settings set config=jsonb_set(config,'{enabled}','true');`);
 const runtime=(await db.query('select * from multi_account_runtime')).rows[0];ok(runtime.enabled===false&&runtime.execution_mode==='SAFE'&&runtime.publishing_enabled===false);
 ok((await db.query('select to_jsonb(claim_multi_account_planner($1::uuid)) row',[randomUUID()])).rows[0].row===null);
 const scheduler=new MultiAccountPublishingScheduler();
 const recommendationCount=i=>i%7+2,totalJobs=accountIds.reduce((n,_,i)=>n+recommendationCount(i),0);
 for(const n of [1,3,10,20,50]) {
  const begin=performance.now(),accounts=accountIds.slice(0,n).map((id,i)=>({ownerId:owner,id,config:accountAutomationSchema.parse({enabled:true}),connected:true,hidden:false,ready:0,produced:0,published:0,publishCap:2,recommendation:{generation:recommendationCount(i),publishing:2,reason:'FIXTURE_OBSERVATIONS',confidence:1},scheduleSeed:id}));
  const plan=scheduler.plan(accounts,new Date());
  // Make generation immediately available; due times remain the real distributed 24h plan.
  const rows=plan.map(p=>({...p,availableAt:new Date(0).toISOString()}));
  await db.query('select plan_multi_account_work($1::jsonb)',[JSON.stringify(rows)]);
  await db.query('select plan_multi_account_work($1::jsonb)',[JSON.stringify(rows)]);
  const expected=accounts.reduce((sum,a)=>sum+a.recommendation.generation,0),count=(await db.query('select count(*)::int n from multi_account_work')).rows[0].n;ok(count===expected);
  timings.push({accounts:n,planned:expected,planAndTwoWritesMs:Math.round(performance.now()-begin)});
 }
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`);
 ok((await db.query('select id from multi_account_work')).rows.length===totalJobs);
 await denied('select lease_token from multi_account_work');await denied('select * from multi_account_runtime');await denied("update multi_account_work set state='COMPLETE'");
 await denied("update account_automation_settings set config='{}'");await denied("select claim_multi_account_work('GENERATE',gen_random_uuid())");
 await db.exec(`select set_config('request.jwt.claim.sub','${other}',false)`);ok((await db.query('select id from multi_account_work')).rows.length===0);ok((await db.query('select config from account_automation_settings')).rows.length===0);
 await db.exec('set role anon');await denied('select id from multi_account_work');await db.exec('reset role;set role service_role');
 await denied(`insert into account_automation_settings(owner_id,tiktok_account_id)values('${other}','${accountIds[0]}')`);
 // Actual SQL leases / CAS / expiry recovery, with distinct worker tokens.
 const first=(await db.query("select to_jsonb(claim_multi_account_work('GENERATE',$1::uuid)) row",[randomUUID()])).rows[0].row;
 const second=(await db.query("select to_jsonb(claim_multi_account_work('GENERATE',$1::uuid)) row",[randomUUID()])).rows[0].row;
 ok(first.id&&second.id&&first.tiktok_account_id!==second.tiktok_account_id);
 await db.query("update multi_account_work set lease_expires_at=now()-interval '1 second' where id=$1::uuid",[first.id]);
 const recovered=(await db.query("select to_jsonb(claim_multi_account_work('GENERATE',$1::uuid)) row",[randomUUID()])).rows[0].row;
 ok(recovered.id===first.id&&recovered.lease_token!==first.lease_token);
 ok((await db.query("select finish_multi_account_work($1::uuid,$2::uuid,$3::uuid,'COMPLETE','READY') done",[owner,first.id,first.lease_token])).rows[0].done===false);
 await db.exec("update multi_account_work set state='WAITING',lease_token=null,lease_expires_at=null");
 // Run the actual pooled worker implementation against the actual migration's claim and finish RPCs.
 const seen=new Set(),claimLatency=[];
 const store={claim:async(kind,token)=>{const begin=performance.now();const row=(await db.query('select to_jsonb(claim_multi_account_work($1,$2::uuid)) row',[kind,token])).rows[0].row;claimLatency.push(performance.now()-begin);return row?.id?row:null;},finish:async(work,out)=>(await db.query('select finish_multi_account_work($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::timestamptz) done',[work.owner_id,work.id,work.lease_token,out.state,out.reason,out.retryAt??null])).rows[0].done};
 let simulatedFailures=0;
 const ports={generate:async work=>{if(work.id===first.id&&work.attempts<4){simulatedFailures++;throw new Error('fixture failure');}ok(!seen.has(work.id));seen.add(work.id);return{state:'COMPLETE',reason:'FIXTURE_COMPLETE'};},publish:async()=>{throw new Error('No TikTok calls allowed');},reconcile:async()=>{throw new Error('No TikTok calls allowed');}};
 const poolBegin=performance.now();const pool=await runWorkerPool(store,ports,{kind:'GENERATE',token:randomUUID,batch:1000,concurrency:8});
 ok(pool.claimed===totalJobs);ok(seen.size===totalJobs-1&&simulatedFailures===1);
 await db.exec("update multi_account_work set available_at=now()-interval '1 second' where state='WAITING'");
 // New pool invocation models process restart: durable DB remains, no browser or in-memory job list survives.
 const resumed=await runWorkerPool(store,ports,{kind:'GENERATE',token:randomUUID,batch:1000,concurrency:8});ok(resumed.claimed===1&&seen.size===totalJobs);
 const empty=await runWorkerPool(store,ports,{kind:'GENERATE',token:randomUUID,batch:10,concurrency:2});ok(empty.claimed===0);
 const throughputMs=performance.now()-poolBegin;
 // Actual platform/app cap gate uses one shared transaction lock across owner accounts.
 const queueIds=[];
 for(const id of accountIds.slice(0,7)){const q=randomUUID();queueIds.push(q);await db.exec(`insert into publishing_queue(id,owner_id,tiktok_account_id,consent_id,publish_mode,privacy_level,status,external_state)values('${q}','${owner}','${id}',gen_random_uuid(),'DIRECT_POST','SELF_ONLY','APPROVED','READY');`);}
 const gate=q=>db.query('select reserve_multi_account_publish($1::uuid,$2::uuid) reason',[owner,q]).then(r=>r.rows[0].reason);
 ok(await gate(queueIds[0])==='SAFE_MODE');await db.exec("update multi_account_runtime set enabled=true,execution_mode='ENABLED',publishing_enabled=true");
 const plannerToken=randomUUID(),planner=(await db.query('select to_jsonb(claim_multi_account_planner($1::uuid)) row',[plannerToken])).rows[0].row;
 ok(planner.planner_token===plannerToken);ok((await db.query('select to_jsonb(claim_multi_account_planner($1::uuid)) row',[randomUUID()])).rows[0].row===null);
 await db.exec("update multi_account_runtime set planner_expires_at=now()-interval '1 second'");ok((await db.query('select to_jsonb(claim_multi_account_planner($1::uuid)) row',[randomUUID()])).rows[0].row.planner_token!==plannerToken);
 // Unlabelled daily aggregates never become production planning evidence.
 await db.exec(`insert into account_daily_stats values('${owner}','${accountIds[0]}',current_date-1,200,20000,200,0,0)`);
 ok(await gate(queueIds[0])==='FREQUENCY_DATA_REQUIRED');
 for(const id of accountIds) await db.query(`insert into video_analytics_snapshots(owner_id,tiktok_account_id,external_video_id,source,source_confidence,source_snapshot_at,published_at,views,likes,comments,shares) select $1::uuid,$2::uuid,'observed-'||n,'TIKTOK_DISPLAY',1,now(),now()-n*interval '1 day',100,10,1,1 from generate_series(1,3) n`,[owner,id]);
 const caps=await Promise.all(queueIds.map(gate));ok(caps.filter(c=>c==='READY').length===5);ok(caps.filter(c=>c==='APP_CAP').length===2);
 ok(await gate(queueIds[0])==='READY');ok((await db.query('select count(*)::int n from multi_account_publish_reservations')).rows[0].n===5);
 const extra=randomUUID();await db.exec(`insert into publishing_queue(id,owner_id,tiktok_account_id,consent_id,publish_mode,privacy_level,status,external_state)values('${extra}','${owner}','${accountIds[0]}',gen_random_uuid(),'DIRECT_POST','SELF_ONLY','APPROVED','READY')`);
 ok(await gate(extra)==='RATE_LIMIT');await db.exec("update multi_account_publish_reservations set reserved_at=now()-interval '2 minutes'");ok(await gate(extra)==='RATE_LIMIT');
 await db.exec("update multi_account_publish_reservations set reserved_at=now()-interval '7 hours'");ok(await gate(extra)==='READY');
 const over=randomUUID();await db.exec(`insert into publishing_queue(id,owner_id,tiktok_account_id,consent_id,publish_mode,privacy_level,status,external_state)values('${over}','${owner}','${accountIds[0]}',gen_random_uuid(),'DIRECT_POST','SELF_ONLY','APPROVED','READY')`);ok(await gate(over)==='RATE_LIMIT');await db.exec("update multi_account_publish_reservations set reserved_at=now()-interval '7 hours'");ok(await gate(over)==='PLATFORM_CAP');
 await db.exec(`update tiktok_accounts set audit_status='AUDITED' where id='${accountIds[6]}';update multi_account_runtime set app_audit_status='AUDITED'`);ok(await gate(queueIds[6])==='APP_CAP_UNKNOWN');
 await db.exec(`update tiktok_accounts set authorization_status='revoked',hidden_at=now() where id='${accountIds[0]}'`);
 ok((await db.query(`select (config->>'paused')::boolean paused from account_automation_settings where tiktok_account_id='${accountIds[0]}'`)).rows[0].paused===true);
 ok((await db.query(`select count(*)::int n from multi_account_work where tiktok_account_id='${accountIds[1]}' and state='COMPLETE'`)).rows[0].n===recommendationCount(1));
 ok(await gate(queueIds[0])==='TOKEN');
 const stats=(await db.query('select multi_account_overview($1::uuid) stats',[owner])).rows[0].stats;ok(stats.length===49&&stats.every(a=>a.produced===0&&a.ready===0&&a.published===0));
 const monitor=(await db.query('select multi_account_monitor() data')).rows[0].data;ok(monitor.googleAssistedCapacity===null&&monitor.billingUnconfirmed===0);
 const day=localDay(new Date(),'Asia/Bangkok'),seed=(await db.query('select multi_account_day_seed($1::uuid,$2::uuid,$3::date) seed',[owner,accountIds[1],day])).rows[0].seed;
 ok((await db.query('select multi_account_day_seed($1::uuid,$2::uuid,$3::date) seed',[owner,accountIds[1],day])).rows[0].seed===seed);
 const realHistory=(await db.query('select multi_account_frequency_evidence($1::uuid,$2::uuid) data',[owner,accountIds[1]])).rows[0].data.history;ok(realHistory.length===3&&realHistory.every(d=>d.posts===1));
 await db.query('update account_publish_health set observed_platform_cap=null where tiktok_account_id=$1::uuid',[accountIds[1]]);
 ok((await db.query('select multi_account_frequency_evidence($1::uuid,$2::uuid) data',[owner,accountIds[1]])).rows[0].data.publishCap===null);
 await db.query('update account_publish_health set observed_platform_cap=2 where tiktok_account_id=$1::uuid',[accountIds[1]]);
 const inventory=randomUUID();await db.query(`insert into master_videos(id,owner_id,tiktok_account_id,quality_status,status,storage_path) values($1::uuid,$2::uuid,$3::uuid,'PASS','READY','isolated/fixture.mp4')`,[inventory,owner,accountIds[1]]);
 await db.query(`insert into publish_eligibility_checks(id,owner_id,video_id,final_status)values(gen_random_uuid(),$2::uuid,$1::uuid,'READY_FOR_REVIEW')`,[inventory,owner]);
 await db.query('update publishing_queue set video_id=$1::uuid where id=$2::uuid',[inventory,queueIds[1]]);
 ok((await db.query('select multi_account_frequency_evidence($1::uuid,$2::uuid) data',[owner,accountIds[1]])).rows[0].data.ready===1);
 await db.query("update publishing_queue set status='PUBLISHED' where id=$1::uuid",[queueIds[1]]);
 ok((await db.query('select multi_account_frequency_evidence($1::uuid,$2::uuid) data',[owner,accountIds[1]])).rows[0].data.ready===0);
 // Same real video polled twice is one post. MOCK/future/stale evidence is excluded.
 await db.query(`insert into video_analytics_snapshots(owner_id,tiktok_account_id,external_video_id,source,source_confidence,source_snapshot_at,published_at,views) values($1::uuid,$2::uuid,'observed-1','TIKTOK_DISPLAY',1,now(),now()-interval '1 day',200),($1::uuid,$2::uuid,'fake','MOCK',1,now(),now()-interval '1 day',999999),($1::uuid,$2::uuid,'future','TIKTOK_DISPLAY',1,now()+interval '1 day',now()-interval '1 day',999999),($1::uuid,$2::uuid,'stale','TIKTOK_DISPLAY',1,now()-interval '8 days',now()-interval '1 day',999999)`,[owner,accountIds[1]]);
 ok((await db.query('select multi_account_frequency_evidence($1::uuid,$2::uuid) data',[owner,accountIds[1]])).rows[0].data.history.every(d=>d.posts===1&&d.views<999999));
 ok((await db.query('select multi_account_advice_inputs($1::uuid) data',[owner])).rows[0].data[accountIds[1]].history.every(d=>d.posts===1&&d.views<999999));
 await db.query(`update account_automation_settings set config=config||'{"spreadFullDay":false,"windows":[{"start":0,"end":1}]}' where tiktok_account_id=$1::uuid`,[accountIds[1]]);
 const windowQueue=randomUUID();await db.query(`insert into publishing_queue(id,owner_id,tiktok_account_id,consent_id,publish_mode,privacy_level,status) values($1::uuid,$2::uuid,$3::uuid,gen_random_uuid(),'DIRECT_POST','SELF_ONLY','APPROVED')`,[windowQueue,owner,accountIds[1]]);
 const localMinute=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Bangkok',hour:'2-digit',hourCycle:'h23'}).format(new Date()))*60+new Date().getUTCMinutes();
 if(localMinute!==0)ok(await gate(windowQueue)==='POSTING_WINDOW');
 const sorted=claimLatency.sort((a,b)=>a-b);
 const explain=await db.query("explain select id from multi_account_work where kind='GENERATE' and state='WAITING' and available_at<=now() order by available_at,due_at limit 20");
 const report={isolatedPostgres:'PASS',checks,accounts:50,tasks:totalJobs,simulation:'Variable per-account recommendations and mock generation outcomes, real SQL functions; one PGlite connection, not a cloud horizontal load certification',timings,claimP50Ms:Number(sorted[Math.floor(sorted.length*.5)].toFixed(2)),claimP95Ms:Number(sorted[Math.floor(sorted.length*.95)].toFixed(2)),mockTasksPerSecond:Number((totalJobs/(throughputMs/1000)).toFixed(2)),elapsedMs:Math.round(performance.now()-started),workerConcurrency:8,restart:'PASS',rls:'owner/cross-owner/anon/private columns/service-only mutations PASS',creatorCap:'5 unaudited; audited unknown blocks',perCreatorCap:'2 fixture cap respected',paidCalls:0,tiktokCalls:0,cloudStagingApplied:false,queryPlan:explain.rows};
 await mkdir('test-results/multi-account',{recursive:true});await writeFile('test-results/multi-account/sql-proof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(simulate)await runReadinessDay(db,owner,accountIds.slice(0,3));
 if(process.argv.includes('--growth-manager'))await verifyGrowthManagerSql(db,owner,other,accountIds);
} finally {await db.close();}
