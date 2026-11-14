// Server-side paging for the portfolio pages: at 10,000 domains the browser
// gets one page of cards, never the whole portfolio.

export const PAGE_SIZE = 100;

export function parsePage(raw: string | null): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
}

/** Slice of an already sorted list. A page past the end lands on the last one. */
export function paginate<T>(all: T[], page: number, size = PAGE_SIZE): Paged<T> {
  const pageCount = Math.max(1, Math.ceil(all.length / size));
  const p = Math.min(Math.max(1, page), pageCount);
  return { items: all.slice((p - 1) * size, p * size), page: p, pageCount, total: all.length };
}
