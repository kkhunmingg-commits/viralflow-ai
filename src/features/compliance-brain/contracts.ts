/** Shared wire contract. No customer secrets or executable policy rules belong here. */
export const SEMANTIC_CATEGORIES = [
  "MEDICAL_TREATMENT", "DISEASE_PREVENTION", "DIAGNOSIS", "GUARANTEED_RESULT",
  "ABSOLUTE_CLAIM", "TIME_BOUND_RESULT", "EXAGGERATED_FUNCTIONALITY", "FAKE_CERTIFICATION",
  "UNSUPPORTED_SUPERIORITY", "MISLEADING_COMPARISON", "FAKE_SCARCITY", "MISLEADING_PRICE",
  "FAKE_TESTIMONIAL", "FALSE_BEFORE_AFTER", "BODY_MANIPULATION", "UNSUPPORTED_FEATURE",
  "REPLACEMENT_FOR_MEDICAL_CARE", "RESTRICTED_PRODUCT", "UNKNOWN_FACT", "AIGC_DISCLOSURE",
  "VISUAL_MISMATCH",
] as const;
export type SemanticCategory = typeof SEMANTIC_CATEGORIES[number];
export type ComplianceDecisionStatus = "PASS" | "PASS_WITH_WARNING" | "AUTO_REWRITE" | "REVIEW_REQUIRED" | "BLOCK";
export type ComplianceChannel = "POST" | "LIVE";
export type ComplianceStage = "PRE_GENERATION" | "POST_GENERATION" | "FINAL_PUBLISH" | "LIVE_SPEECH";
export type CategoryRisk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export interface ComplianceScope {
  ownerId: string; productId: string; accountId?: string; platform: string;
  country: string; region: string; category: string; channel: ComplianceChannel;
}
export interface ProductEvidence {
  id: string; ownerId: string; productId: string;
  kind: "PDP" | "SELLER_DOCUMENT" | "PRODUCT_LABEL" | "CERTIFICATE" | "REGISTRATION" | "STUDY" | "PROMOTION" | "MEDIA_REVIEW";
  source: string; sourceHash: string; jurisdiction: string; verified: boolean;
  expiresAt: string | null;
}
export interface ProductClaim {
  id: string; ownerId: string; productId: string; text: string; type: string;
  source: string; evidenceRefs: string[]; jurisdiction: string; expiresAt: string | null;
  verified: boolean; allowedChannels: ComplianceChannel[]; conditions: string[];
  /** Equivalence must be supplied and verified with the claim, never invented by generation. */
  aliases?: string[];
}
export interface RiskFinding {
  category: SemanticCategory; confidence: number; text: string;
  polarity: "ASSERTED" | "NEGATED" | "QUESTION"; claimRefs: string[];
}
export interface SemanticAssessment {
  findings: RiskFinding[]; assertions: string[]; complete: boolean;
  /** Classifier uncertainty always becomes review, never a fabricated safe result. */
  uncertainty: string[];
}
export interface ComplianceContent {
  hook?: string; script?: string; cta?: string; caption?: string; hashtags?: string[];
  transcript?: string; onScreenText?: string[]; coverText?: string;
  visibleClaims?: string[]; metadata?: string[];
}
export interface ComplianceInput {
  scope: ComplianceScope; stage: ComplianceStage; content: ComplianceContent;
  claims: ProductClaim[]; evidence: ProductEvidence[]; satisfiedConditions?: string[];
  aiGenerated?: boolean; disclosureApplied?: boolean;
  media?: { assetHash: string; coverageComplete: boolean; evidenceRefs: string[] };
  now?: string;
}
export interface ComplianceReason {
  code: string; category?: SemanticCategory; message: string; policyRefs: string[];
}
export interface ComplianceDecision {
  id: string; status: ComplianceDecisionStatus; riskScore: number; categoryRisk: CategoryRisk;
  policyVersion: string | null; policyRefs: string[]; claimRefs: string[]; evidenceRefs: string[];
  reasons: ComplianceReason[]; suggestedRewrite: ComplianceContent | null;
  contentHash: string; checkedAt: string; scope: ComplianceScope; stage: ComplianceStage;
  rewrites: Array<{ inputHash: string; outputHash: string; status: ComplianceDecisionStatus }>;
}
export interface ComplianceAuthority { evaluate(input: ComplianceInput, signal?: AbortSignal): Promise<ComplianceDecision> }
export interface SemanticRiskClassifier { classify(input: ComplianceInput, signal?: AbortSignal): Promise<SemanticAssessment> }
export interface MediaComplianceScanner {
  scan(input: ComplianceInput, signal?: AbortSignal): Promise<{
    status: "VERIFIED" | "VISUAL_REVIEW_REQUIRED"; findings: RiskFinding[]; evidenceRefs: string[];
  }>;
}
export interface ComplianceRewriter {
  rewrite(input: ComplianceInput, decision: ComplianceDecision): Promise<ComplianceContent | null>;
}
