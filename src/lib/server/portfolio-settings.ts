// How many rows per site the Top queries / Top pages pass fetches.
//
// More rows per site means rare queries survive into the portfolio table and
// its filters; it also means memory: every row of every site is held between
// passes. So the default follows the portfolio — a small one gets the full
// 1,000 query rows per site, 10,000 domains get 250 — and Settings can pin a
// number either way.

import type { Db } from './db';
import { clearConfigValue, configSource, getConfigValue, setConfigValue, type ConfigKey } from './config';

/** Search Console's ceiling for one searchAnalytics response. */
export const GSC_MAX_ROW_LIMIT = 25_000;

/** Query rows the process holds across all sites when the setting is "auto". */
export const QUERY_ROW_BUDGET = 2_500_000;
export const AUTO_QUERY_ROWS = { min: 250, max: 1000 };
export const AUTO_PAGE_ROWS = 200;

export type TopRowsKind = 'queries' | 'pages';
const KEYS: Record<TopRowsKind, ConfigKey> = { queries: 'TOP_QUERY_ROWS', pages: 'TOP_PAGE_ROWS' };

export function autoRows(kind: TopRowsKind, sites: number): number {
  if (kind === 'pages') return AUTO_PAGE_ROWS;
  const share = Math.floor(QUERY_ROW_BUDGET / Math.max(1, sites));
  return Math.min(AUTO_QUERY_ROWS.max, Math.max(AUTO_QUERY_ROWS.min, share));
}

function parseRows(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= GSC_MAX_ROW_LIMIT ? n : null;
}

export interface TopRowsSetting {
  kind: TopRowsKind;
  /** Pinned value, or null for "auto". */
  pinned: number | null;
  /** What a pass over `sites` sites uses now. */
  effective: number;
  auto: number;
  source: 'env' | 'db' | 'none';
}

export function topRowsSetting(db: Db, kind: TopRowsKind, sites: number): TopRowsSetting {
  const pinned = parseRows(getConfigValue(db, KEYS[kind]));
  const auto = autoRows(kind, sites);
  return { kind, pinned, effective: pinned ?? auto, auto, source: configSource(db, KEYS[kind]) };
}

/** Empty value goes back to auto. Throws on anything else that is not 1..25000. */
export function saveTopRows(db: Db, kind: TopRowsKind, raw: string): void {
  if (configSource(db, KEYS[kind]) === 'env') throw new Error('Значение задано в окружении сервера');
  if (raw.trim() === '') return clearConfigValue(db, KEYS[kind]);
  const n = parseRows(raw);
  if (n === null) throw new Error(`Укажи целое число от 1 до ${GSC_MAX_ROW_LIMIT} или оставь пустым для авто`);
  setConfigValue(db, KEYS[kind], String(n));
}
