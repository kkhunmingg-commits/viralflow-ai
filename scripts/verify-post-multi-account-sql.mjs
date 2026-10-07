// Isolated PostgreSQL proof. Never connects to Supabase or loads environment files.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { runProof } from './post-multi-account-sql-cases.mjs';
import { runCronProof } from './post-cron-sql-cases.mjs';

async function baseline(db) {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    -- Emulate Supabase's managed service_role default table privileges.
    alter default privileges in schema public grant all on tables to service_role;
    create schema auth; create schema storage; create schema extensions;
    -- Contract stub only: actual pg_cron execution/history is verified remotely.
    create schema cron;
    create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text,active boolean default true);
    create function cron.schedule(text,text,text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command) values($1,$2,$3)
      on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid;
    $$;
    create function cron.alter_job(job_id bigint,schedule text default null,command text default null,active boolean default null)
    returns void language sql as $$
      update cron.job j set schedule=coalesce($2,j.schedule),command=coalesce($3,j.command),active=coalesce($4,j.active) where jobid=$1;
    $$;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$
      select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1];
    $$;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$
      select sha256(convert_to($1,'utf8'));
    $$;
    grant usage on schema extensions to service_role;
  `);
  const files=fs.readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort();
  for(const file of files) {
    try {await db.exec(fs.readFileSync(path.join('supabase/migrations',file),'utf8'));}
    catch(error) {console.error('FAILED MIGRATION',file,error.message);throw error;}
  }
  // The two POST migrations must preserve records/functions and the stable cron job on replay.
  for(const file of files.filter(name=>name.includes('post_multi_account')||name.includes('post_supabase_cron'))) {
    await db.exec(fs.readFileSync(path.join('supabase/migrations',file),'utf8'));
  }
  return files.length;
}

async function main() {
  const db=new PGlite();
  try {
    const migrations=await baseline(db);
    console.log(JSON.stringify({postgres:(await db.query('select version()')).rows[0].version,migrations,syntax:'PASS'}));
    await db.query('select public.tick_post_account_automation()');
    const accountCases=await runProof(db,assert);
    const cases=await runCronProof(db,assert,accountCases);
    // Replay against populated fixtures, not just an empty schema. Historical
    // jobs/slots and the preserved production RPC body must survive unchanged.
    const snapshot=async()=> (await db.query(`select jsonb_build_object(
      'runs',(select jsonb_agg(to_jsonb(r) order by id) from public.auto_runs r),
      'states',(select jsonb_agg(to_jsonb(s) order by id) from public.auto_account_states s),
      'schedules',(select jsonb_agg(to_jsonb(s) order by owner_id,tiktok_account_id) from public.post_account_schedules s),
      'slots',(select jsonb_agg(to_jsonb(s) order by slot_key) from public.post_schedule_slots s),
      'productionClaim',pg_get_functiondef('private.claim_auto_execution_step_v11f(uuid,uuid,uuid,text,integer,boolean)'::regprocedure),
      'cron',(select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j)) result`)).rows[0].result;
    const before=await snapshot();
    for(const file of fs.readdirSync('supabase/migrations').filter(name=>name.includes('post_multi_account')||name.includes('post_supabase_cron')).sort()) {
      await db.exec(fs.readFileSync(path.join('supabase/migrations',file),'utf8'));
    }
    const after=await snapshot();
    for(const key of Object.keys(before)) assert.deepEqual(after[key],before[key],`migration replay preserves ${key}`);
    console.log(JSON.stringify({databaseCases:cases+Object.keys(before).length,result:'PASS',populatedMigrationReplay:'PASS',networkCalls:0,paidCalls:0,cronEngine:'CONTRACT_STUB_ONLY'}));
  } finally {await db.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
