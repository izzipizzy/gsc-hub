import { MAGIC_PROVIDERS } from './magiclinks-providers';
import type { Db } from './db';
import type { checkSummary } from './backlink-monitor';
export type BacklinkSummary = ReturnType<typeof checkSummary>;
export type BacklinkScope = string;
export type BacklinkTotals = Record<string, BacklinkSummary>;
export interface BacklinkSnapshot { at: number; jobId: number | null; totals: BacklinkTotals }
export interface BacklinkDashboard { totals: BacklinkTotals; history: BacklinkSnapshot[]; at: number; providers: { id: string; name: string }[] }

export function saveBacklinkSnapshot(database: Db, totals: BacklinkTotals, jobId: number | null, at = Date.now()) {
  database.prepare('INSERT OR IGNORE INTO backlink_snapshots (job_id, captured_at, payload) VALUES (?, ?, ?)')
    .run(jobId, at, JSON.stringify(totals));
}
export function readBacklinkDashboard(database: Db, totals: BacklinkTotals, now = Date.now()): BacklinkDashboard {
  // Start with the state actually observed now, rather than inventing past counts.
  database.transaction(() => {
    if (!database.prepare('SELECT 1 FROM backlink_snapshots LIMIT 1').get()) saveBacklinkSnapshot(database, totals, null, now);
  })();
  const rows = database.prepare('SELECT * FROM backlink_snapshots ORDER BY captured_at DESC, id DESC LIMIT 180').all() as {
    captured_at: number; job_id: number | null; payload: string;
  }[];
  return { at: now, totals, providers: Object.keys(totals).filter((id) => id !== 'all').map((id) => ({ id, name: MAGIC_PROVIDERS.find((p) => p.id === id)?.name ?? id })), history: rows.reverse().map((r) => ({ at: r.captured_at, jobId: r.job_id, totals: JSON.parse(r.payload) })) };
}
