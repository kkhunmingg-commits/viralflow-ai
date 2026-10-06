// Fixture records exist ONLY in this ephemeral PostgreSQL instance.
export async function runProof(db,assert) {
  const owner='10000000-0000-4000-8000-000000000001';
  const other='10000000-0000-4000-8000-000000000002';
  const ids=Array.from({length:10},(_,i)=>`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
  let checks=0;
  const check=(condition,message)=>{assert.ok(condition,message);checks++;};
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
  await db.query("insert into auth.users(id,email) values($1,'internal-proof@example.invalid'),($2,'other-proof@example.invalid')",[owner,other]);
  for(const [index,id] of ids.entries()) await db.query(`insert into public.tiktok_accounts(id,owner_id,display_name,username,account_status,
    daily_post_hard_limit,daily_video_budget_usd) values($1,$2,$3,$4,'active',20,10)`,[id,owner,`Internal ${index}`,`proof_${index}`]);
  await db.exec('set role service_role');
  const plan=(account,mode='EXPORT',extra={})=>[{accountId:account,postingMode:mode,requestedMode:'GROWTH',mode:'GROWTH',state:'RUNNING',nextAction:'WAIT_FOR_DATA',blockers:[],desiredCandidates:15,desiredPosts:1,maxDailyCostUsd:1,generationCapacity:1,publishCapacity:1,priority:100,actionKey:`proof:${account}`,...extra}];
  const create=async(account,key,mode='EXPORT',extra={}) => (await q('select * from public.create_operator_auto_run_atomic($1,$2,$6::date,$3,$4,$5::jsonb,1)',[owner,key,'boundary-proof','UNAVAILABLE_NO_PAID',JSON.stringify(plan(account,mode,{actionKey:`${key}:action`,...extra})),new Date().toISOString().slice(0,10)]))[0];
  const runs=await Promise.all(ids.map((id,i)=>create(id,`proof-run-${i}`,['AUTO','DRAFT','EXPORT'][i%3])));
  check(new Set(runs.map(r=>r.id)).size===10,'ten accounts reserve independent runs');
  check((await create(ids[0],'another-start','AUTO')).id===runs[0].id,'same account second START returns active run');
  check((await create(ids[0],'proof-run-0','AUTO')).id===runs[0].id,'same request is idempotent');
  await assert.rejects(()=>create(ids[1],'proof-run-0','DRAFT'),/account_mismatch/);checks++;
  await assert.rejects(()=>db.query('select public.create_auto_run_atomic($1,$2,current_date,$3,$4,$5::jsonb)',[other,'wrong-owner','x','x',JSON.stringify(plan(ids[0]))]),/account_not_found/);checks++;
  await assert.rejects(()=>db.query("update auto_runs set posting_mode='EXPORT' where id=$1",[runs[0].id]),/identity_immutable/);checks++;
  const claim=async(i,worker)=> (await q('select public.claim_auto_execution_step($1,$2,$3,$4,900,true) as claim',[owner,runs[i].id,ids[i],worker]))[0].claim;
  const a=await claim(0,'proof-a'),b=await claim(1,'proof-b');
  check(a.accountId===ids[0] && b.accountId===ids[1],'independent claims');
  check(a.postingMode==='AUTO'&&b.postingMode==='DRAFT','immutable mode reaches actual execution claim');
  check(await claim(0,'duplicate-worker')===null,'leased account cannot duplicate step');
  await db.query("select public.control_post_account($1,$2,'STOP')",[owner,ids[0]]);
  check((await q('select state from auto_account_states where auto_run_id=$1',[runs[0].id]))[0].state==='STOPPED','STOP account A');
  check((await q('select state from auto_account_states where auto_run_id=$1',[runs[1].id]))[0].state==='RUNNING','STOP A leaves B running');
  check(await claim(0,'stopped-worker')===null,'STOP prohibits subsequent claim');
  await db.query(`select public.finish_auto_execution_step($1,$2,$3,$4,$5,'ADVANCE','{}','CREATE_CREATIVE',1,null,null)`,[owner,runs[0].id,ids[0],a.leaseToken,a.step]);
  check((await q('select state from auto_account_states where auto_run_id=$1',[runs[0].id]))[0].state==='STOPPED','in-flight finish cannot resume stopped A');
  await db.query('update auto_account_states set execution_lease_expires_at=now()-interval \'1 second\' where auto_run_id=$1',[runs[1].id]);
  const resumed=await claim(1,'after-crash');
  check(resumed&&resumed.operationKey===b.operationKey&&resumed.leaseToken!==b.leaseToken,'restart reclaims same operation key');
  await claim(3,'in-flight-cost-boundary');
  await db.query("select public.control_post_account($1,$2,'STOP')",[owner,ids[3]]);
  await assert.rejects(()=>create(ids[3],'start-during-unresolved-work','AUTO'),/reconciliation_required/);checks++;
  await db.query("select public.control_post_account($1,$2,'STOP')",[owner,ids[2]]);
  const config={postingMode:'EXPORT',creativeMode:'GROWTH',clipsPerDay:3,activeStart:0,activeEnd:1440,timezone:'Asia/Bangkok',minSpacingMinutes:30,allowedDays:[0,1,2,3,4,5,6],enabled:true,dailyBudgetUsd:1};
  const schedule=(await q('select * from public.upsert_post_account_schedule($1,$2,$3::jsonb)',[owner,ids[2],JSON.stringify(config)]))[0];
  const now=Date.now(),date=new Date().toISOString().slice(0,10),slotkey=`post:${ids[2]}:${date}:1`;
  const slots=[{localDate:date,ordinal:1,key:slotkey,scheduledAt:new Date(now-60000).toISOString(),expiresAt:new Date(now+600000).toISOString()},
    {localDate:date,ordinal:2,key:slotkey.replace(/1$/,'2'),scheduledAt:new Date(now-1200000).toISOString(),expiresAt:new Date(now-600000).toISOString()}];
  const materialize=()=>q('select public.materialize_post_schedule_slots($1,$2,$3,$4::jsonb,$5)',[owner,ids[2],schedule.revision,JSON.stringify(slots),new Date(now+86400000).toISOString()]);
  await materialize();await materialize();
  check((await q('select count(*)::int n from post_schedule_slots where tiktok_account_id=$1',[ids[2]]))[0].n===2,'materialization idempotency');
  const slotClaim=async()=> (await q('select * from public.claim_post_schedule_slot($1,$2,now())',[owner,ids[2]]))[0];
  check(!(await slotClaim()).slot_key,'minimum spacing prevents immediate replacement run');
  await db.query("update auto_runs set started_at=now()-interval '31 minutes' where id=$1",[runs[2].id]);
  const slot=await slotClaim();check(slot.slot_key===slotkey,'latest due nonexpired slot claimed');
  check((await q('select state from post_schedule_slots where tiktok_account_id=$1 and ordinal=2',[ids[2]]))[0].state==='MISSED','expired slot missed');
  check(!(await slotClaim()).slot_key,'no concurrent duplicate slot');
  const scheduled=await create(ids[2],slotkey,'EXPORT',{scheduleSlotKey:slotkey});
  await q('select public.reconcile_post_schedule_slots()');
  check((await q('select auto_run_id,state from post_schedule_slots where slot_key=$1',[slotkey]))[0].auto_run_id===scheduled.id,'crash before settlement links existing run');
  const scheduledClaim=(await q('select public.claim_auto_execution_step($1,$2,$3,$4,900,true) claim',[owner,scheduled.id,ids[2],'scheduled-proof']))[0].claim;
  check(scheduledClaim.slotOrdinal===1&&Date.parse(scheduledClaim.scheduledFor)===new Date(slot.scheduled_at).getTime(),'schedule identity reaches claim');
  await db.query("select public.control_post_account($1,$2,'STOP')",[owner,ids[2]]);
  check((await q('select enabled from post_account_schedules where tiktok_account_id=$1',[ids[2]]))[0].enabled===false,'STOP disables account schedule');
  check(!(await slotClaim()).slot_key,'disabled schedule cannot create new work');
  await db.query("select public.control_post_account($1,$2,'START')",[owner,ids[2]]);
  check(!(await slotClaim()).slot_key,'START never replays consumed slot');
  await db.query("select public.control_post_account($1,$2,'STOP')",[owner,ids[4]]);
  await q('select * from public.upsert_post_account_schedule($1,$2,$3::jsonb)',[owner,ids[4],JSON.stringify(config)]);
  const retryKey=`post:${ids[4]}:${date}:1`;
  await db.query(`insert into post_schedule_slots(owner_id,tiktok_account_id,local_date,ordinal,slot_key,scheduled_at,expires_at,posting_mode)
    values($1,$2,$3::date,1,$4,now()-interval '2 minutes',now()+interval '6 hours','EXPORT')`,[owner,ids[4],date,retryKey]);
  for(let attempt=1;attempt<=3;attempt++) {
    const retry=(await q("select * from public.claim_post_schedule_slot($1,$2,now()+interval '1 hour')",[owner,ids[4]]))[0];
    check(retry.attempts===attempt,'durable retry attempt '+attempt);
    await q('select public.settle_post_schedule_slot($1,$2,$3,$4,null,true)',[owner,ids[4],retryKey,retry.lease_token]);
  }
  check((await q('select state from post_schedule_slots where slot_key=$1',[retryKey]))[0].state==='FAILED','bounded retries terminate at three');
  check(!(await q("select * from public.claim_post_schedule_slot($1,$2,now()+interval '1 hour')",[owner,ids[4]]))[0].slot_key,'failed slot never retries indefinitely');
  check(!(await q("select 1 from pg_indexes where indexname='auto_runs_one_active_per_owner_idx'")).length,'owner-global unique lock removed');
  const tables=['post_account_schedules','post_schedule_slots','post_outputs'];
  for(const table of tables) {
    check((await q('select relrowsecurity from pg_class where oid=$1::regclass',[`public.${table}`]))[0].relrowsecurity,'RLS enabled '+table);
    check((await q("select has_table_privilege('anon',$1,'SELECT') permitted",[`public.${table}`]))[0].permitted===false,'anon cannot read '+table);
    check((await q("select has_table_privilege('authenticated',$1,'UPDATE') permitted",[`public.${table}`]))[0].permitted===false,'customer cannot forge '+table);
  }
  await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)',[other]);
  await db.exec('set role authenticated');
  check((await q('select count(*)::int n from post_account_schedules'))[0].n===0,'other owner cannot see schedule');
  await assert.rejects(()=>db.query("select public.control_post_account($1,$2,'STOP')",[owner,ids[1]]),/permission denied/);checks++;
  await db.exec('reset role');
  console.log(JSON.stringify({databaseCases:checks,result:'PASS',networkCalls:0,paidCalls:0}));
}
