import type { Db } from './db';

// Sites the user has hidden from the panel. Stored server-side (not localStorage)
// so the bulk submit-all / ai-all log pages — a different origin/page — exclude
// them too. Keyed by accountId|siteUrl to match the panel's keyOf().

export function listHiddenSites(db: Db): string[] {
  const rows = db.prepare('SELECT account_id, site_url FROM hidden_sites').all() as {
    account_id: string;
    site_url: string;
  }[];
  return rows.map((r) => `${r.account_id}|${r.site_url}`);
}

export function addHiddenSite(db: Db, accountId: string, siteUrl: string): void {
  db.prepare('INSERT OR IGNORE INTO hidden_sites (account_id, site_url, added_at) VALUES (?, ?, ?)').run(
    accountId,
    siteUrl,
    Date.now()
  );
}

export function removeHiddenSite(db: Db, accountId: string, siteUrl: string): void {
  db.prepare('DELETE FROM hidden_sites WHERE account_id = ? AND site_url = ?').run(accountId, siteUrl);
}
