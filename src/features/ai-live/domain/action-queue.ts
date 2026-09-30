import type { LiveAction } from "./types";

export interface ActionQueueOptions {
  now?: () => number;
  maxSize?: number;
  dedupeWindowMs?: number;
  maxSeen?: number;
}

interface QueuedAction { action: LiveAction; sequence: number }
const allowedActions = new Set<LiveAction["type"]>([
  "SPEAK", "SWITCH_PRODUCT", "SHOW_PRODUCT", "PAUSE", "RESUME", "STOP",
]);

/** Bounded priority queue with idempotency across enqueue/dequeue retries. */
export class ActionQueue {
  private readonly now: () => number;
  private readonly maxSize: number;
  private readonly dedupeWindowMs: number;
  private readonly maxSeen: number;
  private readonly seen = new Map<string, number>();
  private queue: QueuedAction[] = [];
  private sequence = 0;

  constructor(options: ActionQueueOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxSize = Math.max(1, options.maxSize ?? 100);
    this.dedupeWindowMs = Math.max(1_000, options.dedupeWindowMs ?? 60 * 60_000);
    this.maxSeen = Math.max(this.maxSize * 2, options.maxSeen ?? 2_000);
  }

  get size(): number { return this.queue.length; }

  enqueue(action: LiveAction): boolean {
    const now = this.now();
    this.prune(now);
    if (!action.idempotencyKey?.trim() || action.idempotencyKey.length > 256
      || !allowedActions.has(action.type)
      || !Number.isFinite(action.priority) || action.priority < 0 || action.priority > 100
      || this.seen.has(action.idempotencyKey) || this.queue.length >= this.maxSize) return false;
    const priority = action.type === "STOP" ? 100
      : action.type === "PAUSE" ? Math.max(90, action.priority) : action.priority;
    this.queue.push({ action: { ...action, priority }, sequence: this.sequence++ });
    this.seen.set(action.idempotencyKey, now);
    this.prune(now);
    return true;
  }

  dequeue(eligible: (action: LiveAction) => boolean = () => true): LiveAction | null {
    if (!this.queue.length) return null;
    let best = -1;
    for (let index = 0; index < this.queue.length; index++) {
      const candidate = this.queue[index];
      if (!eligible(candidate.action)) continue;
      if (best < 0) { best = index; continue; }
      const current = this.queue[best];
      if (candidate.action.priority > current.action.priority
        || (candidate.action.priority === current.action.priority && candidate.sequence < current.sequence)) best = index;
    }
    if (best < 0) return null;
    return this.queue.splice(best, 1)[0].action;
  }

  cancel(idempotencyKey: string): boolean {
    const index = this.queue.findIndex((item) => item.action.idempotencyKey === idempotencyKey);
    if (index < 0) return false;
    this.queue.splice(index, 1);
    return true;
  }

  clear(): void { this.queue = []; }

  private prune(now: number): void {
    const queuedKeys = new Set(this.queue.map((item) => item.action.idempotencyKey));
    for (const [key, seenAt] of this.seen) {
      if (!queuedKeys.has(key) && now - seenAt >= this.dedupeWindowMs) this.seen.delete(key);
    }
    for (const key of this.seen.keys()) {
      if (this.seen.size <= this.maxSeen) break;
      if (!queuedKeys.has(key)) this.seen.delete(key);
    }
  }
}
