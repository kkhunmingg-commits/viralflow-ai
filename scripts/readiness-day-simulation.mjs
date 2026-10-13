import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {runWorkerPool} from '../src/features/multi-account/worker.ts';
import {MultiAccountPublishingScheduler} from '../src/features/multi-account/scheduler.ts';
import {accountAutomationSchema} from '../src/features/multi-account/contracts.ts';
import {assignmentFixtures} from '../src/features/assignments/fixtures.ts';
import {buildDailyAssignments} from '../src/features/assignments/planner.ts';
import {calculateProductScore} from '../src/features/products/scoring.ts';
import {MockAIProvider} from '../src/features/creative/providers.ts';
import {checkProductTruth} from '../src/features/compliance/compliance.ts';
import {evaluatePublishEligibility} from '../src/features/compliance/publishing.ts';

/** Test-only virtual clock: rewrites now() in an isolated DB, never changes deployed SQL/runtime. */
export async function runReadinessDay(db,owner,ids){
 const start=Date.parse('2026-10-13T00:00:00Z');let now=start,networkFailures=0,providerFailures=0,restarts=0,checks=0;
 const ok=v=>{assert.ok(v);checks++;};
 await db.exec(`reset role;delete from multi_account_publish_reservations;delete from multi_account_work;
   update multi_account_runtime set enabled=true,execution_mode='SAFE',publishing_enabled=false;
   create table private.readiness_events(work_id uuid,stage text,evidence jsonb,primary key(work_id,stage));
   grant all on private.readiness_events to service_role;set role service_role;`);
 const accounts=ids.map((id,i)=>({id,ownerId:owner,config:accountAutomationSchema.parse({enabled:true,timezone:'UTC'}),connected:true,hidden:false,ready:0,produced:0,published:0,publishCap:null,recommendation:{generation:[2,5,9][i],publishing:0,reason:'ISOLATED_FIXTURE',confidence:1},scheduleSeed:id}));
 for(const a of accounts)await db.query(`update account_automation_settings set config=$1::jsonb where tiktok_account_id=$2::uuid;`,[JSON.stringify(a.config),a.id]);
 await db.query(`update tiktok_accounts set hidden_at=null,authorization_status='authorized',token_expires_at=$1::timestamptz where id=any($2::uuid[])`,[new Date(start+172800000).toISOString(),ids]);
 const plan=new MultiAccountPublishingScheduler().plan(accounts,new Date(start),0);
 await db.query('select plan_multi_account_work($1::jsonb)',[JSON.stringify(plan)]);
 const store={claim:async(kind,token)=>{const row=(await db.query('select to_jsonb(claim_multi_account_work($1,$2::uuid)) row',[kind,token])).rows[0].row;return row?.id?row:null;},finish:async(work,out)=>(await db.query('select finish_multi_account_work($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::timestamptz) done',[owner,work.id,work.lease_token,out.state,out.reason,out.retryAt??null])).rows[0].done};
 const events=async work=>(await db.query('select stage from private.readiness_events where work_id=$1::uuid',[work.id])).rows.map(r=>r.stage);
 const record=async(work,stage,evidence)=>{await db.query('insert into private.readiness_events values($1::uuid,$2,$3::jsonb) on conflict do nothing',[work.id,stage,JSON.stringify(evidence)]);};
 const ports={generate:async work=>{
   const done=new Set(await events(work));
   if(work.tiktok_account_id===ids[1]&&work.ordinal===1&&!done.has('NETWORK_RECOVERED')){networkFailures++;await record(work,'NETWORK_RECOVERED',{fixture:true});throw new Error('simulated network failure');}
   if(!done.has('PRODUCT')){
     const input=assignmentFixtures(new Date(now).toISOString(),owner);
     input.accounts=input.accounts.map((a,i)=>({...a,id:ids[i],daily_post_target:accounts[i].recommendation.generation,daily_post_hard_limit:accounts[i].recommendation.generation}));
     const p=input.products[0].product;
     const rows=Array.from({length:7},(_,i)=>({price:p.current_price,original_price:p.original_price,commission_rate:p.commission_rate,commission_amount:p.commission_amount,rating:p.rating,review_count:p.review_count,units_sold:1000+i*100,status:'available',competition:.2,creative_potential:90,captured_at:new Date(now-(6-i)*4*3600000).toISOString()}));
     const radar=calculateProductScore(rows,new Date(now));ok(Number.isFinite(radar.product_momentum_score));
     const assignments=buildDailyAssignments(input);const chosen=assignments.assignments.find(a=>a.score.accountId===work.tiktok_account_id);ok(chosen);
     await record(work,'PRODUCT',{fixture:true,productId:chosen.score.productId,radar:radar.product_momentum_score});
   }
   if(!done.has('CREATIVE')){
     const context={account:{mode:'GROWTH'},product:{title:'สินค้าทดสอบ',category:'home'}};
     const output=await new MockAIProvider(context).generate();ok(output.output.concepts.length>0);
     await record(work,'CREATIVE',{fixture:true,caption:output.output.concepts[0].caption});
   }
   // Permanent provider failure must park, not spin/re-purchase indefinitely.
   if(work.tiktok_account_id===ids[2]&&work.ordinal===1){providerFailures++;throw new Error('simulated provider unavailable');}
   if(!done.has('VIDEO'))await record(work,'VIDEO',{fixture:true,qualityBoundary:'mock local video, no generation purchase'});
   const truth=checkProductTruth('สาธิตวิธีใช้สินค้า',[]);ok(truth.status==='PASS');
   ok(checkProductTruth('รักษาสิวหายขาด',[]).status==='REJECT');
   const gate=evaluatePublishEligibility({complianceStatus:truth.status,originalityStatus:'ORIGINAL',qualityStatus:'PASS',health:{healthStatus:'READY',remaining:1,blockers:[]},requiresShopPermission:false,shopPermission:false,userApproved:false});
   ok(gate.finalStatus==='READY_FOR_REVIEW');
   // Real isolated queue rows, without invented consent or an external post identity.
   await db.query(`insert into publishing_queue(id,owner_id,tiktok_account_id,consent_id,publish_mode,privacy_level,status,external_state) values($1::uuid,$2::uuid,$3::uuid,null,'DIRECT_POST',null,'REVIEW_REQUIRED','READY') on conflict(id) do nothing`,[work.id,owner,work.tiktok_account_id]);
   await record(work,'QUEUE',{fixture:true,approval:false,eligibility:gate.finalStatus});
   return{state:'COMPLETE',reason:'CONSENT_REQUIRED'};
 },publish:async()=>{throw new Error('Forbidden external publishing');},reconcile:async()=>{throw new Error('Forbidden external transport');}};
 let pendingMax=0;
 for(let minute=0;minute<=1440;minute++){
   now=start+minute*60000;await db.query('update private.audit_clock set at=$1::timestamptz',[new Date(now).toISOString()]);
   // Lost worker lease: a restarted process has no in-memory tasks and the DB fences its stale token.
   if(!restarts){const stale=await store.claim('GENERATE',randomUUID());if(stale){restarts++;await db.query('update multi_account_work set lease_expires_at=private.audit_now()-interval \'1 second\' where id=$1::uuid',[stale.id]);ok(await store.finish(stale,{state:'COMPLETE',reason:'STALE'})===false);}}
   await runWorkerPool(store,ports,{kind:'GENERATE',token:randomUUID,batch:50,concurrency:3,now:()=>now});
   const count=(await db.query("select count(*)::int n from multi_account_work where state in ('WAITING','CLAIMED')")).rows[0].n;pendingMax=Math.max(pendingMax,count);
 }
 const summary=(await db.query('select tiktok_account_id,state,count(*)::int n from multi_account_work group by 1,2')).rows;
 if(summary.filter(r=>r.state==='COMPLETE').reduce((n,r)=>n+r.n,0)!==15)console.log({fixtureStates:summary,fixtureStages:(await db.query('select stage,count(*) from private.readiness_events group by stage')).rows,networkFailures,providerFailures});
 ok(summary.filter(r=>r.state==='COMPLETE').reduce((n,r)=>n+r.n,0)===15);
 ok(summary.filter(r=>r.state==='REVIEW_REQUIRED').reduce((n,r)=>n+r.n,0)===1);
 ok(networkFailures===1&&providerFailures>0&&providerFailures<=8&&restarts===1);
 ok((await db.query("select count(*)::int n from multi_account_work where state in ('WAITING','CLAIMED')")).rows[0].n===0);
 ok((await db.query("select count(*)::int n from publishing_queue where id in (select id from multi_account_work) and status='REVIEW_REQUIRED' and consent_id is null")).rows[0].n===15);
 const runtime=(await db.query('select execution_mode,publishing_enabled from multi_account_runtime')).rows[0];ok(runtime.execution_mode==='SAFE'&&runtime.publishing_enabled===false);
 const report={result:'PASS',virtualHours:24,wallClockUptimeCertified:false,checks,cadence:[2,5,9],accounts:3,planned:plan.length,complete:15,reviewRequired:1,networkFailures,providerFailures,boundedProviderAttempts:8,restarts,queueMax:pendingMax,queueRemaining:0,
   pipeline:'Actual scheduler/SQL leases, Product Radar scoring, Assignment planner, local MockAIProvider, compliance/eligibility functions and isolated publishing_queue rows; VIDEO/QUALITY are mock boundaries, not real paid media or production publishing',queuedForReview:15,paidCalls:0,tiktokCalls:0,safeMode:true};
 await mkdir('test-results/multi-account',{recursive:true});await writeFile('test-results/multi-account/readiness-day.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
