// Run against disposable, in-memory PostgreSQL only. This script never loads
// environment files, reads credentials, or opens a remote database connection.
// Usage: node scripts/test-fal-budget-sql.mjs <path-to-pglite-dist/index.js>
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.argv[2];
if (!modulePath) throw new Error("Provide the local PGlite module path; no application dependency is required.");
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
const db = await PGlite.create();
const phase6 = await readFile("supabase/migrations/20260915195004_phase_6_video_factory.sql", "utf8");
const phase11 = await readFile("supabase/migrations/20260923143000_phase_11b_exactly_once_atomic_budget.sql", "utf8");
const upgrade = await readFile("supabase/migrations/20261003190554_fal_generation_budget_guards.sql", "utf8");

function table(sql, name) {
  const start = sql.indexOf(`create table public.${name} (`);
  assert(start >= 0, `missing original table ${name}`);
  return sql.slice(start, sql.indexOf("\n);", start) + 3);
}

function rpc(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert(start >= 0, `missing original RPC ${name}`);
  return sql.slice(start, sql.indexOf("end $$;", start) + 7);
}

function policy(sql, name) {
  const start = sql.indexOf(`create policy ${name} `);
  assert(start >= 0, `missing original policy ${name}`);
  return sql.slice(start, sql.indexOf(";", start) + 1);
}

try {
  // Foreign-key dependencies and auth.uid are synthetic. Tables, constraints,
  // original owner RLS, submission transitions and new RPC bodies are real SQL.
  // Retain permissive client grants to prove fal guards also protect legacy RLS.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema auth to authenticated;
    create table public.profiles(id uuid primary key);
    create table public.tiktok_accounts(owner_id uuid,id uuid,unique(owner_id,id));
    create table public.creative_projects(owner_id uuid,id uuid,unique(owner_id,id));
    create table public.products(owner_id uuid,id uuid,unique(owner_id,id));
    create table public.scripts(owner_id uuid,id uuid,unique(owner_id,id));
    create table public.auto_runs(owner_id uuid,id uuid,budget_usd numeric,spent_usd numeric,unique(owner_id,id));
    ${table(phase6, "generation_jobs")}
    ${table(phase6, "master_videos")}
    ${table(phase6, "generation_costs")}
    ${table(phase11, "generation_budget_reservations")}
    alter table public.generation_jobs enable row level security;
    grant select,insert,update,delete on public.generation_jobs to authenticated;
    ${policy(phase6, "generation_jobs_read")}
    ${policy(phase6, "generation_jobs_insert")}
    ${policy(phase6, "generation_jobs_update")}
    create policy test_generation_jobs_owner_delete on public.generation_jobs for delete to authenticated
      using((select auth.uid())=owner_id);
    ${rpc(phase11, "begin_generation_submission")}
    ${rpc(phase11, "mark_generation_submitted")}
    ${rpc(phase11, "release_generation_budget")}
    ${upgrade}
  `);

  async function fixture() {
    const owner = randomUUID(), account = randomUUID(), job = randomUUID();
    await db.query("insert into public.profiles(id) values($1)", [owner]);
    await db.query("insert into public.tiktok_accounts(owner_id,id) values($1,$2)", [owner, account]);
    await db.query(`insert into public.generation_jobs(owner_id,id,idempotency_key,job_type,provider,model)
      values($1,$2,$3,'MASTER_RENDER','fal','test-model')`, [owner, job, `test-job:${job}`]);
    return { owner, account, job };
  }

  const defaults = { cost: .1, clip: .5, daily: 5, monthly: 50, run: 5, account: 5, provider: 5 };
  async function reserve(fixture, slot, limits = {}) {
    const policy = { ...defaults, ...limits };
    const result = await db.query(`select * from public.reserve_generation_budget(
      $1::uuid,$2::uuid,$3::uuid,null::uuid,$4::text,$5::text,$13::text,'test-model'::text,
      $6::numeric,$7::numeric,$8::numeric,$9::numeric,$10::numeric,$11::numeric,$12::numeric,
      '2026-10-04'::date,'2026-10-01'::date,900::integer)`,
    [fixture.owner, fixture.account, fixture.job, `test-run:${fixture.owner}`, `test:${fixture.job}:${slot}`,
      policy.cost, policy.clip, policy.daily, policy.monthly, policy.run, policy.account, policy.provider, policy.providerName ?? "fal"]);
    return result.rows[0];
  }

  async function begin(fixture, hold) {
    return (await db.query("select * from public.begin_generation_submission($1,$2)", [fixture.owner, hold.id])).rows[0];
  }

  async function submitted(fixture, hold, request) {
    return (await db.query("select * from public.mark_generation_submitted($1,$2,$3)", [fixture.owner, hold.id, request])).rows[0];
  }

  async function settle(fixture, hold, cost, request) {
    return (await db.query("select * from public.settle_generation_budget($1,$2,$3,$4)", [fixture.owner, hold.id, cost, request])).rows[0];
  }

  async function release(fixture, hold) {
    return (await db.query("select * from public.release_generation_budget($1,$2,true)", [fixture.owner, hold.id])).rows[0];
  }

  const clip = await fixture();
  assert.equal((await db.query("select public.fal_budget_guard_version() as version")).rows[0].version, "fal-generation-budget-guards-v1");
  const primary = await reserve(clip, "primary", { cost: .15, clip: .25 });
  assert.equal((await reserve(clip, "primary", { cost: .15, clip: .25 })).id, primary.id);
  await assert.rejects(reserve(clip, "primary", { cost: .1 }), /budget_operation_identity_conflict/);
  await assert.rejects(reserve(clip, "fallback"), /paid_generation_previous_attempt_pending/);
  await begin(clip, primary);
  await assert.rejects(begin(clip, primary), /budget_reservation_not_submittable/);
  await assert.rejects(submitted(clip, primary, null), /budget_provider_request_invalid/);
  await submitted(clip, primary, "primary-request");
  await submitted(clip, primary, "primary-request");
  await assert.rejects(submitted(clip, primary, "replacement-request"), /budget_submission_state_conflict/);
  await assert.rejects(release(clip, primary), /provider_charge_must_be_reconciled/);
  const uncertain = (await db.query("select * from public.mark_generation_unknown($1,$2,null)", [clip.owner, primary.id])).rows[0];
  assert.equal(uncertain.provider_submission_state, "SUBMITTED_UNKNOWN");
  assert.equal(uncertain.provider_request_id, "primary-request");
  await assert.rejects(db.query("select * from public.mark_generation_unknown($1,$2,$3)",
    [clip.owner, primary.id, "replacement-request"]), /budget_unknown_state_conflict/);
  await assert.rejects(release(clip, primary), /provider_charge_must_be_reconciled/);
  await assert.rejects(reserve(clip, "fallback"), /paid_generation_previous_attempt_pending/);
  await assert.rejects(settle(clip, primary, null, "primary-request"), /invalid_budget_settlement/);
  await settle(clip, primary, .15, "primary-request");
  await assert.rejects(settle(clip, primary, .15, "replacement-request"), /budget_provider_request_conflict/);
  await assert.rejects(settle(clip, primary, .1, "primary-request"), /budget_settlement_amount_conflict/);
  await assert.rejects(settle(clip, primary, null, "primary-request"), /budget_settlement_amount_conflict/);
  assert.equal((await reserve(clip, "primary", { cost: .15, clip: .25 })).state, "SETTLED");
  await assert.rejects(begin(clip, primary), /budget_reservation_not_submittable/);
  // A later request cannot raise the original clip/job budget.
  await assert.rejects(reserve(clip, "fallback", { cost: .15, clip: 10 }), /per_video_budget_exceeded/);
  const fallback = await reserve(clip, "fallback", { cost: .1, clip: .25 });
  await begin(clip, fallback);
  await submitted(clip, fallback, "fallback-request");
  await settle(clip, fallback, .1, "fallback-request");
  await settle(clip, fallback, .1, "fallback-request");
  const costs = (await db.query("select quantity,total_cost_usd from public.generation_costs where owner_id=$1", [clip.owner])).rows;
  assert.equal(costs.length, 1);
  assert.equal(Number(costs[0].quantity), 2);
  assert.equal(Number(costs[0].total_cost_usd), .25);
  await assert.rejects(reserve(clip, "third"), /paid_generation_attempt_limit_exceeded/);

  const unpaid = await fixture();
  const beforeSubmit = await reserve(unpaid, "primary");
  await begin(unpaid, beforeSubmit);
  await release(unpaid, beforeSubmit);
  const reopened = await reserve(unpaid, "primary");
  assert.equal(reopened.id, beforeSubmit.id);
  assert.equal(reopened.provider_submission_state, "REQUEST_NOT_SENT");
  assert.equal(reopened.released_at, null);
  await begin(unpaid, reopened);
  await release(unpaid, reopened);
  const otherSlot = await reserve(unpaid, "fallback");
  await release(unpaid, otherSlot);
  await assert.rejects(reserve(unpaid, "third"), /paid_generation_attempt_limit_exceeded/);
  assert.equal((await reserve(unpaid, "primary")).id, beforeSubmit.id);

  // Reservations, including requests awaiting results, count against every cap.
  for (const [cap, error] of [["daily", "daily_budget_exceeded"], ["monthly", "monthly_budget_exceeded"],
    ["run", "run_budget_exceeded"], ["account", "account_budget_exceeded"], ["provider", "provider_budget_exceeded"]]) {
    const budget = await fixture();
    await reserve(budget, "primary", { cost: .2 });
    const nextJob = randomUUID();
    await db.query(`insert into public.generation_jobs(owner_id,id,idempotency_key,job_type,provider,model)
      values($1,$2,$3,'MASTER_RENDER','fal','test-model')`, [budget.owner, nextJob, `test-job:${nextJob}`]);
    await assert.rejects(reserve({ ...budget, job: nextJob }, "primary", { [cap]: .25 }), new RegExp(error));
  }

  const held = await fixture();
  const heldPrimary = await reserve(held, "primary");
  await begin(held, heldPrimary);
  await db.query("select * from public.mark_generation_unknown($1,$2,null)", [held.owner, heldPrimary.id]);
  await assert.rejects(db.query("select * from public.release_generation_budget($1,$2,false)", [held.owner, heldPrimary.id]),
    /provider_charge_must_be_reconciled/);
  await assert.rejects(release(held, heldPrimary), /provider_charge_must_be_reconciled/);
  await assert.rejects(reserve(held, "fallback"), /paid_generation_previous_attempt_pending/);

  const otherProvider = await fixture();
  for (const slot of ["one", "two", "three"]) {
    await reserve(otherProvider, slot, { providerName: "google", clip: .1 });
  }

  const media = await fixture();
  const project = randomUUID(), product = randomUUID(), script = randomUUID(), master = randomUUID();
  await db.query("insert into public.creative_projects(owner_id,id) values($1,$2)", [media.owner, project]);
  await db.query("insert into public.products(owner_id,id) values($1,$2)", [media.owner, product]);
  await db.query("insert into public.scripts(owner_id,id) values($1,$2)", [media.owner, script]);
  await db.query("update public.generation_jobs set creative_project_id=$1,attempt=0,status='PROCESSING' where id=$2", [project, media.job]);
  const masterPayload = { id: master, owner_id: media.owner, tiktok_account_id: media.account,
    product_id: product, creative_project_id: project, selected_script_id: script, generation_job_id: media.job,
    provider: "fal", model: "test-model", render_strategy: "AI_IMAGE_TO_VIDEO", duration_seconds: 8,
    width: 720, height: 1280, fps: 30, storage_path: `owner/${media.owner}/masters/master.mp4`,
    quality_status: "RETRY", quality_score: 80, quality_explanation_json: {}, estimated_cost_usd: .1, status: "READY" };
  async function persist(attempt, payload, output = {}, complete = false) {
    return (await db.query("select public.persist_fal_master($1,$2,$3,$4::jsonb,$5::jsonb,$6) as result",
      [media.owner, media.job, attempt, JSON.stringify(payload), JSON.stringify(output), complete])).rows[0].result;
  }
  assert.equal((await persist(0, masterPayload, { reviewRequired: true })).accepted, true);
  await db.query("update public.generation_jobs set attempt=1 where id=$1", [media.job]);
  assert.equal((await persist(1, masterPayload, { attempts: [{ attempt: 1, state: "QUALITY_FAILED" }] })).accepted, true);
  await db.query("update public.generation_jobs set attempt=2 where id=$1", [media.job]);
  const passed = await persist(2, { ...masterPayload, quality_status: "PASS", quality_score: 95 },
    { reviewRequired: false, attempts: [{ attempt: 2, state: "PASS" }] }, true);
  assert.equal(passed.accepted, true);
  const completed = (await db.query("select status,output_json,master_video_id from public.generation_jobs where id=$1", [media.job])).rows[0];
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.master_video_id, master);
  assert.deepEqual(completed.output_json.attempts.map(attempt => attempt.attempt), [1, 2]);
  const stale = await persist(1, masterPayload, { attempts: [{ attempt: 1, state: "LATE_RESULT" }] }, true);
  assert.equal(stale.accepted, false);
  assert.equal(stale.master.quality_status, "PASS");
  assert.equal((await persist(2, masterPayload)).accepted, false);
  await assert.rejects(persist(2, { ...masterPayload, owner_id: randomUUID() }), /fal_master_persistence_input_invalid/);
  await db.query("update public.generation_jobs set status='CANCELLED' where id=$1", [media.job]);
  assert.equal((await persist(2, { ...masterPayload, quality_status: "PASS" })).accepted, false);

  const guarded = await fixture(), foreign = await fixture(), localJob = randomUUID(), serviceJob = randomUUID();
  const serverPolicy = { falPolicy: { perVideoCapUsd: .25, dailyCapUsd: 5, monthlyCapUsd: 50 } };
  await db.query("update public.generation_jobs set input_json=$1::jsonb where id=$2",
    [JSON.stringify(serverPolicy), guarded.job]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [guarded.owner]);
  await db.exec("set role authenticated");
  const ownerRead = (await db.query("select input_json from public.generation_jobs where id=$1", [guarded.job])).rows;
  assert.equal(ownerRead.length, 1);
  assert.deepEqual(ownerRead[0].input_json, serverPolicy);
  assert.equal((await db.query("select id from public.generation_jobs where id=$1", [foreign.job])).rows.length, 0);
  await assert.rejects(db.query(`insert into public.generation_jobs(owner_id,idempotency_key,job_type,provider,model,input_json)
    values($1,$2,'MASTER_RENDER','fal','test-model',$3::jsonb)`,
  [guarded.owner, `forged-fal:${randomUUID()}`, JSON.stringify({ falPolicy: { dailyCapUsd: 999 } })]), /row-level security/);
  for (const change of ["input_json='{}'::jsonb", "provider='local-ffmpeg'", "status='CANCELLED'"]) {
    assert.equal((await db.query(`update public.generation_jobs set ${change} where id=$1 returning id`,
      [guarded.job])).rows.length, 0);
  }
  assert.equal((await db.query("delete from public.generation_jobs where id=$1 returning id", [guarded.job])).rows.length, 0);
  const insertedLocal = (await db.query(`insert into public.generation_jobs(owner_id,id,idempotency_key,job_type,provider,model)
    values($1,$2,$3,'MASTER_RENDER','local-ffmpeg','ffmpeg-template-v1') returning id`,
  [guarded.owner, localJob, `local-job:${localJob}`])).rows;
  assert.equal(insertedLocal[0].id, localJob);
  assert.equal((await db.query("update public.generation_jobs set status='PROCESSING' where id=$1 returning id",
    [localJob])).rows.length, 1);
  await assert.rejects(db.query("update public.generation_jobs set provider='fal',input_json=$1::jsonb where id=$2",
    [JSON.stringify({ falPolicy: { dailyCapUsd: 999 } }), localJob]), /row-level security/);
  await assert.rejects(db.query(`insert into public.generation_jobs(owner_id,idempotency_key,job_type,provider,model)
    values($1,$2,'MASTER_RENDER','local-ffmpeg','test-model')`,
  [foreign.owner, `foreign-job:${randomUUID()}`]), /row-level security/);
  assert.equal((await db.query("delete from public.generation_jobs where id=$1 returning id", [localJob])).rows.length, 1);
  await db.exec("reset role; set role service_role");
  assert.equal((await db.query(`insert into public.generation_jobs(owner_id,id,idempotency_key,job_type,provider,model,input_json)
    values($1,$2,$3,'MASTER_RENDER','fal','test-model',$4::jsonb) returning id`,
  [guarded.owner, serviceJob, `service-fal:${serviceJob}`, JSON.stringify(serverPolicy)])).rows[0].id, serviceJob);
  assert.equal((await db.query("update public.generation_jobs set status='PROCESSING' where id=$1 returning id",
    [serviceJob])).rows.length, 1);
  await db.exec("reset role");
  assert.deepEqual((await db.query("select provider,input_json,status from public.generation_jobs where id=$1",
    [guarded.job])).rows[0], { provider: "fal", input_json: serverPolicy, status: "QUEUED" });
  const guards = (await db.query("select permissive,cmd from pg_policies where tablename='generation_jobs' and policyname like 'fal_generation_jobs_server_%'")).rows;
  assert.equal(guards.length, 3);
  assert.deepEqual(guards.map(guard => guard.cmd).sort(), ["DELETE", "INSERT", "UPDATE"]);
  assert(guards.every(guard => guard.permissive === "RESTRICTIVE"));

  for (const name of ["reserve_generation_budget", "mark_generation_submitted", "mark_generation_unknown", "settle_generation_budget", "release_generation_budget", "persist_fal_master", "fal_budget_guard_version"]) {
    const privileges = (await db.query(`select
      has_function_privilege('anon',oid,'execute') as anon,
      has_function_privilege('authenticated',oid,'execute') as authenticated,
      has_function_privilege('service_role',oid,'execute') as service,
      prosecdef from pg_proc where proname=$1`, [name])).rows[0];
    assert.equal(privileges.anon, false);
    assert.equal(privileges.authenticated, false);
    assert.equal(privileges.service, true);
    assert.equal(privileges.prosecdef, false);
  }
  await db.exec("set role authenticated");
  await assert.rejects(db.query("select public.persist_fal_master($1,$2,2,$3::jsonb,'{}'::jsonb,true)",
    [media.owner, media.job, JSON.stringify(masterPayload)]), /permission denied for function persist_fal_master/);
  await db.exec("reset role");
  console.log("PASS: actual PostgreSQL RPCs, same-slot identity/replay/reopen, aggregate job + five spend caps, two-attempt limit, request identity and settlement replay, no release of submitted/unknown liability, cost accumulation, atomic master + attempt persistence, stale/cancelled result rejection, fal job server-only writes with owner reads + non-fal writes preserved, and service-only invoker permissions.");
} finally {
  await db.close();
}
