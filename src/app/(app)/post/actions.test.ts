import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "d0b500dc-e5b3-4d04-92b7-fa36c6f3bc41" } as { id: string } | null,
  ownedAccount: true, queueOwned: true,
  filters: [] as Array<{ table: string; fields: Record<string, unknown> }>,
  after: vi.fn(), revalidate: vi.fn(), save: vi.fn(), start: vi.fn(), stop: vi.fn(), execute: vi.fn(), retry: vi.fn(), rate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/features/auto/account-schedule", () => ({ saveAccountPostSchedule: mocks.save, startAccountPost: mocks.start, stopAccountPost: mocks.stop }));
vi.mock("@/features/auto/execution-service", () => ({ runAutoExecutionCycle: mocks.execute }));
vi.mock("@/app/(app)/publishing/actions", () => ({ retryPublishAction: mocks.retry }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceOwnerMutationRateLimit: mocks.rate }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ serverOnly: true }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) },
  from(table: string) {
    const record = { table, fields: {} as Record<string, unknown> }; mocks.filters.push(record);
    const query = { select: () => query, eq: (key: string, value: unknown) => { record.fields[key] = value; return query; },
      maybeSingle: async () => ({ error: null, data: (table === "tiktok_accounts" ? mocks.ownedAccount : mocks.queueOwned) ? { id: record.fields.id } : null }) };
    return query;
  },
}) }));
import { retryCustomerPostAction, saveCustomerPostScheduleAction, startCustomerPostAction, stopCustomerPostAction } from "./actions";
const A = "336664cf-ee48-4878-ad0e-ed664122f60a", B = "336664cf-ee48-4878-ad0e-ed664122f60b";
const RUN = "438903cd-27aa-4c6d-a112-dba4377988dd", QUEUE = "708903cd-27aa-4c6d-a112-dba4377988dd";
const previous = { ok: false, message: "" };
function startForm(accountId: string) {
  const data = new FormData();
  Object.entries({ accountId, creativeMode: "AUTO", postingMode: "EXPORT", clipsPerDay: "5", dailyBudgetUsd: "1",
    activeStart: "09:00", activeEnd: "22:00", timezone: "Asia/Bangkok", minSpacingMinutes: "60", enabled: "on",
    requestKey: "779fa2f3-4a8b-4020-b8fb-8adb32c7426b" }).forEach(([key, value]) => data.set(key, value));
  [1, 2, 3].forEach(day => data.append("allowedDays", String(day))); return data;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.filters.length = 0; mocks.user = { id: "d0b500dc-e5b3-4d04-92b7-fa36c6f3bc41" };
  mocks.ownedAccount = true; mocks.queueOwned = true; mocks.start.mockResolvedValue({ run: { id: RUN } });
  mocks.save.mockResolvedValue({ enabled: true }); mocks.stop.mockResolvedValue({ state: "STOPPED" }); mocks.execute.mockResolvedValue(undefined); mocks.retry.mockResolvedValue(undefined);
});
describe("customer POST authorized account boundaries", () => {
  it("starts concurrent A and B using their independent durable schedule services, never an owner-global read", async () => {
    expect((await startCustomerPostAction(previous, startForm(A))).ok).toBe(true);
    expect((await startCustomerPostAction(previous, startForm(B))).ok).toBe(true);
    expect(mocks.save.mock.calls.map(call => call[2])).toEqual([A, B]);
    expect(mocks.start.mock.calls.map(call => call[2])).toEqual([A, B]);
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), mocks.user!.id, A, expect.objectContaining({
      postingMode: "EXPORT", creativeMode: "AUTO", clipsPerDay: 5, timezone: "Asia/Bangkok", allowedDays: [1, 2, 3], enabled: true,
    }));
    await mocks.after.mock.calls[0][0]();
    expect(mocks.execute).toHaveBeenCalledWith(expect.anything(), mocks.user!.id, RUN);
    expect(mocks.filters.every(entry => entry.table === "tiktok_accounts" && entry.fields.owner_id === mocks.user!.id)).toBe(true);
  });
  it("keeps future-window starts enabled without pretending an immediate run exists", async () => {
    mocks.start.mockResolvedValue({ run: null });
    const result = await startCustomerPostAction(previous, startForm(A));
    expect(result.ok).toBe(true); expect(result.message).toContain("ตามเวลา"); expect(mocks.after).not.toHaveBeenCalled();
  });
  it("saves schedule without executing and uses only authenticated owner", async () => {
    const data = startForm(A); data.set("ownerId", "not-owner"); data.delete("enabled");
    expect((await saveCustomerPostScheduleAction(previous, data)).ok).toBe(true);
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), mocks.user!.id, A, expect.objectContaining({ enabled: false }));
    expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });
  it("rejects another owner's account before saving/starting/stopping", async () => {
    mocks.ownedAccount = false;
    expect((await startCustomerPostAction(previous, startForm(A))).ok).toBe(false);
    expect((await stopCustomerPostAction(previous, startForm(A))).ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.stop).not.toHaveBeenCalled();
  });
  it("stops just selected account and does not trust a browser-supplied run ID", async () => {
    const data = startForm(A); data.set("runId", "other-account-run");
    expect((await stopCustomerPostAction(previous, data)).ok).toBe(true);
    expect(mocks.stop).toHaveBeenCalledExactlyOnceWith(expect.anything(), mocks.user!.id, A);
  });
  it("never retries another account's clip and retains existing bounded retry safeguards", async () => {
    const data = new FormData(); data.set("accountId", B); data.set("queueId", QUEUE); mocks.queueOwned = false;
    expect((await retryCustomerPostAction(previous, data)).ok).toBe(false); expect(mocks.retry).not.toHaveBeenCalled();
    mocks.queueOwned = true;
    expect((await retryCustomerPostAction(previous, data)).ok).toBe(true); expect(mocks.retry).toHaveBeenCalledWith(QUEUE);
    expect(mocks.filters.at(-1)!.fields).toMatchObject({ owner_id: mocks.user!.id, tiktok_account_id: B, id: QUEUE });
  });
  it("rejects malformed schedules and unauthenticated requests without returning internals", async () => {
    const data = startForm(A); data.delete("allowedDays");
    expect((await startCustomerPostAction(previous, data)).ok).toBe(false);
    data.append("allowedDays", "1"); data.set("timezone", "fake/zone");
    expect((await saveCustomerPostScheduleAction(previous, data)).ok).toBe(false);
    mocks.user = null;
    const result = await stopCustomerPostAction(previous, startForm(A));
    expect(result.ok).toBe(false); expect(result.message).not.toMatch(/authentication|Error|owner_id/);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.stop).not.toHaveBeenCalled();
  });
});
