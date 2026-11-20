import { afterEach, describe, expect, it, vi } from "vitest";
import { customerPresenterPack, presenterPackReadiness, validatePresenterPack, type PresenterPack } from "./presenter-pack";
import { LiveRoomRegistry, verifiedRoomLimit, type ConcurrentLivePolicy, type LiveRoomResources, type LiveRoomSelection } from "./live-room";
import { liveCommentPriority, RuleBasedLiveBrain } from "./domain";
import { LiveSpeechScheduler } from "./speech-scheduler";
import { SafetyVoiceBuffer, SAFETY_VOICE_CATEGORIES } from "./safety-voice-buffer";
import { LivePolicyGuard, type LivePolicyConfiguration } from "./live-policy";
import { unifiedAccountPerformance } from "./analytics-contract";
import type { LiveSessionSnapshot } from "./session-controller";

function pack(ownerId = "owner-a"): PresenterPack {
  return { id: "presenter-a", ownerId, name: "คน LIVE หนึ่ง", identity: {
    referenceId: "reference-a", imageUrl: "/api/ai-live/presenters/reference-a/image", consentConfirmed: true, representsRealPerson: true,
  }, neutral: { referenceId: "reference-a", expression: "neutral" }, expressionProfile: { intensity: 0.3, allowed: ["neutral", "smile"] },
  gestureBank: ["neutral", "smile", "nod"], voiceBinding: { voiceId: "voice-a", displayName: "เสียงหนึ่ง" },
  safetyFallback: { gesture: "neutral", referenceId: "reference-a" }, rendererCompatibility: ["MuseTalkCPUFloat32", "MuseTalkHybrid"],
  assignedAccountIds: [], createdAtMs: 1, updatedAtMs: 1 };
}
function selection(accountId: string, ownerId = "owner-a"): LiveRoomSelection {
  return { ownerId, account: { id: accountId, ownerId, displayName: accountId, username: accountId, avatarUrl: null, connectionStatus: "CONNECTED" },
    presenter: pack(ownerId), products: [{ id: `product-${accountId}`, ownerId, title: `สินค้า ${accountId}`, status: "available" }],
    title: `ห้อง ${accountId}`, region: "TH" };
}
function resources(): LiveRoomResources {
  const records = new Map<string, LiveSessionSnapshot>();
  return { runtime: { kind: "mock", health: async () => "READY", start: vi.fn(async () => {}), pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}), stop: vi.fn(async () => {}) }, snapshotStore: { load: async (id) => records.get(id) ?? null,
    save: async (snapshot) => { records.set(snapshot.id, structuredClone(snapshot)); } },
    brain: new RuleBasedLiveBrain(), voice: { async *streamText() { yield new Uint8Array([1, 2]); },
      interrupt: vi.fn(async () => {}), cancel: vi.fn(async () => {}) }, presenterAudio: { pushAudioChunk: vi.fn(async () => {}) },
    encoder: {}, stream: {}, safetyVoice: new SafetyVoiceBuffer(), allowMock: true };
}
const policy: ConcurrentLivePolicy = { platformMaxRooms: 3, regionMaxRooms: { TH: 3 }, accountMaxRooms: 1,
  deviceCapacity: { status: "VERIFIED_CAPACITY", maxRooms: 3, renderer: "fixture-boundary-only", measuredAtMs: 1, benchmarkEvidenceId: "test-fixture" } };
const safetyConfiguration: LivePolicyConfiguration = { platformPermitted: true, region: "TH", allowedRegions: ["TH"],
  aigcDisclosureRequired: true, aigcDisclosureSupported: true, aigcDisclosureAccepted: true, prohibitedProductIds: ["blocked"],
  unsafeClaimPatterns: [/cures every disease/giu] };
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe("PresenterPack and customer contracts", () => {
  it("requires neutral recovery and identity consent, and excludes engine metadata from customer projection", () => {
    const input = pack();
    expect(validatePresenterPack(input, "owner-a")).toEqual(input);
    expect(() => validatePresenterPack(input, "owner-b")).toThrow("presenter_owner_mismatch");
    expect(() => validatePresenterPack({ ...input, gestureBank: ["nod"] }, "owner-a")).toThrow();
    expect(() => validatePresenterPack({ ...input, identity: { ...input.identity, imageUrl: "file:///secret" } }, "owner-a")).toThrow();
    const customer = customerPresenterPack(input);
    expect(customer).toMatchObject({ name: "คน LIVE หนึ่ง", status: "READY", voiceName: "เสียงหนึ่ง" });
    expect(JSON.stringify(customer)).not.toMatch(/MuseTalk|rendererCompatibility|referenceId|ownerId/u);
    expect(presenterPackReadiness({ ...input, identity: { ...input.identity, consentConfirmed: false } }).status).toBe("SETUP_REQUIRED");
    expect(presenterPackReadiness({ ...input, voiceBinding: null }).status).toBe("SETUP_REQUIRED");
  });

  it("keeps unobserved analytics null and rejects fabricated invalid counters", () => {
    const value = { accountId: "account-a", observedAtMs: 10, post: { status: null, clipsToday: null, views: null, sales: null },
      live: { status: null, durationSecondsToday: null, viewers: null, sales: null, units: null, revenuePerHour: null },
      commission: null, currency: null, topProductId: null, source: "OBSERVED" as const };
    expect(unifiedAccountPerformance(value)).toEqual(value);
    expect(() => unifiedAccountPerformance({ ...value, post: { ...value.post, views: -1 } })).toThrow("invalid_account_observation");
    expect(() => unifiedAccountPerformance({ ...value, live: { ...value.live, units: 0.5 } })).toThrow();
  });
});

describe("isolated multi-account LIVE lifecycle", () => {
  it("starts 3 distinct accounts with accountMaxRooms=1, isolates comments/products/metrics, pauses AI only and rejects duplicate room/session", async () => {
    let now = 0;
    const created: LiveRoomResources[] = [];
    const registry = new LiveRoomRegistry(policy, () => { const owned = resources(); created.push(owned); return owned; }, () => now);
    const a = registry.create(selection("a"));
    const b = registry.create(selection("b"));
    const c = registry.create(selection("c"));
    expect(() => registry.create(selection("a"))).toThrow("duplicate_live_room");
    await Promise.all([a.start("owner-a"), b.start("owner-a"), c.start("owner-a")]);
    expect(registry.list("owner-a").map((room) => room.state)).toEqual(["LIVE", "LIVE", "LIVE"]);
    await expect(a.start("owner-a")).rejects.toThrow("live_room_already_active");
    await expect(a.stop("owner-b")).rejects.toThrow("live_room_owner_mismatch");
    expect(registry.list("owner-b")).toEqual([]);
    expect(registry.get("owner-b", "a")).toBeNull();
    await a.receiveComment("owner-a", { commentId: "same-id", viewerId: "viewer", text: "hello", createdAtMs: 0 });
    await a.processNext("owner-a");
    expect(a.view("owner-a").lastComment).toBe("hello");
    expect(b.view("owner-a").lastComment).toBeNull();
    expect(c.view("owner-a").metrics.sales).toBeNull();
    a.observe("owner-a", { viewers: 5, sales: 100, units: 2, currency: "THB", revenuePerHour: 50 });
    expect(b.view("owner-a").metrics.sales).toBeNull();
    await a.pauseAi("owner-a");
    expect(a.view("owner-a")).toMatchObject({ state: "LIVE", aiPaused: true });
    expect(created[0].runtime.pause).not.toHaveBeenCalled();
    expect(created[1].voice.interrupt).not.toHaveBeenCalled();
    a.resumeAi("owner-a");
    expect(a.view("owner-a").aiPaused).toBe(false);
    const escaped = a.selection;
    escaped.ownerId = "owner-b";
    expect(a.view("owner-a").accountId).toBe("a");
    now = 30_000;
    await a.inspect("owner-a", { nowMs: now, sessionHeartbeatAt: 0, presenterHeartbeatAt: 0,
      oldestAudioQueuedAt: null, oldestCommentQueuedAt: null, streamConnected: false });
    expect(a.view("owner-a").state).toBe("ERROR");
    expect(b.view("owner-a").state).toBe("LIVE");
    await a.stop("owner-a");
    await a.stop("owner-a");
    expect(created[0].runtime.stop).toHaveBeenCalledTimes(1);
    await b.stop("owner-a"); await c.stop("owner-a");
    expect(registry.list("owner-a").every((room) => room.state === "STOPPED")).toBe(true);
  });

  it("blocks unverified hardware, unauthorized selection and shared mutable runtime dependencies", async () => {
    expect(() => verifiedRoomLimit({ ...policy, deviceCapacity: { status: "UNVERIFIED_CAPACITY" } }, "TH")).toThrow("unverified_live_capacity");
    const unknown = new LiveRoomRegistry({ ...policy, deviceCapacity: { status: "UNVERIFIED_CAPACITY" } }, resources);
    const room = unknown.create(selection("a"));
    await expect(room.start("owner-a")).rejects.toThrow("unverified_live_capacity");
    const wrong = selection("b"); wrong.products[0].ownerId = "owner-b";
    expect(() => unknown.create(wrong)).toThrow("live_room_owner_mismatch");
    const shared = resources();
    const registry = new LiveRoomRegistry(policy, () => shared);
    registry.create(selection("a"));
    expect(() => registry.create(selection("b"))).toThrow("shared_live_room_resource");
  });

  it("retains capacity after an ambiguous start until idempotent Stop acknowledges release", async () => {
    const limited = { ...policy, deviceCapacity: { ...policy.deviceCapacity, status: "VERIFIED_CAPACITY" as const, maxRooms: 1,
      renderer: "fixture", measuredAtMs: 0, benchmarkEvidenceId: "fixture" } };
    let count = 0;
    const registry = new LiveRoomRegistry(limited, () => {
      const owned = resources(); count += 1;
      if (count === 1) owned.runtime.start = async () => { throw new Error("response_lost_after_start"); };
      return owned;
    });
    const a = registry.create(selection("a"));
    const b = registry.create(selection("b"));
    expect((await a.start("owner-a")).state).toBe("ERROR");
    await expect(b.start("owner-a")).rejects.toThrow("live_room_capacity_reached");
    await a.stop("owner-a");
    expect((await b.start("owner-a")).state).toBe("LIVE");
    await b.stop("owner-a");
  });

  it("acknowledges runtime Stop even when the voice cancellation boundary fails", async () => {
    const generated = defer<void>(); const never = defer<void>(); const owned = resources();
    owned.voice.streamText = async function* () { generated.resolve(); await never.promise; yield new Uint8Array([1, 2]); };
    owned.voice.interrupt = async () => { throw new Error("voice_cancel_failed"); };
    const room = new LiveRoomRegistry(policy, () => owned).create(selection("a"));
    await room.start("owner-a");
    room.speak("owner-a", "speaking", "hello");
    const processing = room.processNext("owner-a").catch(() => undefined);
    await generated.promise;
    expect((await room.stop("owner-a")).state).toBe("STOPPED");
    expect(owned.runtime.stop).toHaveBeenCalledTimes(1);
    never.resolve(); await processing;
    expect(owned.presenterAudio.pushAudioChunk).not.toHaveBeenCalled();
  });
});

describe("speech interruption and real safety audio", () => {
  it("prioritizes safety, product questions, purchase, greeting and general comments ahead of filler", () => {
    expect(["report unsafe", "ราคาเท่าไหร่?", "buy now", "hello", "great"].map(liveCommentPriority)).toEqual([100, 80, 70, 50, 30]);
  });

  it("interrupts and resumes through the existing LiveRoom → LivePipeline → voice/presenter execution boundary", async () => {
    const firstAudio = defer<void>(); const release = defer<void>(); const sent: number[] = [];
    const owned = resources();
    owned.voice.streamText = async function* (text) {
      if (text === "Sales.") { yield new Uint8Array([1, 2]); yield new Uint8Array([3, 4]); }
      else yield new Uint8Array([9, 10]);
    };
    owned.presenterAudio.pushAudioChunk = async (_id, chunk) => { sent.push(chunk[0]); if (chunk[0] === 1) { firstAudio.resolve(); await release.promise; } };
    const registry = new LiveRoomRegistry(policy, () => owned);
    const room = registry.create(selection("a"));
    await room.start("owner-a");
    room.pipeline.enqueueSpeech({ id: "script", text: "Sales.", source: "SCRIPT", priority: 10, productId: "product-a", intent: "FILLER" });
    const speaking = room.processNext("owner-a");
    await firstAudio.promise;
    const comment = room.receiveComment("owner-a", { commentId: "price", viewerId: "v", text: "ราคาเท่าไหร่?", createdAtMs: Date.now() });
    release.resolve(); await comment; await speaking;
    await room.processNext("owner-a"); // current product display action
    await room.processNext("owner-a"); // real voice boundary for reply
    await room.processNext("owner-a"); // remaining buffered script audio
    expect(sent).toEqual([1, 9, 3]);
    expect(room.view("owner-a").lastComment).toBe("ราคาเท่าไหร่?");
    expect(room.view("owner-a").currentResponse).toContain("ยังไม่มีราคา");
    await room.stop("owner-a");
  });

  it("preempts at an acknowledged audio boundary, speaks the comment once, resumes exact PCM cursor without repeating audio", async () => {
    const firstAudio = defer<void>(); const release = defer<void>();
    const sent: number[] = []; const texts: string[] = [];
    let activeSends = 0; let maximum = 0;
    const voice = { async *streamText(text: string) {
      texts.push(text);
      if (text === "First.") { yield new Uint8Array([1, 2]); yield new Uint8Array([3, 4]); }
      else if (text === "Second.") yield new Uint8Array([5, 6]);
      else yield new Uint8Array([9, 10]);
    }, interrupt: vi.fn(async () => {}), cancel: vi.fn(async () => {}) };
    const gestures = { onIntent: vi.fn(async () => {}), neutral: vi.fn(async () => {}) };
    const scheduler = new LiveSpeechScheduler({ voice, gestures, presenterAudio: { pushAudioChunk: async (_session, chunk) => {
      activeSends += 1; maximum = Math.max(maximum, activeSends); sent.push(chunk[0]);
      if (chunk[0] === 1) { firstAudio.resolve(); await release.promise; }
      activeSends -= 1;
    } } });
    scheduler.enqueue({ id: "sales", text: "First. Second.", priority: 10, source: "SCRIPT", productId: "product", intent: "FILLER" });
    const initial = scheduler.runNext("session");
    await firstAudio.promise;
    scheduler.enqueue({ id: "comment", text: "Answer", priority: 80, source: "COMMENT", productId: "product", intent: "PRODUCT" });
    const preempted = scheduler.preempt(80);
    expect(await scheduler.runNext("session")).toMatchObject({ status: "IDLE" });
    release.resolve();
    expect(await preempted).toBe(true);
    expect(await initial).toMatchObject({ status: "INTERRUPTED" });
    expect(await scheduler.runNext("session")).toMatchObject({ status: "COMPLETE", requestId: "comment" });
    expect(await scheduler.runNext("session")).toMatchObject({ status: "COMPLETE", requestId: "sales" });
    expect(sent).toEqual([1, 9, 3, 5]);
    expect(texts.filter((text) => text === "First.")).toHaveLength(1);
    expect(maximum).toBe(1);
    expect(gestures.neutral).toHaveBeenCalledTimes(1);
    expect(scheduler.enqueue({ id: "comment", text: "Duplicate", priority: 80, source: "COMMENT", productId: "product", intent: "PRODUCT" })).toBe(false);
  });

  it("prepares all 7 categories using a real voice boundary, isolates products and consumes PCM without silent loops", async () => {
    let now = 0;
    const buffer = new SafetyVoiceBuffer({ now: () => now, maxSeconds: 1 });
    const voice = { async *streamText() { yield new Uint8Array([1, 0, 2, 0]); }, interrupt: async () => {}, cancel: async () => {} };
    expect(await buffer.prepareFromVoice(SAFETY_VOICE_CATEGORIES.map((category) => ({ id: category, category, productId: category === "FILLER" ? null : "product-a", text: "ข้อความที่ตรวจแล้ว" })),
      voice, { signal: new AbortController().signal })).toBe(7);
    const input = buffer.take("CTA", "product-b");
    expect(input).toEqual(new Uint8Array([1, 0, 2, 0])); // generic filler, never product A's CTA
    expect(buffer.take("CTA", "product-b")).toBeNull();
    buffer.activate(); buffer.markWaiting(); now = 500; buffer.markAudio();
    expect(buffer.metrics()).toMatchObject({ preparedClips: 6, consumedSeconds: 4 / 32_000, fallbackActivations: 1, deadAirMs: 500 });
    expect(() => buffer.prepare({ id: "fake", category: "FILLER", productId: null, provenance: "RECORDED", pcm16: new Uint8Array(16), sampleRate: 16_000, channels: 1 })).toThrow("invalid_safety_voice_pcm");
    buffer.clear(); expect(buffer.metrics().remainingSeconds).toBe(0);
  });

  it("uses only prepared PCM on voice failure and returns to normal interaction without creating a replacement session", async () => {
    const buffer = new SafetyVoiceBuffer();
    buffer.prepare({ id: "backup", category: "FILLER", productId: null, provenance: "RECORDED", pcm16: new Uint8Array([11, 12]), sampleRate: 16_000, channels: 1 });
    let fail = true; const sent: number[] = [];
    const voice = { async *streamText() { if (fail) throw new Error("network_timeout"); yield new Uint8Array([21, 22]); }, interrupt: vi.fn(async () => {}), cancel: vi.fn(async () => {}) };
    const scheduler = new LiveSpeechScheduler({ voice, buffer, presenterAudio: { pushAudioChunk: async (_id, chunk) => { sent.push(chunk[0]); } } });
    scheduler.enqueue({ id: "question-1", text: "Reply", source: "COMMENT", priority: 80, productId: "p", intent: "PRODUCT" });
    expect(await scheduler.runNext("session")).toMatchObject({ status: "BUFFERED", audioChunks: 1 });
    fail = false;
    scheduler.enqueue({ id: "question-2", text: "Reply", source: "COMMENT", priority: 80, productId: "p", intent: "PRODUCT" });
    expect(await scheduler.runNext("session")).toMatchObject({ status: "COMPLETE" });
    expect(sent).toEqual([11, 21]);
    expect(buffer.metrics().fallbackActivations).toBe(1);
    expect(voice.cancel).toHaveBeenCalledTimes(1);
  });

  it("covers a slow brain with bounded real backup PCM and returns to the pending reply in the same room", async () => {
    vi.useFakeTimers();
    const answer = defer<Awaited<ReturnType<RuleBasedLiveBrain["decide"]>>>();
    const owned = resources();
    owned.brain.decide = () => answer.promise;
    owned.safetyVoice.prepare({ id: "filler", category: "FILLER", productId: null, provenance: "RECORDED", pcm16: new Uint8Array([11, 12]), sampleRate: 16_000, channels: 1 });
    const room = new LiveRoomRegistry(policy, () => owned).create(selection("a"));
    await room.start("owner-a");
    const receive = room.receiveComment("owner-a", { commentId: "slow", viewerId: "v", text: "hello", createdAtMs: Date.now() });
    await vi.advanceTimersByTimeAsync(501);
    expect(owned.presenterAudio.pushAudioChunk).toHaveBeenCalledWith(expect.any(String), new Uint8Array([11, 12]));
    answer.resolve({ reply: "Hello", intent: "GREETING", priority: 50, suggestedActions: [{ type: "SPEAK", priority: 50 }] });
    await receive; await room.processNext("owner-a");
    expect(room.view("owner-a").state).toBe("LIVE");
    expect(room.view("owner-a").currentResponse).toBe("Hello");
    expect(owned.safetyVoice.metrics().fallbackActivations).toBe(1);
    expect(owned.runtime.start).toHaveBeenCalledTimes(1);
    await room.stop("owner-a");
  });

  it("covers slow streaming TTS with finite prepared voice chunks and continues with real interactive PCM", async () => {
    vi.useFakeTimers();
    const ready = defer<void>(); const sent: number[] = [];
    const buffer = new SafetyVoiceBuffer();
    const pcm = new Uint8Array(32_000); pcm.fill(11);
    buffer.prepare({ id: "finite", category: "FILLER", productId: null, provenance: "RECORDED", pcm16: pcm, sampleRate: 16_000, channels: 1 });
    const scheduler = new LiveSpeechScheduler({ buffer, timeoutMs: 5_000,
      voice: { async *streamText() { await ready.promise; yield new Uint8Array([21, 22]); }, interrupt: async () => {}, cancel: async () => {} },
      presenterAudio: { pushAudioChunk: async (_id, chunk) => { sent.push(chunk[0]); } } });
    scheduler.enqueue({ id: "slow", text: "reply", priority: 80, source: "COMMENT", productId: "p", intent: "PRODUCT" });
    const speaking = scheduler.runNext("session");
    await vi.advanceTimersByTimeAsync(1_001);
    expect(sent).toEqual([11, 11]);
    expect(buffer.metrics().remainingSeconds).toBe(0);
    ready.resolve();
    expect(await speaking).toMatchObject({ status: "COMPLETE", audioChunks: 3 });
    expect(sent).toEqual([11, 11, 21]);
    expect(buffer.metrics().fallbackActivations).toBe(1);
  });

  it("bounds a stalled encoder/audio boundary and fails closed rather than overlapping a new voice", async () => {
    vi.useFakeTimers();
    const scheduler = new LiveSpeechScheduler({ voice: { async *streamText() { yield new Uint8Array([1, 2]); }, interrupt: async () => {}, cancel: async () => {} },
      presenterAudio: { pushAudioChunk: () => new Promise(() => {}) }, timeoutMs: 100 });
    scheduler.enqueue({ id: "one", text: "one", priority: 80, source: "COMMENT", productId: null, intent: "GENERAL" });
    const execution = expect(scheduler.runNext("session")).rejects.toThrow("presenter_audio_timeout");
    await vi.advanceTimersByTimeAsync(101);
    await execution;
    await expect(scheduler.runNext("session")).rejects.toThrow("presenter_audio_recovery_required");
  });
});

describe("live safety policy", () => {
  const safe = { text: "Verified product facts", productId: "p", representsRealPerson: true, identityConsentConfirmed: true, impersonationClaim: false };
  it("blocks unapproved disclosure, region, product, unsafe claims and misleading identity before speaking", () => {
    const guard = new LivePolicyGuard(safetyConfiguration);
    expect(guard.evaluate(safe)).toEqual({ allowed: true, reasons: [] });
    expect(guard.evaluate({ ...safe, text: "cures every disease" }).reasons).toContain("UNSAFE_CLAIM");
    expect(guard.evaluate({ ...safe, text: "cures every disease" }).allowed).toBe(false);
    expect(guard.evaluate({ ...safe, productId: "blocked", identityConsentConfirmed: false }).reasons).toEqual(["PROHIBITED_PRODUCT", "MISLEADING_IDENTITY"]);
    expect(new LivePolicyGuard({ ...safetyConfiguration, aigcDisclosureSupported: false }).evaluate(safe).reasons).toContain("DISCLOSURE_REQUIRED");
    expect(new LivePolicyGuard({ ...safetyConfiguration, allowedRegions: ["OTHER"], platformPermitted: false }).evaluate(safe).reasons).toEqual(["PLATFORM_UNAVAILABLE", "REGION_RESTRICTED"]);
  });

  it("applies policy before the normal pipeline reaches the voice or presenter boundary", async () => {
    const owned = resources(); owned.policy = new LivePolicyGuard(safetyConfiguration);
    const room = new LiveRoomRegistry(policy, () => owned).create(selection("a"));
    await room.start("owner-a");
    expect(room.speak("owner-a", "unsafe", "cures every disease")).toBe(false);
    await room.processNext("owner-a");
    expect(owned.presenterAudio.pushAudioChunk).not.toHaveBeenCalled();
    await room.stop("owner-a");
  });
});
