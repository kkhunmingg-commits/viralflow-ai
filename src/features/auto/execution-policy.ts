import type { StageOutcome } from "./processor";

type PublishAccount = {
  is_mock: boolean;
  authorization_status: string;
  audit_status: string;
  direct_post_status: string;
  granted_scopes: unknown;
};

export function autoPublishMode(account: PublishAccount, development: boolean) {
  if (account.is_mock) return development ? "DRAFT_UPLOAD" as const : null;
  return account.authorization_status === "authorized"
    && account.audit_status === "AUDITED"
    && account.direct_post_status === "READY"
    && Array.isArray(account.granted_scopes)
    && account.granted_scopes.includes("video.publish")
    ? "DIRECT_POST" as const : null;
}

type QualityRow = {
  quality_status: string | null;
  quality_score: number | null;
  quality_explanation_json: unknown;
  provider: string | null;
  status: string | null;
};

export function autoVideoQualityOutcome(row: QualityRow | null): StageOutcome {
  if (!row) return { kind: "WAIT", state: "WAITING_FOR_DATA", reason: "VIDEO_NOT_READY" };
  const evidence = row.quality_explanation_json;
  const visualStatus = evidence && typeof evidence === "object" && "visualVerificationStatus" in evidence
    ? (evidence as { visualVerificationStatus: unknown }).visualVerificationStatus : null;
  if (row.quality_status === "REJECT" || visualStatus === "FAIL") {
    return { kind: "SKIP_ITEM", reason: "QUALITY_REJECTED" };
  }
  if (visualStatus === "REVIEW" || (row.provider === "fal" && visualStatus !== "PASS")) {
    return { kind: "WAIT", state: "WAITING_FOR_DATA", reason: "VISUAL_VERIFICATION_PENDING" };
  }
  if (row.quality_status !== "PASS" || Number(row.quality_score) < 85 || !["READY", "APPROVED"].includes(row.status ?? "")) {
    return { kind: "SKIP_ITEM", reason: "QUALITY_NOT_PASSED" };
  }
  return { kind: "ADVANCE", evidence: { qualityScore: row.quality_score } };
}
