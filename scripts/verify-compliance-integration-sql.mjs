// Applies Compliance Brain only after the full existing project schema contains
// ten-account scheduling fixtures. No environment files or remote connection.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { baseline } from './verify-post-multi-account-sql.mjs';
import { runProof } from './post-multi-account-sql-cases.mjs';
import { runCronProof } from './post-cron-sql-cases.mjs';

const migration='20261008121446_compliance_brain_foundation.sql';
const falMigration='20261008122111_fal_generation_budget_guards.sql';
const db=await PGlite.create();
let checks=0;
const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
try {
  const earlierMigrations=await baseline(db,{excludeMigrations:[migration,falMigration]});
  await db.query('select public.tick_post_account_automation()');
  const accountCases=await runProof(db,assert);
  const schedulerCases=await runCronProof(db,assert,accountCases);
  const owner='10000000-0000-4000-8000-000000000001';
  const other='10000000-0000-4000-8000-000000000002';
  const product=randomUUID();
  await db.query(`insert into public.products(id,owner_id,external_provider,external_product_id,title,slug,category_key,
    current_price,commission_rate,commission_amount,review_count,units_sold,status,first_seen_at,last_seen_at)
    values($1,$2,'internal-proof','compat-product','Original product before migration','compat-product','skincare',
      150,0.1,15,5,50,'available',now(),now())`,[product,owner]);
  const oldJob=randomUUID();
  const account='20000000-0000-4000-8000-000000000001';
  await db.query(`insert into public.generation_jobs(id,owner_id,idempotency_key,job_type,provider,model)
    values($1,$2,'isolated-legacy-fal-job','MASTER_RENDER','fal','legacy-fixture')`,[oldJob,owner]);
  await db.query(`select public.reserve_generation_budget($1::uuid,$2::uuid,$3::uuid,null::uuid,
    'isolated-legacy-run','isolated-legacy-operation','fal','legacy-fixture',0.12,0.25,3,30,3,3,3,
    current_date,date_trunc('month',current_date)::date,900)`,[owner,account,oldJob]);
  const legacyData=async()=>({jobs:await q('select to_jsonb(j) as row from public.generation_jobs j order by id'),
    reservations:await q('select to_jsonb(r) as row from public.generation_budget_reservations r order by id'),
    cron:await q('select * from cron.job order by jobid'),
    productionClaim:await q("select pg_get_functiondef('private.claim_auto_execution_step_v11f(uuid,uuid,uuid,text,integer,boolean)'::regprocedure) as definition")});
  const beforeFal=await legacyData();
  await db.exec(await readFile(`supabase/migrations/${falMigration}`,'utf8'));
  equal(await legacyData(),beforeFal,'fal migration preserves existing jobs, reserved liability, scheduler and production claim');
  equal((await q('select public.fal_budget_guard_version() as version'))[0].version,'fal-generation-budget-guards-v1','fal guard handshake exists');

  const tableNames=(await q(`select n.nspname||'.'||c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind='r' order by name`)).map(row=>row.name);
  const snapshot=async()=>{
    const rows={};
    for(const name of tableNames) rows[name]=await q(`select to_jsonb(t) as row from ${name} t order by to_jsonb(t)::text`);
    const schema=await q(`select table_schema,table_name,column_name,data_type,is_nullable,column_default
      from information_schema.columns where table_schema in ('public','private') and table_name not like 'compliance_brain_%'
      order by table_schema,table_name,ordinal_position`);
    const functions=await q(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,
      pg_get_functiondef(p.oid) definition,p.proacl::text grants from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.proname not like '%compliance_brain%' and p.prokind='f'
      order by n.nspname,p.proname,args`);
    const policies=await q(`select * from pg_policies where schemaname in ('public','private') and tablename not like 'compliance_brain_%'
      order by schemaname,tablename,policyname`);
    const constraints=await q(`select n.nspname,t.relname,c.conname,pg_get_constraintdef(c.oid) definition
      from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
      where n.nspname in ('public','private') and t.relname not like 'compliance_brain_%' order by n.nspname,t.relname,c.conname`);
    const privileges=await q(`select table_schema,table_name,grantee,privilege_type from information_schema.role_table_grants
      where table_schema in ('public','private') and table_name not like 'compliance_brain_%'
      order by table_schema,table_name,grantee,privilege_type`);
    const indexes=await q(`select schemaname,tablename,indexname,indexdef from pg_indexes
      where schemaname in ('public','private') and tablename not like 'compliance_brain_%' order by schemaname,tablename,indexname`);
    const cron=await q('select * from cron.job order by jobid');
    return {rows,schema,functions,policies,constraints,privileges,indexes,cron};
  };
  const before=await snapshot();
  await db.exec(await readFile(`supabase/migrations/${migration}`,'utf8'));
  const after=await snapshot();
  for(const key of Object.keys(before)) equal(after[key],before[key],`preserves existing ${key}`);
  equal((await q('select public.get_post_automation_execution_mode() as mode'))[0].mode,'SAFE','SAFE survives apply');
  equal((await q('select count(*)::int n from public.compliance_brain_policy_versions'))[0].n,0,'no active policy invented');
  equal((await q('select count(*)::int n from public.compliance_brain_claims'))[0].n,0,'product description not verified claim');
  equal((await q(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relname like 'compliance_brain_%' and c.relkind='r' and c.relrowsecurity`))[0].n,8,'all eight new tables enable RLS');

  await db.exec('set role service_role');
  const evidence=randomUUID();
  await db.query(`insert into public.compliance_brain_evidence(id,owner_id,product_id,kind,source_url,source_hash,jurisdiction,verified)
    values($1,$2,$3,'PRODUCT_LABEL','fixture-label','${'a'.repeat(64)}','TH',true)`,[evidence,owner,product]);
  await db.query(`insert into public.compliance_brain_claims(owner_id,product_id,claim_text,claim_type,source,evidence_refs,jurisdiction,verified,allowed_channels)
    values($1,$2,'ช่วยเพิ่มความชุ่มชื้น','COSMETIC','fixture label',array[$3::uuid],'TH',true,array['POST','LIVE'])`,[owner,product,evidence]);
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await db.exec('set role authenticated');
  equal((await q('select count(*)::int n from public.compliance_brain_claims'))[0].n,1,'owner reads own ledger');
  await assert.rejects(()=>db.query('update public.compliance_brain_claims set verified=false'),/permission denied/);checks++;
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  await db.exec('set role authenticated');
  equal((await q('select count(*)::int n from public.compliance_brain_claims'))[0].n,0,'cross-owner cannot read ledger');
  await db.exec('reset role');
  await db.exec('set role anon');
  await assert.rejects(()=>db.query('select * from public.compliance_brain_claims'),/permission denied/);checks++;
  await assert.rejects(()=>db.query('select public.activate_compliance_brain_policy($1,$2)', ['unknown',owner]),/permission denied/);checks++;
  await db.exec('reset role');
  const hostedVerification=(await q(await readFile('supabase/tests/compliance_brain_post_apply_readonly.sql','utf8')))[0].result;
  equal(hostedVerification.tables.length,8,'read-only hosted verification covers all eight new tables');
  equal(hostedVerification.tables.every(table=>table.rls&&!table.anon_select&&!table.authenticated_insert
    &&!table.authenticated_update&&!table.authenticated_delete),true,'hosted grant projection detects no customer writes');
  equal(hostedVerification.functions.every(fn=>!fn.security_definer&&!fn.anon_execute&&!fn.authenticated_execute),true,
    'all Compliance RPC and trigger functions deny customer invocation');
  equal(hostedVerification.decision_raw_columns_blocked,true,'customer raw verdict payload columns remain denied');
  equal(hostedVerification.scheduler.mode,'SAFE','hosted runtime projection remains SAFE');
  equal(hostedVerification.cron.uses_existing_safe_tick,true,'hosted cron projection uses existing SAFE tick');
  console.log(JSON.stringify({postgres:(await q('select version()'))[0].version,
    migrations:earlierMigrations+2,populatedExistingTables:tableNames.length,complianceIntegrationChecks:checks,
    existingAccountSchedulerChecks:schedulerCases,result:'PASS',preservedCustomerData:'PASS',preservedExistingSchema:'PASS',
    policyActivation:'NONE',executionMode:'SAFE',networkCalls:0,paidCalls:0,tiktokCalls:0,cronEngine:'CONTRACT_STUB_ONLY'}));
} finally { await db.close(); }
