import "client-only";
import { AI_LIVE_REALTIME_VALIDATED, LIVE_COMPONENT_VERSIONS, localMachineView, projectLocalMachine, projectLocalComponents, type LocalMachineView } from "./local-contract";
export type { LocalMachineView } from "./local-contract";

const AGENT_ORIGIN = "http://127.0.0.1:8766";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Json = Record<string, unknown>;
interface StartLocalLive {
  accountId: string;
  productIds: string[];
  presenter: File;
  microphoneId: string | null;
}
export interface LocalPresenterCard {
  id: string; name: string; voiceLabel: string; assignedAccountIds: string[];
  status: "READY" | "SETUP_REQUIRED"; hasReference: boolean; consentConfirmed: boolean; updatedAt: number;
}
export interface SaveLocalPresenter {
  id?: string; name: string; voiceLabel: string; assignedAccountIds: string[];
  consentConfirmed: boolean; reference?: File;
}
function presenterCard(value: unknown): LocalPresenterCard {
  if (!value || typeof value !== "object") throw new Error("ข้อมูลคน LIVE ไม่ถูกต้อง");
  const card = value as Record<string, unknown>;
  if (typeof card.id !== "string" || !uuid.test(card.id) || typeof card.name !== "string" || card.name.length > 80
    || typeof card.voiceLabel !== "string" || card.voiceLabel.length > 80 || !Array.isArray(card.assignedAccountIds)
    || card.assignedAccountIds.length > 50 || card.assignedAccountIds.some((id) => typeof id !== "string" || !uuid.test(id))
    || !["READY", "SETUP_REQUIRED"].includes(String(card.status)) || typeof card.hasReference !== "boolean"
    || typeof card.consentConfirmed !== "boolean" || typeof card.updatedAt !== "number" || !Number.isSafeInteger(card.updatedAt)) {
    throw new Error("ข้อมูลคน LIVE ไม่ถูกต้อง");
  }
  return { id: card.id, name: card.name, voiceLabel: card.voiceLabel, assignedAccountIds: [...card.assignedAccountIds] as string[],
    status: card.status as LocalPresenterCard["status"], hasReference: card.hasReference,
    consentConfirmed: card.consentConfirmed, updatedAt: card.updatedAt };
}

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

  snapshot(): LocalMachineView { return { ...this.current, reasons: [...this.current.reasons],
    ...(this.current.aiReadiness ? { aiReadiness: { ...this.current.aiReadiness } } : {}),
    ...(this.current.rooms ? { rooms: this.current.rooms.map((room) => ({ ...room, customerStream: { ...room.customerStream } })) } : {}),
    ...(this.current.capacity ? { capacity: { ...this.current.capacity } } : {}),
    ...(this.current.components ? { components: { ...this.current.components } } : {}) }; }

  private async request(path: string, options: RequestInit = {}, signal?: AbortSignal, authenticated = true): Promise<Json> {
    if (!/^\/v1\/(discovery|pair|renew|status|rooms|hardware|challenge|references|presenters|presenters\/[0-9a-f-]{36}\/delete|ai\/(warmup|product-context)|stream\/setup|components\/(prepare|status)|updates\/(check|apply|repair)|device\/(proof|certificate|revoke)|sessions\/start|sessions\/[0-9a-f-]{36}\/(stop|pause|resume|comment|speech|ai-status))$/.test(path)) {
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
      let text: string;
      if (path === "/v1/presenters" || path === "/v1/rooms") {
        // Twenty presenter packs with fifty account assignments exceed the normal small status response.
        // Bound the new route while it is streamed; unrelated routes retain their existing response limit.
        const reader = response.body?.getReader();
        if (!reader) throw new Error("ข้อมูลคน LIVE ไม่ถูกต้อง");
        const decoder = new TextDecoder();
        const maximum = path === "/v1/presenters" ? 65_536 : 16_384;
        let bytes = 0;
        text = "";
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > maximum * 4) { await reader.cancel(); throw new Error("ข้อมูลคน LIVE มีขนาดไม่ถูกต้อง"); }
            text += decoder.decode(part.value, { stream: true });
            if (text.length > maximum) {
              await reader.cancel(); throw new Error("ข้อมูลคน LIVE มีขนาดไม่ถูกต้อง");
            }
          }
          text += decoder.decode();
          if (text.length > maximum || controller.signal.aborted || signal?.aborted) throw new Error("ข้อมูลคน LIVE ไม่ครบถ้วน");
        } finally { reader.releaseLock(); }
      } else {
        text = await response.text();
        if (text.length > 16_384) throw new Error("ข้อมูลส่วนเสริมไม่ถูกต้อง");
      }
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
    if (!/^\/api\/ai-live\/(entitlement|updates\/manifest|local-grant|product-context|devices\/(challenge|register|[0-9a-f-]{36}))$/.test(path)) throw new Error("ไม่สามารถทำรายการนี้ได้");
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
      this.current.membershipStatus = data.entitled === true ? "SUPPORTED" : "UNSUPPORTED";
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

  /** Membership stays authoritative even before a companion has been installed. */
  async refresh(signal?: AbortSignal): Promise<LocalMachineView> {
    await this.discover(signal);
    if (signal?.aborted) return this.snapshot();
    try {
      const data = await this.cloudRequest("/api/ai-live/entitlement", {}, signal);
      if (typeof data.supported !== "boolean") throw new Error("ข้อมูลสิทธิ์ไม่ถูกต้อง");
      this.current.membershipStatus = data.supported ? "SUPPORTED" : "UNSUPPORTED";
      if (!data.supported) {
        this.current.deviceAuthorized = false;
        this.current.deviceStatus = "MEMBERSHIP_REQUIRED";
      }
    } catch {
      this.current.membershipStatus = "UNAVAILABLE";
      this.current.deviceAuthorized = false;
    }
    return this.snapshot();
  }

  async checkUpdates(signal?: AbortSignal): Promise<LocalMachineView> {
    if (!this.token) throw new Error("กรุณาเชื่อมส่วนเสริมก่อนตรวจอัปเดต");
    // Only authenticated same-origin metadata crosses the bridge. The companion
    // independently verifies the signature and chooses its own trusted downloader.
    const manifest = await this.cloudRequest("/api/ai-live/updates/manifest", {}, signal);
    await this.request("/v1/updates/check", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manifest }),
    }, signal);
    return this.refresh(signal);
  }

  async installUpdate(repair = false, signal?: AbortSignal): Promise<LocalMachineView> {
    const allowed = repair ? this.current.updateCanRepair : this.current.updateCanApply;
    if (!this.token || !allowed || this.current.sessionActive) throw new Error("กรุณาหยุดการใช้งานและตรวจอัปเดตก่อน");
    await this.request(`/v1/updates/${repair ? "repair" : "apply"}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }),
    }, signal);
    return this.refresh(signal);
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

  async prepareAI(signal?: AbortSignal, input?: StartLocalLive): Promise<LocalMachineView> {
    if (!this.current.deviceAuthorized || !this.token || !this.deviceId) throw new Error("กรุณาอนุญาตเครื่องนี้ก่อน");
    let selection: Record<string, unknown> = {};
    if (input) {
      if (!uuid.test(input.accountId) || !input.productIds.length || input.productIds.length > 10
        || input.productIds.some((id) => !uuid.test(id)) || !["image/jpeg", "image/png"].includes(input.presenter.type)
        || !input.presenter.size || input.presenter.size > 4 * 1024 * 1024) throw new Error("กรุณาเลือกบัญชี สินค้า และคน LIVE");
      const context = await this.cloudRequest("/api/ai-live/product-context", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: this.deviceId, accountId: input.accountId, productIds: input.productIds }),
      }, signal);
      await this.request("/v1/ai/product-context", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context }) }, signal);
      const reference = await this.request("/v1/references", {
        method: "POST", headers: { "Content-Type": input.presenter.type }, body: input.presenter,
      }, signal);
      if (typeof reference.presenterId !== "string" || !uuid.test(reference.presenterId)) throw new Error("เตรียมคน LIVE ไม่สำเร็จ");
      selection = { accountId: input.accountId, productIds: input.productIds,
        presenterId: reference.presenterId, microphoneId: input.microphoneId };
    }
    await this.request("/v1/ai/warmup", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selection) }, signal);
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

  /** Opens the native agent dialog. Streaming credentials never enter the browser. */
  async configureStream(input: { accountId: string; productIds: string[] }, signal?: AbortSignal): Promise<{ configured: boolean }> {
    if (!this.current.paired || !this.current.deviceAuthorized || this.current.membershipStatus !== "SUPPORTED"
      || this.current.sessionActive || !this.token || !this.deviceId) throw new Error("กรุณาเชื่อมต่อและอนุญาตเครื่องก่อนตั้งค่าการ LIVE");
    if (!uuid.test(input.accountId) || !input.productIds.length || input.productIds.some((id) => !uuid.test(id))) {
      throw new Error("กรุณาเลือกบัญชีและสินค้า");
    }
    const challenge = await this.request("/v1/challenge", {}, signal);
    if (typeof challenge.challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge.challenge)) throw new Error("กรุณาเชื่อมส่วนเสริมใหม่");
    const grant = await this.cloudRequest("/api/ai-live/local-grant", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: this.deviceId, challenge: challenge.challenge, deviceProof: challenge.deviceProof,
        accountId: input.accountId, productIds: input.productIds }),
    }, signal);
    const result = await this.request("/v1/stream/setup", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grant }),
    }, signal);
    if (typeof result.configured !== "boolean") throw new Error("ยังเปิดหน้าตั้งค่าการ LIVE ไม่สำเร็จ");
    return { configured: result.configured };
  }

  /** Observed managed installation status is independent of production LIVE readiness. */
  async checkComponents(signal?: AbortSignal): Promise<LocalMachineView> {
    if (!this.current.paired || !this.current.deviceAuthorized || this.current.membershipStatus !== "SUPPORTED"
      || this.current.state === "UPDATE_REQUIRED") return this.snapshot();
    try {
      this.current.components = projectLocalComponents(await this.request("/v1/components/status", {}, signal));
    } catch {
      if (!signal?.aborted) this.current.components = projectLocalComponents(null);
    }
    return this.snapshot();
  }

  async prepareComponents(input: { accountId: string; productIds: string[] }, repair = false, signal?: AbortSignal): Promise<LocalMachineView> {
    if (!this.current.paired || !this.current.deviceAuthorized || this.current.membershipStatus !== "SUPPORTED"
      || this.current.sessionActive || !this.current.components?.canPrepare || !this.token || !this.deviceId
      || this.current.state === "UPDATE_REQUIRED" || typeof repair !== "boolean") throw new Error("กรุณาเชื่อมต่อและอนุญาตเครื่องก่อนเตรียมเครื่อง");
    if (!uuid.test(input.accountId) || !input.productIds.length || input.productIds.some((id) => !uuid.test(id))) {
      throw new Error("กรุณาเลือกบัญชีและสินค้า");
    }
    const challenge = await this.request("/v1/challenge", {}, signal);
    if (typeof challenge.challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge.challenge)) throw new Error("กรุณาเชื่อมส่วนเสริมใหม่");
    const grant = await this.cloudRequest("/api/ai-live/local-grant", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: this.deviceId, challenge: challenge.challenge, deviceProof: challenge.deviceProof,
        accountId: input.accountId, productIds: input.productIds }),
    }, signal);
    await this.request("/v1/components/prepare", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grant, repair }),
    }, signal);
    return this.checkComponents(signal);
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
    const context = await this.cloudRequest("/api/ai-live/product-context", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: this.deviceId, accountId: input.accountId, productIds: input.productIds }),
    }, signal);
    await this.request("/v1/ai/product-context", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context }) }, signal);
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

  async refreshRooms(signal?: AbortSignal): Promise<LocalMachineView> {
    this.acceptStatus(await this.request("/v1/rooms", {}, signal), true);
    await this.confirmDevice(signal);
    return this.snapshot();
  }
  private accountSession(accountId: string): string {
    const room = this.current.rooms?.find((item) => item.accountId === accountId && item.state !== "STOPPED");
    if (!uuid.test(accountId) || !room) throw new Error("ไม่มี LIVE ที่กำลังทำงานในบัญชีนี้");
    return room.sessionId;
  }
  async stopAccount(accountId: string, signal?: AbortSignal): Promise<LocalMachineView> {
    const sessionId = this.accountSession(accountId);
    this.acceptStatus(await this.request(`/v1/sessions/${sessionId}/stop`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }, signal), true);
    await this.confirmDevice(signal);
    return this.snapshot();
  }
  async pauseAccount(accountId: string, signal?: AbortSignal): Promise<LocalMachineView> {
    return this.changeAccountSession(accountId, "pause", signal);
  }
  async resumeAccount(accountId: string, signal?: AbortSignal): Promise<LocalMachineView> {
    return this.changeAccountSession(accountId, "resume", signal);
  }
  async roomAIStatus(accountId: string, signal?: AbortSignal): Promise<{ available: boolean; lastComment: string | null; currentResponse: string | null; activity: string[] }> {
    const value = await this.request(`/v1/sessions/${this.accountSession(accountId)}/ai-status`, {}, signal);
    const text = (value: unknown) => typeof value === "string" && value.length <= 1000 ? value : null;
    const events = new Set(["กำลังตอบผู้ชม", "กำลังพูด", "หยุดตอบผู้ชมชั่วคราว", "ตอบผู้ชมต่อ"]);
    return { available: value.available === true, lastComment: text(value.lastComment), currentResponse: text(value.currentResponse),
      activity: Array.isArray(value.activity) ? value.activity.filter((event): event is string => typeof event === "string" && events.has(event)).slice(-10) : [] };
  }
  async submitComment(accountId: string, comment: { commentId: string; viewerId: string; text: string; createdAtMs: number }, signal?: AbortSignal): Promise<boolean> {
    const result = await this.request(`/v1/sessions/${this.accountSession(accountId)}/comment`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(comment),
    }, signal);
    return result.accepted === true;
  }
  async speakAccount(accountId: string, input: { id: string; text: string; productId: string | null }, signal?: AbortSignal): Promise<boolean> {
    const result = await this.request(`/v1/sessions/${this.accountSession(accountId)}/speech`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    }, signal);
    return result.accepted === true;
  }

  private async changeAccountSession(accountId: string, action: "pause" | "resume", signal?: AbortSignal): Promise<LocalMachineView> {
    const sessionId = this.accountSession(accountId);
    this.acceptStatus(await this.request(`/v1/sessions/${sessionId}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }, signal), true);
    await this.confirmDevice(signal);
    return this.snapshot();
  }

  async pause(signal?: AbortSignal): Promise<LocalMachineView> { return this.changeSession("pause", signal); }
  async resume(signal?: AbortSignal): Promise<LocalMachineView> { return this.changeSession("resume", signal); }
  private async changeSession(action: "pause" | "resume", signal?: AbortSignal): Promise<LocalMachineView> {
    if (!this.sessionId) throw new Error("ไม่มี LIVE ที่กำลังทำงาน");
    const result = await this.request(`/v1/sessions/${this.sessionId}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    }, signal);
    this.current = projectLocalMachine(result, !!this.token);
    return this.snapshot();
  }

  async listPresenters(signal?: AbortSignal): Promise<LocalPresenterCard[]> {
    const result = await this.request("/v1/presenters", {}, signal);
    if (!Array.isArray(result.presenters) || result.presenters.length > 20) throw new Error("ข้อมูลคน LIVE ไม่ถูกต้อง");
    return result.presenters.map(presenterCard);
  }

  async savePresenter(input: SaveLocalPresenter, signal?: AbortSignal): Promise<LocalPresenterCard> {
    let image: string | null = null;
    if (input.reference) {
      if (!["image/jpeg", "image/png"].includes(input.reference.type) || !input.reference.size || input.reference.size > 4 * 1024 * 1024) {
        throw new Error("กรุณาใช้ภาพ JPEG หรือ PNG ขนาดไม่เกิน 4 MB");
      }
      const bytes = new Uint8Array(await input.reference.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      image = btoa(binary);
    }
    const result = await this.request("/v1/presenters", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: input.id ?? null, name: input.name, voiceLabel: input.voiceLabel,
        assignedAccountIds: input.assignedAccountIds, consentConfirmed: input.consentConfirmed, image, mediaType: input.reference?.type ?? null }),
    }, signal);
    return presenterCard(result.presenter);
  }

  async deletePresenter(id: string, signal?: AbortSignal): Promise<void> {
    if (!uuid.test(id)) throw new Error("ไม่พบคน LIVE");
    await this.request(`/v1/presenters/${id}/delete`, { method: "POST" }, signal);
  }

  async presenterReference(id: string, signal?: AbortSignal): Promise<File> {
    if (!uuid.test(id) || !this.token || this.tokenExpiresAt <= this.now() / 1000) throw new Error("กรุณาเชื่อมส่วนเสริมอีกครั้ง");
    // Renew the pairing through the same origin-bound path before reading binary media.
    await this.request("/v1/status", {}, signal);
    const controller = new AbortController();
    this.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.fetcher(`${AGENT_ORIGIN}/v1/presenters/${id}/reference`, {
        headers: { Authorization: `Bearer ${this.token}` }, cache: "no-store", credentials: "omit", redirect: "error",
        referrerPolicy: "no-referrer", signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      });
      const type = response.headers.get("content-type");
      const size = Number(response.headers.get("content-length"));
      if (!response.ok || !["image/jpeg", "image/png"].includes(type ?? "") || !Number.isSafeInteger(size) || size < 1 || size > 4 * 1024 * 1024) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("ไม่สามารถเปิดรูปคน LIVE ได้");
      }
      if (!response.body) throw new Error("รูปคน LIVE ไม่ครบถ้วน");
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let received = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          received += part.value.byteLength;
          if (received > size) { await reader.cancel(); throw new Error("รูปคน LIVE มีขนาดไม่ถูกต้อง"); }
          chunks.push(new Uint8Array(part.value));
        }
      } finally { reader.releaseLock(); }
      if (received !== size || controller.signal.aborted || signal?.aborted || !this.token) throw new Error("รูปคน LIVE ไม่ครบถ้วน");
      return new File(chunks, type === "image/png" ? "presenter.png" : "presenter.jpg", { type: type! });
    } finally { clearTimeout(timer); this.requests.delete(controller); }
  }

  /** The owned session path is internal. No credentials are placed in an image URL. */
  async previewAccountFrame(accountId: string, signal?: AbortSignal): Promise<Blob | null> {
    const room = this.current.rooms?.find((item) => item.accountId === accountId && item.state !== "STOPPED");
    return room ? this.previewFrame(signal, room.sessionId) : null;
  }
  async previewFrame(signal?: AbortSignal, targetSessionId?: string): Promise<Blob | null> {
    const selectedSessionId = targetSessionId ?? this.sessionId;
    if (!AI_LIVE_REALTIME_VALIDATED || !this.token || this.tokenExpiresAt <= this.now() / 1000
      || !this.current.paired || !this.current.sessionActive || !this.current.deviceAuthorized
      || !selectedSessionId || !uuid.test(selectedSessionId) || signal?.aborted) return null;
    const sessionId = selectedSessionId;
    const controller = new AbortController();
    this.requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await this.fetcher(`${AGENT_ORIGIN}/v1/sessions/${sessionId}/frame`, {
        method: "GET", headers: { Authorization: `Bearer ${this.token}`, Accept: "image/jpeg" },
        credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      });
      if (response.status === 204) return null;
      if (!response.ok || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "image/jpeg") {
        await response.body?.cancel();
        throw new Error("ยังไม่สามารถแสดงภาพจากระบบได้");
      }
      const maximumBytes = 4 * 1024 * 1024;
      const declaredSize = response.headers.get("content-length");
      if (declaredSize !== null && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > maximumBytes)) {
        await response.body?.cancel();
        throw new Error("ภาพจากระบบมีขนาดไม่ถูกต้อง");
      }
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maximumBytes) { await reader.cancel(); throw new Error("ภาพจากระบบมีขนาดไม่ถูกต้อง"); }
          chunks.push(new Uint8Array(value));
        }
      } finally { reader.releaseLock(); }
      // A response that finishes after Stop, revocation, disposal, or session replacement is stale.
      const stillActive = targetSessionId ? this.current.rooms?.some((room) => room.sessionId === sessionId && room.state !== "STOPPED") : this.sessionId === sessionId;
      if (controller.signal.aborted || signal?.aborted || !stillActive || !this.token
        || this.tokenExpiresAt <= this.now() / 1000 || !this.current.sessionActive || !this.current.deviceAuthorized || !size) return null;
      return new Blob(chunks, { type: "image/jpeg" });
    } finally { clearTimeout(timer); this.requests.delete(controller); }
  }

  dispose(): void {
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
    this.token = null; this.deviceId = null; this.sessionId = null; this.tokenExpiresAt = 0;
    this.localDeviceAuthorized = false;
    this.current = localMachineView("OFFLINE");
  }
}
