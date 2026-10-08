// Real isolated PostgreSQL execution; no environment files or remote connections.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
const db=await PGlite.create();
let checks=0;
const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++};
const denied=async(action,pattern=/permission denied|row-level security/)=>{await assert.rejects(action,pattern);checks++};
async function role(name,owner,action){
  await db.exec(`set role ${name}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner??""]);
  try{return await action();}finally{await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub','',false)");}
}
try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema private;create schema auth;
    grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.profiles(id uuid primary key);
    create table public.products(owner_id uuid,id uuid,unique(owner_id,id));
    create table public.tiktok_accounts(owner_id uuid,id uuid,unique(owner_id,id));`);
  await db.exec(await readFile("supabase/migrations/20261007162048_compliance_brain_foundation.sql","utf8"));
  const a=randomUUID(),b=randomUUID(),pa=randomUUID(),pb=randomUUID(),aa=randomUUID(),ab=randomUUID(),ev=randomUUID(),unverified=randomUUID(),claim=randomUUID(),mediaEv=randomUUID();
  await db.query("insert into public.profiles values($1),($2)",[a,b]);
  await db.query("insert into public.products values($1,$2),($3,$4)",[a,pa,b,pb]);
  await db.query("insert into public.tiktok_accounts values($1,$2),($3,$4)",[a,aa,b,ab]);
  await role("service_role",null,async()=>{
    await db.query(`insert into public.compliance_brain_evidence(id,owner_id,product_id,kind,source_url,source_hash,jurisdiction,verified)
      values($1,$2,$3,'PRODUCT_LABEL','label',$4,'TH',true),($5,$2,$3,'PDP','pdp',$4,'TH',false),($6,$2,$3,'MEDIA_REVIEW','manual asset review',$7,'TH',true)`,[ev,a,pa,"a".repeat(64),unverified,mediaEv,"b".repeat(64)]);
    await db.query(`insert into public.compliance_brain_claims(id,owner_id,product_id,claim_text,claim_type,source,evidence_refs,jurisdiction,verified,allowed_channels)
      values($1,$2,$3,'ช่วยเพิ่มความชุ่มชื้น','COSMETIC','label',array[$4::uuid],'TH',true,array['POST','LIVE'])`,[claim,a,pa,ev]);
    await denied(()=>db.query(`insert into public.compliance_brain_claims(owner_id,product_id,claim_text,claim_type,source,evidence_refs,jurisdiction,verified,allowed_channels)
      values($1,$2,'unknown claim','COSMETIC','pdp',array[$3::uuid],'TH',true,array['POST'])`,[a,pa,unverified]),/compliance_evidence_scope_or_verification_invalid/);
    await denied(()=>db.query(`insert into public.compliance_brain_evidence(owner_id,product_id,kind,source_url,source_hash,jurisdiction)
      values($1,$2,'PDP','pdp',$3,'TH')`,[a,pb,"a".repeat(64)]),/foreign key constraint/);
  });
  await role("authenticated",a,async()=>{
    equal((await db.query("select id from public.compliance_brain_evidence")).rows.length,3);
    equal((await db.query("select id from public.compliance_brain_claims")).rows.length,1);
    await denied(()=>db.query("update public.compliance_brain_evidence set verified=true where id=$1",[unverified]));
    await denied(()=>db.query("insert into public.compliance_brain_claims(owner_id,product_id,claim_text,claim_type,source,jurisdiction,verified) values($1,$2,'fake','TEST','user','TH',true)",[a,pa]));
    await denied(()=>db.query("select * from private.compliance_brain_feedback"));
    await denied(()=>db.query("select public.activate_compliance_brain_policy('TH-1',$1,false)",[a]));
    await denied(()=>db.query("select public.record_compliance_brain_decision('{}')"));
  });
  await role("authenticated",b,async()=>{
    equal((await db.query("select id from public.compliance_brain_evidence")).rows.length,0);
    equal((await db.query("select id from public.compliance_brain_claims")).rows.length,0);
  });
  await role("anon",null,async()=>{
    await denied(()=>db.query("select id from public.compliance_brain_evidence"));
    await denied(()=>db.query("select public.append_compliance_brain_feedback('{}')"));
  });
  const decision={id:randomUUID(),owner_id:a,product_id:pa,account_id:aa,channel:"POST",stage:"FINAL_PUBLISH",platform:"TIKTOK_SHOP",country:"TH",region:"TH",category:"SKINCARE",category_risk:"HIGH",policy_version:null,content_hash:"c".repeat(64),decision:"REVIEW_REQUIRED",risk_score:80,policy_refs:[],claim_refs:[claim],evidence_refs:[ev],reasons:[{code:"REVIEW"}],rewrites_json:[],checked_at:"2026-10-07T00:00:00Z"};
  const record=payload=>db.query("select public.record_compliance_brain_decision($1::jsonb) id",[JSON.stringify(payload)]);
  await role("service_role",null,async()=>{
    equal((await record(decision)).rows[0].id,decision.id);
    equal((await record(decision)).rows[0].id,decision.id);
    equal((await db.query("select count(*)::int n from private.compliance_brain_audits where decision_id=$1",[decision.id])).rows[0].n,1);
    equal((await db.query("select event_key,event_type,source from private.compliance_brain_feedback where decision_id=$1",[decision.id])).rows,
      [{event_key:`decision:${decision.id}`,event_type:"compliance_flag",source:"SYSTEM"}]);
    await denied(()=>record({...decision,id:randomUUID(),checked_at:"2099-01-01T00:00:00Z"}),/compliance_decision_checked_at_future/);
    await denied(()=>record({...decision,decision:"PASS"}),/compliance_decision_identity_conflict/);
    await denied(()=>record({...decision,id:randomUUID(),owner_id:b,product_id:pb,account_id:ab}),/compliance_decision_reference_scope_invalid/);
    await denied(()=>record({...decision,id:randomUUID(),account_id:ab}),/foreign key constraint/);
    await denied(()=>db.query("insert into public.compliance_brain_media_reviews(owner_id,product_id,account_id,asset_hash,evidence_id,transcript,coverage_complete) values($1,$2,$3,$4,$5,'actual transcript',true)",[a,pa,aa,"a".repeat(64),mediaEv]),/compliance_media_review_evidence_invalid/);
    await db.query("insert into public.compliance_brain_media_reviews(owner_id,product_id,account_id,asset_hash,evidence_id,transcript,coverage_complete) values($1,$2,$3,$4,$5,'actual transcript',true)",[a,pa,aa,"b".repeat(64),mediaEv]);
    const feedback={owner_id:a,decision_id:decision.id,event_key:"appeal-1",event_type:"appeal_accepted",source:"OFFICIAL_PLATFORM",platform_reason_code:"ACCEPTED",platform_reason_text:"private official reason",platform_evidence_ref:"https://seller-th.tiktok.com/appeals/private-reference"};
    const first=(await db.query("select public.append_compliance_brain_feedback($1::jsonb) id",[JSON.stringify(feedback)])).rows[0].id;
    equal((await db.query("select public.append_compliance_brain_feedback($1::jsonb) id",[JSON.stringify(feedback)])).rows[0].id,first);
    await denied(()=>db.query("select public.append_compliance_brain_feedback($1::jsonb)",[JSON.stringify({...feedback,owner_id:b})]),/foreign key constraint/);
    await denied(()=>db.query("select public.append_compliance_brain_feedback($1::jsonb)",[JSON.stringify({...feedback,event_key:"unreferenced-official",platform_evidence_ref:null})]),/check constraint/);
    await denied(()=>db.query("select public.append_compliance_brain_feedback($1::jsonb)",[JSON.stringify({...feedback,event_key:"untrusted-source",source:"SYSTEM"})]),/check constraint/);
  });
  const failedDecision={...decision,id:randomUUID(),decision:"PASS"};
  await db.exec("revoke insert on private.compliance_brain_feedback from service_role");
  await role("service_role",null,async()=>await denied(()=>record(failedDecision)));
  equal((await db.query("select count(*)::int n from public.compliance_brain_decisions where id=$1",[failedDecision.id])).rows[0].n,0);
  equal((await db.query("select count(*)::int n from private.compliance_brain_audits where decision_id=$1",[failedDecision.id])).rows[0].n,0);
  await db.exec("grant insert on private.compliance_brain_feedback to service_role");
  await denied(()=>db.query("update public.compliance_brain_decisions set decision='PASS' where id=$1",[decision.id]),/compliance_decision_immutable/);
  await role("authenticated",a,async()=>{
    equal((await db.query("select id,decision,content_hash from public.compliance_brain_decisions")).rows.length,1);
    equal((await db.query("select id from public.compliance_brain_media_reviews")).rows.length,1);
    await denied(()=>db.query("select reasons from public.compliance_brain_decisions"));
    await denied(()=>db.query("select rewrites_json from public.compliance_brain_decisions"));
    equal((await db.query("select rewritten from public.compliance_brain_decisions where id=$1",[decision.id])).rows[0].rewritten,false);
    await denied(()=>db.query("insert into public.compliance_brain_media_reviews(owner_id,product_id,asset_hash,evidence_id) values($1,$2,$3,$4)",[a,pa,"b".repeat(64),mediaEv]));
    await denied(()=>db.query("select public.read_compliance_brain_learning_patterns()"));
    await denied(()=>db.query("select public.read_compliance_brain_learning_observations('TH-1')"));
  });
  await role("authenticated",b,async()=>{
    equal((await db.query("select id from public.compliance_brain_decisions")).rows.length,0);
    equal((await db.query("select id from public.compliance_brain_media_reviews")).rows.length,0);
  });
  await role("service_role",null,async()=>{
    for(const version of ["TH-1","TH-2"])await db.query(`insert into public.compliance_brain_policy_versions(version,platform,country,region,status,effective_at,pack_json,checksum,signature,validated_at,validation_hash)
      values($1,'TIKTOK_SHOP','TH','TH','VALIDATED','2026-01-01','{}',$2,$3,now(),$2)`,[version,"d".repeat(64),"signed-envelope-fixture"]);
    await db.query("select public.activate_compliance_brain_policy('TH-1',$1,false)",[a]);
    await db.query("select public.activate_compliance_brain_policy('TH-2',$1,false)",[a]);
    equal((await db.query("select version from public.compliance_brain_policy_versions where status='ACTIVE'")).rows[0].version,"TH-2");
    await db.query("select public.activate_compliance_brain_policy('TH-1',$1,true)",[a]);
    equal((await db.query("select version from public.compliance_brain_policy_versions where status='ACTIVE'")).rows[0].version,"TH-1");
    await denied(()=>db.query("update public.compliance_brain_policy_versions set pack_json='{}',checksum=$1 where version='TH-1'",["e".repeat(64)]),/compliance_policy_version_immutable/);
    await denied(()=>db.query("update public.compliance_brain_policy_versions set version='TH-1-renamed' where version='TH-1'"),/compliance_policy_version_immutable/);
    await denied(()=>db.query("update public.compliance_brain_policy_versions set status='PARSED' where version='TH-1'"),/compliance_policy_version_immutable/);
    const pattern={policy_version:"TH-1",semantic_category:"GUARANTEED_RESULT",category:"SKINCARE",country:"TH",platform:"TIKTOK_SHOP",channel:"POST",lifecycle:"OBSERVED",evidence_source:"OFFICIAL_PLATFORM",sample_count:1,tenant_count:1,violation_count:1,appeal_accepted_count:0,appeal_rejected_count:0,false_positive_rate:0,confidence:0.33,risk_score:90,shadow_would_block:0,shadow_would_rewrite:0,approved:false};
    await db.query("select public.upsert_compliance_brain_learning_pattern($1::jsonb)",[JSON.stringify(pattern)]);checks++;
    equal((await db.query("select shadow_evaluated_count,shadow_unavailable_count from private.compliance_brain_learning_patterns")).rows[0],{shadow_evaluated_count:0,shadow_unavailable_count:0});
    await denied(()=>db.query("select public.upsert_compliance_brain_learning_pattern($1::jsonb)",[JSON.stringify({...pattern,shadow_evaluated_count:-1})]),/check constraint/);
    await denied(()=>db.query("select public.upsert_compliance_brain_learning_pattern($1::jsonb)",[JSON.stringify({...pattern,shadow_would_block:1})]),/check constraint/);
    await denied(()=>db.query("select public.upsert_compliance_brain_learning_pattern($1::jsonb,$2)",[JSON.stringify({...pattern,lifecycle:"ENFORCED",approved:true}),a]),/check constraint/);
    await denied(()=>db.query("select public.upsert_compliance_brain_learning_pattern($1::jsonb)",[JSON.stringify({...pattern,raw_script:"private",owner_id:a})]),/compliance_learning_unexpected_field/);
    const fields=(await db.query("select column_name from information_schema.columns where table_schema='private' and table_name='compliance_brain_learning_patterns'")).rows.map(row=>row.column_name);
    equal(fields.some(field=>["owner_id","account_id","product_id","decision_id","approved_by","script","comments","sales","pii","payload_json"].includes(field)),false);
    await db.query("select public.upsert_compliance_brain_learning_pattern($1::jsonb)",[JSON.stringify({...pattern,sample_count:10,observed_at:"2000-01-01T00:00:00Z"})]);
    equal((await db.query("select sample_count from private.compliance_brain_learning_patterns")).rows[0].sample_count,1);
    await denied(()=>db.query("select public.upsert_compliance_brain_learning_pattern($1::jsonb)",[JSON.stringify({...pattern,observed_at:"2099-01-01T00:00:00Z"})]),/compliance_learning_snapshot_future/);
    const approved={...pattern,sample_count:20,tenant_count:5,violation_count:20,confidence:0.95,lifecycle:"VERIFIED",approved:true};
    const patternId=(await db.query("select public.upsert_compliance_brain_learning_pattern($1::jsonb,$2) id",[JSON.stringify(approved),a])).rows[0].id;
    equal((await db.query("select public.upsert_compliance_brain_learning_pattern($1::jsonb) id",[JSON.stringify({...pattern,sample_count:30})])).rows[0].id,patternId);
    equal((await db.query("select lifecycle,approved,sample_count from private.compliance_brain_learning_patterns")).rows[0],{lifecycle:"VERIFIED",approved:true,sample_count:20});
    const observedDecision={...decision,id:randomUUID(),policy_version:"TH-1",reasons:[
      {category:"GUARANTEED_RESULT",message:"private reason message"},{category:"private arbitrary category"}]};
    await record(observedDecision);
    await db.query("select public.append_compliance_brain_feedback($1::jsonb)",[JSON.stringify({owner_id:a,decision_id:observedDecision.id,
      event_key:"private event key",event_type:"violation",source:"OFFICIAL_PLATFORM",platform_reason_text:"private platform reason",
      platform_evidence_ref:"https://seller-th.tiktok.com/private-evidence"})]);
    const snapshot=(await db.query("select public.read_compliance_brain_learning_observations('TH-1',100) snapshot")).rows[0].snapshot;
    equal(snapshot.complete,true);equal(snapshot.observations.length,2);
    equal(snapshot.observations.every(event=>JSON.stringify(event.semantic_categories)==='["GUARANTEED_RESULT"]'),true);
    equal(Object.keys(snapshot.observations[0]).sort(),["event_id","owner_id","decision_id","event_type","source","policy_version","semantic_categories","category","country","platform","channel","risk_score","decision","observed_at"].sort());
    equal(/private reason|private arbitrary|private platform|private-evidence|private event key/.test(JSON.stringify(snapshot)),false);
    const incomplete=(await db.query("select public.read_compliance_brain_learning_observations('TH-1',1) snapshot")).rows[0].snapshot;
    equal(incomplete.complete,false);equal(incomplete.observations.length,1);
    equal((await db.query("select public.read_compliance_brain_learning_observations('other',100) snapshot")).rows[0].snapshot.observations.length,0);
    await db.query("select public.upsert_compliance_brain_learning_pattern($1::jsonb)",[JSON.stringify({...pattern,
      semantic_category:"ABSOLUTE_CLAIM",sample_count:20,tenant_count:5,lifecycle:"SHADOW",confidence:0.95,
      shadow_would_block:12,shadow_would_rewrite:8,shadow_evaluated_count:30,shadow_unavailable_count:4})]);
    equal((await db.query("select shadow_would_block,shadow_would_rewrite,shadow_evaluated_count,shadow_unavailable_count from private.compliance_brain_learning_patterns where semantic_category='ABSOLUTE_CLAIM'")).rows[0],
      {shadow_would_block:12,shadow_would_rewrite:8,shadow_evaluated_count:30,shadow_unavailable_count:4});
  });
  const rewrittenDecision={...decision,id:randomUUID(),decision:"PASS",rewrites_json:[{inputHash:"a".repeat(64),outputHash:"c".repeat(64),status:"PASS"}]};
  await role("service_role",null,async()=>{
    equal((await record(rewrittenDecision)).rows[0].id,rewrittenDecision.id);
    equal((await record(rewrittenDecision)).rows[0].id,rewrittenDecision.id);
  });
  await role("authenticated",a,async()=>{
    equal((await db.query("select rewritten from public.compliance_brain_decisions where id=$1",[rewrittenDecision.id])).rows[0].rewritten,true);
    await denied(()=>db.query("update public.compliance_brain_decisions set rewritten=false where id=$1",[rewrittenDecision.id]),/can only be updated to DEFAULT/);
    await denied(()=>db.query("update public.compliance_brain_decisions set rewritten=DEFAULT where id=$1",[rewrittenDecision.id]));
  });
  console.log(JSON.stringify({postgres:(await db.query("select version()")).rows[0].version,checks,result:"PASS",networkCalls:0,paidCalls:0}));
}finally{await db.close();}
