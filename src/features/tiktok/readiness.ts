import {
  TIKTOK_SCOPES,
  type TikTokAccountReadinessInput,
  type TikTokReadiness,
  type TikTokScope,
} from "./types";

export function normalizeTikTokScopes(scopes: readonly string[]): TikTokScope[] {
  const allowed = new Set<string>(TIKTOK_SCOPES);
  return [...new Set(scopes)].filter((scope): scope is TikTokScope => allowed.has(scope)).sort();
}

export function calculateTikTokReadiness(
  input: TikTokAccountReadinessInput,
): TikTokReadiness {
  const grantedScopes = normalizeTikTokScopes(input.grantedScopes);
  const granted = new Set(grantedScopes);
  const missingScopes = [...new Set(input.requestedScopes)]
    .filter((scope) => !granted.has(scope))
    .sort();

  if (input.authorizationStatus === "disconnected") {
    return {
      connectionStatus: "DISCONNECTED",
      grantedScopes,
      missingScopes,
      directPostStatus: "UNAVAILABLE",
      uploadStatus: "UNAVAILABLE",
    };
  }

  if (["expired", "revoked", "error"].includes(input.authorizationStatus)) {
    return {
      connectionStatus: "REAUTH_REQUIRED",
      grantedScopes,
      missingScopes,
      directPostStatus: granted.has("video.publish") ? "UNAVAILABLE" : "MISSING_SCOPE",
      uploadStatus: granted.has("video.upload") ? "UNAVAILABLE" : "MISSING_SCOPE",
    };
  }

  const uploadReady =
    granted.has("video.upload") && input.uploadApproval === "APPROVED";
  const directScopeReady =
    granted.has("video.publish") && input.publishApproval === "APPROVED";
  const directReady = directScopeReady && input.creatorInfoFresh;

  let connectionStatus: TikTokReadiness["connectionStatus"] = "CONNECTED";
  if (missingScopes.length > 0) connectionStatus = "PARTIAL";
  if (uploadReady) connectionStatus = "READY_FOR_UPLOAD";
  if (directReady && input.auditStatus !== "AUDITED") connectionStatus = "PRIVATE_ONLY";
  if (directReady && input.auditStatus === "AUDITED") {
    connectionStatus = "READY_FOR_DIRECT_POST";
  }

  return {
    connectionStatus,
    grantedScopes,
    missingScopes,
    directPostStatus: !granted.has("video.publish")
      ? "MISSING_SCOPE"
      : !directReady
        ? "UNAVAILABLE"
        : input.auditStatus === "AUDITED"
          ? "READY"
          : "PRIVATE_ONLY",
    uploadStatus: !granted.has("video.upload")
      ? "MISSING_SCOPE"
      : uploadReady
        ? "READY"
        : "UNAVAILABLE",
  };
}

export function isCreatorInfoFresh(
  cacheExpiresAt: string | null,
  now = new Date(),
) {
  return cacheExpiresAt !== null && Date.parse(cacheExpiresAt) > now.getTime();
}
