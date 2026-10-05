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
  quality_status?: unknown;
  quality_score?: unknown;
  quality_explanation_json?: unknown;
  provider?: unknown;
  status?: unknown;
};

export function autoVideoQualityOutcome(row: QualityRow | null): StageOutcome {
  if (!row) return { kind: "WAIT", state: "WAITING_FOR_DATA", reason: "VIDEO_NOT_READY" };
  const evidence = row.quality_explanation_json;
  if (evidence && typeof evidence === "object" && "reviewRequired" in evidence && evidence.reviewRequired === true) {
    return { kind: "WAIT", state: "WAITING_FOR_APPROVAL", reason: "REVIEW_REQUIRED" };
  }
  const visualStatus = evidence && typeof evidence === "object" && "visualVerificationStatus" in evidence
    ? (evidence as { visualVerificationStatus: unknown }).visualVerificationStatus : null;
  if (row.quality_status === "REJECT" || visualStatus === "FAIL") {
    return { kind: "SKIP_ITEM", reason: "QUALITY_REJECTED" };
  }
  if (visualStatus === "REVIEW" || (row.provider === "fal" && visualStatus !== "PASS")) {
    return { kind: "WAIT", state: "WAITING_FOR_DATA", reason: "VISUAL_VERIFICATION_PENDING" };
  }
  const threshold = evidence && typeof evidence === "object" && "qualityThreshold" in evidence ? Number(evidence.qualityThreshold) : 85;
  const score = Number(row.quality_score);
  if (!Number.isFinite(threshold) || threshold < 85 || threshold > 100 || !Number.isFinite(score) || score > 100
    || row.quality_status !== "PASS" || score < threshold || !["READY", "APPROVED"].includes(String(row.status ?? ""))) {
    return { kind: "SKIP_ITEM", reason: "QUALITY_NOT_PASSED" };
  }
  return { kind: "ADVANCE", evidence: { qualityScore: row.quality_score } };
}
