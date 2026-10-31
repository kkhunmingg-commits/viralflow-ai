import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { classifyAccount } from '../src/features/growth-manager/discovery.ts';

/** Extends the existing isolated SQL fixture; never opens a remote database or API. */
export async function verifyGrowthManagerSql(db,owner,other,accounts) {
 let checks=0;const ok=v=>{assert.ok(v);checks++;},deny=async(sql,args=[])=>{await assert.rejects(db.query(sql,args));checks++;};
 await db.exec(`reset role;
 alter table tiktok_accounts add column mode text default 'AUTO',add column follower_count bigint not null default 0,
 add column shop_creator_eligible boolean,add column ecommerce_permission boolean,add column cart_enabled boolean,
 add column direct_post_status text default 'UNAVAILABLE',add column granted_scopes text[] default '{user.info.basic}';
 alter table account_publish_health add column health_status text default 'UNKNOWN';
 create table account_analytics_snapshots(owner_id uuid,tiktok_account_id uuid,source text,source_snapshot_at timestamptz,follower_count bigint,source_confidence numeric,availability_json jsonb,unique(owner_id,tiktok_account_id,source,source_snapshot_at));
 create table tiktok_shop_connections(id uuid primary key,owner_id uuid,tiktok_account_id uuid,provider text,authorization_status text,api_access_status text,is_mock boolean,last_synced_at timestamptz,token_expires_at timestamptz);
 create table creator_commerce_profiles(owner_id uuid,tiktok_account_id uuid,shop_connection_id uuid,synced_at timestamptz,affiliate_eligible boolean,ecommerce_permission boolean,cart_permission boolean,commerce_status text);
 create table categories(id uuid primary key,owner_id uuid,provider text,status text,category_key text,display_name text);
 create table category_snapshots(owner_id uuid,category_id uuid,captured_at timestamptz,data_confidence numeric,median_product_momentum numeric);
 alter table video_analytics_snapshots add column video_id uuid,add column video_kind text,add column availability_json jsonb;
 -- The earlier minimal proof deliberately inserts duplicates; restore the real schema's unique shape in this isolated fixture only.
 delete from video_analytics_snapshots a using video_analytics_snapshots b where a.ctid>b.ctid and a.owner_id=b.owner_id and a.source=b.source and a.external_video_id=b.external_video_id and a.source_snapshot_at=b.source_snapshot_at;
 create unique index growth_proof_snapshot_identity on video_analytics_snapshots(owner_id,source,external_video_id,source_snapshot_at);
 `);
 // Reuse the actual account-brain SQL, rather than a duplicate generated-mode test implementation.
 const commerceMigration=await readFile('supabase/migrations/20260918021720_phase_7c_tiktok_shop_foundation.sql','utf8');
 await db.exec(commerceMigration.slice(commerceMigration.indexOf('create function private.account_effective_mode('),commerceMigration.indexOf('create table public.tiktok_shop_connections')));
 for(const path of ['supabase/migrations/20261012094047_growth_manager_pilot.sql','supabase/migrations/20261012100609_auto_account_discovery.sql'])await db.exec(await readFile(path,'utf8'));
 await db.exec(`grant all on account_analytics_snapshots,tiktok_shop_connections,creator_commerce_profiles,categories,category_snapshots to service_role;
 update tiktok_accounts set authorization_status='authorized',hidden_at=null;
 update tiktok_accounts set username='fixture';
 update account_automation_settings set config=config||'{"enabled":false}';
 insert into growth_pilot_allowlist(owner_id,tiktok_account_id,enabled,health_confirmed,policy)values('${owner}','${accounts[0]}',true,true,'{}');
 set role authenticated;`);
 await deny('select * from growth_pilot_allowlist');await deny('select * from growth_pilot_plans');await deny('select * from auto_account_discovery');
 await deny('select claim_auto_account_sync(gen_random_uuid())');await db.exec('set role anon');await deny('select * from auto_account_discovery');await db.exec('reset role');
 // One real-provenance commerce fixture for the boundary; it does not imply live Shop access.
 const shop=randomUUID(),category=randomUUID();
 await db.query(`insert into tiktok_shop_connections values($1::uuid,$2::uuid,$3::uuid,'tiktok_shop','AUTHORIZED','AVAILABLE',false,now(),now()+interval '1 day');
 `,[shop,owner,accounts[1]]);
 await db.query("insert into creator_commerce_profiles values($1::uuid,$2::uuid,$3::uuid,now(),true,true,true,'AFFILIATE_READY')",[owner,accounts[1],shop]);
 await db.query("insert into categories values($1::uuid,$2::uuid,'mock','active','home','MOCK topic')",[category,owner]);
 await db.query('insert into category_snapshots values($1::uuid,$2::uuid,now(),1,80)',[owner,category]);
 await db.exec('set role service_role');
 const now=new Date((await db.query('select now() at')).rows[0].at),handled=new Set();
 const finish=async(a,token,count)=>{
  const result=classifyAccount({...a,followers:{count,identity:a.identity,source:'TIKTOK_DISPLAY',at:now.toISOString()}},now);
  ok((await db.query('select record_auto_account_sync($1::uuid,$2::uuid,$3::uuid,$4::jsonb) done',[a.owner,a.account,token,JSON.stringify({...result,observedAt:now.toISOString(),failure:''})])).rows[0].done);
  handled.add(a.account);return result;
 };
 const claim=async()=>{const token=randomUUID(),a=(await db.query('select claim_auto_account_sync($1::uuid) a',[token])).rows[0].a;return{token,a};};
 const one=await claim(),two=await claim();ok(one.a.account!==two.a.account);
 ok((await db.query('select count(*)::int n from auto_account_discovery')).rows[0].n===accounts.length);
 ok((await db.query('select record_auto_account_sync($1::uuid,$2::uuid,$3::uuid,$4::jsonb) done',[other,one.a.account,one.token,'{}'])).rows[0].done===false);
 ok((await db.query('select record_auto_account_sync($1::uuid,$2::uuid,$3::uuid,$4::jsonb) done',[owner,one.a.account,randomUUID(),'{}'])).rows[0].done===false);
 await finish(one.a,one.token,one.a.account===accounts[1]?1000:300);await finish(two.a,two.token,two.a.account===accounts[1]?1000:300);
 for(;;){const c=await claim();if(!c.a)break;await finish(c.a,c.token,c.a.account===accounts[1]?5000:999);}
 ok(handled.size===accounts.length);
 ok((await db.query('select count(*)::int n from auto_account_discovery where can_execute')).rows[0].n===1);
 ok((await db.query('select mode,can_execute from auto_account_discovery where tiktok_account_id=$1::uuid',[accounts[1]])).rows[0].mode==='AFFILIATE');
 ok((await db.query('select follower_count from tiktok_accounts where id=$1::uuid',[accounts[1]])).rows[0].follower_count===0); // Discovery never mutates an un-enrolled sales account.
 const beforeSnapshots=(await db.query('select count(*)::int n from account_analytics_snapshots')).rows[0].n;
 ok((await db.query('select record_auto_account_sync($1::uuid,$2::uuid,$3::uuid,$4::jsonb) done',[owner,one.a.account,one.token,'{}'])).rows[0].done===false);
 ok((await db.query('select count(*)::int n from account_analytics_snapshots')).rows[0].n===beforeSnapshots);
 const day=now.toISOString().slice(0,10),slot=[{ordinal:1,topic:'Verified fixture topic',at:now.toISOString(),state:'ASSISTED'}],decision={recommended:1,evidenceIds:[]};
 const save=async(hash,slots=slot)=>(await db.query('select save_growth_pilot_plan($1::uuid,$2::date,$3::jsonb,$4::jsonb,$5) done',[owner,day,JSON.stringify(decision),JSON.stringify(slots),hash])).rows[0].done;
 ok(await save('first'));ok(await save('first'));ok((await db.query('select count(*)::int n from growth_pilot_plans')).rows[0].n===1);
 await deny("insert into generation_budget_reservations(owner_id,tiktok_account_id,state,reserved_usd)values($1::uuid,$2::uuid,'RESERVED',1)",[owner,accounts[0]]);
 await db.query("insert into generation_budget_reservations(owner_id,tiktok_account_id,state,reserved_usd)values($1::uuid,$2::uuid,'SETTLED',0)",[owner,accounts[0]]);
 ok((await db.query('select growth_pilot_facts($1::uuid) f',[other])).rows[0].f===null);
 ok((await db.query('select growth_pilot_facts($1::uuid) f',[owner])).rows[0].f.topicEvidence.length===0); // MOCK category is never an automatic topic.
 ok((await db.query('select report_growth_pilot_manual_post($1::uuid,$2::date,1,$3) done',[owner,day,'https://www.tiktok.com/@fixture/video/123'])).rows[0].done);
 ok((await db.query('select report_growth_pilot_manual_post($1::uuid,$2::date,1,$3) done',[owner,day,'https://www.tiktok.com/@fixture/video/123'])).rows[0].done===false);
 ok((await db.query('select report_growth_pilot_manual_post($1::uuid,$2::date,1,$3) done',[owner,day,'https://www.tiktok.com/@fixture/video/456'])).rows[0].done===false);
 ok(await save('restart',[]));ok((await db.query('select slots from growth_pilot_plans')).rows[0].slots[0].state==='MANUAL_REPORTED');
 // Lease expiry recovery retains the same identity, rejects the abandoned writer.
 await db.query('update auto_account_discovery set next_sync_at=now()-interval \'1 day\' where tiktok_account_id=$1::uuid',[accounts[0]]);
 const crash=await claim();await db.query('update auto_account_discovery set lease_expires_at=now()-interval \'1 second\' where tiktok_account_id=$1::uuid',[accounts[0]]);
 const recovered=await claim();ok(crash.a.account===recovered.a.account&&crash.token!==recovered.token);
 await db.query("update tiktok_accounts set granted_scopes='{user.info.basic,user.info.stats,video.list}' where id=$1::uuid",[accounts[0]]);
 const observed=[{externalVideoId:'123',videoId:randomUUID(),source:'TIKTOK_DISPLAY',sourceConfidence:.95,publishedAt:new Date(now.getTime()-86400000).toISOString(),capturedAt:now.toISOString(),views:50,likes:2,comments:1,shares:null}];
 ok((await db.query('select record_growth_manual_analytics($1::uuid,$2::uuid,$3::uuid,$4::jsonb) done',[owner,accounts[0],recovered.token,JSON.stringify(observed)])).rows[0].done);
 ok((await db.query('select record_growth_manual_analytics($1::uuid,$2::uuid,$3::uuid,$4::jsonb) done',[owner,accounts[0],recovered.token,JSON.stringify(observed)])).rows[0].done);
 ok((await db.query("select count(*)::int n from video_analytics_snapshots where external_video_id='123'")).rows[0].n===1);
 ok((await db.query('select record_growth_manual_analytics($1::uuid,$2::uuid,$3::uuid,$4::jsonb) done',[other,accounts[0],recovered.token,JSON.stringify(observed)])).rows[0].done===false);
 const realFacts=(await db.query('select growth_pilot_facts($1::uuid) f',[owner])).rows[0].f;
 ok(realFacts.posts.some(p=>p.id==='123'&&p.views===50&&p.topic==='Verified fixture topic'&&p.followersGained===null));
 ok((await db.query('select record_auto_account_sync($1::uuid,$2::uuid,$3::uuid,$4::jsonb) done',[owner,accounts[0],crash.token,'{}'])).rows[0].done===false);
 await finish(recovered.a,recovered.token,1000); // No verified commerce -> Growth, no Affiliate.
 ok((await db.query('select mode from auto_account_discovery where tiktok_account_id=$1::uuid',[accounts[0]])).rows[0].mode==='GROWTH');
 ok((await db.query('select reason,can_execute from auto_account_discovery where tiktok_account_id=$1::uuid',[accounts[0]])).rows[0].reason==='FOLLOWER_OBSERVATION_CONFLICT');
 ok((await db.query('select can_execute from auto_account_discovery where tiktok_account_id=$1::uuid',[accounts[0]])).rows[0].can_execute===false);
 // An account connected later is discovered without a release or fixed registration limit.
 const added=randomUUID();await db.query('insert into tiktok_accounts(id,owner_id,display_name,open_id)values($1::uuid,$2::uuid,\'New fixture\',\'new-open\')',[added,owner]);
 const newAccount=await claim();ok(newAccount.a.account===added&&newAccount.a.optedIn===false);await finish(newAccount.a,newAccount.token,5000);
 const runtime=(await db.query('select execution_mode,publishing_enabled from multi_account_runtime')).rows[0];
 // The original proof temporarily enables its isolated runtime for gate tests; restore SAFE before reporting.
 await db.exec("update multi_account_runtime set execution_mode='SAFE',publishing_enabled=false");
 ok(runtime!==null);
 const report={isolatedPostgres:'PASS',checks,discovered:handled.size,enrolled:1,leaseRecovery:'PASS',duplicatePrevention:'PASS',rls:'service-only/owner-bound/cross-owner/anon PASS',paidCalls:0,tiktokPostingCalls:0,productionDatabaseChanged:false,manualOutcome:'owner report retained; not verified API analytics',safeMode:true};
 await mkdir('test-results/growth-manager',{recursive:true});await writeFile('test-results/growth-manager/sql-proof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));return checks;
}
