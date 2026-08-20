// Per-site branded-keyword overrides. Config, not GSC data — one row per site.
// Default is derived from the domain; the detail page can override it.

import type { Db } from './db';
import { siteToHost } from './bing';
import { getDomainWithoutSuffix } from 'tldts';

// "https://www.example.com/" | "sc-domain:example.co.uk" → "example"
export function defaultBrandFromDomain(siteUrl: string): string {
  const host = siteToHost(siteUrl).replace(/^www\./, '');
  const registrableLabel = getDomainWithoutSuffix(host);
  if (registrableLabel) return registrableLabel;
  const parts = host.split('.').filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] ?? host;
}

export function getBrandedTerms(db: Db, siteUrl: string): string[] {
  const row = db
    .prepare('SELECT terms FROM site_branded_keywords WHERE site_url = ?')
    .get(siteUrl) as { terms: string } | undefined;
  if (row) {
    try {
      const arr = JSON.parse(row.terms);
      if (Array.isArray(arr) && arr.length) return arr.map(String);
    } catch {
      /* fall through to default */
    }
  }
  return [defaultBrandFromDomain(siteUrl)];
}

// Persist an override. An empty list clears it (reverts to the domain default).
export function setBrandedTerms(db: Db, siteUrl: string, terms: string[]): void {
  const clean = terms.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) {
    db.prepare('DELETE FROM site_branded_keywords WHERE site_url = ?').run(siteUrl);
    return;
  }
  db.prepare(
    `INSERT INTO site_branded_keywords (site_url, terms, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(site_url) DO UPDATE SET terms = excluded.terms, updated_at = excluded.updated_at`
  ).run(siteUrl, JSON.stringify(clean), Date.now());
}
