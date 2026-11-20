/** Low-priority media reads never enter the session-control FIFO. */
export class PassivePresenterRequests {
  private enabled = false;
  private generation = 0;
  private active = new Set<PendingRead>();
  private pending: PendingRead[] = [];

  constructor(private readonly concurrency = 2, private readonly queueLimit = 20) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 2
      || !Number.isSafeInteger(queueLimit) || queueLimit < 0 || queueLimit > 20) throw new Error("Invalid passive read bounds");
  }

  setEnabled(enabled: boolean): void {
    if (!enabled) { this.suspend(); return; }
    this.enabled = true; this.drain();
  }

  suspend(): void {
    this.enabled = false; this.generation += 1;
    const queued = this.pending; this.pending = [];
    for (const task of [...this.active, ...queued]) task.controller.abort();
  }

  read<T>(operation: (signal: AbortSignal) => Promise<T>, caller?: AbortSignal): Promise<T> {
    if (!this.enabled || caller?.aborted || (this.active.size >= this.concurrency && this.pending.length >= this.queueLimit)) {
      return Promise.reject(new DOMException("Passive read unavailable", "AbortError"));
    }
    const generation = this.generation;
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      let settled = false;
      const clean = () => { controller.signal.removeEventListener("abort", abort); caller?.removeEventListener("abort", cancel); };
      const fail = (error: unknown) => { if (settled) return; settled = true; clean(); reject(error); };
      const abort = () => {
        this.pending = this.pending.filter((candidate) => candidate !== task);
        fail(new DOMException("Passive read cancelled", "AbortError"));
      };
      const cancel = () => controller.abort();
      const task: PendingRead = {
        controller,
        run: async () => {
          try {
            const result = await operation(controller.signal);
            if (controller.signal.aborted || !this.enabled || generation !== this.generation) { abort(); return; }
            if (!settled) { settled = true; clean(); resolve(result); }
          } catch (error) { fail(error); }
          finally { this.active.delete(task); this.drain(); }
        },
      };
      controller.signal.addEventListener("abort", abort, { once: true });
      caller?.addEventListener("abort", cancel, { once: true });
      this.pending.push(task); this.drain();
    });
  }

  private drain(): void {
    while (this.enabled && this.active.size < this.concurrency && this.pending.length) {
      const task = this.pending.shift()!;
      if (task.controller.signal.aborted) continue;
      this.active.add(task); void task.run();
    }
  }
}
interface PendingRead { controller: AbortController; run(): Promise<void> }
