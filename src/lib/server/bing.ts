import { env as privateEnv } from '$env/dynamic/private';

const BASE = 'https://ssl.bing.com/webmaster/api.svc/json';

function apiKey(): string {
  const k = privateEnv.BING_API_KEY;
  if (!k) throw new Error('BING_API_KEY not set in .env');
  return k;
}

// Bing identifies a site by its URL form, not the GSC sc-domain: prefix.
export function siteToUrl(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) return `https://${siteUrl.slice('sc-domain:'.length)}/`;
  return siteUrl;
}

export function siteToHost(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) return siteUrl.slice('sc-domain:'.length);
  return new URL(siteUrl).host;
}

// GET a read method of the Bing Webmaster JSON API and return its `d` payload.
async function bingGet<T>(method: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ apikey: apiKey(), ...params });
  const res = await fetch(`${BASE}/${method}?${qs}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`Bing ${method} ${res.status}: ${text.slice(0, 200)}`);
  return (JSON.parse(text).d ?? null) as T;
}

export interface BingTraffic {
  clicks: number;
  impressions: number;
}

export interface BingQuery {
  host: string;
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface BingData {
  traffic: Map<string, BingTraffic>; // host -> recent site-total clicks/impressions
  queries: BingQuery[]; // top queries per site
}

// Concurrency-limited map — Bing throttles bursts, so cap parallel calls.
async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// One fan-out over all verified Bing sites: per site, GetRankAndTrafficStats (site
// totals for the columns) + GetQueryStats (top queries for the keys list), both
// concurrency-limited. Best-effort per site. The API returns query stats as a time
// series (a query repeats per day) → aggregate by query, impression-weighted pos,
// drop `site:` operator noise, keep top `perSiteLimit` by impressions.
async function refreshBing(perSiteLimit = 200): Promise<BingData> {
  const traffic = new Map<string, BingTraffic>();
  const queries: BingQuery[] = [];
  let verified: { host: string; url: string }[];
  try {
    const sites = await bingGet<{ Url: string }[]>('GetUserSites');
    verified = (sites ?? []).map((s) => ({ host: new URL(s.Url).host, url: s.Url }));
  } catch {
    return { traffic, queries };
  }
  await mapPool(verified, 4, async ({ host, url }) => {
    try {
      const rows = await bingGet<{ Impressions: number; Clicks: number }[]>('GetRankAndTrafficStats', { siteUrl: url });
      let clicks = 0;
      let impressions = 0;
      for (const r of rows ?? []) {
        clicks += r.Clicks || 0;
        impressions += r.Impressions || 0;
      }
      traffic.set(host, { clicks, impressions });
    } catch {
      // skip traffic for this site
    }
    try {
      const rows = await bingGet<
        { Query: string; Impressions: number; Clicks: number; AvgImpressionPosition: number }[]
      >('GetQueryStats', { siteUrl: url });
      const agg = new Map<string, { clicks: number; impressions: number; posW: number; w: number }>();
      for (const r of rows ?? []) {
        const q = (r.Query ?? '').trim();
        if (!q || q.startsWith('site:')) continue;
        const a = agg.get(q) ?? { clicks: 0, impressions: 0, posW: 0, w: 0 };
        a.clicks += r.Clicks || 0;
        a.impressions += r.Impressions || 0;
        a.posW += (r.AvgImpressionPosition || 0) * (r.Impressions || 0);
        a.w += r.Impressions || 0;
        agg.set(q, a);
      }
      const list = [...agg.entries()]
        .map(([query, a]) => ({ host, query, clicks: a.clicks, impressions: a.impressions, position: a.w > 0 ? a.posW / a.w : 0 }))
        .sort((x, y) => y.impressions - x.impressions)
        .slice(0, perSiteLimit);
      queries.push(...list);
    } catch {
      // skip queries for this site
    }
  });
  return { traffic, queries };
}

// Bing throttles aggressively (ErrorCode 4 "ThrottleUser"), so the ~100-call
// fan-out must NOT run on every page load. Cache it process-wide: serve cached
// data for BING_TTL_MS; on a fresh miss run one refresh (concurrent page loads
// share it via the in-flight promise). A failed/empty refresh is cached only
// briefly so we retry soon without hammering. Bing data moves slowly (~2-week
// window), so tens-of-minutes staleness is fine.
const BING_TTL_MS = 30 * 60 * 1000;
const BING_FAIL_TTL_MS = 2 * 60 * 1000;
const EMPTY_BING: BingData = { traffic: new Map(), queries: [] };
let bingCache: { at: number; ttl: number; data: BingData } | null = null;
let bingInflight: Promise<BingData> | null = null;

export async function getBing(): Promise<BingData> {
  const fresh = bingCache && Date.now() - bingCache.at < bingCache.ttl;
  if (fresh) return bingCache!.data;
  // Stale or cold: start a refresh (unless one is already running).
  if (!bingInflight) {
    bingInflight = refreshBing()
      .then((data) => {
        const ttl = data.traffic.size > 0 || data.queries.length > 0 ? BING_TTL_MS : BING_FAIL_TTL_MS;
        bingCache = { at: Date.now(), ttl, data };
        return data;
      })
      .catch(() => bingCache?.data ?? EMPTY_BING)
      .finally(() => {
        bingInflight = null;
      });
  }
  // Stale-while-revalidate: serve stale data now, let the refresh finish in the
  // background. Only a cold start (no cache at all) waits for the fan-out.
  if (bingCache) return bingCache.data;
  return bingInflight;
}

// Submit a sitemap to Bing Webmaster (the API method is SubmitFeed). Throws on error.
export async function submitSitemapBing(siteUrl: string, feedUrl: string): Promise<void> {
  const res = await fetch(`${BASE}/SubmitFeed?apikey=${encodeURIComponent(apiKey())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ siteUrl: siteToUrl(siteUrl), feedUrl })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bing SubmitFeed ${res.status}: ${text.slice(0, 300)}`);
  // Success body is {"d":null}; a 200 carrying a fault still has an error message.
  if (/"ErrorCode"|"Message":"[^"]+"/.test(text) && !/"d":null/.test(text)) {
    throw new Error(`Bing SubmitFeed error: ${text.slice(0, 300)}`);
  }
}
