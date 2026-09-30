import { describe, expect, it } from "vitest";
import { ActionQueue, CommentEngine, ProductBrain, RuleBasedLiveBrain } from "./index";
import type { LiveComment, LiveProduct } from "./index";

const product = (id: string, status: LiveProduct["status"] = "available"): LiveProduct => ({
  id,
  title: `Product ${id}`,
  status,
});

describe("CommentEngine", () => {
  it("normalizes, prioritizes questions, and rejects duplicates and spam without growing the queue", () => {
    let time = 1_000;
    const engine = new CommentEngine({ now: () => time, cooldownMs: 1_000, maxQueue: 2 });
    const first = { commentId: "a", viewerId: "one", text: "  สวัสดี   ค่ะ  ", createdAtMs: time };
    expect(engine.ingest(first)).toMatchObject({ accepted: true, comment: { text: "สวัสดี ค่ะ", language: "th" } });
    expect(engine.ingest(first)).toEqual({ accepted: false, reason: "DUPLICATE" });
    expect(engine.ingest({ ...first, commentId: "b", text: "https://spam.example" })).toEqual({ accepted: false, reason: "SPAM" });
    expect(engine.ingest({ ...first, commentId: "c", text: "มีราคาเท่าไหร่?" })).toEqual({ accepted: false, reason: "COOLDOWN" });
    time += 1_000;
    expect(engine.ingest({ ...first, commentId: "c", text: "มีราคาเท่าไหร่?", createdAtMs: time }).accepted).toBe(true);
    expect(engine.next()?.commentId).toBe("c");
    expect(engine.next()?.commentId).toBe("a");
    expect(engine.next()).toBeNull();
  });

  it("bounds backlog and duplicate memory during prolonged intake", () => {
    let time = 0;
    const engine = new CommentEngine({ now: () => time, maxQueue: 3, maxSeen: 6, cooldownMs: 0 });
    for (let index = 0; index < 2_000; index++) {
      time += 1_000;
      engine.ingest({ commentId: String(index), viewerId: String(index), text: `Question ${index}?`, createdAtMs: time });
      expect(engine.size).toBeLessThanOrEqual(3);
      engine.next();
    }
    expect(engine.size).toBe(0);
  });

  it("admits urgent purchase questions over a full low-priority backlog", () => {
    const engine = new CommentEngine({ now: () => 1_000, cooldownMs: 0, maxQueue: 2 });
    engine.ingest({ commentId: "a", viewerId: "one", text: "สวัสดี", createdAtMs: 1_000 });
    engine.ingest({ commentId: "b", viewerId: "two", text: "hello", createdAtMs: 1_000 });
    expect(engine.ingest({ commentId: "c", viewerId: "three", text: "สั่งซื้อได้ไหม?", createdAtMs: 1_000 }).accepted).toBe(true);
    expect(engine.size).toBe(2);
    expect(engine.next()?.commentId).toBe("c");
  });
});

describe("RuleBasedLiveBrain", () => {
  const comment: LiveComment = {
    commentId: "c1", viewerId: "v1", text: "ราคาเท่าไหร่?", normalizedText: "ราคาเท่าไหร่?",
    language: "th", priority: 70, createdAtMs: 1_000,
  };

  it("reports price only from a verified current product record", async () => {
    const brain = new RuleBasedLiveBrain();
    const unknown = await brain.decide({ comment, product: product("a") });
    expect(unknown.reply).toContain("ยังไม่มีราคา");
    expect(unknown.intent).toBe("PRICE");
    expect(unknown.suggestedActions.map((item) => item.type)).toEqual(["SHOW_PRODUCT", "SPEAK"]);
    const known = await brain.decide({ comment, product: { ...product("a"), current_price: 199, currency: "THB" } });
    expect(known.reply).toContain("199.00 บาท");
    const restricted = await brain.decide({ comment, product: { ...product("a"), current_price: 199, currency: "THB" }, sellerRules: { avoidPriceClaims: true } });
    expect(restricted.reply).not.toContain("199.00");
  });

  it("does not claim an unavailable product can be purchased", async () => {
    const brain = new RuleBasedLiveBrain();
    const answer = await brain.decide({ comment: { ...comment, text: "ซื้อ", normalizedText: "ซื้อ" }, product: product("a", "unavailable") });
    expect(answer.reply).toContain("ยังไม่มีข้อมูลสินค้าที่พร้อมแนะนำ");
    expect(answer.suggestedActions).toEqual([{ type: "SPEAK", priority: 70 }]);
  });
});

describe("ProductBrain", () => {
  it("rotates available products without immediate repetition and spaces CTAs", () => {
    let time = 0;
    const brain = new ProductBrain([product("a"), product("x", "discontinued"), product("b"), product("c")], {
      now: () => time, minDwellMs: 60_000, ctaCooldownMs: 120_000,
    });
    expect(brain.current()?.id).toBe("a");
    expect(brain.rotate()).toBeNull();
    time = 60_000;
    expect(brain.rotate()?.id).toBe("b");
    expect(brain.takeCtaDue()).toBe(false);
    time = 120_000;
    expect(brain.rotate()?.id).toBe("c");
    time = 240_000;
    expect(brain.takeCtaDue()).toBe(true);
    expect(brain.takeCtaDue()).toBe(false);
    expect(brain.rotate()?.id).toBe("a");
    expect(brain.select("x")).toBeNull();
  });

  it("preserves the selected product when source records refresh", () => {
    const brain = new ProductBrain([product("a"), product("b")]);
    brain.select("b");
    brain.setProducts([product("b"), product("c")]);
    expect(brain.current()?.id).toBe("b");
    brain.setProducts([product("c")]);
    expect(brain.current()?.id).toBe("c");
  });
});

describe("ActionQueue", () => {
  it("prioritizes stop, preserves FIFO ties, cancels queued actions, and deduplicates retries", () => {
    const queue = new ActionQueue();
    expect(queue.enqueue({ idempotencyKey: "speak:1", type: "SPEAK", priority: 20 })).toBe(true);
    expect(queue.enqueue({ idempotencyKey: "show:1", type: "SHOW_PRODUCT", priority: 20 })).toBe(true);
    expect(queue.enqueue({ idempotencyKey: "stop:1", type: "STOP", priority: 1 })).toBe(true);
    expect(queue.enqueue({ idempotencyKey: "speak:1", type: "SPEAK", priority: 20 })).toBe(false);
    expect(queue.dequeue()?.type).toBe("STOP");
    expect(queue.cancel("show:1")).toBe(true);
    expect(queue.dequeue()?.idempotencyKey).toBe("speak:1");
    expect(queue.enqueue({ idempotencyKey: "speak:1", type: "SPEAK", priority: 20 })).toBe(false);
    expect(queue.dequeue()).toBeNull();
  });

  it("bounds backlog and releases old idempotency keys after the retention window", () => {
    let time = 0;
    const queue = new ActionQueue({ now: () => time, maxSize: 2, maxSeen: 4, dedupeWindowMs: 1_000 });
    expect(queue.enqueue({ idempotencyKey: "a", type: "SPEAK", priority: 1 })).toBe(true);
    expect(queue.enqueue({ idempotencyKey: "b", type: "SPEAK", priority: 1 })).toBe(true);
    expect(queue.enqueue({ idempotencyKey: "c", type: "SPEAK", priority: 1 })).toBe(false);
    queue.dequeue();
    time += 1_001;
    expect(queue.enqueue({ idempotencyKey: "a", type: "SPEAK", priority: 1 })).toBe(true);
    expect(queue.size).toBe(2);
  });
});
