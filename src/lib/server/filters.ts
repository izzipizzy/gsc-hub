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

/**
 * Один способ прятать мусорные запросы на всех экранах. Раньше фильтры знала
 * только таблица сайтов и экспорт, поэтому в striking сайта лезли `site:`-
 * операторы — это не ключи, по ним ничего не покупают и не оптимизируют.
 */
export function queryHidden(query: string, patterns: string[]): boolean {
  const q = query.toLowerCase();
  return patterns.some((p) => q.includes(p));
}

export function filterPatterns(db: Db): string[] {
  return listQueryFilters(db).map((f) => f.pattern.toLowerCase());
}

export function dropFilteredQueries<T>(rows: T[], patterns: string[], pick: (row: T) => string): T[] {
  if (patterns.length === 0) return rows;
  return rows.filter((r) => !queryHidden(pick(r), patterns));
}
