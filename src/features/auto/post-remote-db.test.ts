import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AccountPostSchedule } from "./account-schedule";
import type { ExecutionClaim, ExecutionStage } from "./processor";

vi.mock("server-only", () => ({}));

// Deliberately opt-in. Credentials come only from the caller's process; this
// proof never reads an env file, obtains keys, changes flags or contacts TikTok.
const enabled = process.env.POST_SCHEDULER_REMOTE_PROOF === "1";
const markerPrefix = "post-remote-proof";
type Row = Record<string, unknown>;
interface OwnerFixture {
  id: string; email: string; password: string; accounts: string[]; marker: string;
  client?: SupabaseClient; accessToken?: string; refreshToken?: string;
}
interface TickResult {
  mode: string; status: string; claimedJobs: number; recoveredJobs?: number;
  skippedDuplicate: number; queuedAccounts?: number; failures: number; nextRun?: string;
}
interface ProofReport {
  database: "REMOTE_SUPABASE"; mode: "SAFE"; owners: number; accounts: number;
  logicalJobs: number; maximumConcurrentLeases: number; queuedLeaseRequests: number;
  safeTerminal: "WAITING_FOR_PROVIDER"; safeReason: "SAFE_EXECUTION_BOUNDARY";
  internalStageCompleted: boolean; safeBoundaries: string[]; boundedFailureAttempts: number;
  staleExecutionRecovered: boolean; staleSlotRecovered: boolean; ownerRls: boolean;
  ownerWriteAllowed: boolean; crossOwnerWriteDenied: boolean; sessionsRevoked: boolean;
  crossOwnerDenied: boolean; anonDenied: boolean; timezoneVerified: boolean;
  nextDayVerified: boolean; generatedOutputs: number; paidCalls: number; tiktokCalls: number;
  blockedExternalAttempts: number; cleanup: "VERIFIED";
}

function requireData<T>(data: T | null, error: { code?: string } | null, operation: string): T {
  // Database/Auth error messages may contain request details. Report only codes.
  if (error || data === null) throw new Error(`${operation}:${error?.code ?? "missing_result"}`);
  return data;
}
async function rpc<T>(client: SupabaseClient, name: string, args: Row = {}): Promise<T> {
  const result = await client.rpc(name, args);
  return requireData(result.data as T | null, result.error, name);
}
async function rows(client: SupabaseClient, table: string, owner: string): Promise<Row[]> {
  const result = await client.from(table).select("*").eq("owner_id", owner);
  return requireData(result.data as Row[] | null, result.error, `read_${table}`);
}
async function insert(client: SupabaseClient, table: string, row: Row): Promise<Row> {
  const result = await client.from(table).insert(row).select("*").single();
  return requireData(result.data as Row | null, result.error, `insert_${table}`);
}
async function patch(client: SupabaseClient, table: string, owner: string, account: string, values: Row) {
  const result = await client.from(table).update(values).eq("owner_id", owner).eq("tiktok_account_id", account);
  if (result.error) throw new Error(`patch_${table}:${result.error.code}`);
}
async function accountState(client: SupabaseClient, owner: string, account: string): Promise<Row> {
  const result = await client.from("auto_account_states").select("*").eq("owner_id", owner)
    .eq("tiktok_account_id", account).order("created_at", { ascending: false }).limit(1).single();
  return requireData(result.data as Row | null, result.error, "account_state");
}
function safeStateSnapshot(row: Row) {
  return { run: row.auto_run_id, state: row.state, step: row.current_step,
    checkpoint: row.checkpoint_version, lease: row.execution_lease_token };
}
async function ready(client: SupabaseClient, owner: string, account: string, step?: ExecutionStage) {
  // This is an explicit, isolated fixture state, not a production bypass. It
  // simulates an operator/recovery wake-up and never fabricates output evidence.
  await patch(client, "auto_account_states", owner, account, {
    state: "RUNNING", blockers_json: [], execution_next_attempt_at: null,
    ...(step ? { current_step: step } : {}),
  });
}
async function removeFixture(client: SupabaseClient, fixture: OwnerFixture) {
  const user = await client.auth.admin.getUserById(fixture.id);
  if (user.error || user.data.user?.user_metadata.post_remote_proof !== fixture.marker) {
    throw new Error("cleanup_owner_marker_mismatch");
  }
  // Revoke refresh sessions before deletion. JWTs are stateless, so logout
  // alone is not evidence that an existing access token instantly expires.
  const revoked = fixture.accessToken ? await client.auth.admin.signOut(fixture.accessToken, "global") : null;
  let deleted = await client.auth.admin.deleteUser(fixture.id);
  if (deleted.error) {
    // Bound every cleanup write to a user created by this invocation. Deleting
    // parents cascades append-only histories without changing their grants.
    for (const table of ["post_outputs", "post_schedule_slots", "post_account_schedules",
      "creative_projects", "product_assignments", "account_product_scores", "products",
      "auto_account_states", "auto_runs", "tiktok_accounts"]) {
      const result = await client.from(table).delete().eq("owner_id", fixture.id);
      if (result.error) throw new Error(`cleanup_${table}:${result.error.code}`);
    }
    deleted = await client.auth.admin.deleteUser(fixture.id);
  }
  if (deleted.error) throw new Error(`cleanup_auth:${deleted.error.code ?? "failed"}`);
  for (const table of ["tiktok_accounts", "post_account_schedules", "post_schedule_slots", "post_outputs",
    "auto_runs", "auto_account_states", "auto_checkpoints", "auto_failures", "auto_run_steps",
    "auto_actions", "creative_projects", "creative_angles", "creative_generations", "scripts",
    "products", "product_assignments", "account_product_scores", "generation_jobs", "publishing_queue"]) {
    expect(await rows(client, table, fixture.id), `cleanup_${table}`).toHaveLength(0);
  }
  const profile = await client.from("profiles").select("id").eq("id", fixture.id);
  expect(requireData(profile.data, profile.error, "cleanup_profile")).toHaveLength(0);
  const auth = await client.auth.admin.getUserById(fixture.id);
  expect(auth.data.user).toBeNull();
  if (fixture.client && fixture.refreshToken && fixture.accessToken) {
    const refreshed = await fixture.client.auth.refreshSession({ refresh_token: fixture.refreshToken });
    expect(refreshed.error).not.toBeNull();
    expect(refreshed.data.session).toBeNull();
    const deletedUser = await fixture.client.auth.getUser(fixture.accessToken);
    expect(deletedUser.data.user).toBeNull();
    expect(deletedUser.error).not.toBeNull();
    await fixture.client.auth.signOut({ scope: "local" });
  }
  if (revoked?.error) throw new Error(`cleanup_session:${revoked.error.code ?? "failed"}`);
}

/** Called only by the explicit opt-in test/credential runner, never an app route. */
export async function runPostRemoteSchedulerProof(): Promise<ProofReport> {
  if (!enabled) throw new Error("remote_proof_not_authorized");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publicKey || !secret) throw new Error("remote_proof_credentials_missing");
  if (process.env.POST_AUTOMATION_EXECUTION_MODE === "LIVE") throw new Error("remote_proof_requires_safe_process");
  const origin = new URL(url).origin;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(origin)) throw new Error("remote_proof_project_not_allowed");
  const nativeFetch = globalThis.fetch;
  let blockedExternalAttempts = 0, tiktokCalls = 0, paidCalls = 0;
  let failAssignment: string | null = null;
  const guardedFetch: typeof fetch = async (input, init) => {
    const requested = new URL(input instanceof Request ? input.url : input.toString());
    if (requested.origin !== origin) {
      blockedExternalAttempts++;
      if (/tiktok/.test(requested.hostname)) tiktokCalls++;
      if (/fal|runway|pixverse|googleapis|openai/.test(requested.hostname)) paidCalls++;
      throw new Error("remote_proof_external_network_blocked");
    }
    // A transient error is injected solely at the real Supabase network boundary
    // for one owned assignment. Production processor/ports/store stay unchanged.
    if (failAssignment && requested.pathname === "/rest/v1/product_assignments"
      && requested.searchParams.get("id") === `eq.${failAssignment}`) throw new Error("network timeout remote proof");
    return nativeFetch(input, { ...init, redirect: "error" });
  };
  vi.stubGlobal("fetch", guardedFetch);
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: guardedFetch } };
  const admin = createClient(url, secret, options);
  const fixtures: OwnerFixture[] = [];
  let report: Omit<ProofReport, "cleanup"> | undefined;
  try {
    expect(await rpc<string>(admin, "get_post_automation_execution_mode")).toBe("SAFE");
    const initialHealth = await rpc<Row>(admin, "get_post_scheduler_health");
    expect(initialHealth.enabled).toBe(true);
    expect(initialHealth.maximumConcurrentAccounts).toBe(3);
    // Existing live worker leases make a global-capacity assertion unsafe and
    // nondeterministic. Stop before creating fixtures; never release their leases.
    const foreignLeases = await admin.from("auto_account_states").select("id", { count: "exact", head: true })
      .not("execution_lease_token", "is", null).gt("execution_lease_expires_at", new Date().toISOString());
    if (foreignLeases.error || foreignLeases.count !== 0) throw new Error("remote_proof_existing_execution_leases");

    const { saveAccountPostSchedule, accountDaySlots, accountLocalDate, stopAccountPost } = await import("./account-schedule");
    const { SupabaseExecutionStore } = await import("./execution-store");
    const { createAutoExecutionPorts } = await import("./execution-ports");
    const { processAutoAccount } = await import("./processor");
    const futureDay = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
    const tickTime = `${futureDay}T05:15:00.000Z`; // 12:15 Asia/Bangkok; actual Cron cannot race future fixtures.
    const definitions = [
      { mode: "AUTO" as const, count: 7, start: "09:00", end: "22:00" },
      { mode: "DRAFT" as const, count: 5, start: "12:00", end: "23:00" },
      { mode: "EXPORT" as const, count: 6, start: "09:00", end: "22:00" },
      { mode: "EXPORT" as const, count: 4, start: "09:00", end: "22:00" },
    ];
    for (let ownerIndex = 0; ownerIndex < 2; ownerIndex++) {
      const marker = `${markerPrefix}-${randomUUID()}`;
      const email = `${marker}@example.invalid`, password = randomBytes(32).toString("base64url");
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true,
        user_metadata: { display_name: marker, post_remote_proof: marker } });
      const user = requireData(created.data.user, created.error, "create_test_owner");
      const fixture: OwnerFixture = { id: user.id, email, password, marker, accounts: [] };
      fixtures.push(fixture); // Track immediately, including partially seeded failures.
      for (const [index, definition] of definitions.entries()) {
        const account = await insert(admin, "tiktok_accounts", { owner_id: fixture.id,
          display_name: `POST remote proof ${String.fromCharCode(65 + index)}`,
          username: `proof_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
          open_id: `remote-proof-${randomUUID()}`, mode: "GROWTH", is_mock: false,
          account_status: "active", authorization_status: "authorized", connection_status: "DISCONNECTED",
          granted_scopes: [], daily_post_target: definition.count, daily_post_hard_limit: 20,
          max_cost_per_video_usd: 0.1, daily_video_budget_usd: 1, monthly_video_budget_usd: 30,
          account_notes: fixture.marker });
        const accountId = String(account.id);
        fixture.accounts.push(accountId);
        await saveAccountPostSchedule(admin, fixture.id, accountId, { postingMode: definition.mode,
          creativeMode: "GROWTH", clipsPerDay: definition.count, activeStart: definition.start,
          activeEnd: definition.end, timezone: "Asia/Bangkok", minSpacingMinutes: 30,
          allowedDays: [0, 1, 2, 3, 4, 5, 6], enabled: false, dailyBudgetUsd: 1 });
      }
      const activated = await admin.from("post_account_schedules").update({ enabled: true, next_due_at: tickTime })
        .eq("owner_id", fixture.id);
      if (activated.error) throw new Error(`activate_test_schedules:${activated.error.code}`);
    }
    const tick = (owner: string, time = tickTime) => rpc<TickResult>(admin, "tick_post_account_automation",
      { p_now: time, p_limit: 3, p_owner_id: owner });

    for (const fixture of fixtures) {
      const first = await tick(fixture.id);
      expect(first.mode).toBe("SAFE"); expect(first.status).toBe("SUCCEEDED");
      expect(first.claimedJobs).toBe(3); expect(first.queuedAccounts).toBeGreaterThanOrEqual(1);
      const concurrent = await Promise.all([tick(fixture.id), tick(fixture.id), tick(fixture.id)]);
      expect(concurrent.every(result => result.mode === "SAFE" && result.claimedJobs <= 3 && result.failures === 0)).toBe(true);
      // BUSY is an honest global tick lock outcome. Drain the fourth account
      // using bounded sequential ticks, never more than one run for a slot.
      for (let attempt = 0; attempt < 3 && (await rows(admin, "auto_runs", fixture.id)).length < 4; attempt++) await tick(fixture.id);
      const runs = await rows(admin, "auto_runs", fixture.id);
      expect(runs).toHaveLength(4);
      expect(new Set(runs.map(row => row.tiktok_account_id)).size).toBe(4);
      expect(new Set(runs.map(row => row.schedule_slot_key)).size).toBe(4);
      const states = await rows(admin, "auto_account_states", fixture.id);
      expect(states.every(row => row.state === "WAITING_FOR_PROVIDER"
        && (row.blockers_json as string[]).includes("SAFE_EXECUTION_BOUNDARY"))).toBe(true);
      const again = await tick(fixture.id);
      expect(again.claimedJobs).toBe(0);
      expect(await rows(admin, "auto_runs", fixture.id)).toHaveLength(4);
      const schedules = await rows(admin, "post_account_schedules", fixture.id);
      const slots = await rows(admin, "post_schedule_slots", fixture.id);
      for (const [index, accountId] of fixture.accounts.entries()) {
        const schedule = schedules.find(row => row.tiktok_account_id === accountId) as unknown as AccountPostSchedule;
        const expected = accountDaySlots(schedule, futureDay);
        const actual = slots.filter(row => row.tiktok_account_id === accountId && row.local_date === futureDay)
          .sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
        expect(actual).toHaveLength(definitions[index].count);
        expect(actual.map(row => Date.parse(String(row.scheduled_at)))).toEqual(expected.map(row => Date.parse(row.scheduledAt)));
        expect(actual.every(row => accountLocalDate(new Date(String(row.scheduled_at)), schedule.timezone) === futureDay)).toBe(true);
        expect(Date.parse(String(schedule.next_due_at))).toBeGreaterThan(Date.parse(tickTime));
      }
    }

    const clients: SupabaseClient[] = [];
    for (const fixture of fixtures) {
      const client = createClient(url, publicKey, options);
      const signedIn = await client.auth.signInWithPassword({ email: fixture.email, password: fixture.password });
      requireData(signedIn.data.user, signedIn.error, "sign_in_test_owner");
      const session = requireData(signedIn.data.session, signedIn.error, "test_owner_session");
      fixture.client = client;
      fixture.accessToken = session.access_token;
      fixture.refreshToken = session.refresh_token;
      clients.push(client);
    }
    for (const [index, client] of clients.entries()) {
      const own = fixtures[index], other = fixtures[1 - index];
      const ownName = `${own.marker}-owner-edit`;
      const updated = await client.from("profiles").update({ display_name: ownName })
        .eq("id", own.id).select("id,display_name");
      expect(requireData(updated.data, updated.error, "owner_profile_write")).toEqual([{ id: own.id, display_name: ownName }]);
      const persisted = await admin.from("profiles").select("display_name").eq("id", own.id).single();
      expect(requireData(persisted.data, persisted.error, "owner_profile_persisted").display_name).toBe(ownName);
      const before = await admin.from("profiles").select("display_name").eq("id", other.id).single();
      const otherName = requireData(before.data, before.error, "cross_owner_before").display_name;
      // RLS may filter UPDATE to zero rows without returning an error.
      const crossWrite = await client.from("profiles").update({ display_name: `${own.marker}-forbidden` })
        .eq("id", other.id).select("id");
      expect(crossWrite.data ?? []).toHaveLength(0);
      const after = await admin.from("profiles").select("display_name").eq("id", other.id).single();
      expect(requireData(after.data, after.error, "cross_owner_after").display_name).toBe(otherName);
    }
    for (const [index, client] of clients.entries()) {
      expect(await rows(client, "post_account_schedules", fixtures[index].id)).toHaveLength(4);
      expect(await rows(client, "tiktok_accounts", fixtures[1 - index].id)).toHaveLength(0);
      expect(await rows(client, "post_schedule_slots", fixtures[1 - index].id)).toHaveLength(0);
      expect(await rows(client, "auto_runs", fixtures[1 - index].id)).toHaveLength(0);
      const write = await client.from("post_account_schedules").update({ enabled: false })
        .eq("owner_id", fixtures[index].id).eq("tiktok_account_id", fixtures[index].accounts[0]);
      expect(write.error).not.toBeNull();
      const crossScheduleWrite = await client.from("post_account_schedules").update({ enabled: false })
        .eq("owner_id", fixtures[1 - index].id).eq("tiktok_account_id", fixtures[1 - index].accounts[0]);
      expect(crossScheduleWrite.error).not.toBeNull();
      const denied = await client.rpc("tick_post_account_automation", { p_now: tickTime, p_limit: 3, p_owner_id: fixtures[index].id });
      expect(denied.error).not.toBeNull();
      const privateHealth = await client.rpc("get_post_scheduler_health");
      expect(privateHealth.error).not.toBeNull();
    }
    const anon = createClient(url, publicKey, options);
    const anonRows = await anon.from("post_account_schedules").select("*").eq("owner_id", fixtures[0].id);
    expect(anonRows.data ?? []).toHaveLength(0);
    const anonWrite = await anon.from("profiles").update({ display_name: "forbidden-anon" }).eq("id", fixtures[0].id);
    expect(anonWrite.error).not.toBeNull();
    expect((await anon.rpc("tick_post_account_automation", { p_now: tickTime, p_limit: 3, p_owner_id: fixtures[0].id })).error).not.toBeNull();
    const wrongOwner = await admin.rpc("control_post_account", { p_owner_id: fixtures[0].id,
      p_account_id: fixtures[1].accounts[0], p_action: "STOP" });
    expect(wrongOwner.error).not.toBeNull();

    const leaseTargets = [
      { fixture: fixtures[0], account: fixtures[0].accounts[0] },
      { fixture: fixtures[0], account: fixtures[0].accounts[1] },
      { fixture: fixtures[0], account: fixtures[0].accounts[2] },
      { fixture: fixtures[1], account: fixtures[1].accounts[0] },
    ];
    const leaseRequests = await Promise.all(leaseTargets.map(async ({ fixture, account }) => {
      await ready(admin, fixture.id, account);
      const state = await accountState(admin, fixture.id, account);
      return new SupabaseExecutionStore(admin, fixture.id).claim(String(state.auto_run_id), account, `proof-${randomUUID()}`);
    }));
    const acquired = leaseRequests.filter((claim): claim is ExecutionClaim => claim !== null);
    expect(acquired).toHaveLength(3);
    expect(new Set(acquired.map(claim => claim.accountId)).size).toBe(3);
    const live = await admin.from("auto_account_states").select("id", { count: "exact", head: true })
      .in("owner_id", fixtures.map(fixture => fixture.id)).not("execution_lease_token", "is", null)
      .gt("execution_lease_expires_at", new Date().toISOString());
    expect(live.count).toBe(3);
    for (const claim of acquired) {
      const store = new SupabaseExecutionStore(admin, claim.ownerId);
      expect(await store.claim(claim.runId, claim.accountId, `duplicate-${randomUUID()}`)).toBeNull();
      await store.finish(claim, { kind: "WAIT", state: "WAITING_FOR_DATA", reason: "ASSIGNMENT_REQUIRED" }, claim.step, claim.itemIndex);
    }
    const queuedIndex = leaseRequests.findIndex(claim => claim === null);
    const queued = leaseTargets[queuedIndex];
    const queuedState = await accountState(admin, queued.fixture.id, queued.account);
    const queuedRun = String(queuedState.auto_run_id);
    const drained = await processAutoAccount(new SupabaseExecutionStore(admin, queued.fixture.id), createAutoExecutionPorts(admin),
      queuedRun, queued.account, `drain-${randomUUID()}`);
    expect(drained.status).toBe("WAIT");

    const fixture = fixtures[0], accountA = fixture.accounts[0], accountB = fixture.accounts[1], accountC = fixture.accounts[2];
    const runA = String((await accountState(admin, fixture.id, accountA)).auto_run_id);
    const runRow = (await rows(admin, "auto_runs", fixture.id)).find(row => row.id === runA)!;
    const activeSlot = (await rows(admin, "post_schedule_slots", fixture.id)).find(row => row.slot_key === runRow.schedule_slot_key)!;
    const product = await insert(admin, "products", { owner_id: fixture.id, external_provider: markerPrefix,
      external_product_id: fixture.marker, title: "Remote proof ceramic cup", slug: `proof-cup-${randomUUID()}`,
      category_key: "home", current_price: 100, commission_rate: 0, commission_amount: 0,
      review_count: 0, units_sold: 0, status: "available", first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
    const score = await insert(admin, "account_product_scores", { owner_id: fixture.id, tiktok_account_id: accountA,
      product_id: product.id, run_id: randomUUID(), calculated_at: new Date().toISOString(), product_component: 80, category_component: 80,
      account_category_component: 80, commercial_component: 80, mode_fit_component: 80,
      confidence_component: 80, freshness_component: 80, competition_component: 80,
      account_product_fit_score: 80, final_viral_opportunity_score: 80, effective_mode: "GROWTH",
      eligible: true, score_version: markerPrefix, explanation_json: { fixture: fixture.marker } });
    const assignment = await insert(admin, "product_assignments", { owner_id: fixture.id, tiktok_account_id: accountA,
      product_id: product.id, category_key: "home", score_id: score.id, assignment_date: futureDay,
      rank_for_account: activeSlot.ordinal, effective_mode: "GROWTH", final_score: 80, status: "CANDIDATE",
      score_version: markerPrefix, reason_json: { fixture: fixture.marker } });
    await ready(admin, fixture.id, accountA);
    const store = new SupabaseExecutionStore(admin, fixture.id), ports = createAutoExecutionPorts(admin);
    expect((await processAutoAccount(store, ports, runA, accountA, "proof-product")).status).toBe("ADVANCE");
    expect((await processAutoAccount(store, ports, runA, accountA, "proof-creative")).status).toBe("WAIT");
    expect(await rows(admin, "creative_projects", fixture.id)).toHaveLength(1);
    expect(await rows(admin, "scripts", fixture.id)).toHaveLength(0);
    const creativeState = await accountState(admin, fixture.id, accountA);
    expect(creativeState.current_step).toBe("CREATE_CREATIVE");
    expect(creativeState.state).toBe("WAITING_FOR_PROVIDER");

    // Separate persisted SAFE boundary scenarios do not assert that earlier
    // video/publish work completed; their checkpoints contain no fabricated IDs.
    const boundaries: string[] = ["CREATIVE"];
    const runB = String((await accountState(admin, fixture.id, accountB)).auto_run_id);
    for (const [step, boundary] of [["GENERATE_VIDEO", "VIDEO"], ["QUEUE_PUBLISH", "TIKTOK_QUEUE"], ["PUBLISH", "TIKTOK_PUBLISH"]] as const) {
      await ready(admin, fixture.id, accountB, step);
      expect((await processAutoAccount(store, ports, runB, accountB, `proof-${boundary}`)).status).toBe("WAIT");
      const state = await accountState(admin, fixture.id, accountB);
      expect(state.state).toBe("WAITING_FOR_PROVIDER");
      expect(state.blockers_json).toEqual(["SAFE_EXECUTION_BOUNDARY"]);
      boundaries.push(boundary);
    }

    const otherBefore = safeStateSnapshot(await accountState(admin, fixture.id, accountB));
    failAssignment = String(assignment.id);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await ready(admin, fixture.id, accountA);
      const failure = await processAutoAccount(store, ports, runA, accountA, `proof-failure-${attempt}`);
      expect(failure.status).toBe("FAILED");
      const state = await accountState(admin, fixture.id, accountA);
      expect(state.state).toBe(attempt < 3 ? "RETRY_PENDING" : "BLOCKED");
      expect(await store.claim(runA, accountA, "before-backoff")).toBeNull();
      const expiredBackoff = await admin.from("auto_failures").update({ next_retry_at: new Date(Date.now() - 60_000).toISOString() })
        .eq("owner_id", fixture.id).eq("auto_run_id", runA).eq("tiktok_account_id", accountA);
      if (expiredBackoff.error) throw new Error(`fixture_retry_clock:${expiredBackoff.error.code}`);
    }
    failAssignment = null;
    const failures = (await rows(admin, "auto_failures", fixture.id)).filter(row => row.tiktok_account_id === accountA)
      .sort((a, b) => Number(a.retry_count) - Number(b.retry_count));
    expect(failures).toHaveLength(3); expect(failures.map(row => row.retryable)).toEqual([true, true, false]);
    expect(safeStateSnapshot(await accountState(admin, fixture.id, accountB))).toEqual(otherBefore);
    await stopAccountPost(admin, fixture.id, accountA);
    expect((await accountState(admin, fixture.id, accountA)).state).toBe("STOPPED");
    expect(safeStateSnapshot(await accountState(admin, fixture.id, accountB))).toEqual(otherBefore);

    const runC = String((await accountState(admin, fixture.id, accountC)).auto_run_id);
    const beforeRecoveryCount = (await rows(admin, "auto_runs", fixture.id)).length;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await ready(admin, fixture.id, accountC);
      // Backoff is advanced only for this fixture; no wall-clock sleep or other
      // account lease is changed. The actual production RPC supplies each lease.
      const prior = await admin.from("auto_failures").update({ next_retry_at: new Date(Date.now() - 60_000).toISOString() })
        .eq("owner_id", fixture.id).eq("auto_run_id", runC).eq("tiktok_account_id", accountC);
      if (prior.error) throw new Error(`fixture_recovery_clock:${prior.error.code}`);
      const claim = await store.claim(runC, accountC, `proof-crash-${attempt}`);
      expect(claim).not.toBeNull();
      await patch(admin, "auto_account_states", fixture.id, accountC,
        { execution_lease_expires_at: new Date(Date.now() - 60_000).toISOString() });
      const recovered = await tick(fixture.id);
      expect(recovered.recoveredJobs).toBeGreaterThanOrEqual(1);
      const state = await accountState(admin, fixture.id, accountC);
      expect(state.auto_run_id).toBe(runC); expect(state.execution_lease_token).toBeNull();
      expect(state.state).toBe(attempt < 3 ? "RETRY_PENDING" : "FAILED");
    }
    expect(await rows(admin, "auto_runs", fixture.id)).toHaveLength(beforeRecoveryCount);
    expect(safeStateSnapshot(await accountState(admin, fixture.id, accountB))).toEqual(otherBefore);

    const second = fixtures[1], accountD = second.accounts[3];
    await stopAccountPost(admin, second.id, accountD);
    const pendingSlot = (await rows(admin, "post_schedule_slots", second.id))
      .filter(row => row.tiktok_account_id === accountD && row.state === "DISABLED" && Date.parse(String(row.scheduled_at)) > Date.parse(tickTime))
      .sort((a, b) => Number(a.ordinal) - Number(b.ordinal))[0];
    expect(pendingSlot).toBeDefined();
    await patch(admin, "post_account_schedules", second.id, accountD, { enabled: true, next_due_at: pendingSlot.scheduled_at });
    const slotUpdate = await admin.from("post_schedule_slots").update({ state: "CLAIMED", attempts: 1,
      lease_token: randomUUID(), lease_expires_at: new Date(Date.parse(String(pendingSlot.scheduled_at)) - 60_000).toISOString() })
      .eq("owner_id", second.id).eq("tiktok_account_id", accountD).eq("slot_key", pendingSlot.slot_key);
    if (slotUpdate.error) throw new Error(`fixture_stale_slot:${slotUpdate.error.code}`);
    const reclaimed = await rpc<Row>(admin, "claim_post_schedule_slot",
      { p_owner_id: second.id, p_account_id: accountD, p_now: pendingSlot.scheduled_at });
    expect(reclaimed.slot_key).toBe(pendingSlot.slot_key); expect(reclaimed.attempts).toBe(2);
    await rpc(admin, "settle_post_schedule_slot", { p_owner_id: second.id, p_account_id: accountD,
      p_slot_key: reclaimed.slot_key, p_lease_token: reclaimed.lease_token, p_run_id: null, p_failed: true });
    await patch(admin, "post_account_schedules", second.id, accountD, { enabled: false });

    const nextDay = new Date(Date.parse(`${futureDay}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
    const boundaryTick = await tick(fixture.id, `${nextDay}T17:00:00.000+07:00`);
    expect(boundaryTick.mode).toBe("SAFE");
    const nextDaySlots = (await rows(admin, "post_schedule_slots", fixture.id)).filter(row => row.local_date === nextDay);
    expect(nextDaySlots.filter(row => row.tiktok_account_id === accountA)).toHaveLength(0); // STOP persists across dates.
    expect(nextDaySlots.filter(row => row.tiktok_account_id === accountB)).toHaveLength(5);
    // Safe blocked old work is not declared completed to force a daily reset.
    expect((await accountState(admin, fixture.id, accountB)).auto_run_id).toBe(runB);

    let outputs = 0;
    for (const owner of fixtures) {
      outputs += (await rows(admin, "post_outputs", owner.id)).length;
      for (const table of ["generation_jobs", "master_videos", "publishing_queue", "creative_generations", "scripts", "tiktok_oauth_credentials"]) {
        expect(await rows(admin, table, owner.id), `no_external_evidence_${table}`).toHaveLength(0);
      }
    }
    expect(outputs).toBe(0); expect(blockedExternalAttempts).toBe(0); expect(paidCalls).toBe(0); expect(tiktokCalls).toBe(0);
    report = { database: "REMOTE_SUPABASE", mode: "SAFE", owners: 2, accounts: 8,
      logicalJobs: (await rows(admin, "auto_runs", fixtures[0].id)).length + (await rows(admin, "auto_runs", fixtures[1].id)).length,
      maximumConcurrentLeases: 3, queuedLeaseRequests: 1, safeTerminal: "WAITING_FOR_PROVIDER", safeReason: "SAFE_EXECUTION_BOUNDARY",
      internalStageCompleted: true, safeBoundaries: boundaries, boundedFailureAttempts: failures.length,
      staleExecutionRecovered: true, staleSlotRecovered: true, ownerRls: true, crossOwnerDenied: true,
      ownerWriteAllowed: true, crossOwnerWriteDenied: true, sessionsRevoked: true,
      anonDenied: true, timezoneVerified: true, nextDayVerified: true, generatedOutputs: outputs,
      paidCalls, tiktokCalls, blockedExternalAttempts };
  } finally {
    failAssignment = null;
    const cleanup = await Promise.allSettled(fixtures.map(fixture => removeFixture(admin, fixture)));
    for (const fixture of fixtures) {
      fixture.client?.auth.stopAutoRefresh();
      fixture.password = ""; fixture.accessToken = ""; fixture.refreshToken = ""; fixture.client = undefined;
    }
    vi.unstubAllGlobals();
    const failures = cleanup.filter(result => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), "remote_proof_fixture_cleanup_failed");
  }
  if (!report) throw new Error("remote_proof_report_missing");
  return { ...report, cleanup: "VERIFIED" };
}

describe.runIf(enabled)("remote Supabase POST scheduler SAFE proof", () => {
  it("uses real SQL, authenticated owners and production execution boundaries without provider calls; removes every fixture", async () => {
    const report = await runPostRemoteSchedulerProof();
    // This report contains only counts/statuses. No keys, sessions or tokens.
    console.info("POST_REMOTE_PROOF", JSON.stringify(report));
  }, 360_000);
});
