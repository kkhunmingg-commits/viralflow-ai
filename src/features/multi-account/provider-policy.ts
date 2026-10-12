import type { AccountAutomation } from "./contracts";
import type { ProviderSettings } from "@/features/video-provider/contracts";
/** Account preferences can restrict an existing permission, never grant permission to spend. */
export function restrictProviderSettings(owner: ProviderSettings, account: AccountAutomation, deadlineMissed = false): ProviderSettings {
  let mode: ProviderSettings["mode"] = owner.mode === "GOOGLE_ONLY" || account.providerPreference === "GOOGLE_ONLY" ? "GOOGLE_ONLY"
    : owner.mode === "GEMINI_ONLY" ? "GEMINI_ONLY" : owner.mode === "FAL_ONLY" ? "FAL_ONLY" : account.providerPreference === "FAL_ONLY" && !owner.paidFallback ? "GOOGLE_ONLY" : account.providerPreference;
  if (mode === "AUTO" && deadlineMissed && owner.paidFallback && ["ASSISTED", "UNAVAILABLE", "LOGIN_EXPIRED", "QUOTA_EXHAUSTED"].includes(owner.googleStatus)) mode = "FAL_ONLY";
  return { ...owner, mode, paidFallback: owner.paidFallback,
    maxCostUsd: Math.min(owner.maxCostUsd, account.dailyBudgetUsd) };
}
