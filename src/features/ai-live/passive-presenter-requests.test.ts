import { describe, expect, it, vi } from "vitest";
import { PassivePresenterRequests } from "./passive-presenter-requests";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("passive presenter reads", () => {
  it("bounds active reads and queued metadata instead of sharing the control FIFO", async () => {
    const pool = new PassivePresenterRequests(1, 1); pool.setEnabled(true);
    const gate = deferred<string>(); const next = vi.fn(async () => "second");
    const first = pool.read(() => gate.promise); const second = pool.read(next);
    await expect(pool.read(async () => "overflow")).rejects.toMatchObject({ name: "AbortError" });
    expect(next).not.toHaveBeenCalled();
    gate.resolve("first"); await expect(first).resolves.toBe("first"); await expect(second).resolves.toBe("second");
    expect(next).toHaveBeenCalledOnce();
  });
  it("Stop/permission loss cancels queued reads immediately and discards late media", async () => {
    const pool = new PassivePresenterRequests(1, 2); pool.setEnabled(true);
    const gate = deferred<string>(); const queuedOperation = vi.fn(async () => "queued");
    let requestSignal: AbortSignal | undefined;
    const active = pool.read((signal) => { requestSignal = signal; return gate.promise; });
    const queued = pool.read(queuedOperation);
    const activeRejected = expect(active).rejects.toMatchObject({ name: "AbortError" });
    const queuedRejected = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    pool.suspend();
    await activeRejected; await queuedRejected;
    expect(requestSignal?.aborted).toBe(true); expect(queuedOperation).not.toHaveBeenCalled();
    gate.resolve("stale owner's image");
    await Promise.resolve();
    await expect(pool.read(async () => "unauthorized")).rejects.toMatchObject({ name: "AbortError" });
    pool.setEnabled(true); await expect(pool.read(async () => "new authorized image")).resolves.toBe("new authorized image");
  });
  it("a caller can remove its queued thumbnail without cancelling other reads", async () => {
    const pool = new PassivePresenterRequests(1, 1); pool.setEnabled(true);
    const gate = deferred<string>(); const first = pool.read(() => gate.promise);
    const caller = new AbortController(); const operation = vi.fn(async () => "cancelled");
    const queued = pool.read(operation, caller.signal);
    const rejected = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    caller.abort(); await rejected; expect(operation).not.toHaveBeenCalled();
    gate.resolve("kept"); await expect(first).resolves.toBe("kept");
  });
});
