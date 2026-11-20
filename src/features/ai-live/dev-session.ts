export type DevReleaseState = { status?: string; resources_released?: boolean };

/** Stop acknowledgement is not resource release: a CPU kernel may still be running. */
export async function waitForDevRelease<T extends DevReleaseState>(initial: T, read: () => Promise<T>,
  options: { now?: () => number; wait?: () => Promise<void>; timeoutMs?: number } = {}): Promise<T> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 500)));
  const deadline = now() + (options.timeoutMs ?? 60_000);
  let current = initial;
  while (!current.resources_released || !['STOPPED', 'FAILED'].includes(current.status ?? '')) {
    if (now() >= deadline) throw new Error('Presenter ยังคืนทรัพยากรไม่ครบ กรุณากด Stop เพื่อตรวจอีกครั้ง');
    await wait();
    current = await read();
  }
  return current;
}
