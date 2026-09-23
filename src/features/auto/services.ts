import type { SupabaseClient } from "@supabase/supabase-js";
import { logOps } from "../../lib/ops/logger";
import { operationalPage, operationalWindow } from "../../lib/pagination";
import { planAccount, stableAutoKey } from "./engine";
import type { AutoAccountState, AutoAction, AutoCheckpoint, AutoFailure, AutoRun, AutoStep } from "./types";
import { serverEnv } from "@/lib/server-env";
import { falAutoModeAvailability } from "@/features/video/provider-routing";
import { realProviderAllowedForAccount } from "./operator";

const ACTIVE = ["STARTING", "RUNNING", "PAUSED", "RETRY_PENDING"];
const AUTO_RUN_VERSION = "full-auto-mode-v1";

export async function getAutoOverview(client: SupabaseClient, owner: string, page = 1) {
  const { from, to } = operationalWindow(page);
  const [runs, active, states, actions, failures] = await Promise.all([
    client.from("auto_runs").select("*").eq("owner_id", owner).order("updated_at", { ascending: false }).order("id", { ascending: false }).range(from, to),
    client.from("auto_runs").select("*").eq("owner_id", owner).in("state", ACTIVE).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("auto_account_states").select("*").eq("owner_id", owner).order("priority", { ascending: false }),
    client.from("auto_actions").select("*").eq("owner_id", owner).order("created_at", { ascending: false }).limit(100),
    client.from("auto_failures").select("*").eq("owner_id", owner).order("created_at", { ascending: false }).limit(100),
  ]);
  for (const result of [runs, active, states, actions, failures]) if (result.error) throw new Error(result.error.message);
  const runPage = operationalPage((runs.data ?? []) as AutoRun[], page);
  const runRows = runPage.items;
  const stateRows = (states.data ?? []) as AutoAccountState[];
  const latest = page === 1 ? null : await client.from("auto_runs").select("*").eq("owner_id", owner).order("updated_at", { ascending: false }).limit(50);
  if (latest?.error) throw new Error(latest.error.message);
  const summaryRuns = latest ? (latest.data ?? []) as AutoRun[] : runRows;
  return { runs: runRows, page, hasMore: runPage.hasMore, states: stateRows, actions: actions.data ?? [], failures: failures.data ?? [], activeRun: active.data as AutoRun | null, summary: summarizeAuto(summaryRuns, stateRows, actions.data ?? []) };
}

export async function getAutoRun(client: SupabaseClient, owner: string, id: string) {
  const [run, states, steps, actions, failures, checkpoints] = await Promise.all([
    client.from("auto_runs").select("*").eq("owner_id", owner).eq("id", id).maybeSingle(),
    client.from("auto_account_states").select("*").eq("owner_id", owner).eq("auto_run_id", id).order("priority", { ascending: false }),
    client.from("auto_run_steps").select("*").eq("owner_id", owner).eq("auto_run_id", id).order("created_at").limit(200),
    client.from("auto_actions").select("*").eq("owner_id", owner).eq("auto_run_id", id).order("created_at").limit(200),
    client.from("auto_failures").select("*").eq("owner_id", owner).eq("auto_run_id", id).order("created_at", { ascending: false }).limit(200),
    client.from("auto_checkpoints").select("*").eq("owner_id", owner).eq("auto_run_id", id).order("checkpoint_version", { ascending: false }).limit(200),
  ]);
  for (const result of [run, states, steps, actions, failures, checkpoints]) if (result.error) throw new Error(result.error.message);
  if (!run.data) return null;
  return { run: run.data as AutoRun, states: (states.data ?? []) as AutoAccountState[], steps: (steps.data ?? []) as AutoStep[], actions: (actions.data ?? []) as AutoAction[], failures: (failures.data ?? []) as AutoFailure[], checkpoints: (checkpoints.data ?? []) as AutoCheckpoint[] };
}

export function summarizeAuto(runs: AutoRun[], states: AutoAccountState[], actions: Array<Record<string, unknown>>) {
  const today = new Date().toISOString().slice(0, 10);
  const todayRuns = runs.filter((row) => row.run_date === today);
  return {
    running: states.filter((row) => row.state === "RUNNING").length,
    paused: states.filter((row) => row.state === "PAUSED").length,
    blocked: states.filter((row) => row.state === "BLOCKED").length,
    waitingApprovals: states.filter((row) => row.state === "WAITING_FOR_APPROVAL").length,
    waitingSlots: states.filter((row) => row.state === "WAITING_FOR_SLOT").length,
    costToday: todayRuns.reduce((sum, row) => sum + Number(row.spent_usd), 0),
    generatedToday: states.reduce((sum, row) => sum + row.generated_today, 0),
    publishedToday: states.reduce((sum, row) => sum + row.published_today, 0),
    winnersToday: actions.filter((row) => row.status === "COMPLETED" && String(row.action_type).startsWith("SCALE")).length,
    active: todayRuns[0],
  };
}

export interface OperatorSelection { accountId: string; mode: "AUTO" | "GROWTH" | "AFFILIATE"; dailyTarget: number; dailyBudgetUsd: number }

export async function createAutoRun(admin: SupabaseClient, owner: string, requestKey: string, selection?: OperatorSelection) {
  const date = new Date().toISOString().slice(0, 10);
  const key = stableAutoKey(owner, date, requestKey, AUTO_RUN_VERSION);
  let accountQuery = admin.from("tiktok_accounts")
    .select("id,is_mock,mode,effective_mode,authorization_status,account_status,daily_post_target,daily_post_hard_limit,max_cost_per_video_usd,daily_video_budget_usd,monthly_video_budget_usd")
    .eq("owner_id", owner);
  if (selection) accountQuery = accountQuery.eq("id", selection.accountId);
  const accounts = await accountQuery;
  if (accounts.error) throw new Error(accounts.error.message);
  if (selection && accounts.data?.length !== 1) throw new Error("account_not_found");
  if (selection && (!Number.isInteger(selection.dailyTarget) || selection.dailyTarget < 1 || selection.dailyTarget > 20 || !Number.isFinite(selection.dailyBudgetUsd) || selection.dailyBudgetUsd < 0 || selection.dailyBudgetUsd > 1000)) throw new Error("invalid_operator_selection");
  const providerGate = falAutoModeAvailability({ keyPresent: Boolean(serverEnv.falKey), state: serverEnv.falWanProviderState });
  const providerAvailable = providerGate.providerAvailable;
  const sandbox = process.env.NODE_ENV === "development" && (accounts.data ?? []).length > 0 && (accounts.data ?? []).every((account) => account.is_mock);
  const videoProvider = sandbox ? "local-ffmpeg" : providerAvailable ? "fal-wan-2.2-turbo" : "UNAVAILABLE";
  const plans = (accounts.data ?? []).map((account, index) => {
    const requestedMode = selection?.mode ?? account.mode;
    const dailyTarget = selection?.dailyTarget ?? account.daily_post_target;
    const dailyBudgetUsd = selection?.dailyBudgetUsd ?? Number(account.daily_video_budget_usd ?? 0);
    if (dailyTarget > account.daily_post_hard_limit) throw new Error("daily_target_exceeds_account_limit");
    if (requestedMode === "AFFILIATE" && (account.effective_mode !== "AFFILIATE" || account.is_mock)) throw new Error("affiliate_not_eligible");
    const plan = planAccount({
      id: account.id, requestedMode, commerceReady: account.effective_mode === "AFFILIATE" && !account.is_mock, providerAvailable: sandbox || realProviderAllowedForAccount(providerAvailable, account.is_mock),
      providerBudgetAvailable: Number(account.max_cost_per_video_usd) > 0 && Number(account.monthly_video_budget_usd) > 0 && dailyBudgetUsd > 0 && dailyBudgetUsd <= Number(account.daily_video_budget_usd),
      analyticsFresh: true, accountHealthy: account.account_status === "active" && account.authorization_status === "authorized", consent: false, deferConsentUntilPublish: true,
      publishRemaining: account.daily_post_hard_limit, desiredCandidates: Math.max(15, dailyTarget), desiredPosts: dailyTarget,
      priority: 100 - index, nextGrowthAction: "WAIT_FOR_DATA", affiliateDecision: "WATCH",
    });
    return {
      accountId: plan.accountId, requestedMode, mode: plan.mode, state: plan.state, nextAction: plan.nextAction, blockers: plan.blockers,
      desiredCandidates: Math.max(15, dailyTarget), desiredPosts: dailyTarget,
      maxDailyCostUsd: dailyBudgetUsd, generationCapacity: plan.generationCapacity, publishCapacity: plan.publishCapacity,
      priority: 100 - index, actionKey: stableAutoKey(key, plan.accountId, plan.nextAction),
    };
  });
  const result = await admin.rpc(selection ? "create_operator_auto_run_atomic" : "create_auto_run_atomic", {
    p_owner_id: owner, p_idempotency_key: key, p_run_date: date, p_video_provider: videoProvider,
    p_provider_gate_reason: sandbox ? "DEVELOPMENT_MOCK_ONLY" : providerGate.reason, p_plans: plans,
    ...(selection ? { p_budget_usd: selection.dailyBudgetUsd } : {}),
  });
  if (result.error || !result.data) throw new Error(result.error?.message ?? "auto_run_create_failed");
  logOps({ severity: "INFO", component: "auto", operation: "create_run", owner_id: owner, run_id: result.data.id, correlation_id: key, to_state: result.data.state });
  return result.data as AutoRun;
}

export async function transitionAutoRun(admin: SupabaseClient, owner: string, id: string, action: "PAUSE" | "RESUME" | "STOP") {
  const result = await admin.rpc("transition_auto_run_atomic", { p_owner_id: owner, p_run_id: id, p_action: action });
  if (result.error || !result.data) throw new Error(result.error?.message ?? "auto_run_transition_failed");
  logOps({ severity: "INFO", component: "auto", operation: action, owner_id: owner, run_id: id, from_state: result.data.previous, to_state: result.data.state });
  return result.data as { previous: string; state: string };
}
