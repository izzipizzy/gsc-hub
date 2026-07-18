import type { Db } from './db';

export interface QueryFilter {
  id: number;
  pattern: string;
}

// Substrings (case-insensitive) — a query is hidden if it contains any pattern.
export function listQueryFilters(db: Db): QueryFilter[] {
  return db
    .prepare('SELECT id, pattern FROM query_filters ORDER BY pattern')
    .all() as QueryFilter[];
}

export function addQueryFilter(db: Db, pattern: string): QueryFilter {
  const p = pattern.trim();
  if (!p) throw new Error('empty pattern');
  db.prepare('INSERT OR IGNORE INTO query_filters (pattern, added_at) VALUES (?, ?)').run(p, Date.now());
  return db.prepare('SELECT id, pattern FROM query_filters WHERE pattern = ?').get(p) as QueryFilter;
}

export function removeQueryFilter(db: Db, id: number): void {
  db.prepare('DELETE FROM query_filters WHERE id = ?').run(id);
}
