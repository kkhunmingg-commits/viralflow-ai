import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOwnerAccounts } from "@/features/accounts/queries";
import type { TikTokProvider } from "./provider";
import { TikTokTokenCipher } from "./token-crypto";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("Unexpected database client"); } }));
vi.mock("@/lib/server-env", () => ({
  serverEnv: {
    tiktokProvider: "official",
    tiktokRedirectUri: "https://example.test/auth/tiktok/callback",
    tiktokClientKey: "test-client",
    tiktokClientSecret: "test-client-secret",
    tiktokTokenEncryptionKey: "isolated-multi-account-test-encryption-key",
    tiktokVideoPublishApproved: false,
    tiktokVideoUploadApproved: false,
    tiktokDirectPostAuditStatus: "UNAUDITED",
    tiktokCreatorCacheTtlSeconds: 300,
  },
  tiktokOfficialSetupMissing: [],
}));

type Row = Record<string, unknown>;
type Result = { data: Row | Row[] | null; error: null };

class MemoryAdmin {
  readonly rows = new Map<string, Row[]>();
  private nextId = 0;

  from(table: string) { return new MemoryQuery(this, table); }
  async rpc() {
    return { data: [{ state_id: "state", requested_scopes: ["user.info.basic"], return_path: "/accounts", mock_scenario: null }], error: null };
  }
  records(table: string) { return this.rows.get(table) ?? []; }
  write(table: string, rows: Row[]) { this.rows.set(table, rows); }
  id() { return `record-${++this.nextId}`; }
}

class MemoryQuery implements PromiseLike<Result> {
  private operation: "select" | "upsert" | "update" | "delete" = "select";
  private values: Row = {};
  private filters: Array<[string, unknown]> = [];

  constructor(private readonly admin: MemoryAdmin, private readonly table: string) {}
  select(columns: string) { void columns; return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  order(column: string, options?: { ascending?: boolean }) { void column; void options; return this; }
  upsert(values: Row, options?: { onConflict?: string }) { void options; this.operation = "upsert"; this.values = values; return this; }
  update(values: Row) { this.operation = "update"; this.values = values; return this; }
  delete() { this.operation = "delete"; return this; }
  async single() { const result = this.execute(); return { ...result, data: (result.data as Row[])[0] ?? null }; }
  async maybeSingle() { return this.single(); }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> { return Promise.resolve(this.execute()).then(onfulfilled, onrejected); }

  private execute(): Result {
    const rows = this.admin.records(this.table);
    const matches = (row: Row) => this.filters.every(([key, value]) => row[key] === value);
    if (this.operation === "select") return { data: rows.filter(matches), error: null };
    if (this.operation === "delete") {
      const selected = rows.filter(matches);
      this.admin.write(this.table, rows.filter((row) => !matches(row)));
      return { data: selected, error: null };
    }
    if (this.operation === "update") {
      const selected = rows.filter(matches);
      for (const row of selected) Object.assign(row, this.values);
      return { data: selected, error: null };
    }
    const identity = this.table === "tiktok_accounts" ? ["owner_id", "provider", "open_id"]
      : this.table === "tiktok_oauth_credentials" ? ["tiktok_account_id"]
        : ["owner_id", "provider", "tiktok_account_id"];
    const existing = rows.find((row) => identity.every((key) => row[key] === this.values[key]));
    const saved = existing ?? { id: this.admin.id() };
    Object.assign(saved, this.values);
    if (!existing) this.admin.write(this.table, [...rows, saved]);
    return { data: [saved], error: null };
  }
}

describe("TikTok multi-account OAuth persistence", () => {
  it("keeps A and B separate, reconnects A in place, and disconnects only A", async () => {
    const { TikTokOAuthService, TikTokTokenService } = await import("./services");
    const admin = new MemoryAdmin();
    const client = admin as unknown as SupabaseClient;
    const revoked: string[] = [];
    let tokenVersion = 1;
    const provider = {
      async exchangeAuthorizationCode(code: string) {
        return {
          openId: code, accessToken: `access-${code}-${tokenVersion}`,
          refreshToken: `refresh-${code}-${tokenVersion}`, tokenType: "Bearer" as const,
          scopes: ["user.info.basic" as const],
          accessTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          refreshTokenExpiresAt: new Date(Date.now() + 31_536_000_000).toISOString(),
        };
      },
      async getBasicUserInfo(accessToken: string) {
        const openId = accessToken.split("-")[1];
        return { openId, unionId: null, displayName: `TikTok ${openId}`, avatarUrl: null };
      },
      async revokeAuthorization(accessToken: string) { revoked.push(accessToken); },
    } as TikTokProvider;
    const oauth = new TikTokOAuthService(client, provider);
    const ownerId = "owner-1";
    const a = await oauth.completeCallback({ ownerId, code: "A", state: "state-A" });
    const b = await oauth.completeCallback({ ownerId, code: "B", state: "state-B" });
    const otherOwnerA = await oauth.completeCallback({ ownerId: "owner-2", code: "A", state: "other-owner-A" });
    expect(a.accountId).not.toBe(b.accountId);
    expect(otherOwnerA.accountId).not.toBe(a.accountId);
    expect((await getOwnerAccounts(client, ownerId)).map((account) => account.open_id)).toEqual(["A", "B"]);

    tokenVersion = 2;
    const reconnectedA = await oauth.completeCallback({ ownerId, code: "A", state: "state-A-again" });
    expect(reconnectedA.accountId).toBe(a.accountId);
    expect((await getOwnerAccounts(client, ownerId)).map((account) => account.open_id)).toEqual(["A", "B"]);

    const tokens = new TikTokTokenService(client, provider, new TikTokTokenCipher("isolated-multi-account-test-encryption-key"));
    expect(await tokens.getAccessToken(ownerId, a.accountId)).toBe("access-A-2");
    expect(await tokens.getAccessToken(ownerId, b.accountId)).toBe("access-B-1");
    tokenVersion = 3;
    await expect(oauth.completeCallback({ ownerId, code: "A", state: "new-account-qr", requireNewAccount: true }))
      .rejects.toThrow("tiktok_account_already_added");
    expect(await tokens.getAccessToken(ownerId, a.accountId)).toBe("access-A-2");
    expect(await tokens.getAccessToken(ownerId, b.accountId)).toBe("access-B-1");
    await tokens.revokeAndDisconnect(ownerId, a.accountId);
    expect(revoked).toEqual(["access-A-2"]);
    expect(admin.records("tiktok_oauth_credentials").filter((row) => row.owner_id === ownerId)
      .map((row) => row.tiktok_account_id)).toEqual([b.accountId]);
    expect(admin.records("tiktok_accounts").find((row) => row.id === a.accountId)?.connection_status).toBe("DISCONNECTED");
    expect(admin.records("tiktok_accounts").find((row) => row.id === b.accountId)?.authorization_status).toBe("authorized");
    expect(await tokens.getAccessToken(ownerId, b.accountId)).toBe("access-B-1");
  });
});
