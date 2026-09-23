import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkBudget, evaluateSafetyGates, pauseAutoMode, planAccount, resumeAutoMode, stableAutoKey, stopAutoMode } from "./engine";
import { canStartOperatorRun, describeOperatorRun, operatorStages, realProviderAllowedForAccount } from "./operator";
import type { AutoAccountState, AutoRun } from "./types";

const run = (state: AutoRun["state"]) => ({ state, budget_usd: 1, spent_usd: 0 }) as AutoRun;
const account = (state: AutoAccountState["state"], blockers_json: string[] = []) => ({ state, blockers_json }) as AutoAccountState;
const base = { id: "growth", requestedMode: "GROWTH" as const, commerceReady: false, providerAvailable: true, providerBudgetAvailable: true, analyticsFresh: true, accountHealthy: true, consent: true, publishRemaining: 2, desiredCandidates: 15, desiredPosts: 2, priority: 1 };

describe("one-click operator boundary", () => {
  it("shows only evidence-backed stages, with a clear provider setup state", () => {
    expect(operatorStages[0]).toEqual(["PLAN_ACCOUNTS", "เตรียมแผน"]);
    expect(describeOperatorRun(run("RUNNING"), account("WAITING_FOR_PROVIDER", ["PROVIDER_UNAVAILABLE"]))).toMatchObject({ state: "WAITING_FOR_PROVIDER", setupRequired: true });
    expect(describeOperatorRun(null)).toMatchObject({ state: "IDLE", setupRequired: false });
  });

  it("prevents duplicate START and keeps PAUSE/RESUME/STOP idempotent", () => {
    expect(canStartOperatorRun(run("RUNNING"))).toBe(false);
    expect(canStartOperatorRun(run("PAUSED"))).toBe(false);
    expect(canStartOperatorRun(run("STOPPED"))).toBe(true);
    expect(pauseAutoMode("RUNNING")).toBe("PAUSED");
    expect(resumeAutoMode("PAUSED")).toBe("RUNNING");
    expect(stopAutoMode(stopAutoMode("RUNNING"))).toBe("STOPPED");
    expect(stableAutoKey("owner", "date", "request")).toBe(stableAutoKey("owner", "date", "request"));
  });

  it("keeps provider, budget, consent, and commerce failures closed", () => {
    expect(realProviderAllowedForAccount(true, true)).toBe(false);
    expect(realProviderAllowedForAccount(true, false)).toBe(true);
    expect(planAccount({ ...base, providerAvailable: false }).state).toBe("WAITING_FOR_PROVIDER");
    expect(planAccount({ ...base, providerBudgetAvailable: false }).state).toBe("BLOCKED");
    expect(planAccount({ ...base, requestedMode: "AFFILIATE", commerceReady: false }).mode).toBe("GROWTH");
    expect(checkBudget({ estimated: .1, runBudget: 0, runSpent: 0, accountBudget: 1, accountSpent: 0, providerBudget: 1, providerSpent: 0, perVideoBudget: 1, dailyBudget: 1, dailySpent: 0, monthlyBudget: 1, monthlySpent: 0 }).allowed).toBe(false);
    expect(evaluateSafetyGates({ mode: "GROWTH", quality: true, compliance: true, productTruth: true, aigc: true, originality: true, crossAccountUnique: true, accountHealth: true, commerceReady: false, publishCapacity: true, consent: false }).nextState).toBe("WAITING_FOR_APPROVAL");
  });

  it("moves attested writes behind service-role access while keeping owner reads", () => {
    const sql = readFileSync("supabase/migrations/20260923170000_phase_11f_operator_budget.sql", "utf8");
    expect(sql).toContain("create_operator_auto_run_atomic");
    expect(sql).toContain("p_budget_usd > v_limit");
    expect(sql).toContain("revoke insert,update,delete on public.media_assets");
    expect(sql).toContain("revoke insert,update,delete on public.tiktok_accounts,public.account_daily_stats");
    expect(sql).toContain("drop policy if exists publish_eligibility_insert");
    expect(sql).toContain("to service_role");
  });
});
