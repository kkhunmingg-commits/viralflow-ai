import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const state = vi.hoisted(() => ({ flags: { tiktokPublishingProvider: "official", tiktokPublishingRealMode: true,
  tiktokClientKey: "test-key", tiktokClientSecret: "test-secret", tiktokVideoPublishApproved: false, tiktokVideoUploadApproved: false },
  reads: [] as Array<{ table: string; fields: string; filters: Record<string, unknown>; order: string }>, rows: {} as Record<string, unknown[]> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server-env", () => ({ serverEnv: state.flags }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { readCustomerRecords } from "./customer-data";
import { mapCustomerOverview } from "./customer-mapping";
function client() {
  return { from: (table: string) => {
    const read = { table, fields: "", filters: {} as Record<string, unknown>, order: "" }; state.reads.push(read);
    const query = { select: (fields: string) => { read.fields = fields; return query; }, eq: (key: string, value: unknown) => { read.filters[key] = value; return query; },
      order: (column: string) => { read.order = column; return query; }, range: () => query,
      then: <T,>(resolve: (value: { data: unknown[]; error: null }) => T) => Promise.resolve({ data: state.rows[table] ?? [], error: null }).then(resolve) };
    return query;
  } } as unknown as SupabaseClient;
}
beforeEach(() => { state.reads = []; state.rows = {}; state.flags.tiktokVideoPublishApproved = false; state.flags.tiktokVideoUploadApproved = false; });
describe("customer POST actual read projection", () => {
  it("reads signed-in owner's schedules/outputs and unfinished jobs without completion-date exclusion", async () => {
    await readCustomerRecords(client(), "owner");
    expect(state.reads.every(read => read.filters.owner_id === "owner")).toBe(true);
    expect(state.reads.find(read => read.table === "post_account_schedules")?.order).toBe("tiktok_account_id");
    expect(state.reads.map(read => read.table)).toContain("post_outputs");
    expect(state.reads.find(read => read.table === "generation_jobs")?.filters).toEqual({ owner_id: "owner" });
    expect(state.reads.some(read => /access_token|refresh_token|client_secret/.test(read.fields))).toBe(false);
  });
  it("does not turn saved mode/granted scopes into platform approval or expose technical fields", async () => {
    state.rows.tiktok_accounts = [{ id: "A", display_name: "บัญชี A", mode: "AUTO", is_mock: false, hidden_at: null, authorization_status: "authorized", account_status: "active",
      daily_post_target: 5, daily_post_hard_limit: 10, daily_video_budget_usd: 1, preferred_categories: [], username: null, avatar_url: null,
      audit_status: "AUDITED", direct_post_status: "READY", upload_status: "READY", granted_scopes: ["video.publish", "video.upload"] }];
    let records = await readCustomerRecords(client(), "owner");
    expect(records.availabilityByAccount!.A!.AUTO.available).toBe(false);
    expect(records.availabilityByAccount!.A!.DRAFT.available).toBe(false); expect(records.availabilityByAccount!.A!.EXPORT.available).toBe(true);
    expect(JSON.stringify(mapCustomerOverview(records, "today"))).not.toMatch(/granted_scopes|video\.publish|audit_status|test-secret/);
    state.flags.tiktokVideoPublishApproved = true; state.flags.tiktokVideoUploadApproved = true;
    records = await readCustomerRecords(client(), "owner");
    expect(records.availabilityByAccount!.A!.AUTO.available).toBe(true); expect(records.availabilityByAccount!.A!.DRAFT.available).toBe(true);
  });
});
