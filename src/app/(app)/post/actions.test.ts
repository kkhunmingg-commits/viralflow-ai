import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "d0b500dc-e5b3-4d04-92b7-fa36c6f3bc41" } as { id: string } | null,
  active: null as { id: string } | null,
  ownedAccount: true,
  scope: [] as Array<{ tiktok_account_id: string }>,
  queueOwned: true,
  filters: [] as Array<{ table: string; fields: Record<string, unknown> }>,
  after: vi.fn(), revalidate: vi.fn(), createRun: vi.fn(), transition: vi.fn(), execute: vi.fn(), retry: vi.fn(), assignments: vi.fn(), rate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/features/auto/services", () => ({ createAutoRun: mocks.createRun, transitionAutoRun: mocks.transition }));
vi.mock("@/features/auto/execution-service", () => ({ runAutoExecutionCycle: mocks.execute }));
vi.mock("@/features/assignments/services", () => ({ persistDailyAssignments: mocks.assignments }));
vi.mock("@/app/(app)/publishing/actions", () => ({ retryPublishAction: mocks.retry }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceOwnerMutationRateLimit: mocks.rate }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ serverOnly: true }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) },
    from(table: string) {
      const record = { table, fields: {} as Record<string, unknown> }; mocks.filters.push(record);
      const result = () => ({ error: null, count: 1, data: table === "tiktok_accounts" ? (mocks.ownedAccount ? { id: record.fields.id } : null)
        : table === "auto_runs" ? mocks.active : table === "auto_account_states" ? mocks.scope
          : table === "publishing_queue" ? (mocks.queueOwned ? { id: record.fields.id } : null) : [] });
      const query = {
        select: () => query, eq: (key: string, value: unknown) => { record.fields[key] = value; return query; },
        in: () => query, limit: () => query, maybeSingle: async () => result(),
        then: <T,>(resolve: (value: ReturnType<typeof result>) => T) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  }),
}));

import { retryCustomerPostAction, startCustomerPostAction, stopCustomerPostAction } from "./actions";

const A = "336664cf-ee48-4878-ad0e-ed664122f60a", B = "336664cf-ee48-4878-ad0e-ed664122f60b";
const RUN = "438903cd-27aa-4c6d-a112-dba4377988dd", QUEUE = "708903cd-27aa-4c6d-a112-dba4377988dd";
const previous = { ok: false, message: "" };
function startForm(accountId: string) {
  const data = new FormData();
  Object.entries({ accountId, mode: "AUTO", dailyTarget: "5", dailyBudgetUsd: "1", requestKey: "779fa2f3-4a8b-4020-b8fb-8adb32c7426b" }).forEach(([key, value]) => data.set(key, value));
  return data;
}
function scopedForm(accountId: string) { const data = new FormData(); data.set("accountId", accountId); data.set("runId", RUN); return data; }

beforeEach(() => {
  vi.clearAllMocks(); mocks.filters.length = 0; mocks.user = { id: "d0b500dc-e5b3-4d04-92b7-fa36c6f3bc41" };
  mocks.active = null; mocks.ownedAccount = true; mocks.queueOwned = true; mocks.scope = [{ tiktok_account_id: A }];
  mocks.createRun.mockResolvedValue({ id: RUN }); mocks.transition.mockResolvedValue({ state: "STOPPED" });
  mocks.execute.mockResolvedValue(undefined); mocks.retry.mockResolvedValue(undefined);
});

describe("customer POST account boundaries", () => {
  it("starts A through the existing processor with A's selection, then supports B without reusing A's selection", async () => {
    expect((await startCustomerPostAction(previous, startForm(A))).ok).toBe(true);
    expect(mocks.createRun).toHaveBeenLastCalledWith(expect.anything(), mocks.user!.id, expect.any(String), expect.objectContaining({ accountId: A, dailyTarget: 5 }));
    await mocks.after.mock.calls[0][0]();
    expect(mocks.execute).toHaveBeenCalledWith(expect.anything(), mocks.user!.id, RUN);
    mocks.scope = [{ tiktok_account_id: B }];
    expect((await startCustomerPostAction(previous, startForm(B))).ok).toBe(true);
    expect(mocks.createRun).toHaveBeenLastCalledWith(expect.anything(), mocks.user!.id, expect.any(String), expect.objectContaining({ accountId: B }));
    expect(mocks.filters.every((entry) => entry.fields.owner_id === mocks.user!.id)).toBe(true);
  });
  it("does not start another account while the existing owner's job is active", async () => {
    mocks.active = { id: RUN };
    expect((await startCustomerPostAction(previous, startForm(B))).ok).toBe(false);
    expect(mocks.createRun).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });
  it("does not execute a different account if the atomic lock returns an existing run during a race", async () => {
    mocks.scope = [{ tiktok_account_id: B }];
    expect((await startCustomerPostAction(previous, startForm(A))).ok).toBe(false);
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("rejects another owner's account before preparing assignments", async () => {
    mocks.ownedAccount = false;
    expect((await startCustomerPostAction(previous, startForm(A))).ok).toBe(false);
    expect(mocks.assignments).not.toHaveBeenCalled(); expect(mocks.createRun).not.toHaveBeenCalled();
  });
  it("stops only a run belonging exclusively to the chosen account", async () => {
    expect((await stopCustomerPostAction(previous, scopedForm(A))).ok).toBe(true);
    expect(mocks.transition).toHaveBeenCalledWith(expect.anything(), mocks.user!.id, RUN, "STOP");
    mocks.transition.mockClear();
    expect((await stopCustomerPostAction(previous, scopedForm(B))).ok).toBe(false);
    mocks.scope = [{ tiktok_account_id: A }, { tiktok_account_id: B }];
    expect((await stopCustomerPostAction(previous, scopedForm(A))).ok).toBe(false);
    expect(mocks.transition).not.toHaveBeenCalled();
  });
  it("never retries another account's clip, and reuses authorized publishing retry for an owned clip", async () => {
    const data = new FormData(); data.set("accountId", B); data.set("queueId", QUEUE); mocks.queueOwned = false;
    expect((await retryCustomerPostAction(previous, data)).ok).toBe(false); expect(mocks.retry).not.toHaveBeenCalled();
    mocks.queueOwned = true;
    expect((await retryCustomerPostAction(previous, data)).ok).toBe(true); expect(mocks.retry).toHaveBeenCalledWith(QUEUE);
    const read = mocks.filters.at(-1)!;
    expect(read.fields).toMatchObject({ owner_id: mocks.user!.id, tiktok_account_id: B, id: QUEUE });
  });
  it("blocks unauthenticated and malformed requests without sending raw errors to the customer", async () => {
    mocks.user = null;
    const result = await stopCustomerPostAction(previous, scopedForm(A));
    expect(result.ok).toBe(false); expect(result.message).not.toMatch(/authentication|Error|owner_id/);
    expect(mocks.transition).not.toHaveBeenCalled();
    expect((await startCustomerPostAction(previous, new FormData())).ok).toBe(false);
    expect(mocks.createRun).not.toHaveBeenCalled();
  });
});
