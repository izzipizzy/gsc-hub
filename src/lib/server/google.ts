import { env as privateEnv } from '$env/dynamic/private';
import type { Db } from './db';
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

function clientCreds(): { id: string; secret: string } {
  const id = privateEnv.GOOGLE_CLIENT_ID;
  const secret = privateEnv.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error('GOOGLE_CLIENT_ID/SECRET not set');
  return { id, secret };
}

export async function refreshIfNeeded(db: Db, acc: AccountRow): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (acc.expires_at > now + REFRESH_SKEW_SEC) return acc.access_token;

  const { id, secret } = clientCreds();
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
}

export async function searchAnalyticsQuery(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  body: SearchAnalyticsBody
): Promise<SearchAnalyticsRow[]> {
  const res = await authorizedFetch(
    db,
    acc,
    SEARCH_ANALYTICS_URL(siteUrl),
    { method: 'POST', body: JSON.stringify(body) }
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
  error?: string;
}

export async function inspectUrl(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  inspectionUrl: string,
  languageCode: string = 'en-US'
): Promise<IndexStatusResult> {
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
    inspectionResult?: { indexStatusResult?: IndexStatusResult };
  };
  return json.inspectionResult?.indexStatusResult ?? { verdict: 'VERDICT_UNSPECIFIED' };
}

export async function bulkInspect(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  urls: string[]
): Promise<InspectedUrl[]> {
  const settled = await Promise.allSettled(
    urls.map((u) => inspectUrl(db, acc, siteUrl, u))
  );
  return urls.map((u, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled') return { inspectionUrl: u, status: 'ok', index: r.value };
    return {
      inspectionUrl: u,
      status: 'error',
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
  const isoFrom = (offsetDays: number) =>
    new Date(now - offsetDays * 86400_000).toISOString().slice(0, 10);
  const currentEnd = isoFrom(0);
  const currentStart = isoFrom(days);
  const prevStart = isoFrom(days * 2);
  // Shift previous end back by 1 day to avoid overlap with currentStart.
  const prevEndAdj = isoFrom(days + 1);

  // Per-pair: 2 parallel fetches (current + previous).
  const fetches = await Promise.allSettled(
    pairs.flatMap(({ acc, site }) => [
      searchAnalyticsQuery(db, acc, site.siteUrl, {
        startDate: currentStart,
        endDate: currentEnd,
        dimensions: ['date'],
        rowLimit: 1000
      }),
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
  perSiteLimit: number = 200
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

  const startDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10);

  const perSite = await Promise.allSettled(
    pairs.map(({ acc, site }) =>
      searchAnalyticsQuery(db, acc, site.siteUrl, {
        startDate,
        endDate,
        dimensions: ['query'],
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

  const startDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10);

  const perSite = await Promise.allSettled(
    pairs.map(({ acc, site }) =>
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
}

export interface SiteWithSummary extends SiteRow {
  summary: SiteSummary | null;
  summaryError: string | null;
}

export interface SitesWithSummaryFanOut {
  sites: SiteWithSummary[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

function dateNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

  // Step 2: parallel summaries — one call per site.
  const startDate = dateNDaysAgo(days);
  const endDate = todayIso();
  const summaries = await Promise.allSettled(
    pairs.map(({ acc, site }) =>
      searchAnalyticsQuery(db, acc, site.siteUrl, {
        startDate,
        endDate,
        dimensions: [],
        rowLimit: 1
      })
    )
  );

  // Step 3: zip pairs + summaries into SiteWithSummary[].
  const sites: SiteWithSummary[] = pairs.map(({ site }, i) => {
    const r = summaries[i];
    if (r.status === 'fulfilled') {
      const row = r.value[0];
      return {
        ...site,
        summary: row
          ? { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }
          : { clicks: 0, impressions: 0, ctr: 0, position: 0 },
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

  const now = Date.now();
  const startDate = new Date(now - days * 86400_000).toISOString().slice(0, 10);
  const endDate = new Date(now).toISOString().slice(0, 10);

  const fetches = await Promise.allSettled(
    pairs.map(({ acc, site }) =>
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
