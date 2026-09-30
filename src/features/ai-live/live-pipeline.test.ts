import { describe, expect, it } from "vitest";
import { ActionQueue, CommentEngine, ProductBrain, RuleBasedLiveBrain, type LiveProduct } from "./domain";
import { LivePipeline, type PresenterAudioPort, type VoiceProvider } from "./live-pipeline";
import {
  LiveSessionController, type LiveSessionSnapshot, type LiveSessionSnapshotStore,
  type PresenterRuntimePort,
} from "./session-controller";

const products: LiveProduct[] = [
  { id: "product-one", title: "สินค้าทดสอบหนึ่ง", status: "available", current_price: 42, currency: "THB" },
  { id: "product-two", title: "สินค้าทดสอบสอง", status: "available", current_price: 58, currency: "THB" },
];

describe("AI LIVE non-GPU pipeline", () => {
  it("runs 30 minutes of virtual comment → brain → product → voice → mock presenter traffic without queue buildup or duplicate actions", async () => {
    let clock = 0;
    let audioChunks = 0;
    let speechCalls = 0;
    const records = new Map<string, LiveSessionSnapshot>();
    const store: LiveSessionSnapshotStore = {
      load: async (id) => records.get(id) ?? null,
      save: async (snapshot) => { records.set(snapshot.id, structuredClone(snapshot)); },
    };
    // Test-only network boundary; no video frames or claimed lip-sync are created.
    const mockPresenter: PresenterRuntimePort & PresenterAudioPort = {
      kind: "mock", health: async () => "READY", start: async () => {},
      pause: async () => {}, resume: async () => {}, stop: async () => {},
      pushAudioChunk: async (_sessionId, chunk) => {
        expect(chunk.byteLength).toBeGreaterThan(0);
        audioChunks += 1;
      },
    };
    const voice: VoiceProvider = {
      async *streamText(text, _utteranceId, signal) {
        if (signal.aborted) return;
        expect(text).toContain("สินค้า");
        speechCalls += 1;
        yield new Uint8Array([1, 2, 3, 4]);
      },
      interrupt: async () => {}, cancel: async () => {},
    };
    const controller = new LiveSessionController(mockPresenter, store, {
      allowMock: true, now: () => clock, newId: () => "session-test",
    });
    const comments = new CommentEngine({ now: () => clock, cooldownMs: 0, maxQueue: 5, maxSeen: 128 });
    const productBrain = new ProductBrain(products, { now: () => clock, minDwellMs: 60_000 });
    const actions = new ActionQueue({ now: () => clock, maxSize: 5, maxSeen: 128 });
    const pipeline = new LivePipeline({
      controller, comments, brain: new RuleBasedLiveBrain(), products: productBrain,
      actions, voice, presenterAudio: mockPresenter, now: () => clock,
    });

    expect((await controller.start({
      ownerId: "owner-test", tiktokAccountId: "account-test", productIds: products.map((product) => product.id),
      presenterReferenceId: "reference-test",
    })).state).toBe("RUNNING");

    const beforeHeap = process.memoryUsage().heapUsed;
    for (let second = 0; second < 30 * 60; second += 1) {
      clock = second * 1_000;
      const input = {
        commentId: `comment-${second}`, viewerId: `viewer-${second % 30}`,
        text: `ราคา สินค้า ${second}?`, createdAtMs: clock,
      };
      expect(pipeline.ingestComment(input).accepted).toBe(true);
      expect(pipeline.ingestComment(input)).toEqual({ accepted: false, reason: "DUPLICATE" });
      const handled = await pipeline.handleNextComment();
      expect(handled.type).toBe("COMMENT_HANDLED");
      expect(await pipeline.handleNextAction()).toMatchObject({ type: "ACTION_HANDLED" });
      expect(await pipeline.handleNextAction()).toMatchObject({ type: "ACTION_HANDLED" });
      expect(comments.size).toBe(0);
      expect(actions.size).toBe(0);
      if (second > 0 && second % 60 === 0) {
        const nextProduct = productBrain.rotate(clock);
        if (nextProduct) await controller.updateContext({ productId: nextProduct.id });
      }
      expect(controller.events.size).toBeLessThanOrEqual(100);
    }
    const growthBytes = process.memoryUsage().heapUsed - beforeHeap;
    expect(growthBytes).toBeLessThan(32 * 1024 * 1024);
    expect(clock).toBe(1_799_000);
    expect(speechCalls).toBe(1_800);
    expect(audioChunks).toBe(1_800);
    expect(controller.current()?.state).toBe("RUNNING");
    expect(records.get("session-test")?.currentProductId).toBeTruthy();
    expect((await controller.stop()).state).toBe("STOPPED");
  });

  it("holds speech while paused, resumes with queue priority, and stops without a duplicate start", async () => {
    let speechCalls = 0;
    const records = new Map<string, LiveSessionSnapshot>();
    const controller = new LiveSessionController({
      kind: "mock", health: async () => "READY", start: async () => {},
      pause: async () => {}, resume: async () => {}, stop: async () => {},
    }, {
      load: async (id) => records.get(id) ?? null,
      save: async (snapshot) => { records.set(snapshot.id, structuredClone(snapshot)); },
    }, { allowMock: true, now: () => 0, newId: () => "session-pause" });
    const actions = new ActionQueue();
    const pipeline = new LivePipeline({
      controller, comments: new CommentEngine(), brain: new RuleBasedLiveBrain(),
      products: new ProductBrain(products), actions,
      voice: {
        async *streamText() { speechCalls += 1; yield new Uint8Array([1]); },
        interrupt: async () => {}, cancel: async () => {},
      },
      presenterAudio: { pushAudioChunk: async () => {} },
    });
    await controller.start({ ownerId: "owner", tiktokAccountId: "account", productIds: [products[0].id], presenterReferenceId: "reference" });
    expect(actions.enqueue({ idempotencyKey: "pause", type: "PAUSE", priority: 0 })).toBe(true);
    expect(actions.enqueue({ idempotencyKey: "speak", type: "SPEAK", priority: 10, payload: { text: "hello" } })).toBe(true);
    expect(await pipeline.handleNextAction()).toMatchObject({ action: "PAUSE" });
    expect(await pipeline.handleNextAction()).toEqual({ type: "NO_ACTION" });
    expect(actions.size).toBe(1);
    expect(actions.enqueue({ idempotencyKey: "resume", type: "RESUME", priority: 0 })).toBe(true);
    expect(await pipeline.handleNextAction()).toMatchObject({ action: "RESUME" });
    expect(await pipeline.handleNextAction()).toMatchObject({ action: "SPEAK" });
    expect(speechCalls).toBe(1);
    expect(actions.enqueue({ idempotencyKey: "stop", type: "STOP", priority: 0 })).toBe(true);
    expect(await pipeline.handleNextAction()).toMatchObject({ action: "STOP" });
    expect(controller.current()?.state).toBe("STOPPED");
  });
});
