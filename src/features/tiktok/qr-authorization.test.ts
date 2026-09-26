import { describe, expect, it, vi } from "vitest";
import { TikTokQrAuthorization, openQrSession, parseQrConfirmation, sealQrSession, withQrClientTicket } from "./qr-authorization";

vi.mock("server-only", () => ({}));

const session = {
  ownerId: "ccdcb9b6-3675-4d80-a160-19892cb3fc34",
  token: "private-status-token",
  ticket: "expected-ticket",
  state: "expected-state",
  expiresAt: Date.now() + 60_000,
};
const callback = "https://viralflow.example/auth/tiktok/callback";

describe("official TikTok QR authorization", () => {
  it("creates a real QR payload using only the requested scopes and replaces TikTok's placeholder ticket", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new URLSearchParams(init.body as string).get("scope")).toBe("user.info.basic,video.publish");
      return Response.json({
        scan_qrcode_url: "aweme://authorize?client_ticket=tobefilled&client_key=test-key",
        token: "status-token",
      });
    });
    const qr = await new TikTokQrAuthorization({
      clientKey: "test-key", clientSecret: "secret", fetch: fetchMock as typeof fetch,
    }).create(["user.info.basic", "video.publish"], "state");
    expect(qr.token).toBe("status-token");
    expect(qr.ticket).not.toBe("tobefilled");
    expect(qr.image).toMatch(/^data:image\/png;base64,/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves TikTok's original deep-link encoding outside client_ticket", async () => {
    const originalUrl = "aweme://authorize?state=a%20b&client_ticket=tobefilled&scope=user.info.basic%2Cvideo.publish";
    expect(withQrClientTicket(originalUrl, "new-ticket")).toBe(
      "aweme://authorize?state=a%20b&client_ticket=new-ticket&scope=user.info.basic%2Cvideo.publish",
    );
    const qr = await new TikTokQrAuthorization({
      clientKey: "test-key", clientSecret: "secret",
      fetch: vi.fn(async () => Response.json({ scan_qrcode_url: originalUrl, token: "status-token" })) as typeof fetch,
    }).create(["user.info.basic", "video.publish"], "state");
    expect(qr.image).toMatch(/^data:image\/png;base64,/);
    expect(qr.ticket).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("keeps the QR status token in an encrypted, owner-bound session", () => {
    const sealed = sealQrSession(session, "isolated-test-key");
    expect(sealed).not.toContain(session.token);
    expect(openQrSession(sealed, "isolated-test-key")).toEqual(session);
    expect(() => openQrSession(sealed, "wrong-key")).toThrow();
  });

  it("preserves TikTok's token_expire status so the UI can request a new QR", async () => {
    const authorization = new TikTokQrAuthorization({
      clientKey: "test-key", clientSecret: "secret",
      fetch: vi.fn(async () => Response.json({ error: "token_expire" }, { status: 400 })) as typeof fetch,
    });
    await expect(authorization.check("expired-token")).rejects.toThrow("tiktok_qr_token_expire");
  });

  it("accepts only the matching ticket, state, and callback before account persistence", () => {
    const status = {
      status: "confirmed" as const,
      client_ticket: session.ticket,
      redirect_uri: `${callback}?code=authorization-code&state=${session.state}`,
    };
    expect(parseQrConfirmation(status, session, callback)).toBe("authorization-code");
    expect(() => parseQrConfirmation({ ...status, client_ticket: "other" }, session, callback)).toThrow("qr_confirmation_invalid");
    expect(() => parseQrConfirmation({ ...status, state: "other" }, session, callback)).toThrow("qr_state_mismatch");
    expect(() => parseQrConfirmation(status, session, "https://another.example/auth/tiktok/callback")).toThrow("qr_redirect_mismatch");
  });
});
