export const STRIKING_SORT_KEYS = ['query', 'page', 'position', 'serp', 'impressions', 'clicks', 'ctr', 'bought'] as const;
export type StrikingSortKey = typeof STRIKING_SORT_KEYS[number];
export type SortDirection = 'asc' | 'desc';

interface Row {
  query: string; page: string; position: number; impressions: number; clicks: number; ctr: number;
}

export function sortStriking<T extends Row>(
  rows: T[], key: StrikingSortKey, dir: SortDirection,
  serp: (query: string) => number | null, bought: (page: string, query: string) => number
): T[] {
  const value = (r: T): string | number | null => key === 'serp' ? serp(r.query)
    : key === 'bought' ? bought(r.page, r.query) : r[key];
  const absent = (v: string | number | null) => v === null || (typeof v === 'number' && !Number.isFinite(v));
  return [...rows].sort((a, b) => {
    const x = value(a), y = value(b);
    // Missing/unmeasured SERP positions stay last in either direction; zero is valid.
    if (absent(x) !== absent(y)) return absent(x) ? 1 : -1;
    const cmp = absent(x) ? 0 : typeof x === 'string' && typeof y === 'string'
      ? x.localeCompare(y) : Number(x) - Number(y);
    return (dir === 'asc' ? cmp : -cmp) || a.query.localeCompare(b.query) || a.page.localeCompare(b.page);
  });
}
