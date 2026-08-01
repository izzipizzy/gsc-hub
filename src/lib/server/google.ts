import type { Db } from './db';
import { allSettledLimit } from './concurrency';
import { getGoogleClientId, getGoogleClientSecret } from './config';
import {
  type AccountRow,
  listAccounts,
  markError,
  markRevoked,
  updateTokens
} from './accounts';

const REFRESH_URL = 'https://oauth2.googleapis.com/token';
const SITES_URL = 'https://searchconsole.googleapis.com/webmasters/v3/sites';
const SEARCH_ANALYTICS_URL = (siteUrl: string) =>
  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl
  )}/searchAnalytics/query`;
const REVOKE_URL = (token: string) =>
  `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`;

const REFRESH_SKEW_SEC = 60;

export interface SiteRow {
  siteUrl: string;
  permissionLevel: string;
  accountId: string;
  accountEmail: string;
  accountLabel: string | null;
}

export interface SitesFanOut {
  sites: SiteRow[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function clientCreds(db: Db): { id: string; secret: string } {
  const id = getGoogleClientId(db);
  const secret = getGoogleClientSecret(db);
  if (!id || !secret) throw new Error('GOOGLE_CLIENT_ID/SECRET not set');
  return { id, secret };
}

export async function refreshIfNeeded(db: Db, acc: AccountRow): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (acc.expires_at > now + REFRESH_SKEW_SEC) return acc.access_token;

  const { id, secret } = clientCreds(db);
  const body = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    refresh_token: acc.refresh_token,
    grant_type: 'refresh_token'
  });
  const res = await fetch(REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 400 || res.status === 401) {
      markRevoked(db, acc.id, `refresh ${res.status}: ${text.slice(0, 200)}`);
      throw new Error(`refresh failed (revoked): ${text}`);
    }
    markError(db, acc.id, `refresh ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`refresh failed: ${res.status}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  const newExp = Math.floor(Date.now() / 1000) + json.expires_in;
  updateTokens(db, acc.id, { access_token: json.access_token, expires_at: newExp });
  return json.access_token;
}

async function authorizedFetch(
  db: Db,
  acc: AccountRow,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const token = await refreshIfNeeded(db, acc);
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
}

export async function listSitesForAccount(
  db: Db,
  acc: AccountRow
): Promise<SiteRow[]> {
  const res = await authorizedFetch(db, acc, SITES_URL);
  if (res.status === 401) {
    markRevoked(db, acc.id, 'sites.list 401');
    throw new Error('401 unauthorized');
  }
  if (!res.ok) {
    const text = await res.text();
    markError(db, acc.id, `sites.list ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`sites.list ${res.status}`);
  }
  const json = (await res.json()) as {
    siteEntry?: { siteUrl: string; permissionLevel: string }[];
  };
  return (json.siteEntry ?? []).map((s) => ({
    siteUrl: s.siteUrl,
    permissionLevel: s.permissionLevel,
    accountId: acc.id,
    accountEmail: acc.email,
    accountLabel: acc.label
  }));
}

export async function listSitesForAllAccounts(db: Db): Promise<SitesFanOut> {
  const accounts = listAccounts(db).filter((a) => a.status === 'active');
  const sites: SiteRow[] = [];
  const errors: SitesFanOut['errors'] = [];

  const settled = await Promise.allSettled(
    accounts.map((a) => listSitesForAccount(db, a))
  );

  settled.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') sites.push(...r.value);
    else
      errors.push({
        accountId: acc.id,
        accountEmail: acc.email,
        reason: (r.reason as Error).message
      });
  });

  return { sites, errors };
}

export interface DimensionFilter {
  dimension: 'query' | 'page' | 'country' | 'device' | 'searchAppearance';
  operator?: 'equals' | 'notEquals' | 'contains' | 'notContains' | 'includingRegex' | 'excludingRegex';
  expression: string;
}

export interface DimensionFilterGroup {
  groupType?: 'and';
  filters: DimensionFilter[];
}

export interface SearchAnalyticsBody {
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowLimit?: number;
  startRow?: number;
  dimensionFilterGroups?: DimensionFilterGroup[];
  dataState?: 'all' | 'final';
}

function isoDateDaysAgo(daysAgo: number, now: number = Date.now()): string {
  return new Date(now - daysAgo * 86400_000).toISOString().slice(0, 10);
}

// Trailing window of `days` calendar days ending today (inclusive).
// Pair with dataState: 'all' so days=1 returns the last ~24h, including
// partial fresh data — same behavior as GSC UI's 24h view.
function gscDateRange(days: number, now: number = Date.now()): { startDate: string; endDate: string } {
  return {
    startDate: isoDateDaysAgo(days, now),
    endDate: isoDateDaysAgo(0, now)
  };
}

export async function searchAnalyticsQuery(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  body: SearchAnalyticsBody
): Promise<SearchAnalyticsRow[]> {
  // Default to fresh data ('all') so short windows like days=1 work.
  // Callers can override with dataState: 'final' for stable-only queries.
  const payload: SearchAnalyticsBody = { dataState: 'all', ...body };
  const res = await authorizedFetch(
    db,
    acc,
    SEARCH_ANALYTICS_URL(siteUrl),
    { method: 'POST', body: JSON.stringify(payload) }
  );
  if (res.status === 401) {
    markRevoked(db, acc.id, 'searchAnalytics 401');
    throw new Error('searchAnalytics 401 unauthorized');
  }
  if (!res.ok) {
    throw new Error(`searchAnalytics ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { rows?: SearchAnalyticsRow[] };
  return json.rows ?? [];
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_URL(token), { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Sitemaps API
// ---------------------------------------------------------------------------

export interface GscSitemap {
  path: string;            // submitted sitemap URL
  isPending: boolean;
  isSitemapsIndex: boolean;
  type: string;            // "WEB", "VIDEO", etc.
  lastSubmitted?: string;
  lastDownloaded?: string;
  warnings?: string;
  errors?: string;
  contents?: { type: string; submitted?: string; indexed?: string }[];
}

const SITEMAPS_LIST_URL = (siteUrl: string) =>
  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`;

const SITEMAP_SUBMIT_URL = (siteUrl: string, feedpath: string) =>
  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl
  )}/sitemaps/${encodeURIComponent(feedpath)}`;

export async function listSitemaps(
  db: Db,
  acc: AccountRow,
  siteUrl: string
): Promise<GscSitemap[]> {
  const res = await authorizedFetch(db, acc, SITEMAPS_LIST_URL(siteUrl));
  if (res.status === 401) {
    markRevoked(db, acc.id, 'sitemaps.list 401');
    throw new Error('sitemaps.list 401');
  }
  if (!res.ok) {
    throw new Error(`sitemaps.list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { sitemap?: GscSitemap[] };
  return json.sitemap ?? [];
}

// PUT a single sitemap feedpath — tells Google to (re)submit it. Empty body, 2xx = ok.
export async function submitSitemap(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  feedpath: string
): Promise<void> {
  const res = await authorizedFetch(db, acc, SITEMAP_SUBMIT_URL(siteUrl, feedpath), {
    method: 'PUT'
  });
  if (res.status === 401) {
    markRevoked(db, acc.id, 'sitemaps.submit 401');
    throw new Error('sitemaps.submit 401');
  }
  if (!res.ok) {
    throw new Error(`sitemaps.submit ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

// DELETE a single sitemap feedpath — tells Google to drop it. 2xx/204 = ok.
export async function deleteSitemap(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  feedpath: string
): Promise<void> {
  const res = await authorizedFetch(db, acc, SITEMAP_SUBMIT_URL(siteUrl, feedpath), {
    method: 'DELETE'
  });
  if (res.status === 401) {
    markRevoked(db, acc.id, 'sitemaps.delete 401');
    throw new Error('sitemaps.delete 401');
  }
  if (!res.ok && res.status !== 204) {
    throw new Error(`sitemaps.delete ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

function siteHomepage(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) return `https://${siteUrl.slice('sc-domain:'.length)}/`;
  return siteUrl;
}

export interface SitemapSubmitResult {
  submitted: string[];
  failed: { path: string; reason: string }[];
  source: 'gsc-list' | 'guess' | 'none';
}

// Resubmit every sitemap GSC already knows for this site. If none are listed,
// fall back to guessing {site}/sitemap.xml and submitting that.
export async function resubmitSitemapsForSite(
  db: Db,
  acc: AccountRow,
  siteUrl: string
): Promise<SitemapSubmitResult> {
  let paths: string[] = [];
  let source: SitemapSubmitResult['source'] = 'gsc-list';

  try {
    const sitemaps = await listSitemaps(db, acc, siteUrl);
    paths = sitemaps.map((s) => s.path).filter(Boolean);
  } catch {
    // sitemaps.list failed (other than 401, which already threw) — fall through to guess.
    paths = [];
  }

  if (paths.length === 0) {
    paths = [new URL('/sitemap.xml', siteHomepage(siteUrl)).toString()];
    source = 'guess';
  }

  const settled = await Promise.allSettled(
    paths.map((p) => submitSitemap(db, acc, siteUrl, p))
  );

  const submitted: string[] = [];
  const failed: { path: string; reason: string }[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') submitted.push(paths[i]);
    else failed.push({ path: paths[i], reason: (r.reason as Error).message.slice(0, 200) });
  });

  return { submitted, failed, source: submitted.length === 0 && source === 'guess' ? 'none' : source };
}

export interface SitemapResyncResult {
  robots: string[];                                       // sitemaps declared in robots.txt
  deleted: string[];                                      // previously-registered sitemaps removed
  submitted: string[];                                    // robots sitemaps (re)submitted
  failed: { path: string; op: 'delete' | 'submit'; reason: string }[];
}

// Drop every sitemap GSC currently knows for this site, then submit the given
// robots.txt-declared ones. The caller supplies the robots list (the popup
// already has it) so we don't re-fetch robots.txt here. Errors collected per path.
export async function resyncSitemapsFromRobots(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  robots: string[]
): Promise<SitemapResyncResult> {
  const existing = await listSitemaps(db, acc, siteUrl);

  const deleted: string[] = [];
  const submitted: string[] = [];
  const failed: SitemapResyncResult['failed'] = [];

  for (const sm of existing) {
    try {
      await deleteSitemap(db, acc, siteUrl, sm.path);
      deleted.push(sm.path);
    } catch (e) {
      failed.push({ path: sm.path, op: 'delete', reason: (e as Error).message.slice(0, 200) });
    }
  }

  for (const p of robots) {
    try {
      await submitSitemap(db, acc, siteUrl, p);
      submitted.push(p);
    } catch (e) {
      failed.push({ path: p, op: 'submit', reason: (e as Error).message.slice(0, 200) });
    }
  }

  return { robots, deleted, submitted, failed };
}

// ---------------------------------------------------------------------------
// URL Inspection API
// ---------------------------------------------------------------------------

const URL_INSPECTION_URL =
  'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

export interface IndexStatusResult {
  verdict: 'PASS' | 'FAIL' | 'PARTIAL' | 'NEUTRAL' | 'VERDICT_UNSPECIFIED';
  coverageState?: string;
  robotsTxtState?: string;
  indexingState?: string;
  lastCrawlTime?: string;
  pageFetchState?: string;
  googleCanonical?: string;
  userCanonical?: string;
}

export interface InspectedUrl {
  inspectionUrl: string;
  status: 'ok' | 'error';
  index?: IndexStatusResult;
  link?: string; // GSC "open in URL Inspection" deep-link, straight from the API (has the hash id)
  error?: string;
}

export async function inspectUrl(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  inspectionUrl: string,
  languageCode: string = 'en-US'
): Promise<{ index: IndexStatusResult; link?: string }> {
  const res = await authorizedFetch(db, acc, URL_INSPECTION_URL, {
    method: 'POST',
    body: JSON.stringify({ inspectionUrl, siteUrl, languageCode })
  });
  if (res.status === 401) {
    markRevoked(db, acc.id, 'urlInspection 401');
    throw new Error('urlInspection 401 unauthorized');
  }
  if (res.status === 429) {
    throw new Error('urlInspection 429 quota exceeded (2000/day)');
  }
  if (!res.ok) {
    throw new Error(
      `urlInspection ${res.status}: ${(await res.text()).slice(0, 200)}`
    );
  }
  const json = (await res.json()) as {
    inspectionResult?: { indexStatusResult?: IndexStatusResult; inspectionResultLink?: string };
  };
  return {
    index: json.inspectionResult?.indexStatusResult ?? { verdict: 'VERDICT_UNSPECIFIED' },
    link: json.inspectionResult?.inspectionResultLink
  };
}

export async function bulkInspect(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  urls: string[]
): Promise<InspectedUrl[]> {
  const settled = await allSettledLimit(
    urls.map((u) => () => inspectUrl(db, acc, siteUrl, u))
  );
  return urls.map((u, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled')
      return { inspectionUrl: u, status: 'ok' as const, index: r.value.index, link: r.value.link };
    return {
      inspectionUrl: u,
      status: 'error' as const,
      error: (r.reason as Error).message.slice(0, 200)
    };
  });
}

export interface DailyRow {
  date: string; // YYYY-MM-DD
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface PeriodTotals {
  clicks: number;
  impressions: number;
  ctr: number;       // weighted: total_clicks / total_impressions
  position: number;  // weighted by impressions
}

export interface SiteDailyBreakdown {
  accountId: string;
  accountEmail: string;
  accountLabel: string | null;
  siteUrl: string;
  current: DailyRow[];   // sorted by date asc
  previous: DailyRow[];  // sorted by date asc
  currentTotals: PeriodTotals;
  previousTotals: PeriodTotals;
  error: string | null;  // per-site error if either fetch failed
}

export interface DailyBreakdownFanOut {
  entries: SiteDailyBreakdown[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

function totalsOf(rows: DailyRow[]): PeriodTotals {
  let clicks = 0, impressions = 0, posWeightedSum = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    posWeightedSum += r.position * r.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? posWeightedSum / impressions : 0
  };
}

export async function fetchDailyBreakdown(
  db: Db,
  days: number
): Promise<DailyBreakdownFanOut> {
  const accounts = listAccounts(db).filter((a) => a.status === 'active');

  const perAccount = await Promise.allSettled(
    accounts.map((a) =>
      listSitesForAccount(db, a).then((sites) => ({ acc: a, sites }))
    )
  );

  const pairs: { acc: AccountRow; site: SiteRow }[] = [];
  const errors: DailyBreakdownFanOut['errors'] = [];
  perAccount.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') {
      r.value.sites.forEach((s) => pairs.push({ acc, site: s }));
    } else {
      errors.push({
        accountId: acc.id,
        accountEmail: acc.email,
        reason: (r.reason as Error).message
      });
    }
  });

  if (pairs.length === 0) return { entries: [], errors };

  // Date math: current period = [now-days, now], previous = [now-2*days, now-days-1].
  const now = Date.now();
  const isoFrom = (offsetDays: number) => isoDateDaysAgo(offsetDays, now);
  const currentEnd = isoFrom(0);
  const currentStart = isoFrom(days);
  const prevStart = isoFrom(days * 2);
  // Shift previous end back by 1 day to avoid overlap with currentStart.
  const prevEndAdj = isoFrom(days + 1);

  // Per-pair: 2 parallel fetches (current + previous).
  const fetches = await allSettledLimit(
    pairs.flatMap(({ acc, site }) => [
      () =>
        searchAnalyticsQuery(db, acc, site.siteUrl, {
          startDate: currentStart,
          endDate: currentEnd,
          dimensions: ['date'],
          rowLimit: 1000
        }),
      () =>
        searchAnalyticsQuery(db, acc, site.siteUrl, {
          startDate: prevStart,
          endDate: prevEndAdj,
          dimensions: ['date'],
          rowLimit: 1000
        })
    ])
  );

  const entries: SiteDailyBreakdown[] = pairs.map(({ acc, site }, i) => {
    const cur = fetches[i * 2];
    const prev = fetches[i * 2 + 1];

    const toDailyRows = (rows: SearchAnalyticsRow[]): DailyRow[] =>
      rows
        .map((r) => ({
          date: r.keys[0] ?? '',
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    const errorParts: string[] = [];
    let current: DailyRow[] = [];
    let previous: DailyRow[] = [];

    if (cur.status === 'fulfilled') {
      current = toDailyRows(cur.value);
    } else {
      errorParts.push(`current: ${(cur.reason as Error).message.slice(0, 100)}`);
    }
    if (prev.status === 'fulfilled') {
      previous = toDailyRows(prev.value);
    } else {
      errorParts.push(`previous: ${(prev.reason as Error).message.slice(0, 100)}`);
    }

    return {
      accountId: acc.id,
      accountEmail: acc.email,
      accountLabel: acc.label,
      siteUrl: site.siteUrl,
      current,
      previous,
      currentTotals: totalsOf(current),
      previousTotals: totalsOf(previous),
      error: errorParts.length > 0 ? errorParts.join('; ') : null
    };
  });

  return { entries, errors };
}

export interface AggregatedQuery {
  query: string;
  page: string;
  country: string;   // ISO 3166-1 alpha-3 lowercase from GSC (e.g. 'rus', 'usa'); '' if missing
  clicks: number;
  impressions: number;
  ctr: number;       // clicks / impressions
  position: number;  // weighted avg by impressions
}

export interface PerSiteQueries {
  accountId: string;
  siteUrl: string;
  rows: AggregatedQuery[]; // top per site by impressions
}

export interface PerSiteQueriesFanOut {
  entries: PerSiteQueries[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

export async function fetchPerSiteQueries(
  db: Db,
  days: number,
  perSiteLimit: number = 1000
): Promise<PerSiteQueriesFanOut> {
  const accounts = listAccounts(db).filter((a) => a.status === 'active');

  const perAccount = await Promise.allSettled(
    accounts.map((a) =>
      listSitesForAccount(db, a).then((sites) => ({ acc: a, sites }))
    )
  );

  const pairs: { acc: AccountRow; site: SiteRow }[] = [];
  const errors: PerSiteQueriesFanOut['errors'] = [];
  perAccount.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') {
      r.value.sites.forEach((s) => pairs.push({ acc, site: s }));
    } else {
      errors.push({
        accountId: acc.id,
        accountEmail: acc.email,
        reason: (r.reason as Error).message
      });
    }
  });

  if (pairs.length === 0) return { entries: [], errors };

  const { startDate, endDate } = gscDateRange(days);

  const perSite = await allSettledLimit(
    pairs.map(
      ({ acc, site }) =>
        () =>
          searchAnalyticsQuery(db, acc, site.siteUrl, {
            startDate,
            endDate,
            dimensions: ['query', 'page', 'country'],
            rowLimit: perSiteLimit
          })
    )
  );

  const entries: PerSiteQueries[] = [];
  perSite.forEach((r, i) => {
    const { acc, site } = pairs[i];
    if (r.status !== 'fulfilled') return;
    const rows: AggregatedQuery[] = r.value.map((row) => ({
      query: row.keys[0] ?? '',
      page: row.keys[1] ?? '',
      country: row.keys[2] ?? '',
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position
    }));
    entries.push({ accountId: acc.id, siteUrl: site.siteUrl, rows });
  });

  return { entries, errors };
}

export interface AggregatedPage {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface PerSitePages {
  accountId: string;
  siteUrl: string;
  rows: AggregatedPage[];
}

export interface PerSitePagesFanOut {
  entries: PerSitePages[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

export async function fetchPerSitePages(
  db: Db,
  days: number,
  perSiteLimit: number = 200
): Promise<PerSitePagesFanOut> {
  const accounts = listAccounts(db).filter((a) => a.status === 'active');

  const perAccount = await Promise.allSettled(
    accounts.map((a) =>
      listSitesForAccount(db, a).then((sites) => ({ acc: a, sites }))
    )
  );

  const pairs: { acc: AccountRow; site: SiteRow }[] = [];
  const errors: PerSitePagesFanOut['errors'] = [];
  perAccount.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') {
      r.value.sites.forEach((s) => pairs.push({ acc, site: s }));
    } else {
      errors.push({
        accountId: acc.id,
        accountEmail: acc.email,
        reason: (r.reason as Error).message
      });
    }
  });

  if (pairs.length === 0) return { entries: [], errors };

  const { startDate, endDate } = gscDateRange(days);

  const perSite = await allSettledLimit(
    pairs.map(
      ({ acc, site }) =>
        () =>
          searchAnalyticsQuery(db, acc, site.siteUrl, {
            startDate,
            endDate,
            dimensions: ['page'],
            rowLimit: perSiteLimit
          })
    )
  );

  const entries: PerSitePages[] = [];
  perSite.forEach((r, i) => {
    const { acc, site } = pairs[i];
    if (r.status !== 'fulfilled') return;
    const rows: AggregatedPage[] = r.value.map((row) => ({
      page: row.keys[0] ?? '',
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position
    }));
    entries.push({ accountId: acc.id, siteUrl: site.siteUrl, rows });
  });

  return { entries, errors };
}

export interface SiteSummary {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  series: number[]; // daily clicks over the window, oldest → newest (for the sparkline)
}

export interface SiteWithSummary extends SiteRow {
  summary: SiteSummary | null;
  summaryError: string | null;
}

export interface SitesWithSummaryFanOut {
  sites: SiteWithSummary[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

export async function listSitesWithSummary(
  db: Db,
  days = 28
): Promise<SitesWithSummaryFanOut> {
  const accounts = listAccounts(db).filter((a) => a.status === 'active');

  // Step 1: fan-out sites.list per account, capture (acc, site[]) and per-account errors.
  const perAccount = await Promise.allSettled(
    accounts.map((a) => listSitesForAccount(db, a).then((sites) => ({ acc: a, sites })))
  );

  const pairs: { acc: AccountRow; site: SiteRow }[] = [];
  const errors: SitesWithSummaryFanOut['errors'] = [];
  perAccount.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') {
      r.value.sites.forEach((s) => pairs.push({ acc, site: s }));
    } else {
      errors.push({
        accountId: acc.id,
        accountEmail: acc.email,
        reason: (r.reason as Error).message
      });
    }
  });

  // Step 2: parallel summaries — one call per site, dims=['date'] so a single call yields both
  // the aggregate totals (summed) and the daily series (for the sparkline). Same call count as
  // a totals-only fetch — the sparkline is effectively free.
  const { startDate, endDate } = gscDateRange(days);
  const summaries = await allSettledLimit(
    pairs.map(
      ({ acc, site }) =>
        () =>
          searchAnalyticsQuery(db, acc, site.siteUrl, {
            startDate,
            endDate,
            dimensions: ['date'],
            rowLimit: 500
          })
    )
  );

  // Step 3: zip pairs + summaries into SiteWithSummary[].
  const sites: SiteWithSummary[] = pairs.map(({ site }, i) => {
    const r = summaries[i];
    if (r.status === 'fulfilled') {
      const rows = [...r.value].sort((a, b) => (a.keys[0] ?? '').localeCompare(b.keys[0] ?? ''));
      const clicks = rows.reduce((s, x) => s + x.clicks, 0);
      const impressions = rows.reduce((s, x) => s + x.impressions, 0);
      const posWeight = rows.reduce((s, x) => s + x.position * x.impressions, 0);
      return {
        ...site,
        summary: {
          clicks,
          impressions,
          ctr: impressions > 0 ? clicks / impressions : 0,
          position: impressions > 0 ? posWeight / impressions : 0,
          series: rows.map((x) => x.clicks)
        },
        summaryError: null
      };
    }
    return {
      ...site,
      summary: null,
      summaryError: (r.reason as Error).message.slice(0, 200)
    };
  });

  return { sites, errors };
}

export interface QueryHistoryDailyRow {
  date: string; // YYYY-MM-DD
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface QueryHistoryEntry {
  accountId: string;
  accountEmail: string;
  accountLabel: string | null;
  siteUrl: string;
  rows: QueryHistoryDailyRow[];
}

export interface QueryHistoryFanOut {
  entries: QueryHistoryEntry[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

export async function fetchQueryHistory(
  db: Db,
  query: string,
  days: number = 480
): Promise<QueryHistoryFanOut> {
  const accounts = listAccounts(db).filter((a) => a.status === 'active');

  const perAccount = await Promise.allSettled(
    accounts.map((a) =>
      listSitesForAccount(db, a).then((sites) => ({ acc: a, sites }))
    )
  );

  const pairs: { acc: AccountRow; site: SiteRow }[] = [];
  const errors: QueryHistoryFanOut['errors'] = [];
  perAccount.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') {
      r.value.sites.forEach((s) => pairs.push({ acc, site: s }));
    } else {
      errors.push({
        accountId: acc.id,
        accountEmail: acc.email,
        reason: (r.reason as Error).message
      });
    }
  });

  if (pairs.length === 0) return { entries: [], errors };

  const { startDate, endDate } = gscDateRange(days);

  const fetches = await allSettledLimit(
    pairs.map(
      ({ acc, site }) =>
        () =>
          searchAnalyticsQuery(db, acc, site.siteUrl, {
            startDate,
            endDate,
            dimensions: ['date'],
            rowLimit: 25000,
            dimensionFilterGroups: [
              { filters: [{ dimension: 'query', operator: 'equals', expression: query }] }
            ]
          })
    )
  );

  const entries: QueryHistoryEntry[] = [];
  fetches.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const { acc, site } = pairs[i];
    const rows: QueryHistoryDailyRow[] = r.value
      .map((row) => ({
        date: row.keys[0] ?? '',
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length > 0) {
      entries.push({
        accountId: acc.id,
        accountEmail: acc.email,
        accountLabel: acc.label,
        siteUrl: site.siteUrl,
        rows
      });
    }
  });

  return { entries, errors };
}

// ─── Single-site fetches for the site detail page ─────────────────────────────

// One GSC call: query+page rows for the last `days`. Powers Striking / Cannibalization /
// CTR / Branded from a single response (the caller computes all four in analytics.ts).
export async function fetchSiteQueryPages(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  days: number = 28,
  rowLimit: number = 5000
): Promise<SearchAnalyticsRow[]> {
  const { startDate, endDate } = gscDateRange(days);
  return searchAnalyticsQuery(db, acc, siteUrl, {
    startDate,
    endDate,
    dimensions: ['query', 'page'],
    rowLimit
  });
}

// Two page-level windows for content decay: the recent `days` vs the same-length window
// ending `offsetDays` ago. Default is the immediately preceding period (offsetDays = days),
// e.g. last 28d vs the 28d before that — this catches recent declines, unlike a fixed
// months-ago baseline which misses drops on sites that had little traffic back then.
export async function fetchSiteDecayPages(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  days: number = 28,
  offsetDays?: number,
  rowLimit: number = 5000
): Promise<{ recent: SearchAnalyticsRow[]; prior: SearchAnalyticsRow[] }> {
  const gap = offsetDays ?? days;
  const now = Date.now();
  const recentRange = gscDateRange(days, now);
  const priorStart = isoDateDaysAgo(gap + days, now);
  const priorEnd = isoDateDaysAgo(gap, now);
  const [recent, prior] = await Promise.all([
    searchAnalyticsQuery(db, acc, siteUrl, {
      startDate: recentRange.startDate,
      endDate: recentRange.endDate,
      dimensions: ['page'],
      rowLimit
    }),
    searchAnalyticsQuery(db, acc, siteUrl, {
      startDate: priorStart,
      endDate: priorEnd,
      dimensions: ['page'],
      rowLimit
    })
  ]);
  return { recent, prior };
}

export interface PortfolioDecayEntry {
  accountId: string;
  siteUrl: string;
  recent: SearchAnalyticsRow[];
  prior: SearchAnalyticsRow[];
}

export interface PortfolioDecayFanOut {
  entries: PortfolioDecayEntry[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

// Portfolio-wide content decay: two page-level windows per site (recent vs ~3mo earlier).
// Heavier than the query fan-out (2 calls/site) — call lazily.
export async function fetchPortfolioDecayPages(
  db: Db,
  days: number = 28,
  offsetDays?: number,
  rowLimit: number = 5000
): Promise<PortfolioDecayFanOut> {
  const accounts = listAccounts(db).filter((a) => a.status === 'active');

  const perAccount = await Promise.allSettled(
    accounts.map((a) => listSitesForAccount(db, a).then((sites) => ({ acc: a, sites })))
  );

  const pairs: { acc: AccountRow; site: SiteRow }[] = [];
  const errors: PortfolioDecayFanOut['errors'] = [];
  perAccount.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') r.value.sites.forEach((s) => pairs.push({ acc, site: s }));
    else errors.push({ accountId: acc.id, accountEmail: acc.email, reason: (r.reason as Error).message });
  });

  const settled = await allSettledLimit(
    pairs.map(
      ({ acc, site }) =>
        () =>
          fetchSiteDecayPages(db, acc, site.siteUrl, days, offsetDays, rowLimit)
    )
  );

  const entries: PortfolioDecayEntry[] = [];
  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const { acc, site } = pairs[i];
    entries.push({ accountId: acc.id, siteUrl: site.siteUrl, recent: r.value.recent, prior: r.value.prior });
  });

  return { entries, errors };
}

export interface SiteDaily {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  series: { date: string; clicks: number }[]; // oldest → newest
}

// One GSC call, dims=['date']: aggregate totals + daily series for a single site (sparkline +
// Overview header on the detail page).
export async function fetchSiteDaily(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  days: number = 28
): Promise<SiteDaily> {
  const { startDate, endDate } = gscDateRange(days);
  const rows = await searchAnalyticsQuery(db, acc, siteUrl, {
    startDate,
    endDate,
    dimensions: ['date'],
    rowLimit: 500
  });
  const sorted = [...rows].sort((a, b) => (a.keys[0] ?? '').localeCompare(b.keys[0] ?? ''));
  const clicks = sorted.reduce((s, x) => s + x.clicks, 0);
  const impressions = sorted.reduce((s, x) => s + x.impressions, 0);
  const posWeight = sorted.reduce((s, x) => s + x.position * x.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? posWeight / impressions : 0,
    series: sorted.map((x) => ({ date: x.keys[0] ?? '', clicks: x.clicks }))
  };
}
