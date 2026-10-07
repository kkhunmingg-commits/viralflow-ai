// SQL orchestration fixtures only; never connect to an external service.
export async function runCronProof(db,assert,accountCases) {
  const owner='30000000-0000-4000-8000-000000000001';
  const other='30000000-0000-4000-8000-000000000002';
  const accounts=Array.from({length:4},(_,i)=>`40000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
  let checks=0;
  const check=(value,message)=>{assert.ok(value,message);checks++;};
  await db.exec('reset role');
  // Earlier isolated cases deliberately retain an in-flight STOP lease. Expire
  // only that ephemeral fixture's leases before this independent capacity case.
  await db.query("update public.auto_account_states set execution_lease_expires_at=now()-interval '1 second' where owner_id='10000000-0000-4000-8000-000000000001' and execution_lease_token is not null");
  await db.query("insert into auth.users(id,email) values($1,'post-cron-proof@example.invalid'),($2,'post-cron-other@example.invalid')",[owner,other]);
  for(const [i,id] of accounts.entries()) await db.query(`insert into public.tiktok_accounts(id,owner_id,display_name,username,account_status,authorization_status,
    daily_post_hard_limit,daily_video_budget_usd) values($1,$2,$3,$4,'active','authorized',20,10)`,[id,owner,`SQL Scheduler Proof ${i}`,`cron_proof_${i}`]);
  const date=new Date().toISOString().slice(0,10), now=`${date}T06:00:00Z`;
  await db.exec('set role service_role');
  for(const [i,id] of accounts.entries()) await q('select public.upsert_post_account_schedule($1,$2,$3::jsonb)',[owner,id,JSON.stringify({
    postingMode:['AUTO','DRAFT','EXPORT','EXPORT'][i],creativeMode:'GROWTH',clipsPerDay:[7,5,6,6][i],activeStart:i===1?720:540,
    activeEnd:i===1?1380:1320,timezone:'Asia/Bangkok',minSpacingMinutes:60,allowedDays:[0,1,2,3,4,5,6],enabled:true,dailyBudgetUsd:1})]);
  check((await q('select public.get_post_automation_execution_mode() mode'))[0].mode==='SAFE','database defaults SAFE');
  const tick=async()=> (await q('select public.tick_post_account_automation($1::timestamptz,3,$2) result',[now,owner]))[0].result;
  const first=await tick();
  check(first.status==='SUCCEEDED'&&first.failures===0,`first SAFE tick: ${JSON.stringify(first)}`);
  check(first.claimedJobs===3&&first.queuedAccounts===1,`three account runs, fourth queued: ${JSON.stringify(first)}`);
  const rows=await q('select id,tiktok_account_id,metrics_json from public.auto_runs where owner_id=$1 order by tiktok_account_id',[owner]);
  check(rows.length===3&&new Set(rows.map(row=>row.id)).size===3,'separate real persisted jobs');
  check(rows.every(row=>row.metrics_json.executionMode==='SAFE'&&row.metrics_json.externalCalls===0),'no external execution evidence');
  check((await q("select count(*)::int n from public.auto_account_states where owner_id=$1 and state='WAITING_FOR_PROVIDER' and blockers_json ? 'SAFE_EXECUTION_BOUNDARY'",[owner]))[0].n===3,'honest SAFE waiting states');
  const second=await tick();
  check(second.status==='SUCCEEDED'&&second.claimedJobs===1,'next tick starts only queued account');
  const third=await tick();
  check(third.claimedJobs===0&&(await q('select count(*)::int n from public.auto_runs where owner_id=$1',[owner]))[0].n===4,'repeat tick cannot duplicate logical jobs');
  check((await q('select count(*)::int n from public.post_schedule_slots where owner_id=$1 and auto_run_id is not null',[owner]))[0].n===4,'one run per used schedule slot');
  const runs=await q('select id,tiktok_account_id from public.auto_runs where owner_id=$1 order by tiktok_account_id',[owner]);
  // Simulate an operator retry only for isolated fixture jobs. SAFE WAIT must
  // never auto-clear its boundary or backoff in the real scheduler.
  await q("update public.auto_account_states set state='RUNNING',blockers_json='[]'::jsonb,execution_next_attempt_at=null where owner_id=$1",[owner]);
  const claim=async(i)=> (await q('select public.claim_auto_execution_step($1,$2,$3,$4,180,true) result',[owner,runs[i].id,runs[i].tiktok_account_id,`sql-capacity-${i}`]))[0].result;
  const claims=[];
  for(let i=0;i<3;i++) claims.push(await claim(i));
  check(claims.every(value=>Boolean(value?.leaseToken)),`three persisted execution leases: ${JSON.stringify({claims,states:await q('select state,current_step,execution_next_attempt_at,execution_lease_token,blockers_json from public.auto_account_states where owner_id=$1 order by tiktok_account_id',[owner])})}`);
  check(await claim(3)===null,'fourth worker is queued at database boundary');
  for(let i=0;i<3;i++) await q('select public.finish_auto_execution_step($1,$2,$3,$4,$5,\'WAIT\',$6::jsonb,$5,1,\'WAITING_FOR_PROVIDER\',\'SAFE_EXECUTION_BOUNDARY\')',
    [owner,runs[i].id,runs[i].tiktok_account_id,claims[i].leaseToken,claims[i].step,JSON.stringify({executionMode:'SAFE'})]);
  await q("update public.auto_account_states set state='WAITING_FOR_PROVIDER',blockers_json='[\"SAFE_EXECUTION_BOUNDARY\"]'::jsonb where owner_id=$1 and tiktok_account_id=$2",[owner,accounts[3]]);
  await q("select public.control_post_account($1,$2,'STOP')",[owner,accounts[0]]);
  check((await q('select state from public.auto_runs where id=$1',[runs[0].id]))[0].state==='STOPPED','STOP only selected account');
  check((await q("select count(*)::int n from public.auto_runs where owner_id=$1 and tiktok_account_id<>$2 and state='RUNNING'",[owner,accounts[0]]))[0].n===3,'other accounts remain active');
  await q("update public.auto_account_states set state='RUNNING',blockers_json='[]'::jsonb,execution_next_attempt_at=null where owner_id=$1 and tiktok_account_id=$2",[owner,accounts[1]]);
  const b=await claim(1);
  await q("select public.fail_auto_execution_step($1,$2,$3,$4,$5,'TRANSIENT',true,'SQL_PROOF_TRANSIENT','RETRY_PENDING')",[owner,runs[1].id,accounts[1],b.leaseToken,b.step]);
  check((await q('select state from public.auto_account_states where auto_run_id=$1',[runs[1].id]))[0].state==='RETRY_PENDING','failure has durable retry');
  check((await q("select count(*)::int n from public.auto_account_states where owner_id=$1 and tiktok_account_id=any($2::uuid[]) and state='WAITING_FOR_PROVIDER'",[owner,accounts.slice(2)]))[0].n===2,'failure does not cascade');
  const runCount=(await q('select count(*)::int n from public.auto_runs where owner_id=$1',[owner]))[0].n;
  for(let attempt=1;attempt<=3;attempt++) {
    await q("update public.auto_account_states set state='RUNNING',blockers_json='[]'::jsonb,execution_next_attempt_at=null where owner_id=$1 and tiktok_account_id=$2",[owner,accounts[2]]);
    await q("update public.auto_failures set next_retry_at=now()-interval '1 second' where owner_id=$1 and tiktok_account_id=$2",[owner,accounts[2]]);
    const crashed=await claim(2);
    check(Boolean(crashed?.leaseToken),`actual lease before simulated worker crash ${attempt}`);
    await q("update public.auto_account_states set execution_lease_expires_at=now()-interval '1 second' where owner_id=$1 and tiktok_account_id=$2",[owner,accounts[2]]);
    const recovered=await tick();
    check(recovered.failures===0&&recovered.recoveredJobs>=1,`stale SAFE lease recovered ${attempt}`);
    const recoveredState=(await q('select state,execution_lease_token,auto_run_id from public.auto_account_states where owner_id=$1 and tiktok_account_id=$2',[owner,accounts[2]]))[0];
    check(recoveredState.auto_run_id===runs[2].id&&recoveredState.execution_lease_token===null&&recoveredState.state===(attempt<3?'RETRY_PENDING':'FAILED'),`bounded recovery stays on same logical job ${attempt}`);
  }
  check((await q('select count(*)::int n from public.auto_runs where owner_id=$1',[owner]))[0].n===runCount,'crash retries never duplicate the scheduled logical job');
  // Composite arguments cannot be serialized as objects by every PostgreSQL driver; use the real table row.
  const timeline=async(at)=>(await q('select private.plan_post_account_schedule(s,$3::timestamptz) result from public.post_account_schedules s where owner_id=$1 and tiktok_account_id=$2',[owner,accounts[2],at]))[0].result;
  const before=await timeline(`${date}T16:59:00Z`), after=await timeline(`${date}T17:00:00Z`);
  check(before.slots[0].localDate===date,'Bangkok day before midnight');
  check(after.slots[0].localDate!==date,'Bangkok resets at UTC17');
  check(new Date(before.slots[0].scheduledAt).getUTCHours()===2,'Bangkok 09:00 maps UTC02');
  check(before.slots.length===6&&after.slots.length===6,'daily target survives local day boundary');
  check(new Date(after.nextDue)>new Date(`${date}T17:00:00Z`),'next run calculated after restart/day boundary');
  check((await q('select count(*)::int n from public.post_outputs where owner_id=$1',[owner]))[0].n===0,'SAFE creates no fake output');
  check((await q('select count(*)::int n from public.generation_jobs where owner_id=$1',[owner]))[0].n===0,'SAFE creates no paid generation job');
  check((await q('select count(*)::int n from public.publishing_queue where owner_id=$1',[owner]))[0].n===0,'SAFE creates no publishing request');
  check((await q('select public.get_post_scheduler_health() result'))[0].result.lastSuccessfulTick!==null,'real health last success');
  await db.exec('reset role');
  check((await q("select count(*)::int n from cron.job where jobname='viralflow-post-account-automation'"))[0].n===1,'one stable cron contract registration on migration replay');
  await q("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await db.exec('set role authenticated');
  check((await q('select count(*)::int n from public.post_account_schedules'))[0].n===4,'owner schedule read');
  await db.exec('reset role');
  await q("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  await db.exec('set role authenticated');
  check((await q('select count(*)::int n from public.post_account_schedules'))[0].n===0,'cross-owner schedule read denied');
  await assert.rejects(()=>q('select public.get_post_scheduler_health()'),/permission denied/);checks++;
  await db.exec('reset role');
  console.log(JSON.stringify({databaseCases:accountCases+checks,schedulerCases:checks,result:'PASS',networkCalls:0,paidCalls:0,cronEngine:'CONTRACT_STUB_ONLY'}));
  return accountCases+checks;
}
