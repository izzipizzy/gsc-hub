import type { Db } from './db';

// host -> site creation date (epoch seconds), synced from git.local repos by
// scripts/sync-site-dates.py. gsc-hub never derives this itself — GSC has no
// site date, so the repo's created_at is the source of truth.
export function listSiteDates(db: Db): Map<string, number> {
  const rows = db.prepare('SELECT host, created_at FROM site_dates').all() as {
    host: string;
    created_at: number;
  }[];
  return new Map(rows.map((r) => [r.host, r.created_at]));
}
