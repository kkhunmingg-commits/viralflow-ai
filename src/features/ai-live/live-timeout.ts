/** Bounds an external operation and releases timer/listener state on every completion path. */
export async function liveDeadline<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal, reason = "live_service_timeout"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        if (signal?.aborted) { reject(new Error("speech_interrupted")); return; }
        onAbort = () => reject(new Error("speech_interrupted"));
        signal?.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => reject(new Error(reason)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

export async function liveWaitTick<T>(promise: Promise<T>, delayMs: number): Promise<{ ready: true; value: T } | { ready: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ ready: true as const, value })),
      new Promise<{ ready: false }>((resolve) => { timer = setTimeout(() => resolve({ ready: false }), delayMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
