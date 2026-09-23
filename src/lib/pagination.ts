export const OPERATIONAL_PAGE_SIZE = 50;
export const MAX_OPERATIONAL_PAGE = 1000;

export function parseOperationalPage(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^[1-9]\d*$/.test(raw)) return 1;
  return Math.min(Number(raw), MAX_OPERATIONAL_PAGE);
}

export function operationalWindow(page: number, size = OPERATIONAL_PAGE_SIZE) {
  const safePage = Number.isSafeInteger(page) ? Math.min(MAX_OPERATIONAL_PAGE, Math.max(1, page)) : 1;
  const from = (safePage - 1) * size;
  return { from, to: from + size, size };
}

export function operationalPage<T>(rows: T[], page: number, size = OPERATIONAL_PAGE_SIZE) {
  return { items: rows.slice(0, size), page, hasMore: rows.length > size && page < MAX_OPERATIONAL_PAGE };
}
