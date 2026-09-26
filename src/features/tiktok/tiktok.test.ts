import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { getAccountAffiliateReadiness } from "../accounts/account-performance";
import type { TikTokAccount } from "../accounts/types";
import { MockTikTokProvider, OfficialTikTokProvider, creatorInfoSchema } from "./provider";
import { officialTikTokRequestedScopes } from "./oauth-scopes";
import { calculateTikTokReadiness, isCreatorInfoFresh, normalizeTikTokScopes } from "./readiness";
import { publicTikTokAccount } from "./serialization";
import { TikTokTokenCipher } from "./token-crypto";

const base = {
  authorizationStatus: "authorized" as const,
  requestedScopes: ["user.info.basic", "video.publish", "video.upload"] as const,
  publishApproval: "APPROVED" as const,
  uploadApproval: "APPROVED" as const,
  auditStatus: "AUDITED" as const,
  creatorInfoFresh: true,
};

describe("TikTok scope and readiness mapping", () => {
  it("requests only basic identity in sandbox mode and keeps publishing blocked", () => {
    const requestedScopes = officialTikTokRequestedScopes("basic");
    expect(requestedScopes).toEqual(["user.info.basic"]);
    const readiness = calculateTikTokReadiness({
      ...base,
      requestedScopes,
      grantedScopes: ["user.info.basic"],
    });
    expect(readiness.connectionStatus).toBe("CONNECTED");
    expect(readiness.directPostStatus).toBe("MISSING_SCOPE");
    expect(readiness.uploadStatus).toBe("MISSING_SCOPE");
  });

  it("requests only Direct Post scopes in publishing mode", () => {
    expect(officialTikTokRequestedScopes("publishing"))
      .toEqual(["user.info.basic", "video.publish"]);
  });

  it("normalizes only official prepared scopes", () => {
    expect(normalizeTikTokScopes(["video.upload", "fake.scope", "video.upload", "user.info.basic"]))
      .toEqual(["user.info.basic", "video.upload"]);
    expect(normalizeTikTokScopes(["video.list", "video.publish"])).toEqual(["video.list", "video.publish"]);
  });

  it.each([
    [["user.info.basic"], "PARTIAL"],
    [["user.info.basic", "video.upload"], "READY_FOR_UPLOAD"],
    [["user.info.basic", "video.publish", "video.upload"], "READY_FOR_DIRECT_POST"],
  ] as const)("maps %j to %s", (grantedScopes, status) => {
    expect(calculateTikTokReadiness({ ...base, grantedScopes }).connectionStatus).toBe(status);
  });

  it("keeps unaudited Direct Post private-only", () => {
    const result = calculateTikTokReadiness({
      ...base,
      grantedScopes: ["user.info.basic", "video.publish"],
      auditStatus: "UNAUDITED",
    });
    expect(result.connectionStatus).toBe("PRIVATE_ONLY");
    expect(result.directPostStatus).toBe("PRIVATE_ONLY");
  });

  it("requires reauthorization for expired or revoked authorization", () => {
    for (const authorizationStatus of ["expired", "revoked"] as const) {
      expect(calculateTikTokReadiness({ ...base, authorizationStatus, grantedScopes: base.requestedScopes }).connectionStatus)
        .toBe("REAUTH_REQUIRED");
    }
  });

  it("distinguishes a basic-only complete request from a partial grant", () => {
    expect(calculateTikTokReadiness({
      ...base,
      requestedScopes: ["user.info.basic"],
      grantedScopes: ["user.info.basic"],
    }).connectionStatus).toBe("CONNECTED");
  });

  it("uses creator cache only until its TTL", () => {
    expect(isCreatorInfoFresh(new Date(Date.now() + 10_000).toISOString())).toBe(true);
    expect(isCreatorInfoFresh(new Date(Date.now() - 1).toISOString())).toBe(false);
    expect(isCreatorInfoFresh(null)).toBe(false);
  });
});

describe("TikTok providers and token lifecycle", () => {
  it("builds the official authorization URL with CSRF state and minimum scopes", () => {
    const provider = new OfficialTikTokProvider({ clientKey: "client", clientSecret: "secret123", redirectUri: "https://app.example/callback" });
    const url = new URL(provider.buildAuthorizationUrl({
      clientKey: "client",
      redirectUri: "https://app.example/callback",
      scopes: ["user.info.basic", "video.publish"],
      state: "unguessable-state",
    }));
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("state")).toBe("unguessable-state");
    expect(url.searchParams.get("scope")).toBe("user.info.basic,video.publish");
    expect(url.searchParams.has("disable_auto_auth")).toBe(false);
    const newAccountUrl = new URL(provider.buildAuthorizationUrl({
      clientKey: "client",
      redirectUri: "https://app.example/callback",
      scopes: ["user.info.basic", "video.publish"],
      state: "another-state",
      disableAutoAuth: true,
    }));
    expect(newAccountUrl.searchParams.get("disable_auto_auth")).toBe("1");
  });

  it("exchanges and refreshes through the official v2 token endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
      open_id: "open-1", access_token: "access-secret", refresh_token: "refresh-secret",
      token_type: "Bearer", scope: "user.info.basic,video.upload", expires_in: 86400,
      refresh_expires_in: 31536000,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new OfficialTikTokProvider({ clientKey: "client", clientSecret: "secret123", redirectUri: "https://app.example/callback", fetch: fetchMock });
    const exchanged = await provider.exchangeAuthorizationCode("code");
    const refreshed = await provider.refreshAccessToken("refresh-secret");
    expect(exchanged.scopes).toEqual(["user.info.basic", "video.upload"]);
    expect(refreshed.refreshToken).toBe("refresh-secret");
    expect(fetchMock.mock.calls.every(([url]) => String(url) === "https://open.tiktokapis.com/v2/oauth/token/")).toBe(true);
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain("grant_type=refresh_token");
  });

  it("handles successful empty revoke responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const provider = new OfficialTikTokProvider({ clientKey: "client", clientSecret: "secret123", redirectUri: "https://app.example/callback", fetch: fetchMock });
    await expect(provider.revokeAuthorization("access-secret")).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("token=access-secret");
  });

  it("parses the current creator_info response contract", () => {
    const parsed = creatorInfoSchema.parse({
      data: { creator_avatar_url: "https://example.com/avatar.jpg", creator_username: "creator.1", creator_nickname: "Creator", privacy_level_options: ["SELF_ONLY"], comment_disabled: false, duet_disabled: true, stitch_disabled: true, max_video_post_duration_sec: 300 },
      error: { code: "ok", message: "", log_id: "log" },
    });
    expect(parsed.data.max_video_post_duration_sec).toBe(300);
    expect(parsed.data.privacy_level_options).toEqual(["SELF_ONLY"]);
  });

  it("models expired and revoked mock credentials without real calls", async () => {
    const expired = await new MockTikTokProvider("expired").exchangeAuthorizationCode();
    expect(Date.parse(expired.accessTokenExpiresAt)).toBeLessThan(Date.now());
    await expect(new MockTikTokProvider("revoked").refreshAccessToken())
      .rejects.toThrow("access_token_invalid");
  });

  it("encrypts both token classes with authenticated encryption", () => {
    const cipher = new TikTokTokenCipher("a secure test key with at least thirty-two characters");
    for (const raw of ["access-secret-value", "refresh-secret-value"]) {
      const encrypted = cipher.encrypt(raw);
      expect(JSON.stringify(encrypted)).not.toContain(raw);
      expect(cipher.decrypt(encrypted)).toBe(raw);
    }
  });

  it("never serializes token material into a client-facing account", () => {
    const result = publicTikTokAccount({
      id: "account", display_name: "Creator", access_token: "access-secret",
      refresh_token: "refresh-secret", token_secret_ref: "credential-id",
      connection_status: "CONNECTED",
    });
    expect(JSON.stringify(result)).not.toMatch(/access-secret|refresh-secret|credential-id/);
    expect(result.connection_status).toBe("CONNECTED");
  });
});

describe("Phase 7A database and Growth preservation", () => {
  const migration = readFileSync("supabase/migrations/20260917150532_phase_7a_tiktok_oauth_foundation.sql", "utf8");

  it("uses one-time owner-bound state consumption and global duplicate protection", () => {
    expect(migration).toContain("and owner_id = p_owner_id");
    expect(migration).toContain("and consumed_at is null");
    expect(migration).toContain("tiktok_accounts_open_id_unique_idx");
  });

  it("denies browser roles all token and state access", () => {
    expect(migration).toContain("revoke all on table public.tiktok_oauth_credentials from public, anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("force row level security");
  });

  it("keeps a connected account in Growth when commerce capability is missing", () => {
    const account = {
      follower_count: 20_000,
      mode: "AUTO",
      effective_mode: "GROWTH",
      ecommerce_permission: false,
      cart_enabled: false,
      shop_creator_eligible: false,
      authorization_status: "authorized",
      account_status: "active",
    } as TikTokAccount;
    expect(getAccountAffiliateReadiness(account).effectiveMode).toBe("GROWTH");
    expect(getAccountAffiliateReadiness(account).canAffiliate).toBe(false);
  });
});
