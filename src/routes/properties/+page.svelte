<script lang="ts">
  import SortCaret from '$lib/components/SortCaret.svelte';
  import { onMount } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { env as pubenv } from '$env/dynamic/public';
  import { displaySite, siteDomain, siteHref, siteSearchHref, bingWebmasterHref, gscHref } from '$lib/utils/site';
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

  const nf = new Intl.NumberFormat('en-US');
  function fmtNum(n: number) { return nf.format(n); }
  function fmtCtr(c: number) { return (c * 100).toFixed(1) + '%'; }
  function fmtPos(p: number) { return p.toFixed(1); }
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
  };

  const PULSE_OPTIONS = [30, 90, 180, 365, 480];
  let pulseDays = $state(180);
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
      pulseCache.set(days, data);
      if (pulseDays === days) pulseState = { kind: 'loaded', data };
    } catch (e) {
      if (pulseDays === days) pulseState = { kind: 'error', message: (e as Error).message };
    }
  }

  // Tracks pulseDays: re-runs on switcher clicks, and once on mount for the initial 180d.
  $effect(() => {
    loadPulse(pulseDays);
  });

  const STORAGE_KEY = 'gsc-hub:hidden-sites';

  type SiteWithSummary = (typeof data.sites)[number];

  function keyOf(s: SiteWithSummary): string {
    return `${s.accountId}|${s.siteUrl}`;
  }

  let hidden = $state<Set<string>>(new Set());
  let showHidden = $state(false);

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
      }
    } catch (e) {
      console.warn('[gsc-hub] hidden-sites migration failed:', e);
    }

    try {
      const res = await fetch('/properties/hidden-sites');
      const j = await res.json();
      if (Array.isArray(j.hidden)) hidden = new Set(j.hidden);
    } catch (e) {
      console.warn('[gsc-hub] Could not load hidden sites:', e);
    }
  });

  function hideSite(s: SiteWithSummary) {
    hidden.add(keyOf(s));
    hidden = new Set(hidden);
    fetch('/properties/hidden-sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: s.accountId, site: s.siteUrl })
    }).catch((e) => console.warn('[gsc-hub] Could not hide site:', e));
    invalidatePulse();
  }

  function unhideSite(s: SiteWithSummary) {
    hidden.delete(keyOf(s));
    hidden = new Set(hidden);
    fetch('/properties/hidden-sites', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: s.accountId, site: s.siteUrl })
    }).catch((e) => console.warn('[gsc-hub] Could not unhide site:', e));
    invalidatePulse();
  }

  // The pulse aggregates visible sites only — after a hide/unhide the cached window
  // aggregates are stale. Server-side per-site responses are TTL-cached, so the
  // refetch is a cheap re-aggregation, not a new fan-out.
  function invalidatePulse() {
    pulseCache.clear();
    loadPulse(pulseDays);
  }

  let visibleSites = $derived(
    data.sites.filter(s => !hidden.has(keyOf(s)) || showHidden)
  );

  // Totals across non-hidden sites for the selected period.
  let totals = $derived.by(() => {
    let clicks = 0, impressions = 0, sites = 0;
    for (const s of data.sites) {
      if (hidden.has(keyOf(s))) continue;
      sites++;
      if (s.summary) { clicks += s.summary.clicks; impressions += s.summary.impressions; }
    }
    return { sites, clicks, impressions };
  });

  // Same totals, broken down per connected account (non-hidden sites only).
  let perAccount = $derived.by(() => {
    const map = new Map<string, { accountId: string; label: string; email: string; sites: number; clicks: number; impressions: number }>();
    for (const s of data.sites) {
      if (hidden.has(keyOf(s))) continue;
      let a = map.get(s.accountId);
      if (!a) {
        a = { accountId: s.accountId, label: s.accountLabel ?? s.accountEmail, email: s.accountEmail, sites: 0, clicks: 0, impressions: 0 };
        map.set(s.accountId, a);
      }
      a.sites++;
      if (s.summary) { a.clicks += s.summary.clicks; a.impressions += s.summary.impressions; }
    }
    return [...map.values()].sort((x, y) => y.clicks - x.clicks);
  });

  function goToDays(raw: string | number) {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 1) return;
    goto(`?days=${Math.min(n, 480)}&sort=${data.sort}&dir=${data.dir}`);
  }

  function sortHref(field: string, currentSort: string, currentDir: 'asc' | 'desc', days: number) {
    const nextDir = currentSort === field && currentDir === 'desc' ? 'asc' : 'desc';
    return `?days=${days}&sort=${field}&dir=${nextDir}`;
  }

  function sortIndicator(field: string, currentSort: string, currentDir: 'asc' | 'desc'): 'asc' | 'desc' | '' {
    if (currentSort !== field) return '';
    return currentDir;
  }

  // Queries table: client-side sort state
  let qSort = $state<'query' | 'page' | 'country' | 'clicks' | 'impressions' | 'ctr' | 'position' | 'bingClicks' | 'bingImpr'>('position');
  let qDir = $state<'asc' | 'desc'>('asc');

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

  const allQueries = $derived.by(() => {
    // Bare-host domains of sites currently visible (not hidden). Bing data is merged
    // only for these, so hidden sites don't leak back in via Bing.
    const visibleDomains = new Set<string>();
    for (const s of data.sites) if (!hidden.has(keyOf(s))) visibleDomains.add(siteDomain(s.siteUrl));
    // Bing keys per visible domain, keyed by NORMALIZED query (lowercase + collapsed
    // whitespace) so GSC↔Bing matching survives case/spacing diffs. Value keeps the
    // original Bing query (for display of Bing-only rows).
    const norm = (q: string) => q.toLowerCase().replace(/\s+/g, ' ').trim();
    const bingByDomain = new Map<string, Map<string, { query: string; clicks: number; impressions: number; position: number }>>();
    for (const b of data.bingQueries) {
      if (!visibleDomains.has(b.host)) continue;
      let m = bingByDomain.get(b.host);
      if (!m) { m = new Map(); bingByDomain.set(b.host, m); }
      m.set(norm(b.query), { query: b.query, clicks: b.clicks, impressions: b.impressions, position: b.position });
    }

    type Bucket = { query: string; page: string; country: string; domain: string; host: string; clicks: number; impressions: number; posSum: number; posWeight: number };
    const map = new Map<string, Bucket>();
    const gscCovered = new Set<string>(); // `${host}\n${normQuery}` — which Bing keys are GSC-only
    for (const entry of data.queryEntries) {
      const k = `${entry.accountId}|${entry.siteUrl}`;
      if (hidden.has(k)) continue;
      const domain = displaySite(entry.siteUrl);
      const host = siteDomain(entry.siteUrl);
      for (const r of entry.rows) {
        if (!r.query) continue;
        const key = `${r.query}|${r.page}|${r.country}`;
        const cur = map.get(key) ?? { query: r.query, page: r.page, country: r.country, domain, host, clicks: 0, impressions: 0, posSum: 0, posWeight: 0 };
        cur.clicks += r.clicks;
        cur.impressions += r.impressions;
        cur.posSum += r.position * r.impressions;
        cur.posWeight += r.impressions;
        map.set(key, cur);
        gscCovered.add(`${host}\n${norm(r.query)}`);
      }
    }
    type Row = {
      query: string; page: string; country: string; domain: string;
      gsc: { clicks: number; impressions: number; ctr: number; position: number } | null;
      bing: { clicks: number; impressions: number; position: number } | null;
    };
    const arr: Row[] = [];
    for (const b of map.values()) {
      const bq = bingByDomain.get(b.host)?.get(norm(b.query));
      arr.push({
        query: b.query, page: b.page, country: b.country, domain: b.domain,
        gsc: {
          clicks: b.clicks,
          impressions: b.impressions,
          ctr: b.impressions > 0 ? b.clicks / b.impressions : 0,
          position: b.posWeight > 0 ? b.posSum / b.posWeight : 0
        },
        bing: bq ? { clicks: bq.clicks, impressions: bq.impressions, position: bq.position } : null
      });
    }
    // Bing-only keys (no GSC row for that domain) → rows showing the domain, no page URL.
    for (const [host, m] of bingByDomain) {
      for (const [nq, v] of m) {
        if (gscCovered.has(`${host}\n${nq}`)) continue;
        arr.push({
          query: v.query, page: '', country: '', domain: host,
          gsc: null,
          bing: { clicks: v.clicks, impressions: v.impressions, position: v.position }
        });
      }
    }
    const dirMul = qDir === 'desc' ? -1 : 1;
    const val = (q: Row) => {
      switch (qSort) {
        case 'clicks': return q.gsc?.clicks ?? -1;
        case 'impressions': return q.gsc?.impressions ?? -1;
        case 'ctr': return q.gsc?.ctr ?? -1;
        case 'position': return q.gsc?.position ?? q.bing?.position ?? 99999;
        case 'bingClicks': return q.bing?.clicks ?? -1;
        case 'bingImpr': return q.bing?.impressions ?? -1;
        default: return 0;
      }
    };
    arr.sort((a, b) => {
      if (qSort === 'query') return dirMul * a.query.localeCompare(b.query);
      if (qSort === 'page') return dirMul * a.page.localeCompare(b.page);
      if (qSort === 'country') return dirMul * a.country.localeCompare(b.country);
      return dirMul * (val(a) - val(b));
    });
    return arr;
  });

  const hiddenQueryCount = $derived(
    showFilteredQueries ? 0 : allQueries.filter((q) => isQueryFiltered(q.query)).length
  );

  // Facet option lists — only countries/domains actually present in the data.
  const availableCountries = $derived.by(() => {
    const s = new Set<string>();
    for (const q of allQueries) if (q.country) s.add(q.country);
    return Array.from(s).sort();
  });
  const availableDomains = $derived.by(() => {
    const s = new Set<string>();
    for (const q of allQueries) if (q.domain) s.add(q.domain);
    return Array.from(s).sort();
  });

  const aggregatedQueries = $derived.by(() => {
    let base = showFilteredQueries ? allQueries : allQueries.filter((q) => !isQueryFiltered(q.query));
    if (selectedCountries.size > 0) base = base.filter((q) => selectedCountries.has(q.country));
    if (selectedDomains.size > 0) base = base.filter((q) => selectedDomains.has(q.domain));
    if (querySource === 'gsc') base = base.filter((q) => q.gsc && !q.bing);
    else if (querySource === 'bing') base = base.filter((q) => q.bing && !q.gsc);
    else if (querySource === 'both') base = base.filter((q) => q.gsc && q.bing);
    // Avg-position range (inclusive). Uses the row's effective position (GSC, else Bing).
    // Default (from 0, no 'to') = no filtering.
    const hasMin = posMin != null && posMin > 0;
    const hasMax = posMax != null;
    if (hasMin || hasMax) {
      base = base.filter((q) => {
        const p = q.gsc?.position ?? q.bing?.position ?? 0;
        if (p <= 0) return false; // no real position
        if (hasMin && p < (posMin as number)) return false;
        if (hasMax && p > (posMax as number)) return false;
        return true;
      });
    }
    return base.slice(0, 200);
  });

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

  // Pages table: client-side sort state
  let pSort = $state<'page' | 'clicks' | 'impressions' | 'ctr' | 'position'>('impressions');
  let pDir = $state<'asc' | 'desc'>('desc');

  const aggregatedPages = $derived.by(() => {
    type Bucket = { clicks: number; impressions: number; posSum: number; posWeight: number };
    const map = new Map<string, Bucket>();
    for (const entry of data.pageEntries) {
      const k = `${entry.accountId}|${entry.siteUrl}`;
      if (hidden.has(k)) continue;
      for (const r of entry.rows) {
        if (!r.page) continue;
        const cur = map.get(r.page) ?? { clicks: 0, impressions: 0, posSum: 0, posWeight: 0 };
        cur.clicks += r.clicks;
        cur.impressions += r.impressions;
        cur.posSum += r.position * r.impressions;
        cur.posWeight += r.impressions;
        map.set(r.page, cur);
      }
    }
    const arr = Array.from(map.entries()).map(([page, b]) => ({
      page,
      clicks: b.clicks,
      impressions: b.impressions,
      ctr: b.impressions > 0 ? b.clicks / b.impressions : 0,
      position: b.posWeight > 0 ? b.posSum / b.posWeight : 0
    }));
    const dirMul = pDir === 'desc' ? -1 : 1;
    arr.sort((a, b) => {
      if (pSort === 'page') return dirMul * a.page.localeCompare(b.page);
      return dirMul * (a[pSort] - b[pSort]);
    });
    return arr.slice(0, 200);
  });

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
      // Filter out hidden sites and aggregate by date.
      const visible = (data.entries as QueryHistoryEntry[]).filter(
        (e) => !hidden.has(`${e.accountId}|${e.siteUrl}`)
      );
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
    const entry = data.pageEntries.find(
      (e) => e.accountId === s.accountId && e.siteUrl === s.siteUrl
    );
    const fromPages = entry
      ? entry.rows
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
      if (!r.ok) refreshError = `Кеш не сброшен (HTTP ${r.status}) - цифры могут быть до часа старыми.`;
    } catch {
      refreshError = 'Кеш не сброшен: сервер не ответил - цифры могут быть до часа старыми.';
    }
    await invalidateAll();
    invalidatePulse();
  }
</script>

<svelte:head><title>Sites — gsc-hub</title></svelte:head>
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
        <a href="/">Accounts</a>
        <span aria-hidden="true">/</span>
        <span class="text-ink-2">Sites</span>
      </nav>
      <h1 class="app-pagetitle">All sites</h1>
      <p class="hidden text-xs text-ink-3 print:block">Period: last {data.days === 1 ? '24 hours' : `${data.days} days`}</p>
    </div>
    <div class="app-toolbar-right">
      <div class="app-segmented" aria-label="Period">
        {#each [1, 3, 7, 28, 60] as d}
          <a class:is-active={data.days === d} href="?days={d}&sort={data.sort}&dir={data.dir}">{d}D</a>
        {/each}
        <input
          type="number"
          min="1"
          max="480"
          placeholder="days"
          value={[1, 3, 7, 28, 60].includes(data.days) ? '' : data.days}
          class="input app-num ml-1 h-6 w-16 px-1.5 text-[11.5px]"
          title="Custom day range, up to 480 (16 months)"
          onkeydown={(e) => { if (e.key === 'Enter') goToDays(e.currentTarget.value); }}
          onchange={(e) => goToDays(e.currentTarget.value)}
        />
      </div>
      <span class="app-toolbar-divider" aria-hidden="true"></span>
      <a href="/dashboard?days={data.days}" class="btn btn-ghost">Dashboard</a>
      <a href="/properties/striking?days={data.days}" class="btn btn-ghost" title="Portfolio analytics across all sites — striking distance, cannibalization, CTR, branded, decay">Portfolio</a>
      <div class="btn-group" role="group" aria-label="Submit all sites">
        <span class="btn-group-label">Submit all</span>
        <button type="button" class="btn btn-ghost" onclick={() => window.open(`${aiBase}/properties/submit-all?op=sitemap`, '_blank')} title="Resubmit every site's sitemaps to Google">Sitemaps</button>
        <button type="button" class="btn btn-ghost" onclick={() => window.open(`${aiBase}/properties/submit-all?op=bing`, '_blank')} title="Submit every sitemap to Bing">Bing</button>
        <button type="button" class="btn btn-ghost" onclick={() => window.open(`${aiBase}/properties/submit-all?op=indexnow`, '_blank')} title="Push every site's URLs to IndexNow">IndexNow</button>
      </div>
      <button type="button" class="btn btn-pri" onclick={refreshAll}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M13.5 8A5.5 5.5 0 1 1 11.8 4M13.5 2v3h-3"/></svg>
        Refresh
      </button>
    </div>
  </header>
  {#if refreshError}<p class="app-errors">{refreshError}</p>{/if}

  <div class="desk">
    <!-- Portfolio pulse — all domains combined, own period switcher, Google update bands. -->
    <section class="pane">
      <div class="pane-head">
        <span>Portfolio pulse <span class="aside ml-1 text-ink-3">all domains combined</span></span>
        <div class="app-segmented normal-case tracking-normal" aria-label="Pulse period">
          {#each PULSE_OPTIONS as d (d)}
            <button type="button" class:is-active={pulseDays === d} onclick={() => (pulseDays = d)}>{d === 480 ? '16M' : d === 365 ? '1Y' : `${d}D`}</button>
          {/each}
        </div>
      </div>
      {#if pulseState.kind === 'loading'}
        <p class="loading py-16 text-center">Loading {pulseDays}-day pulse…</p>
      {:else if pulseState.kind === 'error'}
        <div class="flex items-center justify-center gap-2 py-16">
          <span class="text-err">{pulseState.message}</span>
          <button type="button" class="btn btn-sec btn-sm" onclick={() => loadPulse(pulseDays)}>Retry</button>
        </div>
      {:else if pulseState.kind === 'loaded'}
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-3 py-2">
          <div class="stat border-l-0 pl-0"><span class="stat-label">Impressions</span><span class="stat-value">{fmtNum(pulseState.data.totals.impressions)}</span></div>
          <div class="stat"><span class="stat-label">Clicks</span><span class="stat-value">{fmtNum(pulseState.data.totals.clicks)}</span></div>
          <div class="stat"><span class="stat-label">CTR</span><span class="stat-value">{fmtCtr(pulseState.data.totals.ctr)}</span></div>
          {#if pulseState.data.updates.length > 0}
            <div class="stat" title="Google algorithm updates in this window (toggle below)"><span class="stat-label">Updates</span><span class="stat-value">{pulseState.data.updates.length}</span></div>
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

    {#if data.errors.length > 0}
      <div class="app-errors mb-0">
        <div class="app-errors-title">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="6" cy="6" r="5"/><path d="M6 3.5v3M6 8.5v.01"/></svg>
          Errors
        </div>
        <ul class="ml-4 list-disc">
          {#each data.errors as e}
            <li><span class="font-medium">{e.accountEmail}</span>: {e.reason}</li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Watchlist: every site of every connected account for the selected period. -->
    <section class="pane min-w-0">
      <div class="pane-head">
        <span>Watchlist <span class="aside ml-1 text-ink-3">{data.days === 1 ? '24 hours' : `${data.days} days`}</span></span>
        {#if hidden.size > 0}
          <button type="button" class="btn btn-ghost btn-sm normal-case tracking-normal" onclick={() => showHidden = !showHidden}>
            {showHidden ? 'Hide hidden again' : `Show ${hidden.size} hidden site${hidden.size === 1 ? '' : 's'}`}
          </button>
        {/if}
      </div>

      <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-3 py-2">
        <div class="stat border-l-0 pl-0"><span class="stat-label">Sites</span><span class="stat-value">{fmtNum(totals.sites)}</span></div>
        <div class="stat"><span class="stat-label">Impressions</span><span class="stat-value">{fmtNum(totals.impressions)}</span></div>
        <div class="stat"><span class="stat-label">Clicks</span><span class="stat-value">{fmtNum(totals.clicks)}</span></div>
      </div>

      {#if perAccount.length > 1}
        <div class="grid gap-px border-b border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {#each perAccount as a}
            <div class="min-w-0 bg-pane px-3 py-1.5">
              <div class="pii truncate text-[12.5px] font-medium text-ink">{a.label}</div>
              <div class="pii flex gap-3 font-mono text-[11px] tabular-nums text-ink-3">
                <span>{fmtNum(a.sites)} sites</span>
                <span>{fmtNum(a.impressions)} impr</span>
                <span>{fmtNum(a.clicks)} clicks</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      {#if data.sites.length === 0}
        <div class="p-3">
          <div class="app-empty">
            <div class="app-empty-title">No sites yet</div>
            <p class="app-empty-sub">Connect a Google account on <a class="text-acc hover:underline" href="/">Accounts</a>.</p>
          </div>
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="app-table">
            <thead>
              <tr>
                <th>
                  <a class="sort-th" href={sortHref('site', data.sort, data.dir, data.days)}>Site URL<SortCaret dir={sortIndicator('site', data.sort, data.dir)} /></a>
                  <span class="text-ink-4" aria-hidden="true"> · </span>
                  <a class="sort-th" href={sortHref('account', data.sort, data.dir, data.days)}>Account<SortCaret dir={sortIndicator('account', data.sort, data.dir)} /></a>
                </th>
                <th class="print:hidden"><span class="sr-only">Trend</span></th>
                <th class="num">
                  <a class="sort-th" href={sortHref('clicks', data.sort, data.dir, data.days)}>Clicks<SortCaret dir={sortIndicator('clicks', data.sort, data.dir)} /></a>
                </th>
                <th class="num hidden sm:table-cell">
                  <a class="sort-th" href={sortHref('impressions', data.sort, data.dir, data.days)}>Impressions<SortCaret dir={sortIndicator('impressions', data.sort, data.dir)} /></a>
                </th>
                <th class="num hidden md:table-cell">
                  <a class="sort-th" href={sortHref('ctr', data.sort, data.dir, data.days)}>CTR<SortCaret dir={sortIndicator('ctr', data.sort, data.dir)} /></a>
                </th>
                <th class="num">
                  <a class="sort-th" href={sortHref('position', data.sort, data.dir, data.days)}>Avg Pos<SortCaret dir={sortIndicator('position', data.sort, data.dir)} /></a>
                </th>
                <th class="num hidden lg:table-cell" title="Дата создания сайта (таблица site_dates, заполняется внешним импортом)">
                  <a class="sort-th" href={sortHref('date', data.sort, data.dir, data.days)}>Created<SortCaret dir={sortIndicator('date', data.sort, data.dir)} /></a>
                </th>
                <th class="num hidden md:table-cell" title="Bing clicks · последние ~2 недели (не зависит от фильтра дней)">Bing Clk</th>
                <th class="num hidden md:table-cell" title="Bing impressions · последние ~2 недели (не зависит от фильтра дней)">Bing Impr</th>
                <th class="w-0 p-0 print:hidden"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {#each visibleSites as s}
                {@const sKey = `${s.accountId}|${s.siteUrl}`}
                {@const expanded = expandedSite === sKey}
                {@const isHidden = hidden.has(keyOf(s))}
                {@const subSt = submitStates.get(sKey)}
                {@const bSt = bingStates.get(sKey)}
                {@const iSt = indexnowStates.get(sKey)}
                <tr class="cursor-pointer {s.hasIndexNow ? '' : 'bg-warn-t/60 hover:bg-warn-t'} {isHidden ? 'is-hidden-row' : ''}" class:is-selected={expanded} class:has-status={!!(subSt || bSt || iSt)} onclick={() => toggleSite(s)} title={s.hasIndexNow ? undefined : 'Нет IndexNow-ключа ({key}.txt) — не настроен для Bing/IndexNow'}>
                  <td class="min-w-[14rem]">
                    <div class="flex items-center gap-1.5 whitespace-nowrap">
                      {@render chevron(expanded)}
                      <!-- Имя ведёт на страницу сайта внутри хаба: туда ходят чаще, чем на сам сайт.
                           Внешний сайт — отдельной иконкой ↗, как у остальных внешних ссылок строки. -->
                      <a class="pii font-semibold text-ink hover:text-acc hover:underline" href={detailHref(s)} title="Site analytics — striking distance, cannibalization, decay, CTR, health" onclick={(e) => e.stopPropagation()}>{displaySite(s.siteUrl)}</a>
                      <a
                        class="inline-flex h-4 items-center text-ink-4 hover:text-acc print:hidden"
                        href={siteHref(s.siteUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Открыть {displaySite(s.siteUrl)} в новой вкладке"
                        aria-label="Open site in a new tab"
                        onclick={(e) => e.stopPropagation()}
                      ><svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7 9"/></svg></a>
                      <a
                        class="badge badge-muted h-4 px-1 py-0 text-[10px] hover:bg-acc-t hover:text-acc print:hidden"
                        href={gscHref(s.siteUrl, s.accountEmail)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Открыть в Google Search Console ({s.accountEmail})"
                        aria-label="Open in Google Search Console"
                        onclick={(e) => e.stopPropagation()}
                      >GSC</a>
                      <a
                        class="inline-flex h-4 items-center opacity-60 transition-opacity hover:opacity-100 print:hidden"
                        href={siteSearchHref(s.siteUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Google site:{displaySite(s.siteUrl)} — проверить индексацию"
                        aria-label="Google site search"
                        onclick={(e) => e.stopPropagation()}
                      ><img src={googleIcon} alt="Google" class="h-3.5 w-auto" /></a>
                      <a
                        class="inline-flex h-4 items-center opacity-60 transition-opacity hover:opacity-100 print:hidden"
                        href={bingWebmasterHref(s.siteUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Bing Webmaster — {displaySite(s.siteUrl)}"
                        aria-label="Open Bing Webmaster"
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
                  {:else}
                    <td class="print:hidden"></td>
                    <td class="num app-num text-ink-4" title={s.summaryError ?? ''}>—</td>
                    <td class="num app-num hidden text-ink-4 sm:table-cell" title={s.summaryError ?? ''}>—</td>
                    <td class="num app-num hidden text-ink-4 md:table-cell" title={s.summaryError ?? ''}>—</td>
                    <td class="num app-num text-ink-4" title={s.summaryError ?? ''}>
                      <span class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-dn align-middle" title={s.summaryError ?? 'error'}></span>—
                    </td>
                  {/if}
                  <td class="num app-num hidden whitespace-nowrap text-ink-3 lg:table-cell" title="Дата создания сайта">{fmtDate(s.createdAt)}</td>
                  <td class="num app-num hidden md:table-cell {s.bing ? '' : 'text-ink-4'}" title="Bing · последние ~2 недели">{s.bing ? fmtNum(s.bing.clicks) : '—'}</td>
                  <td class="num app-num hidden md:table-cell {s.bing ? '' : 'text-ink-4'}" title="Bing · последние ~2 недели">{s.bing ? fmtNum(s.bing.impressions) : '—'}</td>
                  <td class="row-tray print:hidden" onclick={(e) => e.stopPropagation()}>
                    <div class="row-tray-body">
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        title="Resubmit sitemap(s) to Google"
                        disabled={subSt?.kind === 'loading'}
                        onclick={(e) => { e.stopPropagation(); submitSitemapFor({ accountId: s.accountId, siteUrl: s.siteUrl }); }}
                      >{subSt?.kind === 'loading' ? '…' : 'Submit sitemap'}</button>
                      {#if subSt?.kind === 'done'}
                        <span class="app-num text-[11px] {subSt.failed > 0 ? 'text-warn' : 'text-up'}" title={subSt.failed > 0 ? subSt.failReasons.join('\n') : `source: ${subSt.source}`}><svg viewBox="0 0 12 12" class="inline-block h-3 w-3 align-[-2px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5 5 9l4.5-6"/></svg> {subSt.submitted}{#if subSt.failed > 0} · <svg viewBox="0 0 12 12" class="inline-block h-3 w-3 align-[-2px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg> {subSt.failed}{/if}</span>
                      {:else if subSt?.kind === 'error'}
                        <span class="text-[11px] text-dn" title={subSt.message}><svg viewBox="0 0 12 12" class="inline-block h-3 w-3 align-[-2px]" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg> failed</span>
                      {/if}
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm"
                        title="Submit sitemap to Bing"
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
                        title="Push sitemap URLs to IndexNow (Bing)"
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
                        title="View and manage sitemaps"
                        onclick={(e) => { e.stopPropagation(); openSitemapModal({ accountId: s.accountId, siteUrl: s.siteUrl }); }}
                      >Sitemaps</button>
                      <span class="app-toolbar-divider hidden md:block" aria-hidden="true"></span>
                      <span class="hidden items-center gap-0.5 md:flex">
                      <a
                        class="btn btn-ghost btn-sm"
                        href="/properties/export?account={encodeURIComponent(s.accountId)}&site={encodeURIComponent(s.siteUrl)}&days={data.days}&dim=query"
                      >{@render dlIcon()}query CSV</a>
                      <a
                        class="btn btn-ghost btn-sm"
                        href="/properties/export?account={encodeURIComponent(s.accountId)}&site={encodeURIComponent(s.siteUrl)}&days={data.days}&dim=page"
                      >{@render dlIcon()}page CSV</a>
                      </span>
                      <span class="hidden md:inline-flex">
                    {#if !isHidden}
                      <button type="button" class="btn btn-ghost btn-sm" onclick={() => hideSite(s)}>Hide</button>
                    {:else}
                      <button type="button" class="btn btn-sec btn-sm" onclick={() => unhideSite(s)}>Unhide</button>
                    {/if}
                      </span>
                    </div>
                  </td>
                </tr>
                {#if expanded}
                  <tr class="bg-sunk hover:bg-sunk">
                    <td class="px-3 py-3" colspan="12">
                      {#if inspectState.kind === 'loading'}
                        <p class="loading">Inspecting {inspectState.total} top URLs (URL Inspection API, ~3-5s)…</p>
                      {:else if inspectState.kind === 'error'}
                        <p class="text-err">{inspectState.message}</p>
                      {:else if inspectState.kind === 'loaded'}
                        {@const loadedState = inspectState}
                        <div class="mb-2 flex items-center justify-between gap-3 text-xs text-ink-3">
                          <span>
                            {#if loadedState.source === 'page-entries'}
                              Top {loadedState.results.length} URLs by impressions in current period.
                            {:else if loadedState.source === 'page-entries+sitemap'}
                              {loadedState.results.length} URLs (top by impressions plus sitemap fill-in).
                            {:else}
                              {loadedState.results.length} URLs from sitemap (no impressions in current period).
                            {/if}
                            {#if loadedState.cached}<span class="ml-1 text-ink-4">· Cached {fmtCacheTime(loadedState.fetchedAt)}</span>{:else}<span class="ml-1 text-ink-4">· Fresh</span>{/if}
                            {#if loadedState.sitemapNote}<span class="ml-2 text-warn" title={loadedState.sitemapNote}>(sitemap note)</span>{/if}
                          </span>
                          <button type="button" class="btn btn-sec btn-sm" onclick={(e) => { e.stopPropagation(); refreshInspection({ accountId: loadedState.accountId, siteUrl: loadedState.site }); }}>
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M13.5 8A5.5 5.5 0 1 1 11.8 4M13.5 2v3h-3"/></svg>
                            Force refresh
                          </button>
                        </div>
                        <div class="overflow-x-auto rounded border border-line bg-pane">
                          <table class="app-table">
                            <thead>
                              <tr>
                                <th>URL</th>
                                <th>Status</th>
                                <th>Coverage</th>
                                <th>Robots</th>
                                <th>Last crawl</th>
                                <th>Canonical</th>
                              </tr>
                            </thead>
                            <tbody>
                              {#each loadedState.results as r}
                                <tr>
                                  <td>
                                    <a class="font-mono text-[11.5px] text-acc hover:underline" href={r.inspectionUrl} target="_blank" rel="noopener noreferrer">{shortUrl(r.inspectionUrl, loadedState.site)}</a>
                                  </td>
                                  {#if r.status === 'error'}
                                    <td colspan="5" class="text-err">{r.error}</td>
                                  {:else if r.index}
                                    {@const v = verdictBadge(r.index.verdict)}
                                    <td><span class="badge {v.cls}">{v.label}</span></td>
                                    <td class="text-ink-2">{r.index.coverageState ?? '—'}</td>
                                    <td class={r.index.robotsTxtState === 'DISALLOWED' ? 'text-dn' : 'text-ink-2'}>{r.index.robotsTxtState ?? '—'}</td>
                                    <td class="app-num text-ink-3">{fmtCrawlTime(r.index.lastCrawlTime)}</td>
                                    <td class="text-ink-3">
                                      {#if r.index.googleCanonical && r.index.userCanonical && r.index.googleCanonical !== r.index.userCanonical}
                                        <span class="badge badge-warn" title="Google: {r.index.googleCanonical}\nUser: {r.index.userCanonical}">Mismatch</span>
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
    </section>

    {#if data.queryEntries.length > 0}
      <section class="pane min-w-0">
        <div class="pane-head">
          <span>Top queries <span class="aside ml-1 font-mono text-ink-3">{aggregatedQueries.length} of {data.queryEntries.length > 0 ? data.queryEntries.reduce((a, e) => a + e.rows.length, 0) : 0}</span></span>
          <div class="flex items-center gap-1.5 normal-case tracking-normal">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onclick={copyKeys}
              title="Copy all unique queries of the current (filtered) view to the clipboard, one per line"
            >{keysCopied ? 'Copied' : 'Copy keys'}</button>
            <a
              class="btn btn-sec btn-sm"
              href="/properties/queries-export?days={data.days}&hidden={encodeURIComponent([...hidden].join(','))}"
              download
              title="Download all queries (query · country · impressions · clicks), filters applied"
            >{@render dlIcon()}Export all CSV</a>
          </div>
        </div>
        <p class="border-b border-line-soft px-3 py-1.5 font-mono text-[11px] tracking-tight text-ink-3">visible sites · query × page × country · rowLimit 1000 · click pos → SERP · click row → 16-mo history</p>
        {#snippet facet(label: string, options: string[], selected: Set<string>, onToggle: (v: string) => void, onClear: () => void, search: string, onSearch: (v: string) => void)}
          <details class="facet relative">
            <summary class="btn btn-sec btn-sm list-none [&::-webkit-details-marker]:hidden {selected.size > 0 ? 'border-acc/40 text-acc' : ''}">
              {label}<span class="font-normal text-ink-3">{selected.size > 0 ? ` · ${selected.size}` : ' · all'}</span>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>
            </summary>
            <div class="absolute z-20 mt-1 flex max-h-72 w-52 flex-col rounded border border-line bg-pane p-1 shadow-[0_6px_20px_-6px_rgb(19_23_34/0.25)]">
              {#if options.length === 0}
                <div class="px-2 py-1 text-ink-4">—</div>
              {:else}
                {@const shown = search.trim() ? options.filter((o) => o.toLowerCase().includes(search.trim().toLowerCase())) : options}
                <input
                  class="input mb-1 h-6 w-full text-[11.5px]"
                  placeholder="search…"
                  value={search}
                  oninput={(e) => onSearch(e.currentTarget.value)}
                />
                {#if selected.size > 0}
                  <button type="button" class="btn btn-ghost btn-sm mb-1 w-full justify-start text-acc" onclick={onClear}>Clear ({selected.size})</button>
                {/if}
                <div class="overflow-auto">
                  {#each shown as opt}
                    <label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-sunk">
                      <input type="checkbox" checked={selected.has(opt)} onchange={() => onToggle(opt)} />
                      <span class="break-all font-mono text-[11px] text-ink-2">{opt}</span>
                    </label>
                  {/each}
                  {#if shown.length === 0}
                    <div class="px-2 py-1 text-ink-4">no match</div>
                  {/if}
                </div>
              {/if}
            </div>
          </details>
        {/snippet}
        <div class="flex flex-wrap items-center gap-2 border-b border-line-soft px-3 py-2 text-xs print:hidden">
          <span class="text-[11px] font-medium uppercase tracking-wide text-ink-3">Filter</span>
          {@render facet('Country', availableCountries, selectedCountries, toggleCountry, () => (selectedCountries = new Set()), countrySearch, (v) => (countrySearch = v))}
          {@render facet('Domain', availableDomains, selectedDomains, toggleDomain, () => (selectedDomains = new Set()), domainSearch, (v) => (domainSearch = v))}
          <select class="input h-6 text-xs" bind:value={querySource} title="Откуда ключ — GSC и/или Bing">
            <option value="all">Источник · все</option>
            <option value="gsc">только GSC</option>
            <option value="bing">только Bing</option>
            <option value="both">в обоих</option>
          </select>
          <span class="inline-flex items-center gap-1 text-ink-3">
            Avg Pos
            <input type="number" min="0" step="0.1" class="input app-num h-6 w-14 px-1.5 text-xs" placeholder="от" bind:value={posMin} title="Avg Pos от (включительно)" />
            <span>–</span>
            <input type="number" min="0" step="0.1" class="input app-num h-6 w-14 px-1.5 text-xs" placeholder="до" bind:value={posMax} title="Avg Pos до (включительно), пусто = без верхней границы" />
          </span>
          {#if selectedCountries.size > 0 || selectedDomains.size > 0 || querySource !== 'gsc' || (posMin ?? 0) > 0 || posMax != null}
            <button type="button" class="btn btn-ghost btn-sm text-acc" onclick={() => { selectedCountries = new Set(); selectedDomains = new Set(); querySource = 'gsc'; posMin = 0; posMax = null; }}>reset all</button>
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2 text-xs print:hidden">
          <span class="text-ink-3">Hide queries containing:</span>
          {#each queryFilters as f}
            <span class="badge badge-muted gap-0.5 pr-0.5 font-mono">
              {f.pattern}
              <button type="button" class="inline-flex h-4 w-4 items-center justify-center rounded-sm text-ink-4 hover:bg-dn-t hover:text-dn" title="Remove filter" aria-label="Remove filter {f.pattern}" onclick={() => removeQueryFilter(f.id)}>
                <svg viewBox="0 0 16 16" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
              </button>
            </span>
          {/each}
          <form class="inline-flex items-center gap-1" onsubmit={(e) => { e.preventDefault(); addQueryFilter(newQueryFilter); }}>
            <input class="input h-6 w-24 px-1.5 font-mono text-xs" placeholder="site:" bind:value={newQueryFilter} />
            <button type="submit" class="btn btn-sec btn-sm">Add</button>
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
                <th class="sort-th" onclick={() => toggleQSort('query')}>Query<SortCaret dir={qIndicator('query')} /></th>
                <th class="sort-th hidden md:table-cell" onclick={() => toggleQSort('page')}>Page<SortCaret dir={qIndicator('page')} /></th>
                <th class="sort-th" onclick={() => toggleQSort('country')}>Country<SortCaret dir={qIndicator('country')} /></th>
                <th class="sort-th num" onclick={() => toggleQSort('clicks')}>GSC clk<SortCaret dir={qIndicator('clicks')} /></th>
                <th class="sort-th num hidden sm:table-cell" onclick={() => toggleQSort('impressions')}>GSC imp<SortCaret dir={qIndicator('impressions')} /></th>
                <th class="sort-th num hidden md:table-cell" onclick={() => toggleQSort('ctr')}>CTR<SortCaret dir={qIndicator('ctr')} /></th>
                <th class="sort-th num" onclick={() => toggleQSort('position')}>Avg Pos<SortCaret dir={qIndicator('position')} /></th>
                <th class="sort-th num" onclick={() => toggleQSort('bingClicks')}>Bing clk<SortCaret dir={qIndicator('bingClicks')} /></th>
                <th class="sort-th num hidden sm:table-cell" onclick={() => toggleQSort('bingImpr')}>Bing imp<SortCaret dir={qIndicator('bingImpr')} /></th>
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
                      {#if q.gsc}<span class="badge badge-muted px-1 py-0 text-[10px]" title="Есть в Google Search Console">GSC</span>{/if}
                      {#if q.bing}<span class="badge badge-acc px-1 py-0 text-[10px]" title="Есть в Bing">Bing</span>{/if}
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm btn-icon h-5 w-5 text-ink-4 opacity-0 hover:text-dn focus:opacity-100 group-hover:opacity-100 print:hidden"
                        title="Hide this query (adds it as a filter)"
                        aria-label="Hide this query"
                        onclick={(e) => { e.stopPropagation(); addQueryFilter(q.query); }}
                      >{@render xIcon()}</button>
                    </div>
                  </td>
                  <td class="hidden break-all md:table-cell">
                    {#if q.page}
                      <a class="text-acc hover:underline" href={q.page} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>{q.page}</a>
                    {:else}
                      <span class="font-mono text-[11px] text-ink-3" title="Только Bing — страница неизвестна, показан домен">{q.domain}</span>
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
                        <a class="group/serp inline-flex items-baseline gap-0.5 hover:text-acc hover:underline" href={serpUrl} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()} title="Open Google SERP · {q.country.toUpperCase()}">{fmtPos(q.gsc.position)}<svg viewBox="0 0 16 16" class="h-2.5 w-2.5 self-center text-ink-4 group-hover/serp:text-acc" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5"/></svg></a>
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
                        <p class="loading">Loading 16-month history…</p>
                      {:else if historyState.kind === 'error'}
                        <p class="text-err">Failed: {historyState.message}</p>
                      {:else if historyState.kind === 'loaded'}
                        {@const chart = buildHistoryChart(historyState.aggregated)}
                        {#if historyState.aggregated.length === 0 || chart.rows.length === 0}
                          <p class="loading">No data for this query in the last 16 months on visible sites.</p>
                        {:else}
                          {@const n = chart.rows.length}
                          {@const hi = histHover !== null && histHover < n ? histHover : null}
                          {@const shownRow = chart.rows[hi ?? n - 1]}
                          <div class="rounded border border-line bg-pane px-3 pb-2 pt-1.5">
                            <!-- readout row: hovered day (or the latest one) -->
                            <div class="mb-1 flex min-h-[24px] flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
                              <span class="font-mono text-[11.5px] text-ink-3">{shownRow.date}</span>
                              <span class="inline-flex items-center gap-1.5">
                                <i class="inline-block h-0.5 w-3 rounded-full" style:background={SERIES.pos}></i>Position
                                <b class="font-mono text-[11.5px] font-semibold text-ink">{shownRow.position > 0 ? fmtPos(shownRow.position) : '—'}</b>
                              </span>
                              <span class="inline-flex items-center gap-1.5">
                                <i class="inline-block h-2.5 w-2.5 rounded-sm opacity-60" style:background={SERIES.impr}></i>Impressions
                                <b class="font-mono text-[11.5px] font-semibold text-ink">{fmtNum(shownRow.impressions)}</b>
                              </span>
                              <span class="ml-auto text-[11px] text-ink-3">Aggregated across {historyState.entries.length} visible site{historyState.entries.length === 1 ? '' : 's'} · Position {chart.minPos.toFixed(1)}–{chart.maxPos.toFixed(1)} · Max impr {fmtNum(chart.maxImpr)}</span>
                            </div>
                            <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
                            <svg
                              viewBox="0 0 {chart.width} {chart.height}"
                              class="block w-full touch-none select-none outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-acc"
                              role="application"
                              tabindex="0"
                              aria-label="16-month query history: position and impressions. Use left and right arrows to read single days."
                              onpointermove={(e) => histMove(e, chart.xs, chart.width)}
                              onpointerleave={() => (histHover = null)}
                              onkeydown={(e) => histKey(e, n)}
                            >
                              <g transform="translate({HM.left},{HM.top})">
                                <!-- position grid + right axis (inverted: 1 on top) -->
                                {#each chart.posTicks as t, i (i)}
                                  <line x1="0" x2={chart.innerW} y1={t.y} y2={t.y} stroke={AXIS.grid} />
                                  <text x={chart.innerW + 8} y={t.y + 3.5} font-size="10.5" fill={AXIS.text} class="font-mono">{t.label}</text>
                                {/each}

                                <!-- volume band: impressions -->
                                <line x1="0" x2={chart.innerW} y1={chart.innerH - chart.volH - chart.gap / 2} y2={chart.innerH - chart.volH - chart.gap / 2} stroke={AXIS.line} />
                                <text x={chart.innerW + 8} y={chart.innerH - chart.volH + 7} font-size="10.5" fill={AXIS.text} class="font-mono">{fmtNum(chart.maxImpr)}</text>
                                <text x="4" y={chart.innerH - chart.volH + 8} font-size="10" fill={AXIS.text}>Impressions</text>
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
                                  <line x1={hx} x2={hx} y1="0" y2={chart.innerH} stroke="rgb(67 74 87)" stroke-dasharray="3 3" />
                                  {#if hy !== null}
                                    <line x1="0" x2={chart.innerW} y1={hy} y2={hy} stroke="rgb(67 74 87)" stroke-dasharray="3 3" stroke-opacity="0.6" />
                                    <circle cx={hx} cy={hy} r="3.5" fill={SERIES.pos} stroke="#fff" stroke-width="1.5" />
                                    <g transform="translate({chart.innerW + 2},{hy})">
                                      <rect y="-9" width={HM.right - 4} height="18" rx="2" fill={AXIS.ink} />
                                      <text x={(HM.right - 4) / 2} y="3.5" font-size="10.5" font-weight="600" fill="#fff" text-anchor="middle" class="font-mono">{fmtPos(chart.rows[hi].position)}</text>
                                    </g>
                                  {/if}
                                  <g transform="translate({Math.min(Math.max(hx, 38), chart.innerW - 38)},{chart.innerH + 3})">
                                    <rect x="-38" width="76" height="17" rx="2" fill={AXIS.ink} />
                                    <text y="12" font-size="10.5" fill="#fff" text-anchor="middle" class="font-mono">{chart.rows[hi].date}</text>
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
      </section>
    {/if}

    {#if data.pageEntries.length > 0}
      <section class="pane min-w-0">
        <div class="pane-head">
          <span>Top pages <span class="aside ml-1 text-ink-3">Aggregated across visible sites only. Per-site rowLimit 200.</span></span>
          <span class="aside font-mono">{aggregatedPages.length} of {data.pageEntries.length > 0 ? data.pageEntries.reduce((a, e) => a + e.rows.length, 0) : 0}</span>
        </div>
        <div class="overflow-x-auto">
          <table class="app-table">
            <thead>
              <tr>
                <th class="sort-th" onclick={() => togglePSort('page')}>Page<SortCaret dir={pIndicator('page')} /></th>
                <th class="sort-th num" onclick={() => togglePSort('clicks')}>Clicks<SortCaret dir={pIndicator('clicks')} /></th>
                <th class="sort-th num hidden sm:table-cell" onclick={() => togglePSort('impressions')}>Impressions<SortCaret dir={pIndicator('impressions')} /></th>
                <th class="sort-th num hidden md:table-cell" onclick={() => togglePSort('ctr')}>CTR<SortCaret dir={pIndicator('ctr')} /></th>
                <th class="sort-th num" onclick={() => togglePSort('position')}>Avg Pos<SortCaret dir={pIndicator('position')} /></th>
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
      </section>
    {/if}
  </div>

  {#if sitemapModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onclick={closeSitemapModal} role="presentation">
      <div class="max-h-[85vh] w-full max-w-lg overflow-auto rounded border border-line bg-pane shadow-[0_6px_20px_-6px_rgb(19_23_34/0.25)]" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="pane-head sticky top-0 bg-pane">
          <h2 class="truncate">Sitemaps — <span class="normal-case tracking-normal text-ink">{sitemapModal.title}</span></h2>
          <button class="btn btn-ghost btn-sm btn-icon" onclick={closeSitemapModal} aria-label="Close">{@render xIcon()}</button>
        </div>

        <div class="pane-body">
          {#if sitemapModal.load === 'loading'}
            <p class="loading">Loading…</p>
          {:else if sitemapModal.load === 'error'}
            <p class="text-err">{sitemapModal.loadError}</p>
          {:else}
            <div class="mb-4">
              <div class="stat-label mb-1">Registered in Search Console ({sitemapModal.current.length})</div>
              {#if sitemapModal.current.length === 0}
                <p class="text-[12.5px] text-ink-4">None.</p>
              {:else}
                <ul class="divide-y divide-line-soft rounded border border-line">
                  {#each sitemapModal.current as sm}
                    <li class="break-all px-2 py-1 font-mono text-[11.5px]">
                      <span class="text-ink">{sm.path}</span>
                      {#if sm.errors && sm.errors !== '0'}<span class="badge badge-bad ml-1 font-sans">{sm.errors} errors</span>{/if}
                      {#if sm.isPending}<span class="badge badge-warn ml-1 font-sans">pending</span>{/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>

            <div class="mb-4">
              <div class="stat-label mb-1">Declared in robots.txt ({sitemapModal.robots.length})</div>
              {#if sitemapModal.robotsError}
                <p class="notice notice-warn">robots.txt: {sitemapModal.robotsError}</p>
              {:else if sitemapModal.robots.length === 0}
                <p class="text-[12.5px] text-ink-4">None found.</p>
              {:else}
                <ul class="divide-y divide-line-soft rounded border border-line">
                  {#each sitemapModal.robots as r}
                    <li class="break-all px-2 py-1 font-mono text-[11.5px] text-ink">{r}</li>
                  {/each}
                </ul>
              {/if}
            </div>

            {#if sitemapModal.resync.kind === 'done'}
              <div class="mb-3 rounded border border-up/25 bg-up-t px-3 py-2 text-[12.5px] text-up">
                Deleted <span class="app-num">{sitemapModal.resync.deleted}</span>, submitted <span class="app-num">{sitemapModal.resync.submitted}</span>.
                {#if sitemapModal.resync.failed.length > 0}
                  <div class="mt-1 text-dn">{sitemapModal.resync.failed.length} failed:
                    {#each sitemapModal.resync.failed as f}<div class="break-all text-xs">{f.op} {f.path}: {f.reason}</div>{/each}
                  </div>
                {/if}
              </div>
            {:else if sitemapModal.resync.kind === 'error'}
              <div class="app-errors mb-3">{sitemapModal.resync.message}</div>
            {/if}

            <div class="flex items-center justify-between gap-2">
              <button class="btn btn-ghost" onclick={closeSitemapModal}>Close</button>
              <button
                class="btn btn-danger"
                disabled={sitemapModal.resync.kind === 'running' || sitemapModal.robots.length === 0}
                title={sitemapModal.robots.length === 0 ? 'robots.txt declares no sitemaps' : 'Delete all registered sitemaps, then submit the ones from robots.txt'}
                onclick={resyncSitemaps}
              >{sitemapModal.resync.kind === 'running' ? 'Resyncing…' : 'Delete all + add from robots.txt'}</button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</main>
