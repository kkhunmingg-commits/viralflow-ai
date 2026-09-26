import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logOps } from "../../lib/ops/logger";
import { serverEnv, tiktokOfficialSetupMissing } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { MockTikTokProvider, OfficialTikTokProvider, type TikTokProvider } from "./provider";
import { calculateTikTokReadiness, isCreatorInfoFresh } from "./readiness";
import { officialTikTokRequestedScopes } from "./oauth-scopes";
import { TikTokTokenCipher, type EncryptedToken } from "./token-crypto";
export { publicTikTokAccount } from "./serialization";
import type {
  MockTikTokScenario,
  TikTokAuditStatus,
  TikTokAuthorizationStatus,
  TikTokCreatorInfo,
  TikTokScope,
  TikTokTokenSet,
} from "./types";

type AdminClient = SupabaseClient;

export class TikTokServiceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TikTokServiceError";
  }
}

function stateHash(state: string) {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

function safeErrorCode(error: unknown) {
  if (error instanceof TikTokServiceError) return error.code;
  if (!(error instanceof Error)) return "tiktok_unknown_error";
  const code = error.message.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 80);
  return code || "tiktok_unknown_error";
}

function approval(value: boolean) {
  return value ? ("APPROVED" as const) : ("NOT_APPROVED" as const);
}

export function createTikTokProvider(scenario?: MockTikTokScenario): TikTokProvider {
  if (serverEnv.tiktokProvider === "mock") return new MockTikTokProvider(scenario);
  if (tiktokOfficialSetupMissing.length || !serverEnv.tiktokClientKey || !serverEnv.tiktokClientSecret || !serverEnv.tiktokRedirectUri) {
    throw new TikTokServiceError("tiktok_official_configuration_missing");
  }
  return new OfficialTikTokProvider({
    clientKey: serverEnv.tiktokClientKey,
    clientSecret: serverEnv.tiktokClientSecret,
    redirectUri: serverEnv.tiktokRedirectUri,
  });
}

function tokenCipher() {
  const secret = serverEnv.tiktokTokenEncryptionKey ?? serverEnv.supabaseSecretKey;
  if (!secret) throw new TikTokServiceError("tiktok_token_encryption_key_missing");
  return new TikTokTokenCipher(secret);
}

export class TikTokOAuthService {
  constructor(
    private readonly admin: AdminClient = createAdminClient(),
    private readonly provider: TikTokProvider = createTikTokProvider(),
  ) {}

  async buildAuthorizationUrl(input: {
    ownerId: string;
    origin: string;
    requestedScopes: TikTokScope[];
    returnPath?: string;
    mockScenario?: MockTikTokScenario;
    disableAutoAuth?: boolean;
  }) {
    const state = randomBytes(32).toString("base64url");
    const redirectUri = serverEnv.tiktokProvider === "official"
      ? serverEnv.tiktokRedirectUri
      : `${input.origin}/auth/tiktok/callback`;
    if (!redirectUri) throw new TikTokServiceError("tiktok_redirect_uri_missing");

    const { error } = await this.admin.from("tiktok_oauth_states").insert({
      owner_id: input.ownerId,
      state_hash: stateHash(state),
      requested_scopes: input.requestedScopes,
      return_path: input.returnPath ?? "/accounts",
      mock_scenario: input.mockScenario ?? null,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (error) throw new TikTokServiceError("oauth_state_persist_failed");

    return this.provider.buildAuthorizationUrl({
      clientKey: serverEnv.tiktokClientKey ?? "mock-client-key",
      redirectUri,
      scopes: input.requestedScopes,
      state,
      disableAutoAuth: input.disableAutoAuth,
    });
  }

  async consumeState(ownerId: string, state: string) {
    const { data, error } = await this.admin.rpc("consume_tiktok_oauth_state", {
      p_owner_id: ownerId,
      p_state_hash: stateHash(state),
    });
    const record = Array.isArray(data) ? data[0] : null;
    if (error || !record) throw new TikTokServiceError("oauth_state_invalid_or_replayed");
    return record as {
      state_id: string;
      requested_scopes: TikTokScope[];
      return_path: string;
      mock_scenario: MockTikTokScenario | null;
    };
  }

  async completeCallback(input: {
    ownerId: string;
    code: string;
    state: string;
  }) {
    const state = await this.consumeState(input.ownerId, input.state);
    const provider = state.mock_scenario
      ? createTikTokProvider(state.mock_scenario)
      : this.provider;
    const token = await provider.exchangeAuthorizationCode(input.code);
    const user = await provider.getBasicUserInfo(token.accessToken);
    if (user.openId !== token.openId) throw new TikTokServiceError("oauth_identity_mismatch");

    const { data: duplicate, error: duplicateError } = await this.admin
      .from("tiktok_accounts")
      .select("id,owner_id")
      .eq("open_id", token.openId)
      .maybeSingle();
    if (duplicateError) throw new TikTokServiceError("duplicate_check_failed");
    if (duplicate && duplicate.owner_id !== input.ownerId) {
      throw new TikTokServiceError("tiktok_account_owned_by_another_owner");
    }

    let creator: TikTokCreatorInfo | null = null;
    let creatorError: string | null = null;
    if (token.scopes.includes("video.publish") && state.mock_scenario !== "expired" && state.mock_scenario !== "revoked") {
      try {
        creator = await provider.queryCreatorInfo(token.accessToken);
      } catch (error) {
        creatorError = safeErrorCode(error);
      }
    }

    const authorizationStatus: TikTokAuthorizationStatus = state.mock_scenario === "expired"
      ? "expired"
      : state.mock_scenario === "revoked"
        ? "revoked"
        : "authorized";
    const mockPublishApproved = state.mock_scenario === "direct_ready" || state.mock_scenario === "private_only" || state.mock_scenario === "creator_failure";
    const mockUploadApproved = state.mock_scenario === "upload_ready" || state.mock_scenario === "direct_ready";
    const publishApproval = approval(serverEnv.tiktokProvider === "mock" ? mockPublishApproved : serverEnv.tiktokVideoPublishApproved);
    const uploadApproval = approval(serverEnv.tiktokProvider === "mock" ? mockUploadApproved : serverEnv.tiktokVideoUploadApproved);
    const auditStatus: TikTokAuditStatus = state.mock_scenario === "direct_ready"
      ? "AUDITED"
      : serverEnv.tiktokDirectPostAuditStatus;
    const syncedAt = creator ? new Date().toISOString() : null;
    const cacheExpiresAt = creator
      ? new Date(Date.now() + serverEnv.tiktokCreatorCacheTtlSeconds * 1000).toISOString()
      : null;
    const readiness = calculateTikTokReadiness({
      authorizationStatus,
      grantedScopes: token.scopes,
      requestedScopes: state.requested_scopes,
      publishApproval,
      uploadApproval,
      auditStatus,
      creatorInfoFresh: creator !== null,
    });

    const accountValues = {
      owner_id: input.ownerId,
      open_id: token.openId,
      union_id: user.unionId,
      display_name: creator?.nickname ?? user.displayName,
      username: creator?.username ?? null,
      avatar_url: creator?.avatarUrl ?? user.avatarUrl,
      authorization_status: authorizationStatus,
      connection_status: readiness.connectionStatus,
      token_expires_at: token.accessTokenExpiresAt,
      refresh_token_expires_at: token.refreshTokenExpiresAt,
      granted_scopes: readiness.grantedScopes,
      missing_scopes: readiness.missingScopes,
      creator_info_sync_at: syncedAt,
      creator_info_cache_expires_at: cacheExpiresAt,
      creator_max_video_duration: creator?.maxVideoPostDurationSec ?? null,
      privacy_level_options: creator?.privacyLevelOptions ?? [],
      comment_disabled: creator?.commentDisabled ?? null,
      duet_disabled: creator?.duetDisabled ?? null,
      stitch_disabled: creator?.stitchDisabled ?? null,
      direct_post_status: readiness.directPostStatus,
      upload_status: readiness.uploadStatus,
      video_publish_approval_status: publishApproval,
      video_upload_approval_status: uploadApproval,
      audit_status: auditStatus,
      last_auth_error: null,
      last_sync_error: creatorError,
      disconnected_at: null,
      account_status: "active",
      is_mock: serverEnv.tiktokProvider === "mock",
    };

    let accountId = duplicate?.id as string | undefined;
    if (accountId) {
      const { error } = await this.admin.from("tiktok_accounts").update(accountValues).eq("id", accountId).eq("owner_id", input.ownerId);
      if (error) throw new TikTokServiceError("tiktok_account_update_failed");
    } else {
      const { data, error } = await this.admin.from("tiktok_accounts").insert(accountValues).select("id").single();
      if (error || !data) throw new TikTokServiceError("tiktok_account_create_failed");
      accountId = data.id as string;
    }

    const tokenService = new TikTokTokenService(this.admin, provider, tokenCipher());
    const credentialId = await tokenService.store(input.ownerId, accountId, token);
    const { error: integrationError } = await this.admin.from("integrations").upsert({
      owner_id: input.ownerId,
      tiktok_account_id: accountId,
      provider: "tiktok",
      status: authorizationStatus === "authorized" ? "connected" : authorizationStatus,
      granted_scopes: readiness.grantedScopes,
      capabilities: {
        connection_status: readiness.connectionStatus,
        direct_post_status: readiness.directPostStatus,
        upload_status: readiness.uploadStatus,
        audit_status: auditStatus,
      },
      token_secret_ref: credentialId,
      verified_at: new Date().toISOString(),
      expires_at: token.accessTokenExpiresAt,
    }, { onConflict: "owner_id,provider,tiktok_account_id" });
    if (integrationError) throw new TikTokServiceError("tiktok_integration_update_failed");
    await this.admin.from("account_publish_health").update({
      authorization_status: authorizationStatus,
      last_creator_info_sync_at: syncedAt,
    }).eq("owner_id", input.ownerId).eq("tiktok_account_id", accountId);

    return { accountId, returnPath: state.return_path, connectionStatus: readiness.connectionStatus };
  }
}

interface CredentialRow {
  id: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  access_token_tag: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  refresh_token_tag: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  revoked_at: string | null;
}

export class TikTokTokenService {
  constructor(
    private readonly admin: AdminClient = createAdminClient(),
    private readonly provider: TikTokProvider = createTikTokProvider(),
    private readonly cipher: TikTokTokenCipher = tokenCipher(),
  ) {}

  async store(ownerId: string, accountId: string, token: TikTokTokenSet) {
    const access = this.cipher.encrypt(token.accessToken);
    const refresh = this.cipher.encrypt(token.refreshToken);
    const { data, error } = await this.admin.from("tiktok_oauth_credentials").upsert({
      owner_id: ownerId,
      tiktok_account_id: accountId,
      access_token_ciphertext: access.ciphertext,
      access_token_iv: access.iv,
      access_token_tag: access.tag,
      refresh_token_ciphertext: refresh.ciphertext,
      refresh_token_iv: refresh.iv,
      refresh_token_tag: refresh.tag,
      token_type: token.tokenType,
      access_token_expires_at: token.accessTokenExpiresAt,
      refresh_token_expires_at: token.refreshTokenExpiresAt,
      revoked_at: null,
    }, { onConflict: "tiktok_account_id" }).select("id").single();
    if (error || !data) throw new TikTokServiceError("token_store_failed");
    return data.id as string;
  }

  private async credential(ownerId: string, accountId: string) {
    const { data, error } = await this.admin.from("tiktok_oauth_credentials")
      .select("*").eq("owner_id", ownerId).eq("tiktok_account_id", accountId).maybeSingle();
    if (error || !data) throw new TikTokServiceError("token_not_found");
    return data as CredentialRow;
  }

  private decrypt(row: CredentialRow, prefix: "access" | "refresh") {
    return this.cipher.decrypt({
      ciphertext: row[`${prefix}_token_ciphertext`],
      iv: row[`${prefix}_token_iv`],
      tag: row[`${prefix}_token_tag`],
    } as EncryptedToken);
  }

  async getAccessToken(ownerId: string, accountId: string, refreshBufferMs = 5 * 60_000) {
    const row = await this.credential(ownerId, accountId);
    if (row.revoked_at) throw new TikTokServiceError("token_revoked");
    if (Date.parse(row.access_token_expires_at) > Date.now() + refreshBufferMs) {
      return this.decrypt(row, "access");
    }
    if (Date.parse(row.refresh_token_expires_at) <= Date.now()) {
      await this.markReauthorization(ownerId, accountId, "refresh_token_expired");
      logOps({ severity: "WARN", component: "tiktok_oauth", operation: "refresh", owner_id: ownerId,
        account_id: accountId, to_state: "REAUTH_REQUIRED", error_category: "AUTH", error_code: "REFRESH_TOKEN_EXPIRED" });
      throw new TikTokServiceError("refresh_token_expired");
    }
    try {
      const refreshed = await this.provider.refreshAccessToken(this.decrypt(row, "refresh"));
      const { data: account, error: accountError } = await this.admin.from("tiktok_accounts")
        .select("open_id,video_publish_approval_status,video_upload_approval_status,audit_status,creator_info_cache_expires_at")
        .eq("owner_id", ownerId).eq("id", accountId).single();
      if (accountError || !account || account.open_id !== refreshed.openId) {
        throw new TikTokServiceError("refresh_identity_mismatch");
      }
      const readiness = calculateTikTokReadiness({
        authorizationStatus: "authorized",
        grantedScopes: refreshed.scopes,
        requestedScopes: officialTikTokRequestedScopes(serverEnv.tiktokOAuthScopeMode),
        publishApproval: account.video_publish_approval_status,
        uploadApproval: account.video_upload_approval_status,
        auditStatus: account.audit_status,
        creatorInfoFresh: isCreatorInfoFresh(account.creator_info_cache_expires_at),
      });
      await this.store(ownerId, accountId, refreshed);
      await this.admin.from("tiktok_accounts").update({
        authorization_status: "authorized",
        connection_status: readiness.connectionStatus,
        token_expires_at: refreshed.accessTokenExpiresAt,
        refresh_token_expires_at: refreshed.refreshTokenExpiresAt,
        granted_scopes: readiness.grantedScopes,
        missing_scopes: readiness.missingScopes,
        direct_post_status: readiness.directPostStatus,
        upload_status: readiness.uploadStatus,
        last_auth_error: null,
      }).eq("owner_id", ownerId).eq("id", accountId);
      await this.admin.from("integrations").update({
        status: "connected",
        granted_scopes: readiness.grantedScopes,
        expires_at: refreshed.accessTokenExpiresAt,
        capabilities: {
          connection_status: readiness.connectionStatus,
          direct_post_status: readiness.directPostStatus,
          upload_status: readiness.uploadStatus,
          audit_status: account.audit_status,
        },
      }).eq("owner_id", ownerId).eq("tiktok_account_id", accountId).eq("provider", "tiktok");
      await this.admin.from("account_publish_health").update({ authorization_status: "authorized" })
        .eq("owner_id", ownerId).eq("tiktok_account_id", accountId);
      logOps({ severity: "INFO", component: "tiktok_oauth", operation: "refresh", owner_id: ownerId,
        account_id: accountId, to_state: "AUTHORIZED" });
      return refreshed.accessToken;
    } catch (error) {
      await this.markReauthorization(ownerId, accountId, safeErrorCode(error));
      logOps({ severity: "ERROR", component: "tiktok_oauth", operation: "refresh", owner_id: ownerId,
        account_id: accountId, to_state: "REAUTH_REQUIRED", error_category: "AUTH", error_code: "TOKEN_REFRESH_FAILED" });
      throw new TikTokServiceError("token_refresh_failed");
    }
  }

  private async markReauthorization(ownerId: string, accountId: string, code: string) {
    await this.admin.from("tiktok_accounts").update({
      authorization_status: "expired",
      connection_status: "REAUTH_REQUIRED",
      last_auth_error: code,
    }).eq("owner_id", ownerId).eq("id", accountId);
    await this.admin.from("account_publish_health").update({
      authorization_status: "expired",
      account_status: "BLOCKED",
      health_status: "BLOCKED",
    }).eq("owner_id", ownerId).eq("tiktok_account_id", accountId);
  }

  async revokeAndDisconnect(ownerId: string, accountId: string) {
    const row = await this.credential(ownerId, accountId);
    try {
      await this.provider.revokeAuthorization(this.decrypt(row, "access"));
    } catch {
      // Local credential removal is mandatory even when TikTok is unavailable.
    }
    const now = new Date().toISOString();
    await this.admin.from("tiktok_oauth_credentials").delete().eq("owner_id", ownerId).eq("tiktok_account_id", accountId);
    await this.admin.from("tiktok_accounts").update({
      authorization_status: "revoked",
      connection_status: "DISCONNECTED",
      token_expires_at: null,
      refresh_token_expires_at: null,
      granted_scopes: [],
      missing_scopes: [],
      direct_post_status: "UNAVAILABLE",
      upload_status: "UNAVAILABLE",
      disconnected_at: now,
    }).eq("owner_id", ownerId).eq("id", accountId);
    await this.admin.from("integrations").update({
      status: "revoked",
      granted_scopes: [],
      token_secret_ref: null,
      expires_at: null,
    }).eq("owner_id", ownerId).eq("tiktok_account_id", accountId).eq("provider", "tiktok");
    await this.admin.from("account_publish_health").update({
      authorization_status: "revoked",
      account_status: "DISCONNECTED",
      health_status: "DISCONNECTED",
    }).eq("owner_id", ownerId).eq("tiktok_account_id", accountId);
  }
}

export class TikTokCreatorService {
  constructor(
    private readonly admin: AdminClient = createAdminClient(),
    private readonly provider: TikTokProvider = createTikTokProvider(),
    private readonly tokens: TikTokTokenService = new TikTokTokenService(),
  ) {}

  async queryCreatorInfo(ownerId: string, accountId: string, force = false) {
    const { data: account, error } = await this.admin.from("tiktok_accounts")
      .select("*").eq("owner_id", ownerId).eq("id", accountId).maybeSingle();
    if (error || !account) throw new TikTokServiceError("account_not_found");
    if (!(account.granted_scopes as string[]).includes("video.publish")) {
      throw new TikTokServiceError("scope_not_authorized");
    }
    if (!force && isCreatorInfoFresh(account.creator_info_cache_expires_at)) return account;
    if (force && account.creator_info_sync_at && Date.now() - Date.parse(account.creator_info_sync_at) < 3_000) {
      return account;
    }

    try {
      const accessToken = await this.tokens.getAccessToken(ownerId, accountId);
      const creator = await this.provider.queryCreatorInfo(accessToken);
      const now = new Date().toISOString();
      const cacheExpiresAt = new Date(Date.now() + serverEnv.tiktokCreatorCacheTtlSeconds * 1000).toISOString();
      const readiness = calculateTikTokReadiness({
        authorizationStatus: account.authorization_status,
        grantedScopes: account.granted_scopes,
        requestedScopes: officialTikTokRequestedScopes(serverEnv.tiktokOAuthScopeMode),
        publishApproval: account.video_publish_approval_status,
        uploadApproval: account.video_upload_approval_status,
        auditStatus: account.audit_status,
        creatorInfoFresh: true,
      });
      const { data, error: updateError } = await this.admin.from("tiktok_accounts").update({
        username: creator.username,
        display_name: creator.nickname,
        avatar_url: creator.avatarUrl ?? account.avatar_url,
        privacy_level_options: creator.privacyLevelOptions,
        comment_disabled: creator.commentDisabled,
        duet_disabled: creator.duetDisabled,
        stitch_disabled: creator.stitchDisabled,
        creator_max_video_duration: creator.maxVideoPostDurationSec,
        creator_info_sync_at: now,
        creator_info_cache_expires_at: cacheExpiresAt,
        last_sync_error: null,
        connection_status: readiness.connectionStatus,
        direct_post_status: readiness.directPostStatus,
        upload_status: readiness.uploadStatus,
      }).eq("owner_id", ownerId).eq("id", accountId).select("*").single();
      if (updateError) throw updateError;
      await this.admin.from("account_publish_health").update({ last_creator_info_sync_at: now })
        .eq("owner_id", ownerId).eq("tiktok_account_id", accountId);
      return data;
    } catch (syncError) {
      await this.admin.from("tiktok_accounts").update({ last_sync_error: safeErrorCode(syncError) })
        .eq("owner_id", ownerId).eq("id", accountId);
      throw new TikTokServiceError("creator_info_sync_failed");
    }
  }
}
