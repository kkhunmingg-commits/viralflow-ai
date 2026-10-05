import { ActionQueue, CommentEngine, ProductBrain, type IncomingLiveComment, type LiveBrainProvider, type LiveProduct, type SellerRules } from "./domain";
import { LivePipeline, type PresenterAudioPort, type VoiceProvider } from "./live-pipeline";
import { LiveSessionController, type LiveSessionSnapshotStore, type PresenterRuntimePort } from "./session-controller";
import { customerPresenterPack, validatePresenterPack, type PresenterPack } from "./presenter-pack";
import { SafetyVoiceBuffer } from "./safety-voice-buffer";
import type { SpeechGesturePort } from "./speech-scheduler";
import type { LivePolicyGuard } from "./live-policy";
import type { WatchdogProbe } from "./watchdog";

export type MeasuredLiveCapacity =
  | { status: "UNVERIFIED_CAPACITY" }
  | { status: "VERIFIED_CAPACITY"; maxRooms: number; renderer: string; measuredAtMs: number; benchmarkEvidenceId: string };
export interface ConcurrentLivePolicy {
  platformMaxRooms: number;
  regionMaxRooms: Readonly<Record<string, number>>;
  accountMaxRooms: number;
  deviceCapacity: MeasuredLiveCapacity;
}
export function verifiedRoomLimit(policy: ConcurrentLivePolicy, region: string): number {
  const capacity = policy.deviceCapacity;
  if (capacity.status !== "VERIFIED_CAPACITY" || !capacity.benchmarkEvidenceId.trim()
    || !capacity.renderer.trim() || !Number.isSafeInteger(capacity.measuredAtMs) || capacity.measuredAtMs < 0) throw new Error("unverified_live_capacity");
  const counts = [policy.platformMaxRooms, policy.regionMaxRooms[region], capacity.maxRooms];
  if (!Number.isSafeInteger(policy.accountMaxRooms) || policy.accountMaxRooms < 1) throw new Error("live_concurrency_policy_blocked");
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 1)) throw new Error("live_concurrency_policy_blocked");
  return Math.min(...counts);
}

export interface OwnedLiveAccount {
  id: string;
  ownerId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  connectionStatus: "CONNECTED" | "DISCONNECTED" | "RECONNECT_REQUIRED";
}
export type OwnedLiveProduct = LiveProduct & { ownerId: string };
export interface LiveRoomSelection {
  ownerId: string;
  account: OwnedLiveAccount;
  presenter: PresenterPack;
  products: OwnedLiveProduct[];
  title: string;
  region: string;
}
export interface LiveRoomResources {
  /** Runtime owns the same existing presenter→A/V→encoder→stream lifecycle, once. */
  runtime: PresenterRuntimePort;
  snapshotStore: LiveSessionSnapshotStore;
  brain: LiveBrainProvider;
  voice: VoiceProvider;
  presenterAudio: PresenterAudioPort;
  /** Distinct room-owned handles prevent accidental encoder/transport reuse across accounts. */
  encoder: object;
  stream: object;
  safetyVoice: SafetyVoiceBuffer;
  gestures?: SpeechGesturePort;
  policy?: LivePolicyGuard;
  sellerRules?: SellerRules;
  allowMock?: boolean;
}
export interface LiveRoomMetrics {
  viewers: number | null;
  sales: number | null;
  units: number | null;
  currency: string | null;
  revenuePerHour: number | null;
}
export interface LiveRoomView {
  accountId: string;
  title: string;
  presenter: ReturnType<typeof customerPresenterPack>;
  state: "READY" | "STARTING" | "LIVE" | "PAUSED" | "STOPPED" | "ERROR";
  startedAtMs: number | null;
  updatedAtMs: number | null;
  elapsedMs: number | null;
  aiPaused: boolean;
  currentProduct: LiveProduct | null;
  lastComment: string | null;
  currentResponse: string | null;
  metrics: LiveRoomMetrics;
  activity: Array<{ at: number; text: string }>;
}

/** Every room uses the existing session/controller/pipeline boundary, with dedicated mutable dependencies. */
export class LiveRoom {
  readonly controller: LiveSessionController;
  readonly pipeline: LivePipeline;
  private readonly products: ProductBrain;
  private metrics: LiveRoomMetrics = { viewers: null, sales: null, units: null, currency: null, revenuePerHour: null };
  private aiPaused = false;
  private lifecycle: Promise<unknown> | null = null;
  private readonly selected: LiveRoomSelection;

  constructor(selection: LiveRoomSelection, resources: LiveRoomResources, private readonly lifecyclePorts: {
    claim: () => void; release: () => void; now: () => number;
  }) {
    this.selected = structuredClone(selection);
    this.products = new ProductBrain(structuredClone(selection.products), { now: lifecyclePorts.now });
    this.controller = new LiveSessionController(resources.runtime, resources.snapshotStore, { allowMock: resources.allowMock, now: lifecyclePorts.now });
    this.pipeline = new LivePipeline({ controller: this.controller, comments: new CommentEngine({ now: lifecyclePorts.now }),
      brain: resources.brain, products: this.products, actions: new ActionQueue({ now: lifecyclePorts.now }), voice: resources.voice,
      presenterAudio: resources.presenterAudio, safetyVoice: resources.safetyVoice, gestures: resources.gestures,
      policy: resources.policy, sellerRules: resources.sellerRules, now: lifecyclePorts.now,
      policyIdentity: { representsRealPerson: selection.presenter.identity.representsRealPerson,
        identityConsentConfirmed: selection.presenter.identity.consentConfirmed, impersonationClaim: false } });
  }

  get selection(): LiveRoomSelection { return structuredClone(this.selected); }

  private authorize(ownerId: string): void { if (ownerId !== this.selection.ownerId) throw new Error("live_room_owner_mismatch"); }

  async start(ownerId: string): Promise<LiveRoomView> {
    this.authorize(ownerId);
    if (this.lifecycle || (this.controller.current() && this.controller.current()!.state !== "STOPPED")) throw new Error("live_room_already_active");
    if (this.selection.account.connectionStatus !== "CONNECTED") throw new Error("live_account_reconnect_required");
    this.lifecyclePorts.claim();
    this.pipeline.speech.resume();
    this.aiPaused = false;
    this.lifecycle = this.controller.start({ ownerId, tiktokAccountId: this.selection.account.id,
      productIds: this.selection.products.map((product) => product.id), presenterReferenceId: this.selection.presenter.identity.referenceId });
    try {
      await this.lifecycle;
      const current = this.controller.current();
      if (current?.state === "BLOCKED" && current.runtimeStatus !== "READY") this.lifecyclePorts.release();
      return this.view(ownerId);
    } catch (error) {
      // Do not release a possibly-started runtime lease until an idempotent Stop succeeds.
      if (!this.controller.current()) this.lifecyclePorts.release();
      throw error;
    } finally { this.lifecycle = null; }
  }

  async stop(ownerId: string): Promise<LiveRoomView> {
    this.authorize(ownerId);
    if (this.lifecycle) throw new Error("live_room_transition_in_progress");
    this.lifecycle = (async () => {
      let speechError: unknown;
      try { await this.pipeline.speech.stop(); } catch (error) { speechError = error; }
      if (this.controller.current()) await this.controller.stop();
      if (!this.controller.current() || this.controller.current()?.state === "STOPPED") {
        this.pipeline.speech.confirmStopped();
        this.lifecyclePorts.release();
      } else if (speechError) throw speechError;
    })();
    try { await this.lifecycle; return this.view(ownerId); } finally { this.lifecycle = null; }
  }

  async pauseAi(ownerId: string): Promise<void> {
    this.authorize(ownerId);
    if (this.controller.current()?.state !== "RUNNING") throw new Error("live_room_not_running");
    this.aiPaused = true;
    await this.pipeline.speech.pause();
  }

  resumeAi(ownerId: string): void {
    this.authorize(ownerId);
    if (this.controller.current()?.state !== "RUNNING") throw new Error("live_room_not_running");
    this.aiPaused = false;
    this.pipeline.speech.resume();
  }

  async receiveComment(ownerId: string, input: IncomingLiveComment) {
    this.authorize(ownerId);
    const accepted = this.pipeline.ingestComment(input);
    if (accepted.accepted && !this.aiPaused) await this.pipeline.handleNextComment();
    return accepted;
  }

  speak(ownerId: string, idempotencyKey: string, text: string): boolean {
    this.authorize(ownerId);
    if (this.controller.current()?.state !== "RUNNING" || this.aiPaused) throw new Error("live_room_not_speaking");
    return this.pipeline.enqueueSpeech({ id: idempotencyKey, text, priority: 90, source: "MANUAL",
      productId: this.products.current()?.id ?? null, intent: "GENERAL" });
  }

  async selectProduct(ownerId: string, productId: string): Promise<void> {
    this.authorize(ownerId);
    if (!this.products.select(productId)) throw new Error("product_not_selected");
    const session = this.controller.current();
    if (session?.state === "RUNNING") await this.controller.updateContext({ productId });
  }

  async processNext(ownerId: string): Promise<void> {
    this.authorize(ownerId);
    if (this.aiPaused) return;
    await this.pipeline.handleNextComment();
    await this.pipeline.handleNextAction();
  }

  async inspect(ownerId: string, probe: WatchdogProbe): Promise<void> {
    this.authorize(ownerId);
    await this.controller.inspect(probe);
    if (this.controller.current()?.state !== "RUNNING") await this.pipeline.speech.pause();
  }

  observe(ownerId: string, metrics: LiveRoomMetrics): void {
    this.authorize(ownerId);
    for (const key of ["viewers", "sales", "units", "revenuePerHour"] as const) {
      if (metrics[key] !== null && (!Number.isFinite(metrics[key]) || metrics[key]! < 0)) throw new Error("invalid_live_observation");
    }
    if ((metrics.viewers !== null && !Number.isSafeInteger(metrics.viewers)) || (metrics.units !== null && !Number.isSafeInteger(metrics.units))
      || (metrics.currency !== null && !/^[A-Z]{3}$/u.test(metrics.currency))) throw new Error("invalid_live_observation");
    this.metrics = { ...metrics };
  }

  view(ownerId: string): LiveRoomView {
    this.authorize(ownerId);
    const session = this.controller.current();
    const states: Record<NonNullable<typeof session>["state"], LiveRoomView["state"]> = {
      STARTING: "STARTING", RUNNING: "LIVE", PAUSED: "PAUSED", RECOVERY_REQUIRED: "ERROR", BLOCKED: "ERROR", STOPPED: "STOPPED",
    };
    return { accountId: this.selection.account.id, title: this.selection.title,
      presenter: customerPresenterPack(this.selection.presenter), state: session ? states[session.state] : "READY",
      startedAtMs: session?.startedAt ?? null, updatedAtMs: session?.updatedAt ?? null,
      elapsedMs: session ? Math.max(0, (session.state === "STOPPED" ? session.updatedAt : this.lifecyclePorts.now()) - session.startedAt) : null,
      aiPaused: this.aiPaused, currentProduct: this.products.current() ? structuredClone(this.products.current()!) : null,
      lastComment: session?.lastComment ?? null, currentResponse: session?.currentResponse ?? null,
      metrics: { ...this.metrics }, activity: this.controller.events.recent().map(({ at, text }) => ({ at, text })) };
  }
}

export class LiveRoomRegistry {
  private rooms = new Map<string, LiveRoom>();
  private active = new Set<string>();
  private resources = new WeakSet<object>();
  constructor(private readonly policy: ConcurrentLivePolicy, private readonly factory: (selection: LiveRoomSelection) => LiveRoomResources,
    private readonly now: () => number = Date.now) {}

  create(selection: LiveRoomSelection): LiveRoom {
    const key = `${selection.ownerId}:${selection.account.id}`;
    if (selection.account.ownerId !== selection.ownerId || selection.products.some((product) => product.ownerId !== selection.ownerId)) throw new Error("live_room_owner_mismatch");
    validatePresenterPack(selection.presenter, selection.ownerId);
    if (!selection.title.trim() || selection.title.length > 100 || !selection.products.length || new Set(selection.products.map((product) => product.id)).size !== selection.products.length
      || selection.products.some((product) => product.status !== "available")) throw new Error("invalid_live_room_selection");
    if (this.rooms.has(key)) throw new Error("duplicate_live_room");
    const ownSelection = structuredClone(selection);
    const resources = this.factory(ownSelection);
    const identities = [resources.runtime, resources.brain, resources.voice, resources.presenterAudio, resources.encoder, resources.stream, resources.safetyVoice,
      ...(resources.gestures ? [resources.gestures] : [])];
    if (identities.some((resource) => this.resources.has(resource))) throw new Error("shared_live_room_resource");
    for (const resource of identities) this.resources.add(resource);
    const room = new LiveRoom(ownSelection, resources, {
      now: this.now,
      claim: () => {
        verifiedRoomLimit(this.policy, ownSelection.region);
        const capacity = this.policy.deviceCapacity;
        const limit = Math.min(this.policy.platformMaxRooms, capacity.status === "VERIFIED_CAPACITY" ? capacity.maxRooms : 0);
        const activeInRegion = [...this.active].filter((activeKey) => this.rooms.get(activeKey)?.selection.region === ownSelection.region).length;
        if (this.active.has(key)) throw new Error("live_room_already_active");
        if (this.active.size >= limit || activeInRegion >= this.policy.regionMaxRooms[ownSelection.region]) throw new Error("live_room_capacity_reached");
        this.active.add(key);
      },
      release: () => { this.active.delete(key); },
    });
    this.rooms.set(key, room);
    return room;
  }

  list(ownerId: string): LiveRoomView[] { return [...this.rooms.values()].filter((room) => room.selection.ownerId === ownerId).map((room) => room.view(ownerId)); }
  get(ownerId: string, accountId: string): LiveRoom | null { return this.rooms.get(`${ownerId}:${accountId}`) ?? null; }
}
