// External site-health probes: SSL (direct TLS handshake), Google Safe Browsing, and Core Web
// Vitals via PageSpeed Insights. URL-based public checks — NOT account-scoped: one API key
// covers every site. Each check is independent and optional (missing key → skipped); errors are
// isolated so one failing check never sinks the others. Results are cached one row per site.

import tls from 'node:tls';
import { env } from '$env/dynamic/private';
import type { Db } from './db';
import { siteToHost } from './bing';

export type SslResult =
  | { ok: true; valid: boolean; daysLeft: number; issuer: string; grade: string }
  | { error: string };

export type SafeBrowsingResult =
  | { skipped: true }
  | { ok: true; safe: boolean; threats: string[] }
  | { error: string };

export type CwvResult =
  | { skipped: true }
  | { ok: true; score: number; lcpMs: number; cls: number; tbtMs: number }
  | { error: string };

export interface HealthData {
  url: string;
  ssl: SslResult;
  safeBrowsing: SafeBrowsingResult;
  cwv: CwvResult;
}

// ─── SSL ──────────────────────────────────────────────────────────────────────
function checkSsl(host: string): Promise<SslResult> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: SslResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || !cert.valid_to) {
        done({ error: 'no certificate' });
        return;
      }
      const expiry = new Date(cert.valid_to).getTime();
      const daysLeft = Math.floor((expiry - Date.now()) / 86_400_000);
      const issuer = String(cert.issuer?.O || cert.issuer?.CN || 'unknown');
      const valid = daysLeft > 0;
      const grade = !valid ? 'F' : daysLeft > 30 ? 'A' : daysLeft > 7 ? 'B' : 'C';
      done({ ok: true, valid, daysLeft, issuer, grade });
    });
    socket.on('error', (e) => done({ error: String((e as Error).message).slice(0, 120) }));
    socket.on('timeout', () => {
      socket.destroy();
      done({ error: 'timeout' });
    });
  });
}

// ─── Safe Browsing v4 ─────────────────────────────────────────────────────────
async function checkSafeBrowsing(url: string): Promise<SafeBrowsingResult> {
  const key = env.GOOGLE_SAFE_BROWSING_KEY;
  if (!key) return { skipped: true };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'gsc-hub', clientVersion: '1.0' },
          threatInfo: {
            threatTypes: [
              'MALWARE',
              'SOCIAL_ENGINEERING',
              'UNWANTED_SOFTWARE',
              'POTENTIALLY_HARMFUL_APPLICATION'
            ],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url }]
          }
        })
      }
    );
    if (!res.ok) return { error: `safebrowsing ${res.status}` };
    const data = (await res.json()) as { matches?: { threatType: string }[] };
    const threats = (data.matches ?? []).map((m) => m.threatType);
    return { ok: true, safe: threats.length === 0, threats };
  } catch (e) {
    return { error: (e as Error).name === 'AbortError' ? 'timeout' : String((e as Error).message).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Core Web Vitals via PageSpeed Insights (mobile) ──────────────────────────
async function checkCwv(url: string): Promise<CwvResult> {
  const key = env.PAGESPEED_KEY;
  if (!key) return { skipped: true };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const qs = new URLSearchParams({
      url,
      strategy: 'mobile',
      category: 'performance',
      key
    });
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`, {
      signal: ctrl.signal
    });
    if (!res.ok) return { error: `pagespeed ${res.status}` };
    const data = (await res.json()) as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number } };
        audits?: Record<string, { numericValue?: number }>;
      };
    };
    const lr = data.lighthouseResult;
    if (!lr) return { error: 'no lighthouse result' };
    const audits = lr.audits ?? {};
    return {
      ok: true,
      score: lr.categories?.performance?.score ?? 0,
      lcpMs: audits['largest-contentful-paint']?.numericValue ?? 0,
      cls: audits['cumulative-layout-shift']?.numericValue ?? 0,
      tbtMs: audits['total-blocking-time']?.numericValue ?? 0
    };
  } catch (e) {
    return { error: (e as Error).name === 'AbortError' ? 'timeout' : String((e as Error).message).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Orchestration + cache ────────────────────────────────────────────────────
export async function runHealth(siteUrl: string): Promise<HealthData> {
  const host = siteToHost(siteUrl);
  const url = `https://${host}/`;
  const [ssl, safeBrowsing, cwv] = await Promise.all([
    checkSsl(host),
    checkSafeBrowsing(url),
    checkCwv(url)
  ]);
  return { url, ssl, safeBrowsing, cwv };
}

export interface CachedHealth {
  data: HealthData;
  checkedAt: number;
}

export function getCachedHealth(db: Db, siteUrl: string): CachedHealth | null {
  const row = db
    .prepare('SELECT data, checked_at FROM site_health WHERE site_url = ?')
    .get(siteUrl) as { data: string; checked_at: number } | undefined;
  if (!row) return null;
  try {
    return { data: JSON.parse(row.data) as HealthData, checkedAt: row.checked_at };
  } catch {
    return null;
  }
}

export function saveHealth(db: Db, siteUrl: string, data: HealthData): number {
  const checkedAt = Date.now();
  db.prepare(
    `INSERT INTO site_health (site_url, data, checked_at)
     VALUES (?, ?, ?)
     ON CONFLICT(site_url) DO UPDATE SET data = excluded.data, checked_at = excluded.checked_at`
  ).run(siteUrl, JSON.stringify(data), checkedAt);
  return checkedAt;
}
