import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { executeSchedulerInvocation } from "./scheduler";
import { summarizeSchedulerHealth } from "./scheduler-health";

const secret = "c".repeat(32);
const result = { claimed: true, windowKey: "window-1", incidents: 2, alerts: 1 };

describe("Phase 11E recovery schedule", () => {
  it("lets the cron request reach the bearer-protected route through the auth proxy", () => {
    expect(readFileSync("src/lib/supabase/proxy.ts", "utf8")).toContain('"/api/operations/recovery"');
    expect(readFileSync("vercel.json", "utf8")).toContain('"path": "/api/operations/recovery"');
  });
  it("rejects unauthorized calls before touching recovery", async () => {
    const run = vi.fn(async () => result);
    expect((await executeSchedulerInvocation({ authorization: null, expectedSecret: secret, enabled: true, run, notify: vi.fn() })).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("accepts authorized calls and treats a duplicate claim as idempotent", async () => {
    const notify = vi.fn(async () => undefined);
    const first = await executeSchedulerInvocation({ authorization: `Bearer ${secret}`, expectedSecret: secret, enabled: true, run: async () => result, notify });
    const duplicate = await executeSchedulerInvocation({ authorization: `Bearer ${secret}`, expectedSecret: secret, enabled: true, run: async () => ({ ...result, claimed: false }), notify });
    expect(first.status).toBe(200);
    expect(duplicate).toMatchObject({ status: 200, body: { claimed: false } });
    expect(notify).toHaveBeenCalledOnce();
  });

  it("does not change committed recovery when alert delivery fails", async () => {
    const response = await executeSchedulerInvocation({ authorization: `Bearer ${secret}`, expectedSecret: secret, enabled: true, run: async () => result, notify: async () => { throw new Error("delivery failed"); } });
    expect(response).toMatchObject({ status: 200, body: { claimed: true, incidents: 2 } });
  });

  it("marks a stale or failed-after-success schedule unhealthy", () => {
    const now = new Date("2026-09-23T10:30:00Z");
    const completed = { state: "COMPLETED", started_at: "2026-09-23T10:23:00Z", completed_at: "2026-09-23T10:24:00Z", summary_json: { incidents: 3, alerts: 1 } };
    expect(summarizeSchedulerHealth(completed, completed, null, now)).toMatchObject({ healthy: true, recovery_count: 3, alert_count: 1 });
    expect(summarizeSchedulerHealth(completed, { ...completed, completed_at: "2026-09-23T10:10:00Z" }, null, now).healthy).toBe(false);
    expect(summarizeSchedulerHealth(completed, completed, { state: "FAILED", started_at: "2026-09-23T10:25:00Z", completed_at: "2026-09-23T10:26:00Z" }, now).healthy).toBe(false);
  });
});
