export const RECOVERY_BATCH_SIZE = 200;
export const RECOVERY_MAX_SCAN = 10_000;

export async function scanOperationalBatches<T extends { id: string }>(
  fetchPage: (after: string | null, size: number) => Promise<T[]>,
  batchSize = RECOVERY_BATCH_SIZE,
  maxRows = RECOVERY_MAX_SCAN,
) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || !Number.isSafeInteger(maxRows) || maxRows < batchSize) {
    throw new Error("invalid_recovery_scan_bounds");
  }
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    const batch = await fetchPage(after, batchSize);
    if (batch.length > batchSize) throw new Error("operations_scan_batch_oversized");
    if (batch.some((row, index) => !row.id || (index > 0 && row.id <= batch[index - 1].id) || (after !== null && row.id <= after))) {
      throw new Error("operations_scan_cursor_not_advancing");
    }
    rows.push(...batch);
    if (rows.length > maxRows || (rows.length === maxRows && batch.length === batchSize)) throw new Error("operations_scan_limit_reached");
    if (batch.length < batchSize) return rows;
    after = batch[batch.length - 1].id;
  }
}
