import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.argv[2]??'node_modules/@electric-sql/pglite/dist/index.js').href);
const db=new PGlite();let checks=0;
const {AtomicBudgetLedger}=await import('../src/features/video/budget-ledger.ts');
const owner=randomUUID(),other=randomUUID(),accounts=Array.from({length:3},()=>randomUUID()),jobs=Array.from({length:21},()=>randomUUID());
const ok=value=>{assert.ok(value);checks++;};
async function denied(sql){await assert.rejects(db.exec(sql));checks++;}
try{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema private;
    grant usage on schema public,auth,private to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function private.touch_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
    create table profiles(id uuid primary key);insert into profiles values('${owner}'),('${other}');
    create table auto_runs(id uuid primary key,owner_id uuid,spent_usd numeric,budget_usd numeric,unique(owner_id,id));
    create table generation_costs(owner_id uuid,generation_job_id uuid,provider text,model text,quantity numeric,unit text,unit_cost_usd numeric,total_cost_usd numeric,unique(owner_id,generation_job_id,provider,model,unit));`);
  for(const table of ['tiktok_accounts','products','creative_projects','scripts','generation_jobs','master_videos']){
    await db.exec(`create table ${table}(id uuid primary key,owner_id uuid,unique(owner_id,id));`);
    const ids=table==='tiktok_accounts'?accounts:jobs;
    for(const id of ids)await db.exec(`insert into ${table} values('${id}','${owner}');`);
  }
  const old=await readFile('supabase/migrations/20260923143000_phase_11b_exactly_once_atomic_budget.sql','utf8');
  await db.exec(old.slice(old.indexOf('create table public.generation_budget_reservations'),old.indexOf('create or replace function public.enqueue_publish_atomic')));
  await db.exec(old.slice(old.indexOf('create or replace function public.reserve_generation_budget'),old.indexOf('create or replace function public.recover_generation_budget_reservations')));
  await db.exec('grant all on all tables in schema public to service_role;grant execute on all functions in schema public to service_role;');
  await db.exec(await readFile('supabase/migrations/20261012050849_video_provider_router.sql','utf8'));checks++;
  await db.exec(await readFile('supabase/migrations/20261012155931_gemini_omni_provider.sql','utf8'));checks++;
  await db.exec(await readFile('supabase/migrations/20261013050032_fal_router_budget_readiness.sql','utf8'));checks++;
  for(let i=0;i<jobs.length;i++)await db.exec(`insert into video_provider_jobs(id,owner_id,tiktok_account_id,product_id,creative_project_id,selected_script_id,generation_job_id)values('${jobs[i]}','${owner}','${accounts[i%3]}','${jobs[i]}','${jobs[i]}','${jobs[i]}','${jobs[i]}');`);
  ok((await db.query('select count(*)::int as n from video_provider_jobs')).rows[0].n===21);
  await db.exec(`insert into video_provider_settings(owner_id)values('${owner}');set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`);
  ok((await db.query('select id,state from video_provider_jobs')).rows.length===21);
  ok((await db.query('select config from video_provider_settings')).rows[0].config.paidFallback===false);
  for(const field of ['checkpoint','provider_request_id','lease_token','decisions','*'])await denied(`select ${field} from video_provider_jobs`);
  await denied("update video_provider_settings set config='{}'");await denied("update video_provider_jobs set state='COMPLETED'");
  await denied(`select claim_video_provider_job('${owner}','${jobs[0]}',gen_random_uuid())`);
  await denied(`select video_provider_dashboard('${owner}')`);
  await denied('select gemini_video_guard_version()');
  await denied('select fal_budget_guard_version()');
  await db.exec(`select set_config('request.jwt.claim.sub','${other}',false);`);ok((await db.query('select id from video_provider_jobs')).rows.length===0);
  await db.exec('set role anon');await denied('select id from video_provider_jobs');await denied('select gemini_video_guard_version()');await denied('select fal_budget_guard_version()');
  await db.exec('reset role;set role service_role');
  ok((await db.query('select gemini_video_guard_version() as v')).rows[0].v==='gemini-omni-budget-v1');
  ok((await db.query('select fal_budget_guard_version() as v')).rows[0].v==='fal-generation-budget-guards-v1');
  await db.exec(`update video_provider_jobs set provider='gemini_omni_api',provider_request_id='same-gemini-request' where id='${jobs[5]}';`);
  await denied(`update video_provider_jobs set provider='gemini_omni_api',provider_request_id='same-gemini-request' where id='${jobs[6]}';`);
  await denied(`update video_provider_jobs set provider='untrusted-provider' where id='${jobs[6]}';`);
  await db.exec(`update video_provider_jobs set provider=null,provider_request_id=null where id='${jobs[5]}';`);
  await denied(`insert into video_provider_jobs(owner_id,tiktok_account_id,product_id,creative_project_id,selected_script_id,generation_job_id)values('${other}','${accounts[0]}','${jobs[0]}','${jobs[0]}','${jobs[0]}','${jobs[0]}')`);
  await denied(`insert into video_provider_jobs(owner_id,tiktok_account_id,product_id,creative_project_id,selected_script_id,generation_job_id)values('${owner}','${accounts[0]}','${jobs[0]}','${jobs[0]}','${jobs[0]}','${jobs[0]}')`);
  const token=randomUUID();
  ok((await db.query(`select (claim_video_provider_job('${owner}','${jobs[0]}','${token}')).id as id`)).rows[0].id===jobs[0]);
  const claims=await Promise.all([jobs[0],jobs[3]].map(id=>db.query(`select (claim_video_provider_job('${owner}','${id}',gen_random_uuid())).id as id`)));
  ok(claims.every(result=>result.rows[0].id===null));
  await db.exec(`update video_provider_jobs set provider='fal_ai',provider_request_id='same-external-request' where id='${jobs[0]}';`);
  await denied(`update video_provider_jobs set provider='fal_ai',provider_request_id='same-external-request' where id='${jobs[1]}';`);
  ok((await db.query(`select (claim_video_provider_job('${owner}','${jobs[1]}',gen_random_uuid())).id as id`)).rows[0].id===jobs[1]);
  ok((await db.query(`select (claim_video_provider_job('${other}','${jobs[2]}',gen_random_uuid())).id as id`)).rows[0].id===null);
  await db.exec(`update video_provider_jobs set lease_expires_at=now()-interval '1 minute' where id='${jobs[0]}';`);
  ok((await db.query(`select (claim_video_provider_job('${owner}','${jobs[3]}',gen_random_uuid())).id as id`)).rows[0].id===jobs[3]);
  ok((await db.query(`update video_provider_jobs set state='FAILED' where id='${jobs[0]}' and lease_token='${token}' returning id`)).rows.length===0);
  await db.exec(`update video_provider_jobs set state='REVIEW_REQUIRED',lease_token=null,lease_expires_at=null where id='${jobs[3]}';`);
  ok((await db.query(`select (claim_video_provider_job('${owner}','${jobs[3]}',gen_random_uuid())).id as id`)).rows[0].id===null);
  const reserve=(index,key)=>`select (reserve_generation_budget('${owner}','${accounts[index]}','${jobs[index]}',null,'test-run-0001','${key}','fal','tested-model',.3,.5,.8,2,.8,.8,.8,current_date,date_trunc('month',current_date)::date,900)).id as id`;
  const budget=await Promise.allSettled([0,1,2].map(index=>db.query(reserve(index,`operation-${index}`))));
  ok(budget.filter(result=>result.status==='fulfilled').length===2);ok(budget.filter(result=>result.status==='rejected').length===1);
  const hold=budget[0].value.rows[0].id;
  ok((await db.query(reserve(0,'operation-0'))).rows[0].id===hold);
  await db.query(`select begin_generation_submission('${owner}','${hold}')`);await denied(`select begin_generation_submission('${owner}','${hold}')`);
  await db.query(`select mark_generation_submitted('${owner}','${hold}','known-request')`);
  await db.query(`select settle_generation_budget('${owner}','${hold}',.2,'known-request')`);
  await db.query(`select settle_generation_budget('${owner}','${hold}',.2,'known-request')`);
  ok((await db.query('select count(*)::int as n from generation_costs')).rows[0].n===1);
  await db.exec(`update video_provider_jobs set provider='fal_ai',submission_state='ACCEPTED',estimated_cost_usd=.3 where id='${jobs[0]}';`);
  const stats=(await db.query(`select video_provider_dashboard('${owner}') as stats`)).rows[0].stats;
  ok(stats.actualMonth===null&&stats.unbilledMonth===1&&stats.estimatedMonth===.3);
  // Exercise the actual application ledger against real prepared SQL, not a mock version RPC.
  const localRpc={rpc:async(name,args={})=>{
    if(!['gemini_video_guard_version','fal_budget_guard_version','reserve_generation_budget','begin_generation_submission','mark_generation_submitted','mark_generation_unknown'].includes(name))throw new Error('unexpected proof RPC');
    const literal=value=>value==null?'null':typeof value==='number'?String(value):`'${String(value).replaceAll("'","''")}'`;
    const named=Object.entries(args).map(([key,value])=>{assert.match(key,/^p_[a-z_]+$/);return `${key}=>${literal(value)}`;}).join(',');
    try{const result=await db.query(`select * from public.${name}(${named})`);return{data:name.endsWith('_guard_version')?result.rows[0][name]:result.rows[0],error:null};}
    catch{return{data:null,error:{message:'isolated RPC failed'}};}
  }};
  const day=new Date().toISOString().slice(0,10),ledger=new AtomicBudgetLedger(localRpc),savedInfo=console.info;
  try{
    console.info=()=>{};
    const input={ownerId:owner,accountId:accounts[0],generationJobId:jobs[10],autoRunId:null,runKey:'gemini-proof',logicalOperationKey:'gemini-proof',provider:'gemini',model:'gemini-omni-1.1-flash',reservedUsd:2,perVideoCapUsd:3,dailyCapUsd:3,monthlyCapUsd:6,runCapUsd:3,accountCapUsd:3,providerCapUsd:3,budgetDay:day,budgetMonth:`${day.slice(0,7)}-01`};
    const hold=await ledger.reserve(input);ok(hold.state==='RESERVED');ok((await ledger.reserve(input)).id===hold.id);
    await assert.rejects(ledger.reserve({...input,logicalOperationKey:'gemini-over-budget',reservedUsd:2}));checks++;
    const falInput={...input,provider:'fal',model:'wan/v2.6/image-to-video/flash',runKey:'wan-proof',logicalOperationKey:'wan-proof',reservedUsd:.55,dailyCapUsd:5,monthlyCapUsd:10,accountCapUsd:5};
    const falHold=await ledger.reserve(falInput);ok(falHold.state==='RESERVED');ok((await ledger.reserve(falInput)).id===falHold.id);
    await ledger.begin(owner,falHold.id);await assert.rejects(ledger.begin(owner,falHold.id));checks++;
    await ledger.uncertain(owner,falHold.id,null);await assert.rejects(ledger.begin(owner,falHold.id));checks++;
    // The readiness marker itself must fail if a required atomic RPC is absent.
    await db.exec('reset role;alter function public.begin_generation_submission(uuid,uuid) rename to proof_missing_submission;set role service_role');
    await assert.rejects(ledger.reserve({...falInput,logicalOperationKey:'guard-missing-function'}));checks++;
    await db.exec('reset role;alter function public.proof_missing_submission(uuid,uuid) rename to begin_generation_submission;set role service_role');
  }finally{console.info=savedInfo;}
  console.log(JSON.stringify({isolatedPostgres:'PASS',checks,accounts:3,queuedJobs:21,scope:'additive migration/RLS/private columns/account lease/stale fencing/budget concurrency/idempotency/actual billing/aggregates',paidCalls:0,tiktokCalls:0,remoteMigrationApplied:false}));
}finally{await db.close();}
