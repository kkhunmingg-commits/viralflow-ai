import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getUser, createAuthorizationState, completeCallback, enforceRateLimit } = vi.hoisted(() => ({
  getUser: vi.fn(),
  createAuthorizationState: vi.fn(),
  completeCallback: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}));
vi.mock("@/lib/server-env", () => ({
  serverEnv: {
    tiktokProvider: "official",
    tiktokOAuthScopeMode: "basic",
    tiktokClientKey: "client-key",
    tiktokClientSecret: "client-secret",
    tiktokRedirectUri: "https://viralflow.example/auth/tiktok/callback",
    tiktokTokenEncryptionKey: "isolated-test-key",
  },
  tiktokOfficialSetupMissing: [],
}));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit }));
vi.mock("@/lib/security/request", () => ({
  requestFingerprint: vi.fn(() => "fingerprint"),
  securityErrorResponse: vi.fn(() => null),
}));
vi.mock("@/features/tiktok/services", () => ({
  TikTokOAuthService: class {
    createAuthorizationState = createAuthorizationState;
    completeCallback = completeCallback;
  },
}));

import { POST as startQr } from "./session/route";
import { POST as checkQr } from "./status/route";

const origin = "https://viralflow.example";

function startRequest() {
  return new NextRequest(`${origin}/auth/tiktok/qr/session`, {
    method: "POST", headers: { origin },
  });
}

function statusRequest(payload: unknown, cookie = "") {
  return new NextRequest(`${origin}/auth/tiktok/qr/status`, {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function qrCookie(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  const [name, value] = header.split(";", 1)[0].split("=");
  return { name, value, header };
}

describe("TikTok QR sessions across tabs", () => {
  let providerTokens: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "ccdcb9b6-3675-4d80-a160-19892cb3fc34" } }, error: null });
    let issued = 0;
    createAuthorizationState.mockImplementation(async () => `oauth-state-${++issued}`);
    providerTokens = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/get_qrcode/")) {
        const state = new URLSearchParams(init.body as string).get("state");
        return Response.json({
          scan_qrcode_url: "aweme://authorize?client_ticket=tobefilled",
          token: state?.replace("oauth-state-", "private-token-"),
        });
      }
      if (url.endsWith("/check_qrcode/")) {
        providerTokens.push(new URLSearchParams(init.body as string).get("token") ?? "");
        return Response.json({ status: "new" });
      }
      throw new Error("unexpected_provider_request");
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps two tabs and a refreshed QR bound to their own encrypted cookies", async () => {
    const [firstTab, secondTab] = await Promise.all([startQr(startRequest()), startQr(startRequest())]);
    const refreshedFirstTab = await startQr(startRequest());
    const responses = [firstTab, secondTab, refreshedFirstTab];
    const bodies = await Promise.all(responses.map(async (response) => response.json() as Promise<{ sessionId: string; image: string }>));
    const cookies = responses.map(qrCookie);

    expect(bodies.map((body) => body.sessionId)).toEqual([
      expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
      expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
      expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
    ]);
    expect(new Set(bodies.map((body) => body.sessionId)).size).toBe(3);
    expect(new Set(cookies.map((cookie) => cookie.name)).size).toBe(3);
    for (const [index, cookie] of cookies.entries()) {
      expect(cookie.name).toBe(`viralflow_tiktok_qr_${bodies[index].sessionId}`);
      expect(cookie.header).toMatch(/HttpOnly/i);
      expect(cookie.header).toMatch(/Max-Age=120/i);
      expect(cookie.value).not.toContain(`private-token-${index + 1}`);
      expect(JSON.stringify(bodies[index])).not.toContain(`private-token-${index + 1}`);
      expect(JSON.stringify(bodies[index])).not.toContain(`oauth-state-${index + 1}`);
    }

    // A browser sends every tab's cookies; each tab must select only its own QR.
    const browserCookies = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    const statuses = await Promise.all(bodies.map((body) => checkQr(statusRequest({ sessionId: body.sessionId }, browserCookies))));
    expect(await Promise.all(statuses.map((response) => response.json()))).toEqual([
      { status: "new" }, { status: "new" }, { status: "new" },
    ]);
    expect(providerTokens).toEqual(["private-token-1", "private-token-2", "private-token-3"]);
    expect(completeCallback).not.toHaveBeenCalled();
  });

  it.each([{}, { sessionId: "short" }, { sessionId: "a".repeat(31) }, { sessionId: "a".repeat(32) + ";bad" }])(
    "rejects a missing or malformed QR session ID without calling TikTok: %j",
    async (payload) => {
      const response = await checkQr(statusRequest(payload));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "qr_session_invalid" });
      expect(providerTokens).toEqual([]);
    },
  );

  it("does not use another tab's cookie for a valid but missing session", async () => {
    const first = await startQr(startRequest());
    const second = await startQr(startRequest());
    const firstId = (await first.json() as { sessionId: string }).sessionId;
    const secondCookie = qrCookie(second);
    const response = await checkQr(statusRequest({ sessionId: firstId }, `${secondCookie.name}=${secondCookie.value}`));
    expect(await response.json()).toEqual({ status: "expired" });
    expect(providerTokens).toEqual([]);
  });

  it("refuses a QR session created by a different signed-in owner", async () => {
    const session = await startQr(startRequest());
    const sessionId = (await session.json() as { sessionId: string }).sessionId;
    const cookie = qrCookie(session);
    getUser.mockResolvedValue({ data: { user: { id: "1f15a9da-bcaf-44ae-8a14-cdb5a7c83d18" } }, error: null });

    const response = await checkQr(statusRequest({ sessionId }, `${cookie.name}=${cookie.value}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "qr_authorization_failed" });
    expect(providerTokens).toEqual([]);
  });
});
