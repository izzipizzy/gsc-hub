import type { Db } from './db';

// host -> site creation date (epoch seconds). GSC has no site date, so the
// hub never derives one: the site_dates table is filled by an external import
// (for example from the sites' repositories). Empty table, empty column.
export function listSiteDates(db: Db): Map<string, number> {
  const rows = db.prepare('SELECT host, created_at FROM site_dates').all() as {
    host: string;
    created_at: number;
  }[];
  return new Map(rows.map((r) => [r.host, r.created_at]));
}
