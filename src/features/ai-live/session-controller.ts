import { randomUUID } from "node:crypto";
import { LiveEventLog } from "./event-log";
import { inspectWatchdog, recoveryDisposition, type WatchdogProbe } from "./watchdog";

export type LiveSessionState = "STARTING" | "RUNNING" | "PAUSED" | "RECOVERY_REQUIRED" | "BLOCKED" | "STOPPED";
export type PresenterKind = "mock" | "musetalk";
export type PresenterHealthCode = "READY" | "GPU_REQUIRED" | "MODEL_UNAVAILABLE" | "WORKER_UNAVAILABLE";

export interface PresenterRuntimePort {
  readonly kind: PresenterKind;
  health(): Promise<PresenterHealthCode>;
  start(sessionId: string, referenceId: string): Promise<void>;
  pause(sessionId: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
}

export interface LiveSessionSnapshot {
  id: string;
  ownerId: string;
  tiktokAccountId: string;
  productIds: string[];
  currentProductId: string;
  presenterReferenceId: string;
  presenterKind: PresenterKind;
  state: LiveSessionState;
  runtimeStatus: PresenterHealthCode;
  recoveryAttempts: number;
  startedAt: number;
  updatedAt: number;
  lastComment: string | null;
  currentResponse: string | null;
}

/** The caller supplies a durable implementation before real LIVE is enabled. */
export interface LiveSessionSnapshotStore {
  load(sessionId: string): Promise<LiveSessionSnapshot | null>;
  save(snapshot: LiveSessionSnapshot): Promise<void>;
}

export interface StartLiveSessionInput {
  ownerId: string;
  tiktokAccountId: string;
  productIds: string[];
  presenterReferenceId: string;
}

export class LiveSessionController {
  readonly events: LiveEventLog;
  private snapshot: LiveSessionSnapshot | null = null;

  constructor(
    private readonly runtime: PresenterRuntimePort,
    private readonly store: LiveSessionSnapshotStore,
    private readonly options: { allowMock?: boolean; now?: () => number; newId?: () => string; events?: LiveEventLog } = {},
  ) {
    this.events = options.events ?? new LiveEventLog();
  }

  private now(): number { return (this.options.now ?? Date.now)(); }

  private async persist(patch: Partial<LiveSessionSnapshot>): Promise<LiveSessionSnapshot> {
    if (!this.snapshot) throw new Error("session_not_started");
    const next = { ...this.snapshot, ...patch, updatedAt: this.now() };
    await this.store.save(next);
    this.snapshot = next;
    return next;
  }

  current(): LiveSessionSnapshot | null {
    return this.snapshot ? { ...this.snapshot, productIds: [...this.snapshot.productIds] } : null;
  }

  async start(input: StartLiveSessionInput): Promise<LiveSessionSnapshot> {
    if (this.snapshot && this.snapshot.state !== "STOPPED") {
      throw new Error("session_already_active");
    }
    if (!input.ownerId || !input.tiktokAccountId || !input.presenterReferenceId || !input.productIds.length
      || new Set(input.productIds).size !== input.productIds.length) throw new Error("invalid_session_selection");
    if (this.runtime.kind === "mock" && (!this.options.allowMock || process.env.NODE_ENV === "production")) {
      throw new Error("mock_presenter_forbidden");
    }
    const now = this.now();
    this.snapshot = {
      id: (this.options.newId ?? randomUUID)(), ownerId: input.ownerId,
      tiktokAccountId: input.tiktokAccountId, productIds: [...input.productIds],
      currentProductId: input.productIds[0], presenterReferenceId: input.presenterReferenceId,
      presenterKind: this.runtime.kind, state: "STARTING", runtimeStatus: "WORKER_UNAVAILABLE",
      recoveryAttempts: 0, startedAt: now, updatedAt: now, lastComment: null, currentResponse: null,
    };
    await this.store.save(this.snapshot);
    const health = await this.runtime.health().catch((): PresenterHealthCode => "WORKER_UNAVAILABLE");
    if (health !== "READY") {
      this.events.record("BLOCKED", this.now());
      return this.persist({ state: "BLOCKED", runtimeStatus: health });
    }
    try {
      await this.runtime.start(this.snapshot.id, input.presenterReferenceId);
      this.events.record("SESSION_STARTED", this.now());
      return await this.persist({ state: "RUNNING", runtimeStatus: "READY" });
    } catch {
      // The worker might have started before the response was lost. Never retry automatically.
      this.events.record("RECOVERY_REQUIRED", this.now());
      return this.persist({ state: "RECOVERY_REQUIRED", runtimeStatus: "WORKER_UNAVAILABLE" });
    }
  }

  async pause(): Promise<LiveSessionSnapshot> {
    if (!this.snapshot) throw new Error("session_not_started");
    if (this.snapshot.state === "PAUSED") return this.current()!;
    if (this.snapshot.state !== "RUNNING") throw new Error("session_not_running");
    try { await this.runtime.pause(this.snapshot.id); }
    catch {
      this.events.record("RECOVERY_REQUIRED", this.now());
      return this.persist({ state: "RECOVERY_REQUIRED" });
    }
    this.events.record("SESSION_PAUSED", this.now());
    return this.persist({ state: "PAUSED" });
  }

  async resume(): Promise<LiveSessionSnapshot> {
    if (!this.snapshot) throw new Error("session_not_started");
    if (this.snapshot.state === "RUNNING") return this.current()!;
    if (this.snapshot.state !== "PAUSED") throw new Error("session_not_paused");
    const health = await this.runtime.health().catch((): PresenterHealthCode => "WORKER_UNAVAILABLE");
    if (health !== "READY") return this.persist({ state: "BLOCKED", runtimeStatus: health });
    try { await this.runtime.resume(this.snapshot.id); }
    catch {
      this.events.record("RECOVERY_REQUIRED", this.now());
      return this.persist({ state: "RECOVERY_REQUIRED" });
    }
    this.events.record("SESSION_RESUMED", this.now());
    return this.persist({ state: "RUNNING", runtimeStatus: "READY" });
  }

  async stop(): Promise<LiveSessionSnapshot> {
    if (!this.snapshot) throw new Error("session_not_started");
    if (this.snapshot.state === "STOPPED") return this.current()!;
    try { await this.runtime.stop(this.snapshot.id); } // The runtime contract requires idempotent stop.
    catch {
      this.events.record("RECOVERY_REQUIRED", this.now());
      return this.persist({ state: "RECOVERY_REQUIRED" });
    }
    this.events.record("SESSION_STOPPED", this.now());
    return this.persist({ state: "STOPPED" });
  }

  async recover(sessionId: string): Promise<LiveSessionSnapshot | null> {
    const saved = await this.store.load(sessionId);
    if (!saved) return null;
    if (saved.presenterKind !== this.runtime.kind) throw new Error("presenter_provider_mismatch");
    this.snapshot = { ...saved, productIds: [...saved.productIds] };
    if (["STARTING", "RUNNING", "PAUSED"].includes(saved.state)) {
      this.events.record("RECOVERY_REQUIRED", this.now());
      return this.persist({ state: "RECOVERY_REQUIRED" });
    }
    return this.current();
  }

  async inspect(probe: WatchdogProbe): Promise<LiveSessionSnapshot | null> {
    if (!this.snapshot || this.snapshot.state !== "RUNNING") return this.current();
    if (!inspectWatchdog(probe).length) return this.current();
    const attempts = this.snapshot.recoveryAttempts + 1;
    this.events.record("RECOVERY_REQUIRED", this.now());
    // The controller never restarts a presenter or stream automatically.
    return this.persist({
      state: recoveryDisposition(attempts) === "STOP_REQUIRED" ? "BLOCKED" : "RECOVERY_REQUIRED",
      recoveryAttempts: attempts,
    });
  }

  async requireRecovery(): Promise<LiveSessionSnapshot> {
    if (!this.snapshot || this.snapshot.state === "STOPPED") throw new Error("session_not_active");
    if (this.snapshot.state === "RECOVERY_REQUIRED") return this.current()!;
    this.events.record("RECOVERY_REQUIRED", this.now());
    return this.persist({ state: "RECOVERY_REQUIRED" });
  }

  async updateContext(patch: { productId?: string; lastComment?: string; currentResponse?: string }): Promise<LiveSessionSnapshot> {
    if (!this.snapshot || this.snapshot.state !== "RUNNING") throw new Error("session_not_running");
    if (patch.productId && !this.snapshot.productIds.includes(patch.productId)) throw new Error("product_not_selected");
    if (patch.productId && patch.productId !== this.snapshot.currentProductId) this.events.record("PRODUCT_CHANGED", this.now());
    if (patch.lastComment) this.events.record("COMMENT_RECEIVED", this.now());
    if (patch.currentResponse) this.events.record("REPLY_READY", this.now());
    return this.persist({
      currentProductId: patch.productId ?? this.snapshot.currentProductId,
      lastComment: patch.lastComment?.slice(0, 500) ?? this.snapshot.lastComment,
      currentResponse: patch.currentResponse?.slice(0, 1000) ?? this.snapshot.currentResponse,
    });
  }
}
