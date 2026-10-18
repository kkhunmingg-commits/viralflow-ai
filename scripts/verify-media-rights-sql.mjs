import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.argv[2]??'node_modules/@electric-sql/pglite/dist/index.js').href);
const db=new PGlite();let checks=0;
const owner=randomUUID(),other=randomUUID(),account=randomUUID(),otherAccount=randomUUID(),product=randomUUID(),proof='a'.repeat(64);
const ok=value=>{assert.ok(value);checks++;};
async function denied(sql,pattern){await assert.rejects(db.exec(sql),pattern);checks++;}
const one=async sql=>(await db.query(sql)).rows[0];
const violations=async(kind,id,acct=account)=>(await one(`select media_rights_violations('${owner}','${kind}','${id}','${acct}') as v`)).v;
try{
  // Minimal shapes of the existing tables this migration references; the migration itself is read verbatim.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema private;
    grant usage on schema public,auth,private to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table profiles(id uuid primary key);insert into profiles values('${owner}'),('${other}');
    create table tiktok_accounts(id uuid primary key,owner_id uuid,unique(owner_id,id));
    create table products(id uuid primary key,owner_id uuid,unique(owner_id,id));
    create table media_assets(id uuid primary key default gen_random_uuid(),owner_id uuid,storage_path text,unique(owner_id,id));
    create table master_videos(id uuid primary key default gen_random_uuid(),owner_id uuid,status text not null default 'READY',unique(owner_id,id));
    create table video_variations(id uuid primary key default gen_random_uuid(),owner_id uuid,master_video_id uuid,status text not null default 'READY',unique(owner_id,id));
    create table publishing_queue(id uuid primary key default gen_random_uuid(),owner_id uuid,tiktok_account_id uuid,video_id uuid,video_kind text,
      status text not null default 'QUEUED',external_state text default 'READY',lease_token uuid,cancelled_at timestamptz,last_error_code text,last_error_message text);
    insert into tiktok_accounts values('${account}','${owner}'),('${otherAccount}','${owner}');insert into products values('${product}','${owner}');`);
  await db.exec(await readFile('supabase/migrations/20261018120000_media_rights_evidence_ledger.sql','utf8'));checks++;

  const asset=async()=> (await one(`insert into media_assets(owner_id,storage_path) values('${owner}','owner/${owner}/x/${randomUUID()}') returning id`)).id;
  const rights=async(assetId,extra={})=>{const r={origin_source:"'OWNER_CREATED'",asset_role:"'REAL_FOOTAGE'",allows_commercial:'true',allows_edit:'true',allows_promotion:'true',platform_scope:"'{TIKTOK}'",territory:"'{TH}'",review_state:"'APPROVED'",reviewed_by:`'${owner}'`,reviewed_at:'now()',...extra};
    return (await one(`insert into media_asset_rights(owner_id,media_asset_id,source_reference,rightsholder,license_type,attested_by,${Object.keys(r).join(',')})
      values('${owner}','${assetId}','owner footage','Owner','OWNER_ORIGINAL','${owner}',${Object.values(r).join(',')}) returning id`)).id;};
  const master=async()=> (await one(`insert into master_videos(owner_id) values('${owner}') returning id`)).id;
  const addUsage=async(assetId,rightsId,masterId)=>db.exec(`insert into media_asset_usages(owner_id,media_asset_id,rights_id,master_video_id,rights_snapshot) values('${owner}','${assetId}','${rightsId}','${masterId}','{}')`);
  const queue=async(kind,id,extra='')=> (await one(`insert into publishing_queue(owner_id,tiktok_account_id,video_id,video_kind${extra?','+extra.split('=')[0]:''}) values('${owner}','${account}','${id}','${kind}'${extra?','+extra.split('=')[1]:''}) returning id`)).id;

  // Legacy outputs without recorded usages are not changed by this gate.
  const legacy=await master();ok((await violations('MASTER',legacy)).length===0);
  const legacyQueue=await queue('MASTER',legacy);await db.exec(`update publishing_queue set status='UPLOADING' where id='${legacyQueue}'`);checks++;

  // Fully attested, reviewed owner footage is allowed and can upload.
  const a1=await asset(),r1=await rights(a1),m1=await master();await addUsage(a1,r1,m1);
  ok((await violations('MASTER',m1)).length===0);
  const q1=await queue('MASTER',m1);await db.exec(`update publishing_queue set status='UPLOADING' where id='${q1}'`);checks++;

  // Fail-closed cases.
  const cases=[[{review_state:"'PENDING'",reviewed_by:'null',reviewed_at:'null'},'NOT_APPROVED'],[{expires_at:"now()-interval '1 day'"},'EXPIRED'],
    [{allows_commercial:'false'},'COMMERCIAL_NOT_ALLOWED'],[{allows_edit:'false'},'EDIT_NOT_ALLOWED'],[{platform_scope:"'{INSTAGRAM}'"},'PLATFORM_OUT_OF_SCOPE'],
    [{account_scope:`array['${otherAccount}']::uuid[]`},'ACCOUNT_OUT_OF_SCOPE']];
  for(const [extra,reason] of cases){
    const a=await asset(),r=await rights(a,extra),m=await master();await addUsage(a,r,m);
    ok((await violations('MASTER',m)).includes(reason));
    const q=await queue('MASTER',m);await denied(`update publishing_queue set status='UPLOADING' where id='${q}'`,/media_rights_blocked/);
  }
  // Account scope admits the listed account.
  {const a=await asset(),r=await rights(a,{account_scope:`array['${account}']::uuid[]`}),m=await master();await addUsage(a,r,m);ok((await violations('MASTER',m)).length===0);ok((await violations('MASTER',m,otherAccount)).includes('ACCOUNT_OUT_OF_SCOPE'));}

  // Third-party media without stored proof cannot be recorded; with proof it can.
  await denied(`insert into media_asset_rights(owner_id,media_asset_id,origin_source,asset_role,source_reference,rightsholder,license_type,attested_by) values('${owner}','${await asset()}','MERCHANT_LICENSED','REAL_IMAGE','listing','Shop','License','${owner}')`,/check/);
  ok(await rights(await asset(),{origin_source:"'MERCHANT_LICENSED'",proof_sha256:`'${proof}'`}));

  // Reviewed scope cannot be widened in place; pending records can be completed by review.
  await denied(`update media_asset_rights set platform_scope='{TIKTOK,INSTAGRAM}' where id='${r1}'`,/immutable/);
  {const r=await rights(await asset(),{review_state:"'PENDING'",reviewed_by:'null',reviewed_at:'null'});await db.exec(`update media_asset_rights set review_state='APPROVED',reviewed_by='${owner}',reviewed_at=now() where id='${r}'`);checks++;}

  // Variations inherit their master's sources.
  const a2=await asset(),r2=await rights(a2),m2=await master();await addUsage(a2,r2,m2);
  const v2=(await one(`insert into video_variations(owner_id,master_video_id) values('${owner}','${m2}') returning id`)).id;
  const qMaster=await queue('MASTER',m2),qVariation=await queue('VARIATION',v2),qInflight=await queue('VARIATION',v2,`lease_token=gen_random_uuid()`);
  ok((await violations('VARIATION',v2)).length===0);

  // Revocation: queued posts stop, derived outputs are rejected, in-flight upload is blocked, and it cannot be undone.
  await db.exec(`update media_asset_rights set revoked_at=now(),revocation_reason='Owner withdrew permission' where id='${r2}'`);
  ok((await one(`select status,last_error_code from publishing_queue where id='${qMaster}'`)).last_error_code==='MEDIA_RIGHTS_REVOKED');
  ok((await one(`select status from publishing_queue where id='${qVariation}'`)).status==='CANCELLED');
  ok((await one(`select status from publishing_queue where id='${qInflight}'`)).status==='QUEUED');
  await denied(`update publishing_queue set status='UPLOADING' where id='${qInflight}'`,/REVOKED/);
  ok((await one(`select status from master_videos where id='${m2}'`)).status==='REJECTED');
  ok((await one(`select status from video_variations where id='${v2}'`)).status==='REJECTED');
  ok((await violations('VARIATION',v2)).includes('REVOKED'));
  await denied(`update media_asset_rights set revoked_at=null,revocation_reason=null where id='${r2}'`,/final/);
  await denied(`update media_asset_rights set revocation_reason='edited' where id='${r2}'`,/final/);
  ok((await one(`select status from publishing_queue where id='${q1}'`)).status==='UPLOADING');

  // Evidence must name a product or topic.
  await denied(`insert into content_evidence(owner_id,statement,source,source_reference,captured_at,verified_by) values('${owner}','x','PDP','ref',now(),'${owner}')`,/check/);
  ok((await one(`insert into content_evidence(owner_id,topic,statement,source,source_reference,captured_at,verified_by) values('${owner}','football spin','Spin deflects a ball','AUTHORIZED_SOURCE','https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/bending-a-soccer-ball/',now(),'${owner}') returning id`)).id);

  // Authorization: owner reads own rows only; clients cannot write or call the checker.
  await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`);
  ok((await db.query('select id from media_asset_rights')).rows.length>0);ok((await db.query('select id from content_evidence')).rows.length===1);
  await denied(`insert into content_evidence(owner_id,topic,statement,source,source_reference,captured_at,verified_by) values('${owner}','t','s','PDP','r',now(),'${owner}')`);
  await denied(`update media_asset_rights set review_state='APPROVED'`);
  await denied(`select media_rights_violations('${owner}','MASTER','${m1}','${account}')`);
  await db.exec(`select set_config('request.jwt.claim.sub','${other}',false);`);
  ok((await db.query('select id from media_asset_rights')).rows.length===0);ok((await db.query('select id from media_asset_usages')).rows.length===0);
  await db.exec('reset role;set role anon');await denied('select id from media_asset_rights');await denied('select id from content_evidence');
  await db.exec('reset role');
  console.log(JSON.stringify({status:'PASS',checks,database:'PGlite isolated in-memory',migration:'20261018120000_media_rights_evidence_ledger.sql'}));
}finally{await db.close();}
