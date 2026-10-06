import type { Db } from './db';
import { siteHostname, type UrlExclusion } from '../utils/url-filters';

export function listUrlExclusions(db: Db, site: string): UrlExclusion[] {
  return db.prepare('SELECT id, pattern, kind FROM site_url_exclusions WHERE site_host = ? ORDER BY id')
    .all(siteHostname(site)) as UrlExclusion[];
}

export function addUrlExclusion(db: Db, site: string, pattern: string, kind: UrlExclusion['kind']): void {
  const value = pattern.trim();
  if (!value || value.length > 2000) throw new Error('Маска должна содержать от 1 до 2000 символов');
  db.prepare('INSERT OR IGNORE INTO site_url_exclusions (site_host, pattern, kind) VALUES (?, ?, ?)')
    .run(siteHostname(site), value, kind);
}

export function removeUrlExclusion(db: Db, site: string, id: number): void {
  db.prepare('DELETE FROM site_url_exclusions WHERE site_host = ? AND id = ?').run(siteHostname(site), id);
}
