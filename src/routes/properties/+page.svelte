<script lang="ts">
  import PeriodPicker from '$lib/components/PeriodPicker.svelte';
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, getLocale } from '$lib/i18n/index.svelte';
  import SiteSearch from '$lib/components/SiteSearch.svelte';
  import Pager from '$lib/components/Pager.svelte';
  import SnapshotStatus from '$lib/components/SnapshotStatus.svelte';
  import { page } from '$app/state';
  import SortCaret from '$lib/components/SortCaret.svelte';
  import { onMount } from 'svelte';
  import { goto, invalidateAll, replaceState } from '$app/navigation';
  import { parsePeriod } from '$lib/utils/periods';
  import { env as pubenv } from '$env/dynamic/public';
  import { displaySite, siteHref, siteSearchHref, bingWebmasterHref, gscHref } from '$lib/utils/site';
  import googleIcon from '$lib/assets/google.svg';
  import bingIcon from '$lib/assets/bing.svg';
  import TrendChart from '$lib/components/TrendChart.svelte';
  import { googleSerpUrl } from '$lib/utils/country';
  import { SERIES, AXIS } from '$lib/chart-theme';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  // Submit-all log pages open on this same origin by default. PUBLIC_AI_BASE
  // sends them to another origin of the same hub when one is configured.
  const aiBase = pubenv.PUBLIC_AI_BASE || '';

  // Numbers follow the interface language (fmtNum from i18n).
  function fmtCtr(c: number) { return fmtPct(c); }
  function fmtPos(p: number) { return fmtDec(p, 1); }
  function fmtDate(ts: number | null) { return ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '—'; }

  // Inline sparkline path from a daily-clicks series.
  function sparkPath(series: number[], w = 64, h = 16): string {
    if (!series || series.length === 0) return '';
    const max = Math.max(...series, 1);
    const step = series.length > 1 ? w / (series.length - 1) : w;
    return series
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
      .join(' ');
  }
  function detailHref(s: { siteUrl: string; accountId: string }) {
    return `/properties/${encodeURIComponent(s.siteUrl)}?acc=${encodeURIComponent(s.accountId)}`;
  }

  // ─── Portfolio pulse: aggregated clicks/impressions across all sites, own period ───
  type PulseUpdate = {
    date: string;
    end: string;
    name: string;
    type: string;
    color: string;
    impact: { clicks: number | null; confident: boolean } | null;
  };
  type PulseData = {
    totals: { clicks: number; impressions: number; ctr: number };
    series: { date: string; clicks: number; impressions: number }[];
    updates: PulseUpdate[];
    events: { date: string; label: string; color: string }[];
    errors: { accountId: string; accountEmail: string; reason: string }[];
    status: { state: 'cold' | 'ready'; refreshing: boolean };
  };

  // Pulse period lives in the URL (?pulse=), so a view can be bookmarked; the
  // switch itself stays client-side and only rewrites the address.
  let pulseDays = $state(parsePeriod(page.url.searchParams.get('pulse')) ?? 90);
  function setPulse(d: number) {
    pulseDays = d;
    const url = new URL(page.url);
    url.searchParams.set('pulse', String(d));
    replaceState(url, page.state);
  }
  const pulseHref = (d: number) => {
    const url = new URL(page.url);
    url.searchParams.set('pulse', String(d));
    return `${url.pathname}${url.search}`;
  };
  let showPulseUpdates = $state(true);
  let showPulseEvents = $state(true);
  let pulseState = $state<
    { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'loaded'; data: PulseData }
  >({ kind: 'loading' });
  // One fan-out per window per session — switching back to a seen range is instant.
  const pulseCache = new Map<number, PulseData>();

  async function loadPulse(days: number) {
    const hit = pulseCache.get(days);
    if (hit) {
      pulseState = { kind: 'loaded', data: hit };
      return;
    }
    pulseState = { kind: 'loading' };
    try {
      const res = await fetch(`/properties/pulse?days=${days}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: PulseData = await res.json();
      // A pulse summed from a half-filled snapshot is not worth keeping.
      if (!data.status.refreshing) pulseCache.set(days, data);
      if (pulseDays === days) pulseState = { kind: 'loaded', data };
    } catch (e) {
      if (pulseDays === days) pulseState = { kind: 'error', message: (e as Error).message };
    }
  }

  // Tracks pulseDays: re-runs on switcher clicks, and once on mount for the initial period.
  // Also re-runs when the snapshot moves on (a pass finished or progressed),
  // so the pulse follows the table rather than a session-old cache.
  $effect(() => {
    void data.status.updatedAt;
    void data.status.done;
    pulseCache.clear();
    loadPulse(pulseDays);
  });

  const STORAGE_KEY = 'gsc-hub:hidden-sites';

  type SiteWithSummary = (typeof data.sites)[number];

  function keyOf(s: SiteWithSummary): string {
    return `${s.accountId}|${s.siteUrl}`;
  }

  // Hidden sites live on the server; the load excludes them (or lists them
  // with ?hidden=1) and marks each row.

  onMount(async () => {
    // One-time migration: push any sites hidden in the old localStorage store to
    // the server (INSERT OR IGNORE), then drop the local copy. The server is now
    // the source of truth so the bulk submit-all / ai-all pages exclude them too.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) {
          await Promise.all(
            arr.map((k: string) => {
              const i = k.indexOf('|');
              return fetch('/properties/hidden-sites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ account: k.slice(0, i), site: k.slice(i + 1) })
              });
            })
          );
        }
        localStorage.removeItem(STORAGE_KEY);
        await invalidateAll();
      }
    } catch (e) {
      console.warn('[gsc-hub] hidden-sites migration failed:', e);
    }
  });

  let hideError = $state<string | null>(null);
  async function setHidden(s: SiteWithSummary, hide: boolean) {
    hideError = null;
    try {
      const r = await fetch('/properties/hidden-sites', {
        method: hide ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: s.accountId, site: s.siteUrl })
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      hideError = `Could not ${hide ? 'hide' : 'unhide'} ${displaySite(s.siteUrl)}: ${(e as Error).message}`;
    }
    await invalidateAll();
    invalidatePulse();
    loadTop();
  }
  const hideSite = (s: SiteWithSummary) => setHidden(s, true);
  const unhideSite = (s: SiteWithSummary) => setHidden(s, false);

  // The pulse aggregates visible sites only — after a hide/unhide the cached window
  // aggregates are stale. Server-side per-site responses are TTL-cached, so the
  // refetch is a cheap re-aggregation, not a new fan-out.
  function invalidatePulse() {
    pulseCache.clear();
    loadPulse(pulseDays);
  }

  const searchQuery = $derived(data.q);
  // Search and the hidden toggle ride along on every period/sort link.
  const searchParam = $derived(`${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}${data.showHidden ? '&hidden=1' : ''}`);
  function showHiddenHref(on: boolean): string {
    const url = new URL(page.url);
    if (on) url.searchParams.set('hidden', '1');
    else url.searchParams.delete('hidden');
    url.searchParams.delete('page');
    return `${url.pathname}${url.search}`;
  }

  // One page of the table; totals and the per-account split are over the whole
  // portfolio and come computed from the server.
  let visibleSites = $derived(data.sites);
  let totals = $derived(data.totals);
  let perAccount = $derived(data.perAccount);


  function sortHref(field: string, currentSort: string, currentDir: 'asc' | 'desc', days: number) {
    const nextDir = currentSort === field && currentDir === 'desc' ? 'asc' : 'desc';
    return `?days=${days}&sort=${field}&dir=${nextDir}${searchParam}`;
  }

  function sortIndicator(field: string, currentSort: string, currentDir: 'asc' | 'desc'): 'asc' | 'desc' | '' {
    if (currentSort !== field) return '';
    return currentDir;
  }

  // Queries table: client-side sort state
  let qSort = $state<'query' | 'page' | 'country' | 'clicks' | 'impressions' | 'ctr' | 'position' | 'bingClicks' | 'bingImpr'>('position');
  let qDir = $state<'asc' | 'desc'>('asc');
  // Pages table sort. Declared up here: the Top-block effects below run as
  // soon as they are declared and read it.
  let pSort = $state<'page' | 'clicks' | 'impressions' | 'ctr' | 'position'>('impressions');
  let pDir = $state<'asc' | 'desc'>('desc');

  // Junk-query filters (e.g. "site:") — stored server-side in SQLite, applied
  // here as case-insensitive substring matches.
  let queryFilters = $state<{ id: number; pattern: string }[]>(data.queryFilters ?? []);
  let showFilteredQueries = $state(false);
  let newQueryFilter = $state('');

  // Facet filters for Top queries — empty set means "all" (no filtering).
  // Option lists are populated only from values present in the data.
  let selectedCountries = $state<Set<string>>(new Set());
  let selectedDomains = $state<Set<string>>(new Set());
  let countrySearch = $state('');
  let domainSearch = $state('');
  // Source facet: where the key comes from. 'all' | 'gsc' (GSC only) | 'bing' (Bing only) | 'both'.
  // Default to GSC so the table opens on the familiar GSC keys, not the Bing-only flood.
  let querySource = $state<'all' | 'gsc' | 'bing' | 'both'>('gsc');
  // Avg-position range filter (inclusive). Empty 'to' = no upper bound. Default from 0.
  let posMin = $state<number | null>(0);
  let posMax = $state<number | null>(null);

  function toggleCountry(c: string) {
    const next = new Set(selectedCountries);
    next.has(c) ? next.delete(c) : next.add(c);
    selectedCountries = next;
  }
  function toggleDomain(d: string) {
    const next = new Set(selectedDomains);
    next.has(d) ? next.delete(d) : next.add(d);
    selectedDomains = next;
  }

  function isQueryFiltered(q: string): boolean {
    const lq = q.toLowerCase();
    return queryFilters.some((f) => lq.includes(f.pattern.toLowerCase()));
  }

  async function addQueryFilter(pattern: string) {
    const p = pattern.trim();
    if (!p || queryFilters.some((f) => f.pattern.toLowerCase() === p.toLowerCase())) {
      newQueryFilter = '';
      return;
    }
    try {
      const res = await fetch('/properties/query-filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern: p })
      });
      if (!res.ok) throw new Error(await res.text());
      const f = await res.json();
      queryFilters = [...queryFilters, f].sort((a, b) => a.pattern.localeCompare(b.pattern));
      newQueryFilter = '';
    } catch (e) {
      console.error('addQueryFilter failed', e);
    }
  }

  async function removeQueryFilter(id: number) {
    try {
      const res = await fetch('/properties/query-filters', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (!res.ok) throw new Error(await res.text());
      queryFilters = queryFilters.filter((f) => f.id !== id);
    } catch (e) {
      console.error('removeQueryFilter failed', e);
    }
  }

  // ─── Top queries / top pages: summarised on the server (/properties/top) ───
  // Loaded once the block scrolls into view, and again whenever a filter, the
  // sort or the period changes. The browser holds the 200 rows it shows.
  type TopStatus = { state: 'cold' | 'ready'; refreshing: boolean; done: number; total: number; error: string | null };
  type QueryRow = {
    query: string; page: string; country: string; domain: string;
    gsc: { clicks: number; impressions: number; ctr: number; position: number } | null;
    bing: { clicks: number; impressions: number; position: number } | null;
  };
  type TopQueries = { rows: QueryRow[]; sourceRows: number; filteredCount: number; matched: number; availableCountries: string[]; availableDomains: string[]; status: TopStatus };
  type PageRow = { page: string; clicks: number; impressions: number; ctr: number; position: number };
  type TopPages = { rows: PageRow[]; sourceRows: number; matched: number; status: TopStatus };

  // "Show more" grows the slice by a page; any filter or sort change starts over.
  const TOP_STEP = 200;
  const TOP_MAX = 5000;
  let qLimit = $state(TOP_STEP);
  let pLimit = $state(TOP_STEP);

  let topVisible = $state(false);
  let topQueriesState = $state<{ kind: 'idle' | 'loading' } | { kind: 'error'; message: string } | { kind: 'loaded'; data: TopQueries }>({ kind: 'idle' });
  let topPagesState = $state<{ kind: 'idle' | 'loading' } | { kind: 'error'; message: string } | { kind: 'loaded'; data: TopPages }>({ kind: 'idle' });
  let topTimer: ReturnType<typeof setTimeout> | null = null;
  let topSeq = 0;

  function topQueryUrl(): string {
    const p = new URLSearchParams({ kind: 'queries', days: String(data.days), sort: qSort, dir: qDir, source: querySource, limit: String(qLimit) });
    if (selectedCountries.size) p.set('countries', [...selectedCountries].join(','));
    if (selectedDomains.size) p.set('domains', [...selectedDomains].join(','));
    if (posMin != null && posMin > 0) p.set('posMin', String(posMin));
    if (posMax != null) p.set('posMax', String(posMax));
    if (showFilteredQueries) p.set('showFiltered', '1');
    return `/properties/top?${p}`;
  }

  async function loadTop() {
    if (!topVisible) return;
    const seq = ++topSeq;
    if (topTimer) clearTimeout(topTimer);
    if (topQueriesState.kind !== 'loaded') topQueriesState = { kind: 'loading' };
    if (topPagesState.kind !== 'loaded') topPagesState = { kind: 'loading' };
    const get = async <T,>(u: string): Promise<T> => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    };
    const [qr, pr] = await Promise.allSettled([
      get<TopQueries>(topQueryUrl()),
      get<TopPages>(`/properties/top?kind=pages&days=${data.days}&sort=${pSort}&dir=${pDir}&limit=${pLimit}`)
    ]);
    if (seq !== topSeq) return; // a newer request superseded this one
    topQueriesState = qr.status === 'fulfilled' ? { kind: 'loaded', data: qr.value } : { kind: 'error', message: (qr.reason as Error).message };
    topPagesState = pr.status === 'fulfilled' ? { kind: 'loaded', data: pr.value } : { kind: 'error', message: (pr.reason as Error).message };
    // While the pass that fills these rows runs, look again now and then.
    const running = (qr.status === 'fulfilled' && qr.value.status.refreshing) || (pr.status === 'fulfilled' && pr.value.status.refreshing);
    if (running) topTimer = setTimeout(loadTop, 5_000);
  }

  // Re-query on any input change; typing in the position boxes is debounced.
  let topDebounce: ReturnType<typeof setTimeout> | null = null;
  let qKey = '';
  let pKey = '';
  $effect.pre(() => {
    const nq = JSON.stringify([data.days, qSort, qDir, querySource, posMin, posMax, showFilteredQueries, [...selectedCountries], [...selectedDomains], queryFilters.length]);
    const np = JSON.stringify([data.days, pSort, pDir]);
    if (nq !== qKey) { qKey = nq; qLimit = TOP_STEP; }
    if (np !== pKey) { pKey = np; pLimit = TOP_STEP; }
  });
  $effect(() => {
    void [data.days, qSort, qDir, pSort, pDir, querySource, posMin, posMax, showFilteredQueries, selectedCountries, selectedDomains, queryFilters, topVisible, qLimit, pLimit];
    if (topDebounce) clearTimeout(topDebounce);
    topDebounce = setTimeout(loadTop, 200);
  });

  function observeTop(node: HTMLElement) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        topVisible = true;
        io.disconnect();
      }
    }, { rootMargin: '400px' });
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }

  const topQ = $derived(topQueriesState.kind === 'loaded' ? topQueriesState.data : null);
  const aggregatedQueries = $derived(topQ?.rows ?? []);
  const hiddenQueryCount = $derived(topQ?.filteredCount ?? 0);
  const availableCountries = $derived(topQ?.availableCountries ?? []);
  const availableDomains = $derived(topQ?.availableDomains ?? []);
  const topP = $derived(topPagesState.kind === 'loaded' ? topPagesState.data : null);

  function toggleQSort(field: typeof qSort) {
    if (qSort === field) {
      qDir = qDir === 'desc' ? 'asc' : 'desc';
    } else {
      qSort = field;
      qDir = 'desc';
    }
  }

  function qIndicator(field: string): 'asc' | 'desc' | '' {
    if (qSort !== field) return '';
    return qDir;
  }


  const aggregatedPages = $derived(topP?.rows ?? []);

  function togglePSort(field: typeof pSort) {
    if (pSort === field) {
      pDir = pDir === 'desc' ? 'asc' : 'desc';
    } else {
      pSort = field;
      pDir = 'desc';
    }
  }

  function pIndicator(field: string): 'asc' | 'desc' | '' {
    if (pSort !== field) return '';
    return pDir;
  }

  // Query history expansion
  type DailyAggregate = { date: string; impressions: number; clicks: number; position: number };

  type QueryHistoryEntry = {
    accountId: string;
    accountEmail: string;
    accountLabel: string | null;
    siteUrl: string;
    rows: { date: string; impressions: number; clicks: number; ctr: number; position: number }[];
  };

  type HistoryState =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'loaded'; aggregated: DailyAggregate[]; entries: QueryHistoryEntry[] };

  let expandedQuery = $state<string | null>(null); // composite key `${query}|${page}|${country}`
  let historyState = $state<HistoryState>({ kind: 'idle' });

  async function toggleQuery(query: string, page: string, country: string) {
    const key = `${query}|${page}|${country}`;
    if (expandedQuery === key) {
      expandedQuery = null;
      historyState = { kind: 'idle' };
      return;
    }
    expandedQuery = key;
    historyState = { kind: 'loading' };
    try {
      const res = await fetch(`/properties/query-history?q=${encodeURIComponent(query)}&days=480`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Hidden sites are already dropped by the server; aggregate by date.
      const visible = data.entries as QueryHistoryEntry[];
      type Bucket = { impressions: number; clicks: number; posWeightedSum: number };
      const map = new Map<string, Bucket>();
      for (const e of visible) {
        for (const r of e.rows) {
          const cur = map.get(r.date) ?? { impressions: 0, clicks: 0, posWeightedSum: 0 };
          cur.impressions += r.impressions;
          cur.clicks += r.clicks;
          cur.posWeightedSum += r.position * r.impressions;
          map.set(r.date, cur);
        }
      }
      const aggregated: DailyAggregate[] = Array.from(map.entries())
        .map(([date, b]) => ({
          date,
          impressions: b.impressions,
          clicks: b.clicks,
          position: b.impressions > 0 ? b.posWeightedSum / b.impressions : 0
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      historyState = { kind: 'loaded', aggregated, entries: visible };
    } catch (e) {
      historyState = { kind: 'error', message: (e as Error).message };
    }
  }

  // URL Inspection expansion
  type InspectedUrl = {
    inspectionUrl: string;
    status: 'ok' | 'error';
    index?: {
      verdict: 'PASS' | 'FAIL' | 'PARTIAL' | 'NEUTRAL' | 'VERDICT_UNSPECIFIED';
      coverageState?: string;
      robotsTxtState?: string;
      indexingState?: string;
      lastCrawlTime?: string;
      googleCanonical?: string;
      userCanonical?: string;
    };
    error?: string;
  };

  type InspectState =
    | { kind: 'idle' }
    | { kind: 'loading'; total: number }
    | { kind: 'error'; message: string }
    | {
        kind: 'loaded';
        results: InspectedUrl[];
        site: string;
        accountId: string;
        siteHrefStr: string;
        cached: boolean;
        fetchedAt: number;
        source: 'page-entries' | 'page-entries+sitemap' | 'sitemap';
        sitemapNote?: string;
      };

  let expandedSite = $state<string | null>(null); // composite key accountId|siteUrl
  let inspectState = $state<InspectState>({ kind: 'idle' });

  const TARGET = 10;

  async function collectUrlsForSite(
    s: { accountId: string; siteUrl: string }
  ): Promise<{ urls: string[]; source: 'page-entries' | 'page-entries+sitemap' | 'sitemap'; sitemapErr?: string }> {
    let rows: { page: string; impressions: number }[] = [];
    try {
      const r = await fetch(`/properties/top?kind=site-pages&days=${data.days}&account=${encodeURIComponent(s.accountId)}&site=${encodeURIComponent(s.siteUrl)}`);
      if (r.ok) rows = (await r.json()).pages;
    } catch {
      // fall through to the sitemap
    }
    const fromPages = rows.length
      ? rows
          .slice()
          .sort((a, b) => b.impressions - a.impressions)
          .map((r) => r.page)
          .filter(Boolean)
      : [];

    // Always include the homepage first.
    const home = siteHref(s.siteUrl);
    const chosen: string[] = [home];

    // Add page-entries (skip homepage if already there).
    for (const u of fromPages) {
      if (chosen.length >= TARGET) break;
      if (!chosen.includes(u)) chosen.push(u);
    }

    let source: 'page-entries' | 'page-entries+sitemap' | 'sitemap' = 'page-entries';
    let sitemapErr: string | undefined;

    // If we still don't have enough, ask the server for sitemap URLs.
    if (chosen.length < TARGET) {
      try {
        const r = await fetch(
          `/properties/sitemap-urls?account=${encodeURIComponent(s.accountId)}&site=${encodeURIComponent(s.siteUrl)}&limit=${TARGET * 3}`
        );
        const sitemapData = await r.json();
        if (sitemapData.source !== 'none') {
          source = chosen.length > 1 ? 'page-entries+sitemap' : 'sitemap';
          for (const u of sitemapData.urls as string[]) {
            if (chosen.length >= TARGET) break;
            if (!chosen.includes(u)) chosen.push(u);
          }
        } else if (sitemapData.error) {
          sitemapErr = sitemapData.error;
        }
      } catch (e) {
        sitemapErr = (e as Error).message;
      }
    }

    return { urls: chosen, source, sitemapErr };
  }

  async function toggleSite(s: { accountId: string; siteUrl: string }) {
    const key = `${s.accountId}|${s.siteUrl}`;
    if (expandedSite === key) {
      expandedSite = null;
      inspectState = { kind: 'idle' };
      return;
    }

    expandedSite = key;
    inspectState = { kind: 'loading', total: TARGET };

    const { urls, source, sitemapErr } = await collectUrlsForSite(s);

    if (urls.length === 0) {
      inspectState = {
        kind: 'error',
        message: sitemapErr ?? 'No URLs to inspect (no impressions and no sitemap accessible).'
      };
      return;
    }

    inspectState = { kind: 'loading', total: urls.length };
    try {
      const res = await fetch('/properties/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: s.accountId, site: s.siteUrl, urls })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const json = await res.json();
      inspectState = {
        kind: 'loaded',
        results: json.results,
        site: s.siteUrl,
        accountId: s.accountId,
        siteHrefStr: siteHref(s.siteUrl),
        cached: !!json.cached,
        fetchedAt: json.fetchedAt ?? Math.floor(Date.now() / 1000),
        source,
        sitemapNote: sitemapErr
      };
    } catch (e) {
      inspectState = { kind: 'error', message: (e as Error).message };
    }
  }

  async function refreshInspection(s: { accountId: string; siteUrl: string }) {
    const { urls, source, sitemapErr } = await collectUrlsForSite(s);
    if (urls.length === 0) return;

    inspectState = { kind: 'loading', total: urls.length };
    try {
      const res = await fetch('/properties/inspect?force=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: s.accountId, site: s.siteUrl, urls })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const responseData = await res.json();
      inspectState = {
        kind: 'loaded',
        results: responseData.results,
        site: s.siteUrl,
        accountId: s.accountId,
        siteHrefStr: siteHref(s.siteUrl),
        cached: !!responseData.cached,
        fetchedAt: responseData.fetchedAt ?? Math.floor(Date.now() / 1000),
        source,
        sitemapNote: sitemapErr
      };
    } catch (e) {
      inspectState = { kind: 'error', message: (e as Error).message };
    }
  }

  // Sitemap (re)submit state
  type SubmitState =
    | { kind: 'loading' }
    | { kind: 'done'; submitted: number; failed: number; source: string; failReasons: string[] }
    | { kind: 'error'; message: string };

  let submitStates = $state<Map<string, SubmitState>>(new Map());

  function setSubmitState(key: string, st: SubmitState) {
    submitStates.set(key, st);
    submitStates = new Map(submitStates);
  }

  async function submitSitemapFor(
    s: { accountId: string; siteUrl: string }
  ): Promise<{ submitted: number; failed: number; source: string } | null> {
    const key = `${s.accountId}|${s.siteUrl}`;
    setSubmitState(key, { kind: 'loading' });
    try {
      const res = await fetch('/properties/sitemap-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: s.accountId, site: s.siteUrl })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const r = await res.json();
      const failReasons = (r.failed as { path: string; reason: string }[]).map(
        (f) => `${f.path}: ${f.reason}`
      );
      const summary = { submitted: r.submitted.length, failed: r.failed.length, source: r.source };
      setSubmitState(key, { kind: 'done', ...summary, failReasons });
      return summary;
    } catch (e) {
      setSubmitState(key, { kind: 'error', message: (e as Error).message });
      return null;
    }
  }

  // --- Sitemaps popup ---
  type GscSitemap = { path: string; isPending: boolean; errors?: string; warnings?: string; lastDownloaded?: string };
  type SitemapModal = {
    accountId: string;
    site: string;
    title: string;
    load: 'loading' | 'loaded' | 'error';
    loadError?: string;
    current: GscSitemap[];
    robots: string[];
    robotsError?: string | null;
    resync: { kind: 'idle' } | { kind: 'running' } | { kind: 'error'; message: string }
      | { kind: 'done'; deleted: number; submitted: number; failed: { path: string; op: string; reason: string }[] };
  };
  let sitemapModal = $state<SitemapModal | null>(null);

  async function openSitemapModal(s: { accountId: string; siteUrl: string }) {
    sitemapModal = {
      accountId: s.accountId, site: s.siteUrl, title: displaySite(s.siteUrl),
      load: 'loading', current: [], robots: [], resync: { kind: 'idle' }
    };
    try {
      const res = await fetch(
        `/properties/sitemaps?account=${encodeURIComponent(s.accountId)}&site=${encodeURIComponent(s.siteUrl)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      if (!sitemapModal || sitemapModal.site !== s.siteUrl) return;
      sitemapModal = { ...sitemapModal, load: 'loaded', current: data.current, robots: data.robots, robotsError: data.robotsError };
    } catch (e) {
      if (!sitemapModal || sitemapModal.site !== s.siteUrl) return;
      sitemapModal = { ...sitemapModal, load: 'error', loadError: (e as Error).message };
    }
  }

  function closeSitemapModal() {
    sitemapModal = null;
  }

  // --- Bing sitemap submit + IndexNow: per-site row buttons ---
  type RowState = { kind: 'loading' } | { kind: 'done'; msg: string } | { kind: 'error'; msg: string };

  let bingStates = $state<Map<string, RowState>>(new Map());
  let indexnowStates = $state<Map<string, RowState>>(new Map());

  function setBingState(key: string, st: RowState) {
    bingStates.set(key, st);
    bingStates = new Map(bingStates);
  }
  function setIndexnowState(key: string, st: RowState) {
    indexnowStates.set(key, st);
    indexnowStates = new Map(indexnowStates);
  }

  async function submitBingFor(s: { accountId: string; siteUrl: string }): Promise<boolean> {
    const key = `${s.accountId}|${s.siteUrl}`;
    setBingState(key, { kind: 'loading' });
    try {
      const res = await fetch('/properties/bing-sitemap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: s.siteUrl })
      });
      if (!res.ok) throw new Error(await res.text());
      const j = await res.json();
      if (j.ok === false) throw new Error(j.error || 'Bing error');
      setBingState(key, { kind: 'done', msg: 'submitted' });
      return true;
    } catch (e) {
      setBingState(key, { kind: 'error', msg: (e as Error).message });
      return false;
    }
  }

  async function indexNowFor(s: { accountId: string; siteUrl: string }): Promise<boolean> {
    const key = `${s.accountId}|${s.siteUrl}`;
    setIndexnowState(key, { kind: 'loading' });
    try {
      const res = await fetch('/properties/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: s.siteUrl })
      });
      if (!res.ok) throw new Error(await res.text());
      const r = await res.json();
      setIndexnowState(key, { kind: 'done', msg: `${r.submitted} URLs` });
      return true;
    } catch (e) {
      setIndexnowState(key, { kind: 'error', msg: (e as Error).message });
      return false;
    }
  }


  // Native <details> facets don't close on outside click — close any open one
  // when a pointerdown lands outside it (called from <svelte:window>).
  function closeFacets(except?: Element | null) {
    for (const d of document.querySelectorAll('details.facet[open]')) {
      if (!except || !d.contains(except)) (d as HTMLDetailsElement).open = false;
    }
  }

  // Copy every unique query of the current (filtered) view to the clipboard,
  // one per line — for pasting the keyword list elsewhere.
  let keysCopied = $state(false);
  let keysCopiedTimer: ReturnType<typeof setTimeout> | undefined;
  async function copyKeys() {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const q of aggregatedQueries) {
      if (!seen.has(q.query)) { seen.add(q.query); lines.push(q.query); }
    }
    await navigator.clipboard.writeText(lines.join('\n'));
    keysCopied = true;
    clearTimeout(keysCopiedTimer);
    keysCopiedTimer = setTimeout(() => (keysCopied = false), 1500);
  }

  async function resyncSitemaps() {
    const m = sitemapModal;
    if (!m) return;
    const n = m.current.length;
    if (!confirm(`Delete all ${n} registered sitemap(s) and submit the ${m.robots.length} from robots.txt?`)) return;
    sitemapModal = { ...m, resync: { kind: 'running' } };
    try {
      const res = await fetch('/properties/sitemaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: m.accountId, site: m.site, robots: m.robots })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const r = await res.json();
      // Reload the current list so the popup reflects the new state.
      const after = await fetch(
        `/properties/sitemaps?account=${encodeURIComponent(m.accountId)}&site=${encodeURIComponent(m.site)}`
      ).then((x) => x.json());
      if (!sitemapModal || sitemapModal.site !== m.site) return;
      sitemapModal = {
        ...sitemapModal, current: after.current, robots: after.robots, robotsError: after.robotsError,
        resync: { kind: 'done', deleted: r.deleted.length, submitted: r.submitted.length, failed: r.failed }
      };
    } catch (e) {
      if (!sitemapModal || sitemapModal.site !== m.site) return;
      sitemapModal = { ...sitemapModal, resync: { kind: 'error', message: (e as Error).message } };
    }
  }

  function fmtCacheTime(ts: number): string {
    const d = new Date(ts * 1000);
    const now = Date.now();
    const ageMin = Math.round((now - d.getTime()) / 60_000);
    if (ageMin < 1) return 'just now';
    if (ageMin < 60) return `${ageMin}m ago`;
    return `${Math.round(ageMin / 60)}h ago`;
  }

  function verdictBadge(v: string) {
    if (v === 'PASS') return { cls: 'badge-ok', label: 'Indexed' };
    if (v === 'PARTIAL') return { cls: 'badge-warn', label: 'Partial' };
    if (v === 'FAIL') return { cls: 'badge-bad', label: 'Not indexed' };
    if (v === 'NEUTRAL') return { cls: 'badge-muted', label: 'Neutral' };
    return { cls: 'badge-muted', label: 'Unknown' };
  }

  function fmtCrawlTime(ts?: string): string {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toISOString().slice(0, 10);
  }

  function shortUrl(u: string, site: string): string {
    try {
      const url = new URL(u);
      const sitePrefix = site.startsWith('sc-domain:') ? '' : site;
      if (sitePrefix && u.startsWith(sitePrefix)) return u.slice(sitePrefix.length) || '/';
      return url.pathname + url.search;
    } catch {
      return u;
    }
  }

  // 16-month query history in the chart grammar: position is the price line
  // (inverted, scale on the right), impressions are the volume band underneath.
  const HM = { top: 8, right: 46, bottom: 22, left: 8 };
  function buildHistoryChart(allRows: DailyAggregate[]) {
    const width = 800;
    const height = 220;
    const innerW = width - HM.left - HM.right;
    const innerH = height - HM.top - HM.bottom;
    const volH = Math.round(innerH * 0.28);
    const gap = 10;
    const priceH = innerH - volH - gap;

    // Drop days with no impressions — chart spans only the active range.
    const rows = allRows.filter((r) => r.impressions > 0);

    const base = {
      width, height, innerW, innerH, volH, gap, priceH, rows,
      xs: [] as number[],
      ys: [] as (number | null)[],
      posPath: '',
      barW: 0,
      bars: [] as { x: number; y: number; h: number }[],
      maxImpr: 0,
      minPos: 0,
      maxPos: 0,
      posTicks: [] as { y: number; label: string }[],
      dateLabels: [] as { x: number; date: string }[]
    };
    if (rows.length === 0) return base;

    const maxImpr = Math.max(1, ...rows.map((r) => r.impressions));
    const positions = rows.filter((r) => r.position > 0).map((r) => r.position);
    const minPos = positions.length > 0 ? Math.min(...positions) : 1;
    const maxPos = positions.length > 0 ? Math.max(...positions) : 100;
    const lo = Math.max(1, Math.floor(minPos));
    const hi = Math.max(lo + 1, Math.ceil(maxPos));

    // Position points by actual timestamp so date gaps are preserved proportionally.
    const tsOf = (date: string) => Date.parse(date);
    const minTs = tsOf(rows[0].date);
    const maxTs = tsOf(rows[rows.length - 1].date);
    const tsRange = maxTs - minTs || 1;
    const xs = rows.map((r) => (rows.length === 1 ? innerW / 2 : ((tsOf(r.date) - minTs) / tsRange) * innerW));
    // Position: lower number = better → drawn higher (inverted axis, 1 on top).
    const yOfPos = (p: number) => ((p - lo) / (hi - lo)) * priceH;
    const ys = rows.map((r) => (r.position > 0 ? yOfPos(r.position) : null));

    const barW = Math.max(1, Math.min(6, (innerW / rows.length) * 0.62));
    const bars = rows.map((r, i) => {
      const h = Math.max(0.5, (r.impressions / maxImpr) * volH);
      return { x: xs[i] - barW / 2, y: innerH - h, h };
    });

    let posPath = '';
    ys.forEach((y, i) => {
      if (y === null) return;
      posPath += `${posPath ? 'L' : 'M'}${xs[i].toFixed(1)},${y.toFixed(1)}`;
    });

    const span = hi - lo;
    const posTicks = Array.from({ length: 5 }, (_, i) => {
      const v = lo + (span * i) / 4;
      return { y: yOfPos(v), label: span >= 8 ? String(Math.round(v)) : v.toFixed(1) };
    });

    // Date labels: ~6 evenly spaced by index.
    const labelCount = Math.min(6, rows.length);
    const labelStep = Math.max(1, Math.floor(rows.length / labelCount));
    const dateLabels: { x: number; date: string }[] = [];
    for (let i = 0; i < rows.length; i += labelStep) {
      dateLabels.push({ x: xs[i], date: rows[i].date });
    }

    return { ...base, xs, ys, posPath, barW, bars, maxImpr, minPos, maxPos, posTicks, dateLabels };
  }

  // Hovered day of the expanded history chart (index into chart.rows). Local UI state only.
  let histHover = $state<number | null>(null);

  function histMove(e: PointerEvent, xs: number[], width: number) {
    if (xs.length === 0) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width - HM.left;
    let best = 0;
    for (let i = 1; i < xs.length; i++) {
      if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    }
    histHover = best;
  }

  function histKey(e: KeyboardEvent, n: number) {
    if (n === 0) return;
    if (e.key === 'ArrowLeft') histHover = Math.max(0, (histHover ?? n) - 1);
    else if (e.key === 'ArrowRight') histHover = Math.min(n - 1, (histHover ?? -1) + 1);
    else if (e.key === 'Escape') histHover = null;
    else return;
    e.preventDefault();
  }

  // Refresh promises fresh numbers: drop the GSC cache first, then re-run the
  // load and the pulse, which lives outside page data. A failed drop is said
  // out loud - otherwise the button would quietly show the cached numbers.
  let refreshError = $state<string | null>(null);
  async function refreshAll() {
    refreshError = null;
    try {
      const r = await fetch('/cache/clear', { method: 'POST' });
      if (!r.ok) refreshError = t('Кеш не сброшен (HTTP {status}) - цифры могут быть до часа старыми.', { status: r.status });
    } catch {
      refreshError = t('Кеш не сброшен: сервер не ответил - цифры могут быть до часа старыми.');
    }
    await invalidateAll();
    invalidatePulse();
  }
</script>

<svelte:head><title>{t('Сайты · gsc-hub')}</title></svelte:head>
<svelte:window
  onkeydown={(e) => { if (e.key === 'Escape') { if (sitemapModal) closeSitemapModal(); closeFacets(); } }}
  onpointerdown={(e) => closeFacets(e.target as Element)}
/>

{#snippet dlIcon()}
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13h10"/></svg>
{/snippet}
{#snippet xIcon()}
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
{/snippet}
{#snippet chevron(open: boolean)}
  <svg viewBox="0 0 16 16" class="inline-block h-3 w-3 align-[-1px] text-ink-4 transition-transform duration-150 print:hidden {open ? 'rotate-90' : ''}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>
{/snippet}

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs">
        <span>{t('Обзор')}</span>
        <span aria-hidden="true">/</span>
        <span class="text-ink-2">{t('Сайты')}</span>
      </nav>
      <h1 class="app-pagetitle">{t('Все сайты')}</h1>
      <p class="hidden text-xs text-ink-3 print:block">{t('Период')}: {data.days === 1 ? t('последние 24 часа') : plural('день', data.days)}</p>
    </div>
    <div class="app-toolbar-right">
      <PeriodPicker days={data.days} label={false} href={(d) => `?days=${d}&sort=${data.sort}&dir=${data.dir}${searchParam}`} />
      <span class="app-toolbar-divider" aria-hidden="true"></span>
      <a href="/dashboard?days={data.days}" class="btn btn-ghost">{t('Дашборд')}</a>
      <a href="/properties/striking?days={data.days}" class="btn btn-ghost" title={t('Аналитика по всем сайтам: striking distance, каннибализация, CTR, branded, decay')}>{t('Портфель')}</a>
      <div class="btn-group" role="group" aria-label={t('Отправить все сайты')}>
        <span class="btn-group-label">{t('Отправить все')}</span>
        <button type="button" class="btn btn-ghost" onclick={() => window.open(`${aiBase}/properties/submit-all?op=sitemap`, '_blank')} title={t('Переотправить карты сайта всех сайтов в Google')}>{t('Карты сайта')}</button>
        <button type="button" class="btn btn-ghost" onclick={() => window.open(`${aiBase}/properties/submit-all?op=bing`, '_blank')} title={t('Отправить все карты сайта в Bing')}>Bing</button>
        <button type="button" class="btn btn-ghost" onclick={() => window.open(`${aiBase}/properties/submit-all?op=indexnow`, '_blank')} title={t('Отправить URL всех сайтов в IndexNow')}>IndexNow</button>
      </div>
      <button type="button" class="btn btn-sec" onclick={refreshAll}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M13.5 8A5.5 5.5 0 1 1 11.8 4M13.5 2v3h-3"/></svg>
        {t('Обновить')}
      </button>
    </div>
  </header>
  {#if refreshError}<p class="app-errors">{tx(refreshError)}</p>{/if}
  <SnapshotStatus status={data.status} />

  <div class="desk">
    <!-- Portfolio pulse — all domains combined, own period switcher, Google update bands. -->
    <section class="pane">
      <div class="pane-head">
        <span>{t('Пульс портфеля')} <span class="aside ml-1 hidden text-ink-3 sm:inline">{t('все домены вместе')}</span></span>
        <div class="normal-case tracking-normal"><PeriodPicker days={pulseDays} label={false} custom={false} href={pulseHref} onpick={setPulse} /></div>
      </div>
      {#if pulseState.kind === 'loading'}
        <p class="loading py-16 text-center">{t('Загружаем пульс за {n} дн.…', { n: pulseDays })}</p>
      {:else if pulseState.kind === 'error'}
        <div class="flex items-center justify-center gap-2 py-16">
          <span class="text-err">{pulseState.message}</span>
          <button type="button" class="btn btn-sec btn-sm" onclick={() => loadPulse(pulseDays)}>{t('Повторить')}</button>
        </div>
      {:else if pulseState.kind === 'loaded'}
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-3 py-2">
          <div class="stat border-l-0 pl-0"><span class="stat-label">{t('Показы')}</span><span class="stat-value">{fmtNum(pulseState.data.totals.impressions)}</span></div>
          <div class="stat"><span class="stat-label">{t('Клики')}</span><span class="stat-value">{fmtNum(pulseState.data.totals.clicks)}</span></div>
          <div class="stat"><span class="stat-label">CTR</span><span class="stat-value">{fmtCtr(pulseState.data.totals.ctr)}</span></div>
          {#if pulseState.data.updates.length > 0}
            <div class="stat" title={t('Апдейты Google в этом окне (переключаются ниже)')}><span class="stat-label">{t('Апдейты')}</span><span class="stat-value">{pulseState.data.updates.length}</span></div>
          {/if}
        </div>
        <div class="px-3 pb-2 pt-2">
          <TrendChart
            points={pulseState.data.series}
            updates={pulseState.data.updates}
            events={pulseState.data.events}
            height={260}
            bind:showUpdates={showPulseUpdates}
            bind:showEvents={showPulseEvents}
          />
        </div>
      {/if}
    </section>

    {#if hideError}<p class="app-errors">{tx(hideError)}</p>{/if}
    {#if data.errors.length > 0}
      <div class="app-errors mb-0">
        <div class="app-errors-title">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="6" cy="6" r="5"/><path d="M6 3.5v3M6 8.5v.01"/></svg>
          {t('Ошибки')}
        </div>
        <ul class="ml-4 list-disc">
          {#each data.errors as e}
            <li><span class="font-medium">{e.accountEmail}</span>: {tx(e.reason)}</li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Watchlist: every site of every connected account for the selected period. -->
    <section class="pane min-w-0">
      <div class="pane-head">
        <span>{t('Список сайтов')} <span class="aside ml-1 text-ink-3">{data.days === 1 ? t('24 часа') : plural('день', data.days)}</span></span>
        {#if data.hiddenCount > 0}
          <a class="btn btn-ghost btn-sm normal-case tracking-normal" href={showHiddenHref(!data.showHidden)}>
            {data.showHidden ? t('Снова спрятать скрытые') : t('Показать скрытые: {n}', { n: data.hiddenCount })}
          </a>
        {/if}
      </div>

      <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-3 py-2">
        <div class="stat border-l-0 pl-0"><span class="stat-label">{t('Сайты')}</span><span class="stat-value">{fmtNum(totals.sites)}</span></div>
        <div class="stat"><span class="stat-label">{t('Показы')}</span><span class="stat-value">{fmtNum(totals.impressions)}</span></div>
        <div class="stat"><span class="stat-label">{t('Клики')}</span><span class="stat-value">{fmtNum(totals.clicks)}</span></div>
      </div>

      <div class="border-b border-line px-3 py-2"><SiteSearch /></div>

      {#if perAccount.length > 1}
        <div class="grid gap-px border-b border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {#each perAccount as a}
            <div class="min-w-0 bg-pane px-3 py-1.5">
              <div class="pii truncate text-[12.5px] font-medium text-ink">{a.label}</div>
              <div class="pii flex gap-3 font-mono text-[11px] tabular-nums text-ink-3">
                <span>{plural('сайт', a.sites)}</span>
                <span>{t('{n} показов', { n: fmtNum(a.impressions) })}</span>
                <span>{t('{n} кликов', { n: fmtNum(a.clicks) })}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      {#if data.totalSites === 0 && data.status.state === 'cold'}
        <!-- The status line above says what is loading or what failed. -->
      {:else if data.totalSites === 0}
        <div class="p-3">
          <div class="app-empty">
            <div class="app-empty-title">{t('Сайтов пока нет')}</div>
            <p class="app-empty-sub">{t('Подключите Google-аккаунт в')} <a class="link" href="/settings/accounts">{t('Настройках')}</a>.</p>
          </div>
        </div>
      {:else if data.total === 0 && searchQuery.trim()}
        <div class="app-empty" role="status">
          <div class="app-empty-title">{t('Подходящих сайтов нет')}</div>
          <p class="app-empty-sub">{t('Попробуйте другой домен, сбросьте поиск или покажите скрытые сайты.')}</p>
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="app-table">
            <thead>
              <tr>
                <th>
                  <a class="sort-th" href={sortHref('site', data.sort, data.dir, data.days)}>{t('URL сайта')}<SortCaret dir={sortIndicator('site', data.sort, data.dir)} /></a>
                  <span class="text-ink-4" aria-hidden="true"> · </span>
                  <a class="sort-th" href={sortHref('account', data.sort, data.dir, data.days)}>{t('Аккаунт')}<SortCaret dir={sortIndicator('account', data.sort, data.dir)} /></a>
                </th>
                <th class="print:hidden"><span class="sr-only">{t('Тренд')}</span></th>
                <th class="num">
                  <a class="sort-th" href={sortHref('clicks', data.sort, data.dir, data.days)}>{t('Клики')}<SortCaret dir={sortIndicator('clicks', data.sort, data.dir)} /></a>
                </th>
                <th class="num hidden sm:table-cell">
                  <a class="sort-th" href={sortHref('impressions', data.sort, data.dir, data.days)}>{t('Показы')}<SortCaret dir={sortIndicator('impressions', data.sort, data.dir)} /></a>
                </th>
                <th class="num hidden md:table-cell">
                  <a class="sort-th" href={sortHref('ctr', data.sort, data.dir, data.days)}>CTR<SortCaret dir={sortIndicator('ctr', data.sort, data.dir)} /></a>
                </th>
                <th class="num">
                  <a class="sort-th" href={sortHref('position', data.sort, data.dir, data.days)}>{t('Ср. поз.')}<SortCaret dir={sortIndicator('position', data.sort, data.dir)} /></a>
                </th>
                <th class="num hidden lg:table-cell" title={t('Дата создания сайта (таблица site_dates, заполняется внешним импортом)')}>
                  <a class="sort-th" href={sortHref('date', data.sort, data.dir, data.days)}>{t('Создан')}<SortCaret dir={sortIndicator('date', data.sort, data.dir)} /></a>
                </th>
                <th class="num hidden md:table-cell" title={t('Bing clicks · последние ~2 недели (не зависит от фильтра дней)')}>{t('Bing клики')}</th>
                <th class="num hidden md:table-cell" title={t('Bing impressions · последние ~2 недели (не зависит от фильтра дней)')}>{t('Bing показы')}</th>
                <th class="w-0 p-0 print:hidden"><span class="sr-only">{t('Действия')}</span></th>
              </tr>
            </thead>
            <tbody>
              {#each visibleSites as s}
                {@const sKey = `${s.accountId}|${s.siteUrl}`}
                {@const expanded = expandedSite === sKey}
                {@const isHidden = s.hidden}
                {@const subSt = submitStates.get(sKey)}
                {@const bSt = bingStates.get(sKey)}
                {@const iSt = indexnowStates.get(sKey)}
                <tr class="cursor-pointer {s.hasIndexNow ? '' : 'bg-warn-t/60 hover:bg-warn-t'} {isHidden ? 'is-hidden-row' : ''}" class:is-selected={expanded} class:has-status={!!(subSt || bSt || iSt)} onclick={() => toggleSite(s)} title={s.hasIndexNow ? undefined : t('Нет IndexNow-ключа ({key}.txt) — не настроен для Bing/IndexNow', { key: '{key}' })}>
                  <td class="min-w-56">
                    <div class="flex items-center gap-1.5 whitespace-nowrap">
                      {@render chevron(expanded)}
                      <!-- Имя ведёт на страницу сайта внутри хаба: туда ходят чаще, чем на сам сайт.
                           Внешний сайт — отдельной иконкой ↗, как у остальных внешних ссылок строки. -->
                      <a class="pii font-semibold text-ink hover:text-acc hover:underline" href={detailHref(s)} title={t('Аналитика сайта: striking distance, каннибализация, decay, CTR, здоровье')} onclick={(e) => e.stopPropagation()}>{displaySite(s.siteUrl)}</a>
                      <a
                        class="inline-flex h-4 items-center text-ink-4 hover:text-acc print:hidden"
                        href={siteHref(s.siteUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('Открыть {name} в новой вкладке', { name: displaySite(s.siteUrl) })}
                        aria-label={t('Открыть сайт в новой вкладке')}
                        onclick={(e) => e.stopPropagation()}
                      ><svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7 9"/></svg></a>
                      <a
                        class="badge badge-muted h-4 px-1 py-0 text-[10px] hover:bg-acc-t hover:text-acc print:hidden"
                        href={gscHref(s.siteUrl, s.accountEmail)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('Открыть в Google Search Console ({email})', { email: s.accountEmail })}
                        aria-label={t('Открыть в Google Search Console')}
                        onclick={(e) => e.stopPropagation()}
                      >GSC</a>
                      <a
                        class="inline-flex h-4 items-center opacity-60 transition-opacity hover:opacity-100 print:hidden"
                        href={siteSearchHref(s.siteUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('Google site:{name} — проверить индексацию', { name: displaySite(s.siteUrl) })}
                        aria-label={t('Поиск site: в Google')}
                        onclick={(e) => e.stopPropagation()}
                      ><img src={googleIcon} alt="Google" class="h-3.5 w-auto" /></a>
                      <a
                        class="inline-flex h-4 items-center opacity-60 transition-opacity hover:opacity-100 print:hidden"
                        href={bingWebmasterHref(s.siteUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Bing Webmaster — {displaySite(s.siteUrl)}"
                        aria-label={t('Открыть Bing Webmaster')}
                        onclick={(e) => e.stopPropagation()}
                      ><img src={bingIcon} alt="Bing" class="h-3.5 w-auto" /></a>
                    </div>
                    <div class="pii truncate pl-[18px] text-[11px] text-ink-3">
                      {s.accountLabel ?? s.accountEmail}{#if s.accountLabel}<span class="text-ink-4"> ({s.accountEmail})</span>{/if}
                    </div>
                  </td>
                  {#if s.summary !== null}
                    <td class="w-16 print:hidden">
                      {#if s.summary.series?.length}
                        <svg viewBox="0 0 64 16" class="block h-4 w-16" preserveAspectRatio="none" aria-hidden="true">
                          <path d={sparkPath(s.summary.series)} fill="none" stroke={SERIES.clicks} stroke-width="1.35" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
                        </svg>
                      {/if}
                    </td>
                    <td class="num app-num font-semibold"><span class="pii">{fmtNum(s.summary.clicks)}</span></td>
                    <td class="num app-num pii hidden sm:table-cell">{fmtNum(s.summary.impressions)}</td>
                    <td class="num app-num pii hidden md:table-cell">{fmtCtr(s.summary.ctr)}</td>
                    <td class="num app-num pii">{fmtPos(s.summary.position)}</td>
                  {:else if s.pending}
                    <td class="print:hidden"></td>
                    <td class="num loading text-[11px] text-ink-4" colspan="4">{t('загрузка…')}</td>
                  {:else}
                    <td class="print:hidden"></td>
                    <td class="num app-num text-ink-4" title={s.summaryError ?? ''}>—</td>
                    <td class="num app-num hidden text-ink-4 sm:table-cell" title={s.summaryError ?? ''}>—</td>
                    <td class="num app-num hidden text-ink-4 md:table-cell" title={s.summaryError ?? ''}>—</td>
                    <td class="num app-num text-ink-4" title={s.summaryError ?? ''}>
                      <span class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-dn align-middle" title={s.summaryError ?? 'error'}></span>—
                    </td>
                  {/if}
                  <td class="num app-num hidden whitespace-nowrap text-ink-3 lg:table-cell" title={t('Дата создания сайта')}>{fmtDate(s.createdAt)}</td>
                  <td class="num app-num hidden md:table-cell {s.bing ? '' : 'text-ink-4'}" title={t('Bing · последние ~2 недели')}>{s.bing ? fmtNum(s.bing.clicks) : '—'}</td>
                  <td class="num app-num hidden md:table-cell {s.bing ? '' : 'text-ink-4'}" title={t('Bing · последние ~2 недели')}>{s.bing ? fmtNum(s.bing.impressions) : '—'}</td>
                  <td class="row-tray print:hidden" onclick={(e) => e.stopPropagation()}>
                    <div class="row-tray-body">
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        title={t('Переотправить карты сайта в Google')}
                        disabled={subSt?.kind === 'loading'}
                        onclick={(e) => { e.stopPropagation(); submitSitemapFor({ accountId: s.accountId, siteUrl: s.siteUrl }); }}
                      >{subSt?.kind === 'loading' ? '…' : t('Отправить карту сайта')}</button>
                      {#if subSt?.kind === 'done'}
                        <span class="app-num text-[11px] {subSt.failed > 0 ? 'text-warn' : 'text-up'}" title={subSt.failed > 0 ? subSt.failReasons.join('\n') : `${t('источник')}: ${subSt.source}`}><svg viewBox="0 0 12 12" class="inline-block h-3 w-3 align-[-2px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-6"/></svg> {subSt.submitted}{#if subSt.failed > 0} · <svg viewBox="0 0 12 12" class="inline-block h-3 w-3 align-[-2px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg> {subSt.failed}{/if}</span>
                      {:else if subSt?.kind === 'error'}
                        <span class="text-[11px] text-dn" title={subSt.message}><svg viewBox="0 0 12 12" class="inline-block h-3 w-3 align-[-2px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg> failed</span>
                      {/if}
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        title={t('Отправить карту сайта в Bing')}
                        disabled={bSt?.kind === 'loading'}
                        onclick={(e) => { e.stopPropagation(); submitBingFor({ accountId: s.accountId, siteUrl: s.siteUrl }); }}
                      >{bSt?.kind === 'loading' ? '…' : 'Bing'}</button>
                      {#if bSt?.kind === 'done'}
                        <span class="text-[11px] text-up" aria-label="ok"><svg viewBox="0 0 12 12" class="inline-block h-3 w-3 align-[-2px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-6"/></svg></span>
                      {:else if bSt?.kind === 'error'}
                        <span class="text-[11px] text-dn" title={bSt.msg} aria-label="failed"><svg viewBox="0 0 12 12" class="inline-block h-3 w-3 align-[-2px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg></span>
                      {/if}
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        title={t('Отправить URL из карты в IndexNow (Bing)')}
                        disabled={iSt?.kind === 'loading'}
                        onclick={(e) => { e.stopPropagation(); indexNowFor({ accountId: s.accountId, siteUrl: s.siteUrl }); }}
                      >{iSt?.kind === 'loading' ? '…' : 'IndexNow'}</button>
                      {#if iSt?.kind === 'done'}
                        <span class="text-[11px] text-up" title={iSt.msg} aria-label="ok"><svg viewBox="0 0 12 12" class="inline-block h-3 w-3 align-[-2px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-6"/></svg></span>
                      {:else if iSt?.kind === 'error'}
                        <span class="text-[11px] text-dn" title={iSt.msg} aria-label="failed"><svg viewBox="0 0 12 12" class="inline-block h-3 w-3 align-[-2px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg></span>
                      {/if}
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        title={t('Карты сайта: просмотр и управление')}
                        onclick={(e) => { e.stopPropagation(); openSitemapModal({ accountId: s.accountId, siteUrl: s.siteUrl }); }}
                      >{t('Карты сайта')}</button>
                      <span class="app-toolbar-divider hidden md:block" aria-hidden="true"></span>
                      <span class="hidden items-center gap-0.5 md:flex">
                      <a
                        class="btn btn-ghost btn-sm"
                        href="/properties/export?account={encodeURIComponent(s.accountId)}&site={encodeURIComponent(s.siteUrl)}&days={data.days}&dim=query"
                      >{@render dlIcon()}{t('CSV запросов')}</a>
                      <a
                        class="btn btn-ghost btn-sm"
                        href="/properties/export?account={encodeURIComponent(s.accountId)}&site={encodeURIComponent(s.siteUrl)}&days={data.days}&dim=page"
                      >{@render dlIcon()}{t('CSV страниц')}</a>
                      </span>
                      <span class="hidden md:inline-flex">
                    {#if !isHidden}
                      <button type="button" class="btn btn-ghost btn-sm" onclick={() => hideSite(s)}>{t('Скрыть')}</button>
                    {:else}
                      <button type="button" class="btn btn-sec btn-sm" onclick={() => unhideSite(s)}>{t('Вернуть')}</button>
                    {/if}
                      </span>
                    </div>
                  </td>
                </tr>
                {#if expanded}
                  <tr class="bg-sunk hover:bg-sunk">
                    <td class="px-3 py-3" colspan="12">
                      {#if inspectState.kind === 'loading'}
                        <p class="loading">{t('Проверяем {n} главных URL (URL Inspection API, ~3–5 с)…', { n: inspectState.total })}</p>
                      {:else if inspectState.kind === 'error'}
                        <p class="text-err">{inspectState.message}</p>
                      {:else if inspectState.kind === 'loaded'}
                        {@const loadedState = inspectState}
                        <div class="mb-2 flex items-center justify-between gap-3 text-xs text-ink-3">
                          <span>
                            {#if loadedState.source === 'page-entries'}
                              {t('Топ-{n} URL по показам за текущий период.', { n: loadedState.results.length })}
                            {:else if loadedState.source === 'page-entries+sitemap'}
                              {t('{n} URL (топ по показам плюс добор из карты сайта).', { n: loadedState.results.length })}
                            {:else}
                              {t('{n} URL из карты сайта (без показов за текущий период).', { n: loadedState.results.length })}
                            {/if}
                            {#if loadedState.cached}<span class="ml-1 text-ink-4">· {t('из кеша')} {fmtCacheTime(loadedState.fetchedAt)}</span>{:else}<span class="ml-1 text-ink-4">· {t('свежие')}</span>{/if}
                            {#if loadedState.sitemapNote}<span class="ml-2 text-warn" title={tx(loadedState.sitemapNote)}>({t('заметка по карте сайта')})</span>{/if}
                          </span>
                          <button type="button" class="btn btn-sec btn-sm" onclick={(e) => { e.stopPropagation(); refreshInspection({ accountId: loadedState.accountId, siteUrl: loadedState.site }); }}>
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M13.5 8A5.5 5.5 0 1 1 11.8 4M13.5 2v3h-3"/></svg>
                            {t('Обновить принудительно')}
                          </button>
                        </div>
                        <div class="overflow-x-auto rounded-sm border border-line bg-pane">
                          <table class="app-table">
                            <thead>
                              <tr>
                                <th>URL</th>
                                <th>{t('Статус')}</th>
                                <th>{t('Охват')}</th>
                                <th>{t('Robots')}</th>
                                <th>{t('Последний обход')}</th>
                                <th>{t('Canonical')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {#each loadedState.results as r}
                                <tr>
                                  <td>
                                    <a class="font-mono text-[11.5px] text-acc hover:underline" href={r.inspectionUrl} target="_blank" rel="noopener noreferrer">{shortUrl(r.inspectionUrl, loadedState.site)}</a>
                                  </td>
                                  {#if r.status === 'error'}
                                    <td colspan="5" class="text-err">{tx(r.error)}</td>
                                  {:else if r.index}
                                    {@const v = verdictBadge(r.index.verdict)}
                                    <td><span class="badge {v.cls}">{v.label}</span></td>
                                    <td class="text-ink-2">{r.index.coverageState ?? '—'}</td>
                                    <td class={r.index.robotsTxtState === 'DISALLOWED' ? 'text-dn' : 'text-ink-2'}>{r.index.robotsTxtState ?? '—'}</td>
                                    <td class="app-num text-ink-3">{fmtCrawlTime(r.index.lastCrawlTime)}</td>
                                    <td class="text-ink-3">
                                      {#if r.index.googleCanonical && r.index.userCanonical && r.index.googleCanonical !== r.index.userCanonical}
                                        <span class="badge badge-warn" title={`Google: ${r.index.googleCanonical}\n${t('Вы')}: ${r.index.userCanonical}`}>{t('Расхождение')}</span>
                                      {:else if r.index.googleCanonical}
                                        <span class="font-mono text-[11px]">{shortUrl(r.index.googleCanonical, loadedState.site)}</span>
                                      {:else}
                                        —
                                      {/if}
                                    </td>
                                  {/if}
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        </div>
                      {/if}
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      <div class="px-3 pb-3"><Pager page={data.page} pageCount={data.pageCount} total={data.total} /></div>
    </section>

    {#snippet topStatus(state: { kind: string; message?: string }, st: TopStatus | undefined)}
      {#if state.kind === 'error'}
        <p class="border-b border-line-soft px-3 py-1.5 text-[11px] text-err">{t('Не удалось загрузить:')} {state.message} <button type="button" class="btn btn-ghost btn-sm" onclick={loadTop}>{t('Повторить')}</button></p>
      {:else if state.kind !== 'loaded'}
        <p class="loading border-b border-line-soft px-3 py-1.5 text-[11px]">{t('Загрузка…')}</p>
      {:else if st?.refreshing}
        <p class="loading border-b border-line-soft px-3 py-1.5 text-[11px]">{st.state === 'cold' ? t('Собираем') : t('Обновляем')} {t('строки: {done} из {total} сайтов', { done: st.done, total: st.total || '…' })}</p>
      {:else if st?.error}
        <p class="border-b border-line-soft px-3 py-1.5 text-[11px] text-err">{t('Последнее обновление не удалось:')} {st.error}</p>
      {/if}
    {/snippet}

    {#if data.totalSites > 0}
      <section class="pane min-w-0" use:observeTop>
        <div class="pane-head">
          <span>{t('Топ запросов')} <span class="aside ml-1 font-mono text-ink-3">{aggregatedQueries.length} of {topQ ? topQ.sourceRows : '…'}</span></span>
          <div class="flex items-center gap-1.5 normal-case tracking-normal">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onclick={copyKeys}
              title={t('Скопировать все уникальные запросы текущего (отфильтрованного) вида, по одному на строку')}
            >{keysCopied ? t('Скопировано') : t('Скопировать запросы')}</button>
            <a
              class="btn btn-sec btn-sm"
              href="/properties/queries-export?days={data.days}"
              download
              title={t('Скачать все запросы (запрос · страна · показы · клики) с учётом фильтров')}
            >{@render dlIcon()}{t('Выгрузить всё в CSV')}</a>
          </div>
        </div>
        <p class="border-b border-line-soft px-3 py-1.5 font-mono text-[11px] tracking-tight text-ink-3">{t('видимые сайты · запрос × страница × страна · строк с сайта —')} <a class="underline hover:text-acc" href="/settings/portfolio">{t('настройки')}</a> · {t('клик по позиции → выдача · клик по строке → история за 16 мес.')}</p>
        {@render topStatus(topQueriesState, topQ?.status)}
        {#snippet facet(label: string, options: string[], selected: Set<string>, onToggle: (v: string) => void, onClear: () => void, search: string, onSearch: (v: string) => void)}
          <details class="facet relative">
            <summary class="btn btn-sec btn-sm list-none [&::-webkit-details-marker]:hidden {selected.size > 0 ? 'border-acc/40 text-acc' : ''}">
              {label}<span class="font-normal text-ink-3">{selected.size > 0 ? ` · ${selected.size}` : ' · all'}</span>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>
            </summary>
            <div class="absolute z-20 mt-1 flex max-h-72 w-52 flex-col rounded-sm border border-line bg-pane p-1 shadow-pop">
              {#if options.length === 0}
                <div class="px-2 py-1 text-ink-4">—</div>
              {:else}
                {@const shown = search.trim() ? options.filter((o) => o.toLowerCase().includes(search.trim().toLowerCase())) : options}
                <input
                  class="input mb-1 h-6 w-full text-[11.5px]"
                  placeholder={t('поиск…')}
                  value={search}
                  oninput={(e) => onSearch(e.currentTarget.value)}
                />
                {#if selected.size > 0}
                  <button type="button" class="btn btn-ghost btn-sm mb-1 w-full justify-start text-acc" onclick={onClear}>{t('Сбросить ({n})', { n: selected.size })}</button>
                {/if}
                <div class="overflow-auto">
                  {#each shown as opt}
                    <label class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 hover:bg-sunk">
                      <input type="checkbox" checked={selected.has(opt)} onchange={() => onToggle(opt)} />
                      <span class="break-all font-mono text-[11px] text-ink-2">{opt}</span>
                    </label>
                  {/each}
                  {#if shown.length === 0}
                    <div class="px-2 py-1 text-ink-4">{t('нет совпадений')}</div>
                  {/if}
                </div>
              {/if}
            </div>
          </details>
        {/snippet}
        <div class="flex flex-wrap items-center gap-2 border-b border-line-soft px-3 py-2 text-xs print:hidden">
          <span class="text-[11px] font-medium uppercase tracking-wide text-ink-3">{t('Фильтр')}</span>
          {@render facet(t('Страна'), availableCountries, selectedCountries, toggleCountry, () => (selectedCountries = new Set()), countrySearch, (v) => (countrySearch = v))}
          {@render facet(t('Домен'), availableDomains, selectedDomains, toggleDomain, () => (selectedDomains = new Set()), domainSearch, (v) => (domainSearch = v))}
          <select class="input h-6 text-xs" bind:value={querySource} title={t('Откуда ключ — GSC и/или Bing')}>
            <option value="all">{t('Источник · все')}</option>
            <option value="gsc">{t('только GSC')}</option>
            <option value="bing">{t('только Bing')}</option>
            <option value="both">{t('в обоих')}</option>
          </select>
          <span class="inline-flex items-center gap-1 text-ink-3">
            {t('Ср. поз.')}
            <input type="number" min="0" step="0.1" class="input app-num h-6 w-14 px-1.5 text-xs" placeholder={t('от')} bind:value={posMin} title={t('Avg Pos от (включительно)')} />
            <span>–</span>
            <input type="number" min="0" step="0.1" class="input app-num h-6 w-14 px-1.5 text-xs" placeholder={t('до')} bind:value={posMax} title={t('Avg Pos до (включительно), пусто = без верхней границы')} />
          </span>
          {#if selectedCountries.size > 0 || selectedDomains.size > 0 || querySource !== 'gsc' || (posMin ?? 0) > 0 || posMax != null}
            <button type="button" class="btn btn-ghost btn-sm text-acc" onclick={() => { selectedCountries = new Set(); selectedDomains = new Set(); querySource = 'gsc'; posMin = 0; posMax = null; }}>{t('сбросить всё')}</button>
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2 text-xs print:hidden">
          <span class="text-ink-3">{t('Скрыть запросы, содержащие:')}</span>
          {#each queryFilters as f}
            <span class="badge badge-muted gap-0.5 pr-0.5 font-mono">
              {f.pattern}
              <button type="button" class="inline-flex h-4 w-4 items-center justify-center rounded-xs text-ink-4 hover:bg-dn-t hover:text-dn" title={t('Убрать фильтр')} aria-label={t('Убрать фильтр {pattern}', { pattern: f.pattern })} onclick={() => removeQueryFilter(f.id)}>
                <svg viewBox="0 0 16 16" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
              </button>
            </span>
          {/each}
          <form class="inline-flex items-center gap-1" onsubmit={(e) => { e.preventDefault(); addQueryFilter(newQueryFilter); }}>
            <input class="input h-6 w-24 px-1.5 font-mono text-xs" placeholder="site:" bind:value={newQueryFilter} />
            <button type="submit" class="btn btn-sec btn-sm">{t('Добавить')}</button>
          </form>
          {#if hiddenQueryCount > 0 || showFilteredQueries}
            <button type="button" class="btn btn-ghost btn-sm ml-auto" onclick={() => (showFilteredQueries = !showFilteredQueries)}>
              {showFilteredQueries ? 'hide filtered' : `show ${hiddenQueryCount} filtered`}
            </button>
          {/if}
        </div>
        <div class="overflow-x-auto">
          <table class="app-table">
            <thead>
              <tr>
                <th class="sort-th" onclick={() => toggleQSort('query')}>{t('Запрос')}<SortCaret dir={qIndicator('query')} /></th>
                <th class="sort-th hidden md:table-cell" onclick={() => toggleQSort('page')}>{t('Страница')}<SortCaret dir={qIndicator('page')} /></th>
                <th class="sort-th" onclick={() => toggleQSort('country')}>{t('Страна')}<SortCaret dir={qIndicator('country')} /></th>
                <th class="sort-th num" onclick={() => toggleQSort('clicks')}>{t('GSC клики')}<SortCaret dir={qIndicator('clicks')} /></th>
                <th class="sort-th num hidden sm:table-cell" onclick={() => toggleQSort('impressions')}>{t('GSC показы')}<SortCaret dir={qIndicator('impressions')} /></th>
                <th class="sort-th num hidden md:table-cell" onclick={() => toggleQSort('ctr')}>CTR<SortCaret dir={qIndicator('ctr')} /></th>
                <th class="sort-th num" onclick={() => toggleQSort('position')}>{t('Ср. поз.')}<SortCaret dir={qIndicator('position')} /></th>
                <th class="sort-th num" onclick={() => toggleQSort('bingClicks')}>{t('Bing клики')}<SortCaret dir={qIndicator('bingClicks')} /></th>
                <th class="sort-th num hidden sm:table-cell" onclick={() => toggleQSort('bingImpr')}>{t('Bing показы')}<SortCaret dir={qIndicator('bingImpr')} /></th>
              </tr>
            </thead>
            <tbody>
              {#each aggregatedQueries as q}
                {@const qKey = `${q.query}|${q.page}|${q.country}`}
                {@const serpUrl = googleSerpUrl(q.query, q.country)}
                {@const pos = q.gsc?.position ?? q.bing?.position ?? 0}
                {@const posTone = pos > 0 && pos <= 10 ? 'text-up' : pos > 0 && pos <= 20 ? 'text-warn' : 'text-ink'}
                <tr class="group cursor-pointer" class:is-selected={expandedQuery === qKey} onclick={() => toggleQuery(q.query, q.page, q.country)}>
                  <td>
                    <div class="flex items-center gap-1.5">
                      {@render chevron(expandedQuery === qKey)}
                      <span class="text-ink">{q.query}</span>
                      {#if q.gsc}<span class="badge badge-muted px-1 py-0 text-[10px]" title={t('Есть в Google Search Console')}>GSC</span>{/if}
                      {#if q.bing}<span class="badge badge-acc px-1 py-0 text-[10px]" title={t('Есть в Bing')}>Bing</span>{/if}
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm btn-icon h-5 w-5 text-ink-4 opacity-0 hover:text-dn focus:opacity-100 group-hover:opacity-100 print:hidden"
                        title={t('Скрыть этот запрос (добавит его в фильтр)')}
                        aria-label={t('Скрыть этот запрос')}
                        onclick={(e) => { e.stopPropagation(); addQueryFilter(q.query); }}
                      >{@render xIcon()}</button>
                    </div>
                  </td>
                  <td class="hidden break-all md:table-cell">
                    {#if q.page}
                      <a class="text-acc hover:underline" href={q.page} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>{q.page}</a>
                    {:else}
                      <span class="font-mono text-[11px] text-ink-3" title={t('Только Bing — страница неизвестна, показан домен')}>{q.domain}</span>
                    {/if}
                  </td>
                  <td>
                    {#if q.country}
                      <span class="badge badge-muted font-mono text-[10px] uppercase tracking-[0.08em]">{q.country}</span>
                    {/if}
                  </td>
                  <td class="num app-num {q.gsc ? '' : 'text-ink-4'}">{q.gsc ? fmtNum(q.gsc.clicks) : '—'}</td>
                  <td class="num app-num hidden sm:table-cell {q.gsc ? '' : 'text-ink-4'}">{q.gsc ? fmtNum(q.gsc.impressions) : '—'}</td>
                  <td class="num app-num hidden md:table-cell {q.gsc ? '' : 'text-ink-4'}">{q.gsc ? fmtCtr(q.gsc.ctr) : '—'}</td>
                  <td class="num app-num font-semibold {posTone}">
                    {#if q.gsc}
                      {#if serpUrl}
                        <a class="group/serp inline-flex items-baseline gap-0.5 hover:text-acc hover:underline" href={serpUrl} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()} title={t('Открыть выдачу Google · {country}', { country: q.country.toUpperCase() })}>{fmtPos(q.gsc.position)}<svg viewBox="0 0 16 16" class="h-2.5 w-2.5 self-center text-ink-4 group-hover/serp:text-acc" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5"/></svg></a>
                      {:else}
                        {fmtPos(q.gsc.position)}
                      {/if}
                    {:else}
                      <span class="font-normal text-ink-4">—</span>
                    {/if}
                  </td>
                  <td class="num app-num {q.bing ? '' : 'text-ink-4'}">{q.bing ? fmtNum(q.bing.clicks) : '—'}</td>
                  <td class="num app-num hidden sm:table-cell {q.bing ? '' : 'text-ink-4'}">{q.bing ? fmtNum(q.bing.impressions) : '—'}</td>
                </tr>
                {#if expandedQuery === qKey}
                  <tr class="bg-sunk hover:bg-sunk">
                    <td class="px-3 py-3" colspan="9">
                      {#if historyState.kind === 'loading'}
                        <p class="loading">{t('Загружаем историю за 16 месяцев…')}</p>
                      {:else if historyState.kind === 'error'}
                        <p class="text-err">{t('Ошибка:')} {historyState.message}</p>
                      {:else if historyState.kind === 'loaded'}
                        {@const chart = buildHistoryChart(historyState.aggregated)}
                        {#if historyState.aggregated.length === 0 || chart.rows.length === 0}
                          <p class="loading">{t('По этому запросу на видимых сайтах нет данных за 16 месяцев.')}</p>
                        {:else}
                          {@const n = chart.rows.length}
                          {@const hi = histHover !== null && histHover < n ? histHover : null}
                          {@const shownRow = chart.rows[hi ?? n - 1]}
                          <div class="rounded-sm border border-line bg-pane px-3 pb-2 pt-1.5">
                            <!-- readout row: hovered day (or the latest one) -->
                            <div class="mb-1 flex min-h-[24px] flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
                              <span class="font-mono text-[11.5px] text-ink-3">{shownRow.date}</span>
                              <span class="inline-flex items-center gap-1.5">
                                <i class="inline-block h-0.5 w-3 rounded-full" style:background={SERIES.pos}></i>{t('Позиция')}
                                <b class="font-mono text-[11.5px] font-semibold text-ink">{shownRow.position > 0 ? fmtPos(shownRow.position) : '—'}</b>
                              </span>
                              <span class="inline-flex items-center gap-1.5">
                                <i class="inline-block h-2.5 w-2.5 rounded-xs opacity-60" style:background={SERIES.impr}></i>{t('Показы')}
                                <b class="font-mono text-[11.5px] font-semibold text-ink">{fmtNum(shownRow.impressions)}</b>
                              </span>
                              <span class="ml-auto text-[11px] text-ink-3">{t('Сумма по {sites} · позиция {min}–{max} · макс. показов {impr}', { sites: plural('сайт', historyState.entries.length), min: fmtDec(chart.minPos, 1), max: fmtDec(chart.maxPos, 1), impr: fmtNum(chart.maxImpr) })}</span>
                            </div>
                            <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
                            <svg
                              viewBox="0 0 {chart.width} {chart.height}"
                              class="block w-full touch-none select-none outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-acc"
                              role="application"
                              tabindex="0"
                              aria-label={t('История запроса за 16 месяцев: позиция и показы. Стрелки влево и вправо читают отдельные дни.')}
                              onpointermove={(e) => histMove(e, chart.xs, chart.width)}
                              onpointerleave={() => (histHover = null)}
                              onkeydown={(e) => histKey(e, n)}
                            >
                              <g transform="translate({HM.left},{HM.top})">
                                <!-- position grid + right axis (inverted: 1 on top) -->
                                {#each chart.posTicks as it, i (i)}
                                  <line x1="0" x2={chart.innerW} y1={it.y} y2={it.y} stroke={AXIS.grid} />
                                  <text x={chart.innerW + 8} y={it.y + 3.5} font-size="10.5" fill={AXIS.text} class="font-mono">{it.label}</text>
                                {/each}

                                <!-- volume band: impressions -->
                                <line x1="0" x2={chart.innerW} y1={chart.innerH - chart.volH - chart.gap / 2} y2={chart.innerH - chart.volH - chart.gap / 2} stroke={AXIS.line} />
                                <text x={chart.innerW + 8} y={chart.innerH - chart.volH + 7} font-size="10.5" fill={AXIS.text} class="font-mono">{fmtNum(chart.maxImpr)}</text>
                                <text x="4" y={chart.innerH - chart.volH + 8} font-size="10" fill={AXIS.text}>{t('Показы')}</text>
                                {#each chart.bars as bar, i (i)}
                                  <rect
                                    x={bar.x}
                                    y={bar.y}
                                    width={chart.barW}
                                    height={bar.h}
                                    fill={hi === i ? AXIS.ink : SERIES.impr}
                                    fill-opacity={hi === i ? 0.75 : 0.45}
                                  />
                                {/each}

                                <!-- position line -->
                                <path d={chart.posPath} fill="none" stroke={SERIES.pos} stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />

                                <!-- date labels -->
                                {#each chart.dateLabels as lab (lab.date)}
                                  <text x={lab.x} y={chart.innerH + 15} font-size="10.5" fill={AXIS.text} text-anchor="middle" class="font-mono">{lab.date}</text>
                                {/each}

                                <!-- crosshair -->
                                {#if hi !== null}
                                  {@const hx = chart.xs[hi]}
                                  {@const hy = chart.ys[hi]}
                                  <line x1={hx} x2={hx} y1="0" y2={chart.innerH} stroke={AXIS.hover} stroke-dasharray="3 3" />
                                  {#if hy !== null}
                                    <line x1="0" x2={chart.innerW} y1={hy} y2={hy} stroke={AXIS.hover} stroke-dasharray="3 3" stroke-opacity="0.6" />
                                    <circle cx={hx} cy={hy} r="3.5" fill={SERIES.pos} stroke={AXIS.onInk} stroke-width="1.5" />
                                    <g transform="translate({chart.innerW + 2},{hy})">
                                      <rect y="-9" width={HM.right - 4} height="18" rx="2" fill={AXIS.ink} />
                                      <text x={(HM.right - 4) / 2} y="3.5" font-size="10.5" font-weight="600" fill={AXIS.onInk} text-anchor="middle" class="font-mono">{fmtPos(chart.rows[hi].position)}</text>
                                    </g>
                                  {/if}
                                  <g transform="translate({Math.min(Math.max(hx, 38), chart.innerW - 38)},{chart.innerH + 3})">
                                    <rect x="-38" width="76" height="17" rx="2" fill={AXIS.ink} />
                                    <text y="12" font-size="10.5" fill={AXIS.onInk} text-anchor="middle" class="font-mono">{chart.rows[hi].date}</text>
                                  </g>
                                {/if}
                              </g>
                            </svg>
                          </div>
                        {/if}
                      {/if}
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
        {#if topQ && aggregatedQueries.length < topQ.matched && qLimit < TOP_MAX}
          <div class="border-t border-line-soft px-3 py-2"><button type="button" class="btn btn-sec btn-sm" onclick={() => (qLimit = Math.min(TOP_MAX, qLimit + TOP_STEP))}>{t('Показать ещё')} <span class="app-num text-ink-3">{aggregatedQueries.length} {t('из')} {topQ.matched}</span></button></div>
        {/if}
      </section>
    {/if}

    {#if data.totalSites > 0}
      <section class="pane min-w-0">
        <div class="pane-head">
          <span>{t('Топ страниц')} <span class="aside ml-1 text-ink-3">{t('Только по видимым сайтам. Строк с сайта:')} <a class="underline hover:text-acc" href="/settings/portfolio">{t('настройки')}</a>.</span></span>
          <span class="aside font-mono">{aggregatedPages.length} of {topP ? topP.sourceRows : '…'}</span>
        </div>
        {@render topStatus(topPagesState, topP?.status)}
        <div class="overflow-x-auto">
          <table class="app-table">
            <thead>
              <tr>
                <th class="sort-th" onclick={() => togglePSort('page')}>{t('Страница')}<SortCaret dir={pIndicator('page')} /></th>
                <th class="sort-th num" onclick={() => togglePSort('clicks')}>{t('Клики')}<SortCaret dir={pIndicator('clicks')} /></th>
                <th class="sort-th num hidden sm:table-cell" onclick={() => togglePSort('impressions')}>{t('Показы')}<SortCaret dir={pIndicator('impressions')} /></th>
                <th class="sort-th num hidden md:table-cell" onclick={() => togglePSort('ctr')}>CTR<SortCaret dir={pIndicator('ctr')} /></th>
                <th class="sort-th num" onclick={() => togglePSort('position')}>{t('Ср. поз.')}<SortCaret dir={pIndicator('position')} /></th>
              </tr>
            </thead>
            <tbody>
              {#each aggregatedPages as p}
                <tr>
                  <td class="break-all">
                    <a class="text-acc hover:underline" href={p.page} target="_blank" rel="noopener noreferrer">{p.page}</a>
                  </td>
                  <td class="num app-num">{fmtNum(p.clicks)}</td>
                  <td class="num app-num hidden sm:table-cell">{fmtNum(p.impressions)}</td>
                  <td class="num app-num hidden md:table-cell">{fmtCtr(p.ctr)}</td>
                  <td class="num app-num">{fmtPos(p.position)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if topP && aggregatedPages.length < topP.matched && pLimit < TOP_MAX}
          <div class="border-t border-line-soft px-3 py-2"><button type="button" class="btn btn-sec btn-sm" onclick={() => (pLimit = Math.min(TOP_MAX, pLimit + TOP_STEP))}>{t('Показать ещё')} <span class="app-num text-ink-3">{aggregatedPages.length} {t('из')} {topP.matched}</span></button></div>
        {/if}
      </section>
    {/if}
  </div>

  {#if sitemapModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onclick={closeSitemapModal} role="presentation">
      <div class="max-h-[85vh] w-full max-w-lg overflow-auto rounded-sm border border-line bg-pane shadow-pop" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="pane-head sticky top-0 bg-pane">
          <h2 class="truncate">{t('Карты сайта')} — <span class="normal-case tracking-normal text-ink">{sitemapModal.title}</span></h2>
          <button class="btn btn-ghost btn-sm btn-icon" onclick={closeSitemapModal} aria-label={t('Закрыть')}>{@render xIcon()}</button>
        </div>

        <div class="pane-body">
          {#if sitemapModal.load === 'loading'}
            <p class="loading">{t('Загрузка…')}</p>
          {:else if sitemapModal.load === 'error'}
            <p class="text-err">{sitemapModal.loadError}</p>
          {:else}
            <div class="mb-4">
              <div class="stat-label mb-1">{t('Зарегистрированы в Search Console ({n})', { n: sitemapModal.current.length })}</div>
              {#if sitemapModal.current.length === 0}
                <p class="text-[12.5px] text-ink-4">{t('Нет.')}</p>
              {:else}
                <ul class="divide-y divide-line-soft rounded-sm border border-line">
                  {#each sitemapModal.current as sm}
                    <li class="break-all px-2 py-1 font-mono text-[11.5px]">
                      <span class="text-ink">{sm.path}</span>
                      {#if sm.errors && sm.errors !== '0'}<span class="badge badge-bad ml-1 font-sans">{t('ошибок: {n}', { n: sm.errors })}</span>{/if}
                      {#if sm.isPending}<span class="badge badge-warn ml-1 font-sans">pending</span>{/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>

            <div class="mb-4">
              <div class="stat-label mb-1">{t('Указаны в robots.txt ({n})', { n: sitemapModal.robots.length })}</div>
              {#if sitemapModal.robotsError}
                <p class="notice notice-warn">robots.txt: {tx(sitemapModal.robotsError)}</p>
              {:else if sitemapModal.robots.length === 0}
                <p class="text-[12.5px] text-ink-4">{t('Не найдено.')}</p>
              {:else}
                <ul class="divide-y divide-line-soft rounded-sm border border-line">
                  {#each sitemapModal.robots as r}
                    <li class="break-all px-2 py-1 font-mono text-[11.5px] text-ink">{r}</li>
                  {/each}
                </ul>
              {/if}
            </div>

            {#if sitemapModal.resync.kind === 'done'}
              <div class="mb-3 rounded-sm border border-up/25 bg-up-t px-3 py-2 text-[12.5px] text-up">
                {t('Удалено')} <span class="app-num">{sitemapModal.resync.deleted}</span>, {t('отправлено')} <span class="app-num">{sitemapModal.resync.submitted}</span>.
                {#if sitemapModal.resync.failed.length > 0}
                  <div class="mt-1 text-dn">{t('Не удалось: {n}', { n: sitemapModal.resync.failed.length })}
                    {#each sitemapModal.resync.failed as f}<div class="break-all text-xs">{f.op} {f.path}: {f.reason}</div>{/each}
                  </div>
                {/if}
              </div>
            {:else if sitemapModal.resync.kind === 'error'}
              <div class="app-errors mb-3">{sitemapModal.resync.message}</div>
            {/if}

            <div class="flex items-center justify-between gap-2">
              <button class="btn btn-ghost" onclick={closeSitemapModal}>{t('Закрыть')}</button>
              <button
                class="btn btn-danger"
                disabled={sitemapModal.resync.kind === 'running' || sitemapModal.robots.length === 0}
                title={sitemapModal.robots.length === 0 ? t('В robots.txt нет карт сайта') : t('Удалить все зарегистрированные карты, затем отправить карты из robots.txt')}
                onclick={resyncSitemaps}
              >{sitemapModal.resync.kind === 'running' ? t('Синхронизируем…') : t('Удалить все + добавить из robots.txt')}</button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</main>
