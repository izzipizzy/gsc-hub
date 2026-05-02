import { createHash } from 'node:crypto';
import type { Db } from './db';

export interface CachedInspection {
  payload: string;       // JSON string of { results: InspectedUrl[] }
  fetchedAt: number;     // unix seconds
}

export function hashUrls(urls: string[]): string {
  // Sort first so order doesn't change the key — same set of URLs always hashes the same.
  const sorted = [...urls].sort();
  return createHash('sha256').update(sorted.join('\n')).digest('hex');
}

export function getCachedInspection(
  db: Db,
  accountId: string,
  siteUrl: string,
  urlsHash: string,
  ttlSec: number
): CachedInspection | null {
  const row = db
    .prepare(
      `SELECT payload, fetched_at as fetchedAt
       FROM url_inspection_cache
       WHERE account_id = ? AND site_url = ? AND urls_hash = ?
         AND fetched_at > ?`
    )
    .get(accountId, siteUrl, urlsHash, Math.floor(Date.now() / 1000) - ttlSec) as
    | CachedInspection
    | undefined;
  return row ?? null;
}

export function setCachedInspection(
  db: Db,
  accountId: string,
  siteUrl: string,
  urlsHash: string,
  payload: string
): void {
  db.prepare(
    `INSERT INTO url_inspection_cache (account_id, site_url, urls_hash, fetched_at, payload)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, site_url, urls_hash) DO UPDATE SET
       fetched_at = excluded.fetched_at,
       payload    = excluded.payload`
  ).run(accountId, siteUrl, urlsHash, Math.floor(Date.now() / 1000), payload);
}

export function deleteCachedInspection(
  db: Db,
  accountId: string,
  siteUrl: string,
  urlsHash: string
): void {
  db.prepare(
    `DELETE FROM url_inspection_cache WHERE account_id = ? AND site_url = ? AND urls_hash = ?`
  ).run(accountId, siteUrl, urlsHash);
}
