import type { DurableWork, WorkKind, WorkState } from "./contracts";

export interface WorkOutcome { state: WorkState; reason: string; retryAt?: string; providerJobId?: string; publishingQueueId?: string; creativeProjectId?: string; }
export interface WorkerStore {
  claim(kind: WorkKind, token: string): Promise<DurableWork | null>;
  finish(work: DurableWork, outcome: WorkOutcome): Promise<boolean>;
}
export interface WorkerPorts {
  generate(work: DurableWork): Promise<WorkOutcome>;
  publish(work: DurableWork): Promise<WorkOutcome>;
  reconcile(work: DurableWork): Promise<WorkOutcome>;
}
export function retryAt(attempt: number, now = Date.now()) {
  return new Date(now + Math.min(3600, 30 * 2 ** Math.min(attempt, 7)) * 1000).toISOString();
}
/** Bounded pool tick. Resource concurrency bounds do not limit the number of accounts. */
export async function runWorkerPool(store: WorkerStore, ports: WorkerPorts, options: {
  kind: WorkKind; token: () => string; batch: number; concurrency: number; now?: () => number; deadlineAt?: number;
}) {
  if (!Number.isSafeInteger(options.batch) || options.batch < 1 || !Number.isSafeInteger(options.concurrency) || options.concurrency < 1) throw new Error("INVALID_WORKER_BOUNDS");
  let index = 0, claimed = 0, completed = 0, fenced = 0;
  await Promise.all(Array.from({ length: options.concurrency }, async () => {
    while (index++ < options.batch) {
      if (options.deadlineAt !== undefined && (options.now?.() ?? Date.now()) >= options.deadlineAt) break;
      const work = await store.claim(options.kind, options.token()); if (!work) break; claimed++;
      let result: WorkOutcome;
      try { result = await ports[options.kind === "GENERATE" ? "generate" : options.kind === "PUBLISH" ? "publish" : "reconcile"](work); }
      catch { result = { state: work.attempts >= 8 ? "REVIEW_REQUIRED" : "WAITING", reason: work.attempts >= 8 ? "RECOVERY_REQUIRED" : "RETRY", retryAt: retryAt(work.attempts, options.now?.()) }; }
      if (await store.finish(work, result)) completed++; else fenced++;
    }
  }));
  return { claimed, completed, fenced };
}
