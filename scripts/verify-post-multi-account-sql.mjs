// Isolated PostgreSQL proof. Never connects to Supabase or loads environment files.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { runProof } from './post-multi-account-sql-cases.mjs';

async function baseline(db) {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    -- Emulate Supabase's managed service_role default table privileges.
    alter default privileges in schema public grant all on tables to service_role;
    create schema auth; create schema storage; create schema extensions;
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
  return files.length;
}

async function main() {
  const db=new PGlite();
  try {
    const migrations=await baseline(db);
    console.log(JSON.stringify({postgres:(await db.query('select version()')).rows[0].version,migrations,syntax:'PASS'}));
    await runProof(db,assert);
  } finally {await db.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
