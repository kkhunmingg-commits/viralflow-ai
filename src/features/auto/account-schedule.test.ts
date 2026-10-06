import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountDaySlots, accountLocalDate, activeAccountState, planAccountSchedule, saveAccountPostSchedule, startAccountPost, stopAccountPost,
  tickAccountPostSchedules, validateAccountPostSchedule, type AccountPostSchedule, type AccountPostScheduleInput } from "./account-schedule";

vi.mock("@/lib/server-env", () => ({ serverEnv: {} }));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/ops/logger", () => ({ logOps: vi.fn() }));
const createRun = vi.hoisted(() => vi.fn());
const executeCycle = vi.hoisted(() => vi.fn());
vi.mock("./processor", () => ({ processAutoCycle: executeCycle }));
vi.mock("./execution-ports", () => ({ createAutoExecutionPorts: () => ({}) }));
vi.mock("./services", () => ({ ACTIVE_AUTO_ACCOUNT_STATES: ["STARTING", "RUNNING", "PAUSED", "WAITING_FOR_PROVIDER", "WAITING_FOR_APPROVAL", "WAITING_FOR_SLOT", "WAITING_FOR_DATA", "WAITING_FOR_RECONCILIATION", "BLOCKED", "RETRY_PENDING"], createAutoRun: createRun }));

const input: AccountPostScheduleInput = { postingMode: "EXPORT", creativeMode: "GROWTH", clipsPerDay: 7,
  activeStart: "09:00", activeEnd: "22:00", timezone: "Asia/Bangkok", minSpacingMinutes: 60, allowedDays: [0, 1, 2, 3, 4, 5, 6], enabled: true, dailyBudgetUsd: 1 };
const schedule: AccountPostSchedule = { owner_id: "owner", tiktok_account_id: "account-a", posting_mode: "EXPORT", creative_mode: "GROWTH",
  clips_per_day: 7, active_start: 540, active_end: 1320, timezone: "Asia/Bangkok", min_spacing_minutes: 60, allowed_days: [0, 1, 2, 3, 4, 5, 6],
  enabled: true, daily_budget_usd: 1, next_due_at: "2026-10-07T02:00:00Z", revision: 1, created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z" };

describe("account-local recurring schedule", () => {
  it("keeps modes and constraints truthful instead of silently overriding", () => {
    for (const postingMode of ["AUTO", "DRAFT", "EXPORT"] as const) expect(validateAccountPostSchedule({ ...input, postingMode }).postingMode).toBe(postingMode);
    expect(() => validateAccountPostSchedule({ ...input, clipsPerDay: 21 })).toThrow("invalid_post_schedule");
    expect(() => validateAccountPostSchedule({ ...input, timezone: "Imaginary/Zone" })).toThrow("invalid_timezone");
    expect(() => validateAccountPostSchedule({ ...input, activeEnd: "08:00" })).toThrow("invalid_post_schedule");
    expect(() => validateAccountPostSchedule({ ...input, minSpacingMinutes: 200 })).toThrow("post_schedule_spacing");
    expect(validateAccountPostSchedule({ ...input, allowedDays: [1, 1, 5] }).allowedDays).toEqual([1, 5]);
  });
  it("admits a short window that fits the configured spacing", () => {
    expect(validateAccountPostSchedule({ ...input, clipsPerDay: 2, activeEnd: "10:00", minSpacingMinutes: 45 })).toBeTruthy();
    const slots = accountDaySlots({ ...schedule, clips_per_day: 2, active_end: 600, min_spacing_minutes: 45 }, "2026-10-07");
    expect(slots).toHaveLength(2);
    expect(Date.parse(slots[1].scheduledAt) - Date.parse(slots[0].scheduledAt)).toBeGreaterThanOrEqual(45 * 60_000);
  });
  it("produces one stable identity per account/local date/ordinal across restart and config revision", () => {
    const first = accountDaySlots(schedule, "2026-10-07"), restart = accountDaySlots({ ...schedule, posting_mode: "DRAFT", revision: 2 } as AccountPostSchedule, "2026-10-07");
    expect(first).toHaveLength(7);
    expect(first.map(slot => slot.key)).toEqual(restart.map(slot => slot.key));
    expect(first[0].scheduledAt).toBe("2026-10-07T02:00:00.000Z");
    expect(first.every(slot => Date.parse(slot.expiresAt) > Date.parse(slot.scheduledAt))).toBe(true);
  });
  it("isolates all ten account keys and daily targets", () => {
    const all = Array.from({ length: 10 }, (_, index) => accountDaySlots({ ...schedule, tiktok_account_id: `account-${index}`, clips_per_day: index % 3 + 1 }, "2026-10-07"));
    expect(all.map(slots => slots.length)).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3, 1]);
    const keys = all.flat().map(slot => slot.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("uses the selected timezone for daily reset rather than UTC midnight", () => {
    const now = new Date("2026-10-06T18:00:00Z");
    expect(accountLocalDate(now, "Asia/Bangkok")).toBe("2026-10-07");
    expect(accountLocalDate(now, "America/Los_Angeles")).toBe("2026-10-06");
    expect(accountDaySlots({ ...schedule, allowed_days: [4] }, "2026-10-07")).toEqual([]);
    expect(planAccountSchedule({ ...schedule, allowed_days: [4] }, now).nextDue).toBe("2026-10-08T02:00:00.000Z");
  });
  it("handles DST missing and repeated wall times with continuous spaced instants", () => {
    const dst = { ...schedule, timezone: "America/New_York", active_start: 120, active_end: 300, clips_per_day: 3, min_spacing_minutes: 30 };
    const spring = accountDaySlots(dst, "2026-03-08");
    expect(spring).toHaveLength(3);
    expect(spring[0].scheduledAt).toBe("2026-03-08T07:00:00.000Z");
    for (const slots of [spring, accountDaySlots({ ...dst, active_start: 60 }, "2026-11-01")]) {
      expect(new Set(slots.map(slot => slot.scheduledAt)).size).toBe(slots.length);
      slots.slice(1).forEach((slot, index) => expect(Date.parse(slot.scheduledAt) - Date.parse(slots[index].scheduledAt)).toBeGreaterThanOrEqual(30 * 60_000));
    }
  });
  it("preserves every waiting/paused/blocking account reservation", () => {
    for (const state of ["PAUSED", "WAITING_FOR_PROVIDER", "WAITING_FOR_RECONCILIATION", "BLOCKED", "WAITING_FOR_APPROVAL"]) expect(activeAccountState(state)).toBe(true);
    for (const state of ["FAILED", "COMPLETED", "STOPPED"]) expect(activeAccountState(state)).toBe(false);
  });
});

function clientWith(schedules: AccountPostSchedule[], rpc: ReturnType<typeof vi.fn>, pending: Record<string, unknown>[] = []) {
  return { rpc, from(table: string) {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const rows = table === "post_account_schedules" ? schedules : table === "post_schedule_slots" ? pending : [];
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      lte: () => query, gt: () => query, in: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: rows.find(row => filters.every(filter => filter(row as unknown as Record<string, unknown>))) ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows.filter(row => filters.every(filter => filter(row as unknown as Record<string, unknown>))), error: null }).then(resolve) };
    return query;
  } } as unknown as SupabaseClient;
}

describe("durable scheduler production service boundary", () => {
  it("persists normalized settings only for the authenticated owner's selected account", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: schedule, error: null });
    await saveAccountPostSchedule(clientWith([], rpc), "owner", "account-a", input);
    expect(rpc).toHaveBeenCalledWith("upsert_post_account_schedule", expect.objectContaining({ p_owner_id: "owner", p_account_id: "account-a", p_config: expect.objectContaining({ activeStart: 540, activeEnd: 1320, postingMode: "EXPORT" }) }));
  });
  it("STOP has no owner-wide or unrelated run target; START resumes persisted active work", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { runId: "run-a", state: "PAUSED", enabled: true }, error: null });
    const client = clientWith([schedule], rpc);
    await stopAccountPost(client, "owner", "account-a");
    expect(rpc.mock.calls[0]).toEqual(["control_post_account", { p_owner_id: "owner", p_account_id: "account-a", p_action: "STOP" }]);
    createRun.mockClear();
    await startAccountPost(client, "owner", "account-a", "request-a");
    expect(createRun).not.toHaveBeenCalled();
  });
  it("recovers before claiming and carries immutable mode/date/slot into one generation per account", async () => {
    const accountB = { ...schedule, tiktok_account_id: "account-b", posting_mode: "DRAFT" as const };
    const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
      if (name === "reconcile_post_schedule_slots") return { data: 1, error: null };
      if (name === "claim_post_schedule_slot") return { data: { owner_id: "owner", tiktok_account_id: params.p_account_id,
        local_date: "2026-10-07", slot_key: `post:${params.p_account_id}:2026-10-07:4`, posting_mode: params.p_account_id === "account-b" ? "DRAFT" : "EXPORT", lease_token: "lease" }, error: null };
      return { data: true, error: null };
    });
    createRun.mockImplementation(async (_client, _owner, key) => ({ id: `run:${key}`, schedule_slot_key: key }));
    const result = await tickAccountPostSchedules(clientWith([schedule, accountB], rpc), 10, new Date("2026-10-07T10:00:00Z"));
    expect(rpc.mock.calls[0][0]).toBe("reconcile_post_schedule_slots");
    expect(result.runs).toHaveLength(2);
    expect(createRun.mock.calls.at(-1)?.[3]).toMatchObject({ accountId: "account-b", dailyTarget: 1, postingMode: "DRAFT", runDate: "2026-10-07" });
    expect(rpc.mock.calls.filter(call => call[0] === "settle_post_schedule_slot").every(call => call[1].p_owner_id === "owner")).toBe(true);
  });
  it("records failure for bounded durable retry and continues another account", async () => {
    const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => ({ error: null, data: name === "claim_post_schedule_slot"
      ? { owner_id: "owner", tiktok_account_id: params.p_account_id, local_date: "2026-10-07", slot_key: `${params.p_account_id}:slot`, posting_mode: "EXPORT", lease_token: "lease" } : true }));
    createRun.mockImplementation(async (_client, _owner, key, selection) => {
      if (selection.accountId === "account-a") throw new Error("network_timeout");
      return { id: "run-b", schedule_slot_key: key };
    });
    const result = await tickAccountPostSchedules(clientWith([schedule, { ...schedule, tiktok_account_id: "account-b" }], rpc), 3, new Date("2026-10-07T10:00:00Z"));
    expect(result.runs).toHaveLength(1);
    expect(rpc.mock.calls.find(call => call[0] === "settle_post_schedule_slot" && call[1].p_account_id === "account-a")?.[1]).toMatchObject({ p_failed: true, p_run_id: null });
  });
  it("executes at most three accounts concurrently and keeps another account's failure isolated", async () => {
    const { runPendingAutoExecution } = await import("./execution-service");
    const rows = ["a", "b", "c", "d"].map(id => ({ owner_id: "owner", auto_run_id: `run-${id}` }));
    const scans: Array<Record<string, unknown>> = [];
    const client = { rpc: vi.fn().mockResolvedValue({ data: 0, error: null }), from(table: string) {
      const filter: Record<string, unknown> = {};
      const query = { select: () => query, update: (value: unknown) => { scans.push({ value, filter }); return query; },
        eq: (key: string, value: unknown) => { filter[key] = value; return query; }, in: () => query, order: () => query, limit: () => query,
        lte: () => query, gt: () => query, then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({ data: table === "auto_account_states" ? rows : [], error: null }).then(resolve) };
      return query;
    } } as unknown as SupabaseClient;
    let started = 0;
    let release!: () => void;
    const together = new Promise<void>(resolve => { release = resolve; });
    executeCycle.mockImplementation(async (_store, _ports, runId: string) => {
      started++;
      if (started === 3) release();
      await together; // A serial runner would never reach this barrier.
      if (runId === "run-a") throw new Error("one_account_failed");
      return { operationKey: runId, results: [{ status: "READY" }] };
    });
    const result = await runPendingAutoExecution(client, 100);
    expect(started).toBe(3);
    expect(result).toMatchObject({ runs: 2, failedRuns: 1, steps: 2 });
    expect(scans).toHaveLength(3);
    expect(scans.map(scan => (scan.filter as Record<string, string>).auto_run_id)).toEqual(["run-a", "run-b", "run-c"]);
  });
});
