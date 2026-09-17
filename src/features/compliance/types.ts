export const COMPLIANCE_VERSION="content-compliance-v1";
export const ORIGINALITY_VERSION="originality-gate-v1";

export type TriStatus="PASS"|"REVIEW"|"REJECT";
export type OriginalityStatus="ORIGINAL"|"ACCEPTABLE_VARIATION"|"TOO_SIMILAR"|"REJECT";
export type AccountPublishStatus="READY"|"LIMITED"|"PAUSED"|"BLOCKED"|"DISCONNECTED";
export type PublishEligibilityStatus="READY_FOR_REVIEW"|"READY_TO_PUBLISH"|"QUEUED_NEXT_DAY"|"HOLD"|"REGENERATE"|"REJECT"|"ACCOUNT_BLOCKED";

export interface ComplianceInput {
  text:string;
  approvedProductFacts:string[];
  mode:"GROWTH"|"AFFILIATE";
  cartAvailable:boolean;
  affiliateAvailable:boolean;
  inheritedRisk?:"SAFE"|"REVIEW"|"REJECT";
  aiGenerated:boolean;
  aiModified:boolean;
  provider:string;
  providerRequiresDisclosure?:boolean;
  platformRequiresDisclosure?:boolean;
  provenanceAvailable?:boolean;
}
export interface AIGCDisclosure {
  ai_generated:boolean;
  ai_modified:boolean;
  disclosure_recommended:boolean;
  disclosure_required_if_provider_or_platform_indicates:boolean;
  provenance_available:boolean;
  provider:string;
}
export interface ComplianceIssue {code:string;severity:TriStatus;message:string}
export interface ComplianceResult {
  claimStatus:TriStatus;
  productTruthStatus:TriStatus;
  aigcStatus:"PASS"|"DISCLOSE"|"REVIEW";
  policyStatus:TriStatus;
  overallStatus:TriStatus;
  issues:ComplianceIssue[];
  aigc:AIGCDisclosure;
  version:string;
}

export interface OriginalityMetadata {
  videoId:string;
  accountId:string;
  masterId:string;
  productId:string;
  creativeProjectId:string;
  hook:string;
  scenes:unknown;
  cta:string;
  audio:unknown;
}
export interface OriginalityResult {
  sameAccountSimilarity:number;
  crossAccountSimilarity:number;
  hookSimilarity:number;
  sceneSimilarity:number;
  audioSimilarity:number;
  overallSimilarity:number;
  status:OriginalityStatus;
  matchedVideoIds:string[];
  version:string;
}

export interface AccountHealthInput {
  effectiveMode:"GROWTH"|"AFFILIATE";
  authorizationStatus:string;
  sourceAccountStatus:string;
  dailyTarget:number;
  dailyHardLimit:number;
  observedPlatformCap?:number|null;
  internalSafetyLimit?:number;
  postsToday:number;
  failedPostsToday:number;
  shopPermission:boolean;
  cartEnabled:boolean;
  paused?:boolean;
}
export interface AccountHealthResult {
  accountStatus:AccountPublishStatus;
  healthStatus:AccountPublishStatus;
  effectivePublishCap:number;
  remaining:number;
  blockers:string[];
}
export interface PublishEligibilityInput {
  complianceStatus:TriStatus;
  originalityStatus:OriginalityStatus;
  qualityStatus:string|null;
  health:AccountHealthResult;
  requiresShopPermission:boolean;
  shopPermission:boolean;
  userApproved?:boolean;
}
export interface PublishEligibilityResult {
  compliancePass:boolean;
  originalityPass:boolean;
  qualityPass:boolean;
  accountHealthPass:boolean;
  creatorLimitPass:boolean;
  shopPermissionPass:boolean;
  userApprovalRequired:true;
  finalStatus:PublishEligibilityStatus;
  blockers:string[];
}
