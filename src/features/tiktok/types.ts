export const TIKTOK_SCOPES = [
  "user.info.basic",
  "video.publish",
  "video.upload",
] as const;

export type TikTokScope = (typeof TIKTOK_SCOPES)[number];
export type TikTokConnectionStatus =
  | "CONNECTED"
  | "PARTIAL"
  | "READY_FOR_UPLOAD"
  | "READY_FOR_DIRECT_POST"
  | "PRIVATE_ONLY"
  | "REAUTH_REQUIRED"
  | "DISCONNECTED";
export type TikTokAuthorizationStatus =
  | "disconnected"
  | "pending"
  | "authorized"
  | "expired"
  | "revoked"
  | "error";
export type TikTokAppApprovalStatus = "UNKNOWN" | "NOT_APPROVED" | "APPROVED";
export type TikTokAuditStatus = "UNAUDITED" | "IN_REVIEW" | "AUDITED";

export interface TikTokTokenSet {
  openId: string;
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  scopes: TikTokScope[];
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface TikTokBasicUserInfo {
  openId: string;
  unionId: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export interface TikTokCreatorInfo {
  username: string;
  nickname: string;
  avatarUrl: string | null;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
}

export interface TikTokAccountReadinessInput {
  authorizationStatus: TikTokAuthorizationStatus;
  grantedScopes: readonly string[];
  requestedScopes: readonly TikTokScope[];
  publishApproval: TikTokAppApprovalStatus;
  uploadApproval: TikTokAppApprovalStatus;
  auditStatus: TikTokAuditStatus;
  creatorInfoFresh: boolean;
}

export interface TikTokReadiness {
  connectionStatus: TikTokConnectionStatus;
  grantedScopes: TikTokScope[];
  missingScopes: TikTokScope[];
  directPostStatus: "UNAVAILABLE" | "MISSING_SCOPE" | "PRIVATE_ONLY" | "READY";
  uploadStatus: "UNAVAILABLE" | "MISSING_SCOPE" | "READY";
}

export type MockTikTokScenario =
  | "connected"
  | "partial"
  | "upload_ready"
  | "direct_ready"
  | "private_only"
  | "expired"
  | "revoked"
  | "creator_failure";
