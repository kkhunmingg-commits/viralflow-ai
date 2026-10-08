import type { ComplianceDecisionStatus } from "./contracts";

export interface SafetyDecisionRow {
  id: string; account_id: string | null; channel: "POST" | "LIVE";
  stage: string; content_hash: string; decision: ComplianceDecisionStatus; rewritten?: boolean; checked_at: string;
}
export interface AccountSafetySummary {
  state: "READY" | "EMPTY" | "UNAVAILABLE";
  checkedContent: number; safePercent: number | null; preventedRiskyPosts: number;
  reviewRequired: number; latestStatus: ComplianceDecisionStatus | null; latestRewritten: boolean;
  recentPolicyUpdate: string | null;
}

export function customerComplianceStatus(status: ComplianceDecisionStatus, rewritten = false) {
  switch (status) {
    case "PASS": return rewritten ? {label: "ปรับคำแล้ว", tone: "rewritten"} as const : {label: "ปลอดภัย", tone: "safe"} as const;
    case "PASS_WITH_WARNING": return rewritten ? {label: "ปรับคำแล้ว · มีข้อแนะนำ", tone: "rewritten"} as const : {label: "ปลอดภัย · มีข้อแนะนำ", tone: "safe"} as const;
    case "AUTO_REWRITE": return {label: "ควรตรวจสอบ", tone: "review"} as const;
    case "REVIEW_REQUIRED": return {label: "ควรตรวจสอบ", tone: "review"} as const;
    case "BLOCK": return {label: "ถูกบล็อกเพื่อป้องกันบัญชี", tone: "blocked"} as const;
  }
}

export const unavailableAccountSafety = (): AccountSafetySummary => ({state: "UNAVAILABLE", checkedContent: 0,
  safePercent: null, preventedRiskyPosts: 0, reviewRequired: 0, latestStatus: null, latestRewritten: false, recentPolicyUpdate: null});

/** Count the latest final check per content hash; retries and pre-generation checks cannot inflate safety. */
export function summarizeAccountSafety(rows: readonly SafetyDecisionRow[], accountId: string,
  recentPolicyUpdate: string | null = null): AccountSafetySummary {
  const final = rows.filter(row => row.account_id === accountId &&
    (row.channel === "POST" && row.stage === "FINAL_PUBLISH" || row.channel === "LIVE" && row.stage === "LIVE_SPEECH"))
    .sort((a, b) => b.checked_at.localeCompare(a.checked_at) || b.id.localeCompare(a.id));
  const latest = new Map<string, SafetyDecisionRow>();
  for (const row of final) {
    const key = `${row.channel}:${row.content_hash}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  const checks = [...latest.values()];
  const safe = checks.filter(row => row.decision === "PASS" || row.decision === "PASS_WITH_WARNING").length;
  return {state: checks.length ? "READY" : "EMPTY", checkedContent: checks.length,
    safePercent: checks.length ? Math.round(safe / checks.length * 100) : null,
    preventedRiskyPosts: checks.filter(row => row.channel === "POST" && row.decision === "BLOCK").length,
    reviewRequired: checks.filter(row => row.decision === "REVIEW_REQUIRED" || row.decision === "AUTO_REWRITE").length,
    latestStatus: checks[0]?.decision ?? null,
    latestRewritten: checks[0]?.rewritten === true && ["PASS","PASS_WITH_WARNING"].includes(checks[0].decision), recentPolicyUpdate};
}
