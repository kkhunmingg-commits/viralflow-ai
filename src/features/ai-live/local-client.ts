import "client-only";
import { LIVE_COMPONENT_VERSIONS, localMachineView, projectLocalMachine, type LocalMachineView } from "./local-contract";
export type { LocalMachineView } from "./local-contract";

const AGENT_ORIGIN = "http://127.0.0.1:8766";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Json = Record<string, unknown>;

/** Browser → loopback only. Auth and license leases never enter persistent browser storage. */
export class LocalLiveClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private deviceId: string | null = null;
  private sessionId: string | null = null;
  private current = localMachineView("NOT_INSTALLED");
  private localDeviceAuthorized = false;
  private requests = new Set<AbortController>();

  constructor(private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  snapshot(): LocalMachineView { return { ...this.current, reasons: [...this.current.reasons] }; }

  private async request(path: string, options: RequestInit = {}, signal?: AbortSignal, authenticated = true): Promise<Json> {
    if (!/^\/v1\/(discovery|pair|renew|status|hardware|challenge|references|device\/(proof|certificate|revoke)|sessions\/start|sessions\/[0-9a-f-]{36}\/stop)$/.test(path)) {
      throw new Error("ไม่สามารถทำรายการนี้ได้");
    }
    if (authenticated && (!this.token || this.tokenExpiresAt <= this.now() / 1000)) {
      this.token = null;
      throw new Error("กรุณาเชื่อมส่วนเสริมอีกครั้ง");
    }
    if (authenticated && path !== "/v1/renew" && this.tokenExpiresAt - this.now() / 1000 < 60) {
      this.acceptPairing(await this.request("/v1/renew", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      }, signal));
    }
    const controller = new AbortController();
    this.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await this.fetcher(`${AGENT_ORIGIN}${path}`, {
        ...options, headers: { ...(authenticated ? { Authorization: `Bearer ${this.token}` } : {}), ...options.headers },
        credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      });
      if (!response.ok) throw new Error("ไม่สามารถเชื่อมส่วนเสริมได้ กรุณาตรวจสอบแล้วลองอีกครั้ง");
      const text = await response.text();
      if (text.length > 16_384) throw new Error("ข้อมูลส่วนเสริมไม่ถูกต้อง");
      const result: unknown = JSON.parse(text);
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("ข้อมูลส่วนเสริมไม่ถูกต้อง");
      return result as Json;
    } finally {
      clearTimeout(timer);
      this.requests.delete(controller);
    }
  }

  private acceptPairing(data: Json): void {
    if (typeof data.token !== "string" || data.token.length < 32 || data.token.length > 256
      || typeof data.expiresAt !== "number" || data.expiresAt <= this.now() / 1000
      || data.expiresAt > this.now() / 1000 + 3600 || typeof data.deviceId !== "string" || !uuid.test(data.deviceId)
      || (this.deviceId !== null && this.deviceId !== data.deviceId)) {
      throw new Error("ข้อมูลส่วนเสริมไม่ถูกต้อง");
    }
    this.token = data.token;
    this.tokenExpiresAt = data.expiresAt;
    this.deviceId = data.deviceId;
  }

  private acceptStatus(result: Json, paired: boolean): void {
    this.current = projectLocalMachine(result, paired);
    this.localDeviceAuthorized = paired && result.deviceAuthorized === true;
    this.sessionId = paired && this.current.sessionActive && typeof result.sessionId === "string" && uuid.test(result.sessionId)
      ? result.sessionId : null;
  }

  private async cloudRequest(path: string, options: RequestInit = {}, signal?: AbortSignal): Promise<Json> {
    if (!/^\/api\/ai-live\/(local-grant|devices\/(challenge|register|[0-9a-f-]{36}))$/.test(path)) throw new Error("ไม่สามารถทำรายการนี้ได้");
    const controller = new AbortController();
    this.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await this.fetcher(path, { ...options, credentials: "same-origin", cache: "no-store", redirect: "error",
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
      if (!response.ok) throw new Error("ยังไม่สามารถอนุญาตเครื่องนี้ได้ กรุณาตรวจสอบสิทธิ์หรือลองอีกครั้ง");
      const raw = await response.text();
      if (raw.length > 16_384) throw new Error("ข้อมูลการเชื่อมต่อไม่ถูกต้อง");
      const result: unknown = JSON.parse(raw);
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("ข้อมูลการเชื่อมต่อไม่ถูกต้อง");
      return result as Json;
    } finally { clearTimeout(timer); this.requests.delete(controller); }
  }

  private async confirmDevice(signal?: AbortSignal): Promise<void> {
    if (!this.deviceId || this.current.state === "UPDATE_REQUIRED") return;
    try {
      const data = await this.cloudRequest(`/api/ai-live/devices/${this.deviceId}`, {}, signal);
      const device = data.device as { authorized?: unknown } | undefined;
      this.current.deviceRegistered = device?.authorized === true;
      this.current.deviceAuthorized = this.localDeviceAuthorized && this.current.deviceRegistered && data.entitled === true;
      this.current.deviceStatus = data.entitled !== true ? "MEMBERSHIP_REQUIRED" : this.current.deviceAuthorized ? "AUTHORIZED" : "UNREGISTERED";
    } catch {
      this.current.deviceAuthorized = false;
      this.current.deviceRegistered = false;
      this.current.deviceStatus = "UNAVAILABLE";
    }
  }

  async discover(signal?: AbortSignal): Promise<LocalMachineView> {
    try {
      const paired = !!this.token && this.tokenExpiresAt > this.now() / 1000;
      const result = await this.request(paired ? "/v1/status" : "/v1/discovery", {}, signal, paired);
      this.acceptStatus(result, paired);
      if (paired) await this.confirmDevice(signal);
    } catch {
      if (!signal?.aborted) this.current = localMachineView(this.token ? "OFFLINE" : "NOT_INSTALLED");
    }
    return this.snapshot();
  }

  async pair(code: string, signal?: AbortSignal): Promise<LocalMachineView> {
    if (!/^[A-Za-z0-9-]{6,64}$/.test(code)) throw new Error("กรุณากรอกรหัสจากส่วนเสริมให้ถูกต้อง");
    const data = await this.request("/v1/pair", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
    }, signal, false);
    this.acceptPairing(data);
    return this.discover(signal);
  }

  async checkHardware(signal?: AbortSignal): Promise<LocalMachineView> {
    if (!this.token) return this.discover(signal);
    try { this.acceptStatus(await this.request("/v1/hardware", {}, signal), true); await this.confirmDevice(signal); }
    catch { this.current = localMachineView("ERROR", !!this.token); }
    return this.snapshot();
  }

  async registerDevice(signal?: AbortSignal): Promise<LocalMachineView> {
    if (!this.token || !this.deviceId || this.current.state === "UPDATE_REQUIRED") throw new Error("กรุณาเชื่อมส่วนเสริมรุ่นปัจจุบันก่อน");
    const challenge = await this.cloudRequest("/api/ai-live/devices/challenge", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: this.deviceId, versions: LIVE_COMPONENT_VERSIONS }),
    }, signal);
    const proof = await this.request("/v1/device/proof", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challenge }),
    }, signal);
    const registration = await this.cloudRequest("/api/ai-live/devices/register", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(proof),
    }, signal);
    await this.request("/v1/device/certificate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ certificate: registration.certificate }),
    }, signal);
    return this.discover(signal);
  }

  async revokeDevice(signal?: AbortSignal): Promise<LocalMachineView> {
    if (!this.token || !this.deviceId) throw new Error("กรุณาเชื่อมส่วนเสริมก่อน");
    const data = await this.cloudRequest(`/api/ai-live/devices/${this.deviceId}`, { method: "DELETE" }, signal);
    // Revocation is effective on the server even if the local process goes offline.
    this.localDeviceAuthorized = false;
    this.current.deviceAuthorized = false;
    this.current.deviceRegistered = false;
    this.current.deviceStatus = "UNREGISTERED";
    await this.request("/v1/device/revoke", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receipt: data.receipt }),
    }, signal);
    return this.discover(signal);
  }

  async start(input: { accountId: string; productIds: string[]; presenter: File; microphoneId: string }, signal?: AbortSignal): Promise<LocalMachineView> {
    if (!this.current.canStart || !this.current.deviceAuthorized || !this.token || !this.deviceId) throw new Error("AI LIVE ยังไม่พร้อมสำหรับการเริ่มไลฟ์");
    if (!uuid.test(input.accountId) || !input.productIds.length || input.productIds.some((id) => !uuid.test(id))) throw new Error("กรุณาเลือกบัญชีและสินค้า");
    if (!["image/jpeg", "image/png"].includes(input.presenter.type) || input.presenter.size > 4 * 1024 * 1024) throw new Error("กรุณาเลือกภาพที่รองรับ ขนาดไม่เกิน 4 MB");
    const challenge = await this.request("/v1/challenge", {}, signal);
    if (typeof challenge.challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge.challenge)) throw new Error("กรุณาเชื่อมส่วนเสริมใหม่");
    const grant = await this.cloudRequest("/api/ai-live/local-grant", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
      body: JSON.stringify({ deviceId: this.deviceId, challenge: challenge.challenge, deviceProof: challenge.deviceProof,
        accountId: input.accountId, productIds: input.productIds }),
    }, signal);
    const reference = await this.request("/v1/references", {
      method: "POST", headers: { "Content-Type": input.presenter.type }, body: input.presenter,
    }, signal);
    if (typeof reference.presenterId !== "string" || !uuid.test(reference.presenterId)) throw new Error("เตรียมพรีเซนเตอร์ไม่สำเร็จ");
    const result = await this.request("/v1/sessions/start", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant, accountId: input.accountId, productIds: input.productIds, presenterId: reference.presenterId, microphoneId: input.microphoneId }),
    }, signal);
    if (typeof result.sessionId === "string" && uuid.test(result.sessionId)) this.sessionId = result.sessionId;
    this.current = projectLocalMachine(result, true);
    return this.snapshot();
  }

  async stop(signal?: AbortSignal): Promise<LocalMachineView> {
    if (!this.sessionId) return this.snapshot();
    const result = await this.request(`/v1/sessions/${this.sessionId}/stop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, signal);
    this.sessionId = null;
    this.current = projectLocalMachine(result, !!this.token);
    return this.snapshot();
  }

  dispose(): void {
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
    this.token = null; this.deviceId = null; this.sessionId = null; this.tokenExpiresAt = 0;
    this.localDeviceAuthorized = false;
    this.current = localMachineView("OFFLINE");
  }
}
