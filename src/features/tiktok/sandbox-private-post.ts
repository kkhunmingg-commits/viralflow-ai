export interface SandboxPrivatePostAccount {
  id: string;
  owner_id: string;
  is_mock: boolean;
  authorization_status: string;
  granted_scopes: string[];
  audit_status: string;
  video_publish_approval_status: string;
}

export function sandboxPrivatePostAccountId(env: Record<string, string | undefined> = process.env) {
  if (env.TIKTOK_SANDBOX_PRIVATE_TEST_ENABLED !== "true") return null;
  if (!env.TIKTOK_CLIENT_KEY?.startsWith("sb")) return null;
  if (env.TIKTOK_PROVIDER !== "official") return null;
  if (env.TIKTOK_PUBLISHING_REAL_MODE === "true") return null;
  if (env.TIKTOK_VIDEO_PUBLISH_APPROVED === "true") return null;
  if (env.TIKTOK_DIRECT_POST_AUDIT_STATUS === "AUDITED") return null;
  const accountId = env.TIKTOK_SANDBOX_PRIVATE_TEST_ACCOUNT_ID;
  return accountId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)
    ? accountId
    : null;
}

export function assertSandboxPrivatePostAccount(
  account: SandboxPrivatePostAccount,
  ownerId: string,
  configuredAccountId: string | null,
) {
  if (!configuredAccountId || account.id !== configuredAccountId || account.owner_id !== ownerId) {
    throw new Error("sandbox_account_not_allowed");
  }
  if (account.is_mock || account.authorization_status !== "authorized") {
    throw new Error("sandbox_account_not_authorized");
  }
  if (!account.granted_scopes.includes("video.publish")) {
    throw new Error("sandbox_video_publish_scope_missing");
  }
  if (account.audit_status !== "UNAUDITED" || account.video_publish_approval_status !== "NOT_APPROVED") {
    throw new Error("sandbox_approval_state_mismatch");
  }
}
