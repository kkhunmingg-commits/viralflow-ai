import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { TikTokTokenCipher, type EncryptedToken } from "./token-crypto";

export const TIKTOK_QR_COOKIE = "viralflow_tiktok_qr";
// Keep displayed QR codes short-lived even if TikTok does not publish its token TTL.
export const TIKTOK_QR_MAX_AGE_SECONDS = 120;

const qrSessionSchema = z.object({
  ownerId: z.string().uuid(),
  token: z.string().min(1),
  ticket: z.string().min(1),
  state: z.string().min(1),
  expiresAt: z.number().int(),
});
export type TikTokQrSession = z.infer<typeof qrSessionSchema>;

const qrStartSchema = z.object({
  scan_qrcode_url: z.string().min(1),
  token: z.string().min(1),
});
const qrStatusSchema = z.object({
  client_ticket: z.string().optional(),
  status: z.enum(["new", "scanned", "confirmed", "expired", "utilised"]),
  redirect_uri: z.string().optional(),
  code: z.string().optional(),
  state: z.string().optional(),
});
export type TikTokQrStatus = z.infer<typeof qrStatusSchema>;

function sameSecret(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sealQrSession(session: TikTokQrSession, secret: string) {
  const encrypted = new TikTokTokenCipher(secret).encrypt(JSON.stringify(qrSessionSchema.parse(session)));
  return Buffer.from(JSON.stringify(encrypted)).toString("base64url");
}

export function openQrSession(value: string, secret: string): TikTokQrSession {
  const encrypted = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as EncryptedToken;
  const session = qrSessionSchema.parse(JSON.parse(new TikTokTokenCipher(secret).decrypt(encrypted)));
  if (session.expiresAt <= Date.now()) throw new Error("qr_session_expired");
  return session;
}

export function parseQrConfirmation(status: TikTokQrStatus, session: TikTokQrSession, expectedRedirectUri: string) {
  if (status.status !== "confirmed" || !status.client_ticket || !sameSecret(status.client_ticket, session.ticket)) {
    throw new Error("qr_confirmation_invalid");
  }
  const reportedUrl = status.redirect_uri ?? (status.code?.startsWith("https://") ? status.code : null);
  const redirect = reportedUrl ? new URL(reportedUrl) : null;
  if (redirect) {
    const expected = new URL(expectedRedirectUri);
    if (redirect.origin !== expected.origin || redirect.pathname !== expected.pathname) {
      throw new Error("qr_redirect_mismatch");
    }
  }
  const state = status.state ?? redirect?.searchParams.get("state");
  if (!state || !sameSecret(state, session.state)) throw new Error("qr_state_mismatch");
  const code = redirect ? redirect.searchParams.get("code") : status.code;
  if (!code) throw new Error("qr_code_missing");
  return code;
}

async function tikTokQrResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  const error = z.object({ error: z.string().optional() }).safeParse(body);
  if (!response.ok || (error.success && error.data.error)) {
    const code = error.success && error.data.error && /^[a-z_]+$/.test(error.data.error)
      ? error.data.error : "provider_error";
    throw new Error(`tiktok_qr_${code}`);
  }
  return body;
}

export class TikTokQrAuthorization {
  constructor(private readonly config: { clientKey: string; clientSecret: string; fetch?: typeof fetch }) {}

  async create(scopes: readonly string[], state: string) {
    const response = await (this.config.fetch ?? fetch)("https://open.tiktokapis.com/v2/oauth/get_qrcode/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: this.config.clientKey, scope: scopes.join(","), state }),
      cache: "no-store",
    });
    const result = qrStartSchema.parse(await tikTokQrResponse(response));
    const scanUrl = new URL(result.scan_qrcode_url);
    if (scanUrl.protocol !== "aweme:" || !scanUrl.searchParams.has("client_ticket")) {
      throw new Error("tiktok_qr_url_invalid");
    }
    const ticket = randomBytes(24).toString("base64url");
    scanUrl.searchParams.set("client_ticket", ticket);
    return {
      token: result.token,
      ticket,
      image: await QRCode.toDataURL(scanUrl.toString(), { errorCorrectionLevel: "M", margin: 2, width: 320 }),
    };
  }

  async check(token: string): Promise<TikTokQrStatus> {
    const response = await (this.config.fetch ?? fetch)("https://open.tiktokapis.com/v2/oauth/check_qrcode/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: this.config.clientKey,
        client_secret: this.config.clientSecret,
        token,
      }),
      cache: "no-store",
    });
    return qrStatusSchema.parse(await tikTokQrResponse(response));
  }
}
