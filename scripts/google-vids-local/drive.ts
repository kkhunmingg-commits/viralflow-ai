import { createHash, randomBytes } from "node:crypto";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const VIDS_MIME = "application/vnd.google-apps.vid";
export const LOCAL_ORIGIN = "http://localhost:3020";
export const REDIRECT_URI = `${LOCAL_ORIGIN}/oauth/callback`;
export const MAX_MP4_BYTES = 50 * 1024 * 1024;
type Json = Record<string, unknown>;
export type LocalConfig = { clientId: string; clientSecret: string; pickerKey: string; projectNumber: string };
export class TestBlocked extends Error {
  constructor(readonly reason: string) { super(reason); }
}
export function configuration(env: Record<string, string | undefined>): LocalConfig | null {
  const values = [env.GOOGLE_VIDS_LOCAL_CLIENT_ID, env.GOOGLE_VIDS_LOCAL_CLIENT_SECRET,
    env.GOOGLE_VIDS_LOCAL_PICKER_KEY, env.GOOGLE_VIDS_LOCAL_PROJECT_NUMBER];
  if (values.some(value => !value?.trim())) return null;
  const [clientId, clientSecret, pickerKey, projectNumber] = values as string[];
  if (!clientId.endsWith(".apps.googleusercontent.com") || !/^\d+$/.test(projectNumber)) throw new TestBlocked("LOCAL_CONFIGURATION_INVALID");
  return { clientId, clientSecret, pickerKey, projectNumber };
}
export class Consent {
  private pending: { state: string; expires: number } | null = null;
  constructor(private config: LocalConfig, private now = Date.now) {}
  begin() {
    const state = randomBytes(32).toString("base64url");
    this.pending = { state, expires: this.now() + 5 * 60_000 };
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: REDIRECT_URI,
      response_type: "code", scope: DRIVE_FILE_SCOPE, state, access_type: "online",
      include_granted_scopes: "false", prompt: "select_account consent" }).toString();
    return { url: url.toString(), state };
  }
  consume(state: string | null, cookieState: string | undefined) {
    const pending = this.pending; this.pending = null;
    if (!pending || !state || state !== pending.state || cookieState !== state || this.now() >= pending.expires) throw new TestBlocked("CONSENT_STATE_INVALID");
  }
  clear() { this.pending = null; }
}
async function bounded(response: Response, limit: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) { await response.body?.cancel(); throw new TestBlocked("RESPONSE_TOO_LARGE"); }
  if (!response.body) throw new TestBlocked("RESPONSE_INVALID");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel(); throw new TestBlocked("RESPONSE_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Uint8Array(Buffer.concat(chunks, total));
}
async function json(response: Response): Promise<Json> {
  if (!response.ok) { await response.body?.cancel(); throw new TestBlocked(`GOOGLE_HTTP_${response.status}`); }
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) throw new TestBlocked("RESPONSE_INVALID");
  try {
    const result: unknown = JSON.parse(Buffer.from(await bounded(response, 128_000)).toString());
    if (result && typeof result === "object" && !Array.isArray(result)) return result as Json;
  } catch (error) { if (error instanceof TestBlocked) throw error; }
  throw new TestBlocked("RESPONSE_INVALID");
}
export async function exchangeCode(config: LocalConfig, code: string, request: typeof fetch = fetch) {
  if (!code || code.length > 4096) throw new TestBlocked("CONSENT_CODE_INVALID");
  const result = await json(await request("https://oauth2.googleapis.com/token", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
  }));
  // Never accept a broader grant or persist a refresh token.
  const scopes = typeof result.scope === "string" ? result.scope.trim().split(/\s+/) : [];
  if (scopes.length !== 1 || scopes[0] !== DRIVE_FILE_SCOPE || typeof result.access_token !== "string" ||
      result.token_type !== "Bearer" || typeof result.expires_in !== "number" || result.expires_in <= 0) throw new TestBlocked("CONSENT_SCOPE_INVALID");
  return { token: result.access_token, expires: Date.now() + Math.min(result.expires_in, 3600) * 1000 };
}
export function safeDownloadUrl(value: unknown): URL {
  if (typeof value !== "string") throw new TestBlocked("DOWNLOAD_URL_INVALID");
  let url: URL; try { url = new URL(value); } catch { throw new TestBlocked("DOWNLOAD_URL_INVALID"); }
  const exact = ["www.googleapis.com", "docs.google.com", "drive.google.com", "drive.usercontent.google.com"];
  const contentHost = /^doc-[a-z0-9-]+-docs\.googleusercontent\.com$/.test(url.hostname);
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash ||
      (!exact.includes(url.hostname) && !contentHost)) throw new TestBlocked("DOWNLOAD_HOST_NOT_APPROVED");
  return url;
}
export function operationUrl(name: unknown) {
  if (typeof name !== "string") throw new TestBlocked("OPERATION_INVALID");
  if (!/^(?:operations\/)?[A-Za-z0-9_-]{1,1024}$/.test(name)) throw new TestBlocked("OPERATION_INVALID");
  // Mirror the official operations/{name} path parameter; never rewrite the returned name.
  return `https://www.googleapis.com/drive/v3/operations/${encodeURIComponent(name)}`;
}
export class DriveOneFileTest {
  private selected: { id: string; resourceKey?: string; fingerprint: string } | null = null;
  private operation: Json | null = null;
  private started = false;
  private inFlight: Promise<Uint8Array> | null = null;
  private stopped = false;
  private metadataVerified = false;
  readonly calls = { metadata: 0, download: 0, polls: 0, content: 0 };
  constructor(private token: string, private expires: number, private request: typeof fetch = fetch,
    private sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {}
  private headers(content = false, host?: string): Record<string, string> {
    if (this.stopped || Date.now() >= this.expires) throw new TestBlocked("CONSENT_EXPIRED");
    return { ...(!content || host === "www.googleapis.com" ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(this.selected?.resourceKey ? { "X-Goog-Drive-Resource-Keys": `${this.selected.id}/${this.selected.resourceKey}` } : {}) };
  }
  pickerToken() { this.headers(); return this.token; }
  clear() { this.stopped = true; this.token = ""; this.selected = null; this.operation = null; this.metadataVerified = false; }
  async select(id: unknown, resourceKey?: unknown) {
    if (this.selected || this.started) throw new TestBlocked("ONE_FILE_ONLY");
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id) ||
      (resourceKey !== undefined && (typeof resourceKey !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(resourceKey)))) throw new TestBlocked("FILE_SELECTION_INVALID");
    this.selected = { id, resourceKey: resourceKey as string | undefined, fingerprint: createHash("sha256").update(id).digest("hex") };
    this.calls.metadata++;
    const data = await json(await this.request(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,mimeType,capabilities(canDownload),trashed,resourceKey`,
      { headers: this.headers(), redirect: "error", signal: AbortSignal.timeout(30_000) }));
    if (data.id !== id || data.mimeType !== VIDS_MIME || data.trashed === true) throw new TestBlocked("SELECT_EXISTING_VIDS_PROJECT");
    const capabilities = data.capabilities as Json | undefined;
    if (capabilities?.canDownload !== true) throw new TestBlocked("DOWNLOAD_PERMISSION_MISSING");
    if (typeof data.resourceKey === "string") {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(data.resourceKey)) throw new TestBlocked("RESOURCE_KEY_INVALID");
      this.selected.resourceKey = data.resourceKey;
    }
    this.metadataVerified = true;
    return { mimeType: VIDS_MIME, canDownload: true, selectedFileSha256: this.selected.fingerprint };
  }
  download(): Promise<Uint8Array> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run();
    return this.inFlight;
  }
  private async run() {
    if (!this.selected || !this.metadataVerified) throw new TestBlocked("SELECT_FILE_FIRST");
    // One POST per process/session. An unknown result is never automatically resubmitted.
    if (!this.started) {
      this.started = true; this.calls.download++;
      this.operation = await json(await this.request(`https://www.googleapis.com/drive/v3/files/${this.selected.id}/download?mimeType=video/mp4`,
        { method: "POST", headers: this.headers(), redirect: "error", signal: AbortSignal.timeout(30_000) }));
    }
    let operation = this.operation!;
    const pollUrl = operation.done === true ? null : operationUrl(operation.name);
    for (let attempt = 0; operation.done !== true && attempt < 12; attempt++) {
      await this.sleep(Math.min(10_000 * 2 ** attempt, 30_000));
      this.calls.polls++;
      operation = await json(await this.request(pollUrl!, { headers: this.headers(), redirect: "error", signal: AbortSignal.timeout(30_000) }));
      this.operation = operation;
    }
    if (operation.done !== true) throw new TestBlocked("DOWNLOAD_TIMEOUT_NO_RESUBMIT");
    if (operation.error || !operation.response) throw new TestBlocked("DOWNLOAD_OPERATION_FAILED");
    let url = safeDownloadUrl((operation.response as Json).downloadUri);
    for (let redirect = 0; redirect <= 3; redirect++) {
      this.calls.content++;
      const response = await this.request(url.toString(), { headers: this.headers(true, url.hostname), redirect: "manual", signal: AbortSignal.timeout(90_000) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location"); await response.body?.cancel();
        if (!location) throw new TestBlocked("DOWNLOAD_REDIRECT_INVALID");
        url = safeDownloadUrl(new URL(location, url).toString()); continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new TestBlocked(`CONTENT_HTTP_${response.status}`); }
      const type = response.headers.get("content-type")?.split(";")[0];
      if (!["video/mp4", "application/octet-stream"].includes(type ?? "")) throw new TestBlocked("MP4_CONTENT_REQUIRED");
      const bytes = await bounded(response, MAX_MP4_BYTES);
      if (bytes.length < 1000 || Buffer.from(bytes).toString("ascii", 4, 8) !== "ftyp") throw new TestBlocked("MP4_CONTENT_REQUIRED");
      return bytes;
    }
    throw new TestBlocked("DOWNLOAD_REDIRECT_LIMIT");
  }
}
