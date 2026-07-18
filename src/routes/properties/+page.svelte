<script lang="ts">
  import { onMount } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { env as pubenv } from '$env/dynamic/public';
  import { displaySite, siteDomain, siteHref, siteSearchHref, bingWebmasterHref } from '$lib/utils/site';
  import googleIcon from '$lib/assets/google.svg';
  import bingIcon from '$lib/assets/bing.svg';
  import { googleSerpUrl } from '$lib/utils/country';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  // AI/submit pages are normally opened on the local http origin (localhost:5174)
  // so their http noVNC iframes aren't blocked as mixed content. In prod set
  // PUBLIC_AI_BASE to the public https origin so the buttons open there instead.
  const aiBase = pubenv.PUBLIC_AI_BASE || 'http://localhost:5174';

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
  }

  function unhideSite(s: SiteWithSummary) {
    hidden.delete(keyOf(s));
    hidden = new Set(hidden);
    fetch('/properties/hidden-sites', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: s.accountId, site: s.siteUrl })
    }).catch((e) => console.warn('[gsc-hub] Could not unhide site:', e));
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

  function sortIndicator(field: string, currentSort: string, currentDir: 'asc' | 'desc') {
    if (currentSort !== field) return '';
    return currentDir === 'asc' ? ' ↑' : ' ↓';
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

  function qIndicator(field: string): string {
    if (qSort !== field) return '';
    return qDir === 'asc' ? ' ↑' : ' ↓';
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

  function pIndicator(field: string): string {
    if (pSort !== field) return '';
    return pDir === 'asc' ? ' ↑' : ' ↓';
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
    if (v === 'PASS') return { cls: 'bg-green-50 text-green-800', dot: 'bg-green-500', label: 'Indexed' };
    if (v === 'PARTIAL') return { cls: 'bg-yellow-50 text-yellow-800', dot: 'bg-yellow-500', label: 'Partial' };
    if (v === 'FAIL') return { cls: 'bg-red-50 text-red-800', dot: 'bg-red-500', label: 'Not indexed' };
    if (v === 'NEUTRAL') return { cls: 'bg-gray-100 text-gray-700', dot: 'bg-gray-400', label: 'Neutral' };
    return { cls: 'bg-gray-100 text-gray-500', dot: 'bg-gray-400', label: 'Unknown' };
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

  function buildHistoryChart(allRows: DailyAggregate[]) {
    const width = 800;
    const height = 200;
    const padTop = 10;
    const padBottom = 30;
    const padLeft = 40;
    const padRight = 10;
    const innerW = width - padLeft - padRight;
    const innerH = height - padTop - padBottom;

    // Drop days with no impressions — chart spans only the active range.
    const rows = allRows.filter((r) => r.impressions > 0);

    if (rows.length === 0) {
      return { width, height, padTop, padBottom, padLeft, padRight, innerW, innerH, posPath: '', bars: [], maxImpr: 0, minPos: 0, maxPos: 0, dateLabels: [] as { x: number; date: string }[], gridLines: [] as { y: number; x1: number; x2: number }[] };
    }

    const maxImpr = Math.max(1, ...rows.map((r) => r.impressions));
    const positions = rows.filter((r) => r.position > 0).map((r) => r.position);
    const minPos = positions.length > 0 ? Math.min(...positions) : 1;
    const maxPos = positions.length > 0 ? Math.max(...positions) : 100;
    const posRange = maxPos - minPos || 1;

    // Position points by actual timestamp so date gaps are preserved proportionally.
    const tsOf = (date: string) => Date.parse(date);
    const minTs = tsOf(rows[0].date);
    const maxTs = tsOf(rows[rows.length - 1].date);
    const tsRange = maxTs - minTs || 1;
    const xOf = (date: string) => padLeft + ((tsOf(date) - minTs) / tsRange) * innerW;
    // Position: lower number = better → draw HIGHER on chart (invert Y).
    const yOfPos = (p: number) => padTop + ((p - minPos) / posRange) * innerH;
    const yOfImpr = (n: number) => height - padBottom - (n / maxImpr) * innerH;

    const bars = rows.map((r) => ({
      x: xOf(r.date) - 1.5,
      y: yOfImpr(r.impressions),
      h: height - padBottom - yOfImpr(r.impressions),
      w: 3,
      impr: r.impressions,
      date: r.date
    }));

    const posPoints = rows
      .filter((r) => r.position > 0)
      .map((r) => ({ x: xOf(r.date), y: yOfPos(r.position) }));
    const posPath = posPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');

    // Date labels: ~6 evenly spaced by index.
    const labelCount = Math.min(6, rows.length);
    const labelStep = Math.max(1, Math.floor(rows.length / labelCount));
    const dateLabels: { x: number; date: string }[] = [];
    for (let i = 0; i < rows.length; i += labelStep) {
      dateLabels.push({ x: xOf(rows[i].date), date: rows[i].date });
    }

    // Horizontal grid lines (5 lines including top/bottom).
    const gridLines: { y: number; x1: number; x2: number }[] = [];
    for (let i = 0; i <= 4; i++) {
      const y = padTop + (i / 4) * innerH;
      gridLines.push({ y, x1: padLeft, x2: padLeft + innerW });
    }

    return { width, height, padTop, padBottom, padLeft, padRight, innerW, innerH, posPath, bars, maxImpr, minPos, maxPos, dateLabels, gridLines };
  }
</script>

<svelte:head><title>Sites — gsc-hub</title></svelte:head>
<svelte:window
  onkeydown={(e) => { if (e.key === 'Escape') { if (sitemapModal) closeSitemapModal(); closeFacets(); } }}
  onpointerdown={(e) => closeFacets(e.target as Element)}
/>

<main class="w-full p-3 sm:p-6">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs">
        <a href="/">Accounts</a>
        <span aria-hidden="true">/</span>
        <span class="text-gray-800">Sites</span>
      </nav>
      <h1 class="app-pagetitle">All sites</h1>
      <p class="hidden text-xs text-gray-500 print:block">Period: last {data.days === 1 ? '24 hours' : `${data.days} days`}</p>
    </div>
    <div class="app-toolbar-right">
      <a href="/dashboard?days={data.days}" class="app-pill app-pill-secondary">Dashboard</a>
      <a href="/properties/striking?days={data.days}" class="app-pill app-pill-secondary" title="Portfolio analytics across all sites — striking distance, cannibalization, CTR, branded, decay">Portfolio</a>
      <span class="app-toolbar-divider" aria-hidden="true"></span>
      <div class="app-segmented">
        <span class="app-segmented-label">Period</span>
        {#each [1, 3, 7, 28, 60] as d}
          <a class:is-active={data.days === d} href="?days={d}&sort={data.sort}&dir={data.dir}">{d}d</a>
        {/each}
        <input
          type="number"
          min="1"
          max="480"
          placeholder="days"
          value={[1, 3, 7, 28, 60].includes(data.days) ? '' : data.days}
          class="ml-0.5 w-16 rounded border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-700"
          title="Custom day range, up to 480 (16 months)"
          onkeydown={(e) => { if (e.key === 'Enter') goToDays(e.currentTarget.value); }}
          onchange={(e) => goToDays(e.currentTarget.value)}
        />
      </div>
      <button type="button" class="app-pill app-pill-secondary" onclick={() => invalidateAll()}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7a4.5 4.5 0 0 1 7.96-2.86M11.5 7a4.5 4.5 0 0 1-7.96 2.86M11 2.5v2.5h-2.5M3 11.5v-2.5h2.5"/></svg>
        Refresh
      </button>
      <button type="button" class="app-pill app-pill-secondary" onclick={() => window.open(`${aiBase}/properties/submit-all?op=sitemap`, '_blank')}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 1.5v7M4 5l3-3 3 3M2.5 9.5v2a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2"/></svg>
        Submit all sitemaps
      </button>
      <button type="button" class="app-pill app-pill-secondary" onclick={() => window.open(`${aiBase}/properties/submit-all?op=bing`, '_blank')}>Submit all to Bing</button>
      <button type="button" class="app-pill app-pill-secondary" onclick={() => window.open(`${aiBase}/properties/submit-all?op=indexnow`, '_blank')}>IndexNow all</button>
    </div>
  </header>

  <div class="mb-4 flex flex-wrap gap-2">
    <span class="inline-flex items-baseline gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-sm">
      <span class="text-gray-500">Sites</span>
      <span class="font-semibold tabular-nums text-gray-900">{fmtNum(totals.sites)}</span>
    </span>
    <span class="inline-flex items-baseline gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-sm">
      <span class="text-gray-500">Impressions</span>
      <span class="font-semibold tabular-nums text-gray-900">{fmtNum(totals.impressions)}</span>
    </span>
    <span class="inline-flex items-baseline gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-sm">
      <span class="text-gray-500">Clicks</span>
      <span class="font-semibold tabular-nums text-gray-900">{fmtNum(totals.clicks)}</span>
    </span>
  </div>

  {#if perAccount.length > 1}
    <div class="mb-4 flex flex-wrap gap-2">
      {#each perAccount as a}
        <div class="rounded-md border border-gray-200 px-3 py-1.5 text-sm">
          <div class="pii font-medium text-gray-800">{a.label}</div>
          <div class="pii flex gap-3 text-xs tabular-nums text-gray-500">
            <span>{fmtNum(a.sites)} sites</span>
            <span>{fmtNum(a.impressions)} impr</span>
            <span>{fmtNum(a.clicks)} clicks</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if data.errors.length > 0}
    <div class="app-errors">
      <div class="app-errors-title">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="6" cy="6" r="5"/><path d="M6 3.5v3M6 8.5v.01"/></svg>
        Errors
      </div>
      <ul class="ml-4 list-disc text-sm">
        {#each data.errors as e}
          <li><span class="font-medium">{e.accountEmail}</span>: {e.reason}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if hidden.size > 0}
    <p class="mb-3 text-xs">
      <button type="button" class="text-blue-600 hover:underline" onclick={() => showHidden = !showHidden}>
        {showHidden ? 'Hide hidden again' : `Show ${hidden.size} hidden site${hidden.size === 1 ? '' : 's'}`}
      </button>
    </p>
  {/if}

  {#if data.sites.length === 0}
    <div class="app-empty">
      <div class="app-empty-title">No sites yet</div>
      <p class="app-empty-sub">Connect a Google account on <a class="text-blue-600 hover:underline" href="/">Accounts</a>.</p>
    </div>
  {:else}
    <div class="-mx-3 overflow-x-auto sm:-mx-6">
    <table class="app-table">
      <thead>
        <tr>
          <th class="pl-3 sm:pl-6">
            <a class="cursor-pointer hover:underline" href={sortHref('site', data.sort, data.dir, data.days)}>
              Site URL{sortIndicator('site', data.sort, data.dir)}
            </a>
          </th>
          <th class="hidden md:table-cell">
            <a class="cursor-pointer hover:underline" href={sortHref('account', data.sort, data.dir, data.days)}>
              Account{sortIndicator('account', data.sort, data.dir)}
            </a>
          </th>
          <th>
            <a class="cursor-pointer hover:underline" href={sortHref('clicks', data.sort, data.dir, data.days)}>
              Clicks{sortIndicator('clicks', data.sort, data.dir)}
            </a>
          </th>
          <th class="hidden sm:table-cell">
            <a class="cursor-pointer hover:underline" href={sortHref('impressions', data.sort, data.dir, data.days)}>
              Impressions{sortIndicator('impressions', data.sort, data.dir)}
            </a>
          </th>
          <th class="hidden md:table-cell">
            <a class="cursor-pointer hover:underline" href={sortHref('ctr', data.sort, data.dir, data.days)}>
              CTR{sortIndicator('ctr', data.sort, data.dir)}
            </a>
          </th>
          <th class="pr-3 sm:pr-0">
            <a class="cursor-pointer hover:underline" href={sortHref('position', data.sort, data.dir, data.days)}>
              Avg Pos{sortIndicator('position', data.sort, data.dir)}
            </a>
          </th>
          <th class="hidden lg:table-cell" title="Дата создания репозитория сайта (git.local)">
            <a class="cursor-pointer hover:underline" href={sortHref('date', data.sort, data.dir, data.days)}>
              Created{sortIndicator('date', data.sort, data.dir)}
            </a>
          </th>
          <th class="hidden md:table-cell" title="Bing clicks · последние ~2 недели (не зависит от фильтра дней)">Bing Clk</th>
          <th class="hidden md:table-cell" title="Bing impressions · последние ~2 недели (не зависит от фильтра дней)">Bing Impr</th>
          <th class="hidden md:table-cell print:hidden">Export</th>
          <th class="hidden md:table-cell print:hidden">Visibility</th>
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
          <tr class="cursor-pointer {s.hasIndexNow ? 'hover:bg-gray-50' : 'bg-amber-50 hover:bg-amber-100'} {isHidden ? 'is-hidden-row' : ''}" onclick={() => toggleSite(s)} title={s.hasIndexNow ? undefined : 'Нет IndexNow-ключа ({key}.txt) — не настроен для Bing/IndexNow'}>
            <td class="pl-3 sm:pl-6">
              <span class="mr-1 text-gray-400 print:hidden">{expanded ? '▾' : '▸'}</span>
              <a class="pii text-blue-600 hover:underline" href={siteHref(s.siteUrl)} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>{displaySite(s.siteUrl)}</a>
              <a
                class="ml-1.5 inline-flex h-4 align-middle text-gray-400 hover:text-blue-600 print:hidden"
                href={detailHref(s)}
                title="Site analytics — striking distance, cannibalization, decay, CTR, health"
                aria-label="Site analytics"
                onclick={(e) => e.stopPropagation()}
              >📊</a>
              <a
                class="ml-1.5 inline-flex h-4 align-middle opacity-70 transition-opacity hover:opacity-100 print:hidden"
                href={siteSearchHref(s.siteUrl)}
                target="_blank"
                rel="noopener noreferrer"
                title="Google site:{displaySite(s.siteUrl)} — проверить индексацию"
                aria-label="Google site search"
                onclick={(e) => e.stopPropagation()}
              ><img src={googleIcon} alt="Google" class="h-4 w-auto" /></a>
              <a
                class="ml-1.5 inline-flex h-4 align-middle opacity-70 transition-opacity hover:opacity-100 print:hidden"
                href={bingWebmasterHref(s.siteUrl)}
                target="_blank"
                rel="noopener noreferrer"
                title="Bing Webmaster — {displaySite(s.siteUrl)}"
                aria-label="Open Bing Webmaster"
                onclick={(e) => e.stopPropagation()}
              ><img src={bingIcon} alt="Bing" class="h-4 w-auto" /></a>
              <button
                type="button"
                class="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                title="Resubmit sitemap(s) to Google"
                disabled={subSt?.kind === 'loading'}
                onclick={(e) => { e.stopPropagation(); submitSitemapFor({ accountId: s.accountId, siteUrl: s.siteUrl }); }}
              >{subSt?.kind === 'loading' ? '…' : 'Submit sitemap'}</button>
              {#if subSt?.kind === 'done'}
                <span class="ml-1 text-[11px] {subSt.failed > 0 ? 'text-amber-700' : 'text-green-700'}" title={subSt.failed > 0 ? subSt.failReasons.join('\n') : `source: ${subSt.source}`}>✓ {subSt.submitted}{#if subSt.failed > 0} · ✗ {subSt.failed}{/if}</span>
              {:else if subSt?.kind === 'error'}
                <span class="ml-1 text-[11px] text-red-600" title={subSt.message}>✗ failed</span>
              {/if}
              <button
                type="button"
                class="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                title="Submit sitemap to Bing"
                disabled={bSt?.kind === 'loading'}
                onclick={(e) => { e.stopPropagation(); submitBingFor({ accountId: s.accountId, siteUrl: s.siteUrl }); }}
              >{bSt?.kind === 'loading' ? '…' : 'Bing'}</button>
              {#if bSt?.kind === 'done'}
                <span class="ml-0.5 text-[11px] text-green-700">✓</span>
              {:else if bSt?.kind === 'error'}
                <span class="ml-0.5 text-[11px] text-red-600" title={bSt.msg}>✗</span>
              {/if}
              <button
                type="button"
                class="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                title="Push sitemap URLs to IndexNow (Bing)"
                disabled={iSt?.kind === 'loading'}
                onclick={(e) => { e.stopPropagation(); indexNowFor({ accountId: s.accountId, siteUrl: s.siteUrl }); }}
              >{iSt?.kind === 'loading' ? '…' : 'IndexNow'}</button>
              {#if iSt?.kind === 'done'}
                <span class="ml-0.5 text-[11px] text-green-700" title={iSt.msg}>✓</span>
              {:else if iSt?.kind === 'error'}
                <span class="ml-0.5 text-[11px] text-red-600" title={iSt.msg}>✗</span>
              {/if}
              <button
                type="button"
                class="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-200"
                title="View and manage sitemaps"
                onclick={(e) => { e.stopPropagation(); openSitemapModal({ accountId: s.accountId, siteUrl: s.siteUrl }); }}
              >Sitemaps</button>
            </td>
            <td class="pii hidden md:table-cell">
              {s.accountLabel ?? s.accountEmail}
              {#if s.accountLabel}<span class="text-gray-400"> ({s.accountEmail})</span>{/if}
            </td>
            {#if s.summary !== null}
              <td class="app-num">
                <span class="pii">{fmtNum(s.summary.clicks)}</span>
                {#if s.summary.series?.length}
                  <svg viewBox="0 0 64 16" class="ml-1 inline-block h-3.5 w-14 align-middle text-blue-500 print:hidden" preserveAspectRatio="none" aria-hidden="true">
                    <path d={sparkPath(s.summary.series)} fill="none" stroke="currentColor" stroke-width="1" />
                  </svg>
                {/if}
              </td>
              <td class="app-num pii hidden sm:table-cell">{fmtNum(s.summary.impressions)}</td>
              <td class="app-num pii hidden md:table-cell">{fmtCtr(s.summary.ctr)}</td>
              <td class="app-num pii pr-3 sm:pr-0">{fmtPos(s.summary.position)}</td>
            {:else}
              <td class="text-gray-400" title={s.summaryError ?? ''}>—</td>
              <td class="hidden text-gray-400 sm:table-cell" title={s.summaryError ?? ''}>—</td>
              <td class="hidden text-gray-400 md:table-cell" title={s.summaryError ?? ''}>—</td>
              <td class="pr-3 text-gray-400 sm:pr-0" title={s.summaryError ?? ''}>
                — <span class="inline-block h-2 w-2 rounded-full bg-red-500" title={s.summaryError ?? 'error'}></span>
              </td>
            {/if}
            <td class="app-num hidden lg:table-cell text-gray-600" title="git.local repo created_at">{fmtDate(s.createdAt)}</td>
            <td class="app-num hidden md:table-cell" title="Bing · последние ~2 недели">{s.bing ? fmtNum(s.bing.clicks) : '—'}</td>
            <td class="app-num hidden md:table-cell" title="Bing · последние ~2 недели">{s.bing ? fmtNum(s.bing.impressions) : '—'}</td>
            <td class="hidden md:table-cell print:hidden" onclick={(e) => e.stopPropagation()}>
              <a
                class="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700 hover:bg-blue-200"
                href="/properties/export?account={encodeURIComponent(s.accountId)}&site={encodeURIComponent(s.siteUrl)}&days={data.days}&dim=query"
              >query CSV</a>
              <a
                class="ml-1 rounded bg-blue-100 px-2 py-1 text-xs text-blue-700 hover:bg-blue-200"
                href="/properties/export?account={encodeURIComponent(s.accountId)}&site={encodeURIComponent(s.siteUrl)}&days={data.days}&dim=page"
              >page CSV</a>
            </td>
            <td class="hidden md:table-cell print:hidden" onclick={(e) => e.stopPropagation()}>
              {#if !isHidden}
                <button
                  type="button"
                  class="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
                  onclick={() => hideSite(s)}
                >Hide</button>
              {:else}
                <button
                  type="button"
                  class="rounded bg-yellow-100 px-2 py-1 text-xs text-yellow-800 hover:bg-yellow-200"
                  onclick={() => unhideSite(s)}
                >Unhide</button>
              {/if}
            </td>
          </tr>
          {#if expanded}
            <tr class="border-b bg-gray-50">
              <td class="px-3 py-3" colspan="11">
                {#if inspectState.kind === 'loading'}
                  <div class="text-sm text-gray-500">Inspecting {inspectState.total} top URLs (URL Inspection API, ~3-5s)…</div>
                {:else if inspectState.kind === 'error'}
                  <div class="text-sm text-red-600">{inspectState.message}</div>
                {:else if inspectState.kind === 'loaded'}
                  {@const loadedState = inspectState}
                  <div class="mb-2 flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {#if loadedState.source === 'page-entries'}
                        Top {loadedState.results.length} URLs by impressions in current period.
                      {:else if loadedState.source === 'page-entries+sitemap'}
                        {loadedState.results.length} URLs (top by impressions plus sitemap fill-in).
                      {:else}
                        {loadedState.results.length} URLs from sitemap (no impressions in current period).
                      {/if}
                      {#if loadedState.cached}<span class="ml-1 text-gray-400">· Cached {fmtCacheTime(loadedState.fetchedAt)}</span>{:else}<span class="ml-1 text-gray-400">· Fresh</span>{/if}
                      {#if loadedState.sitemapNote}<span class="ml-2 text-amber-700" title={loadedState.sitemapNote}>(sitemap note)</span>{/if}
                    </span>
                    <button type="button" class="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-200" onclick={(e) => { e.stopPropagation(); refreshInspection({ accountId: loadedState.accountId, siteUrl: loadedState.site }); }}>
                      Force refresh
                    </button>
                  </div>
                  <table class="w-full border-collapse text-xs">
                    <thead>
                      <tr class="border-b border-gray-200 text-left uppercase tracking-wide text-gray-500">
                        <th class="py-1.5">URL</th>
                        <th class="py-1.5">Status</th>
                        <th class="py-1.5">Coverage</th>
                        <th class="py-1.5">Robots</th>
                        <th class="py-1.5">Last crawl</th>
                        <th class="py-1.5">Canonical</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each loadedState.results as r}
                        <tr class="border-b border-gray-100">
                          <td class="py-1.5">
                            <a class="font-mono text-blue-600 hover:underline" href={r.inspectionUrl} target="_blank" rel="noopener noreferrer">{shortUrl(r.inspectionUrl, loadedState.site)}</a>
                          </td>
                          {#if r.status === 'error'}
                            <td colspan="5" class="py-1.5 text-red-600">{r.error}</td>
                          {:else if r.index}
                            {@const v = verdictBadge(r.index.verdict)}
                            <td class="py-1.5">
                              <span class="inline-flex items-center rounded px-1.5 py-0.5 {v.cls}">
                                <span class="mr-1.5 inline-block h-1.5 w-1.5 rounded-full {v.dot}"></span>
                                {v.label}
                              </span>
                            </td>
                            <td class="py-1.5 text-gray-700">{r.index.coverageState ?? '—'}</td>
                            <td class="py-1.5 {r.index.robotsTxtState === 'DISALLOWED' ? 'text-red-700' : 'text-gray-700'}">{r.index.robotsTxtState ?? '—'}</td>
                            <td class="app-num py-1.5 text-gray-600">{fmtCrawlTime(r.index.lastCrawlTime)}</td>
                            <td class="py-1.5 text-gray-600">
                              {#if r.index.googleCanonical && r.index.userCanonical && r.index.googleCanonical !== r.index.userCanonical}
                                <span class="text-amber-700" title="Google: {r.index.googleCanonical}\nUser: {r.index.userCanonical}">Mismatch</span>
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
                {/if}
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
    </div>
  {/if}

  {#if data.queryEntries.length > 0}
    <section class="app-section">
      <div class="app-section-head">
        <div>
          <h2 class="app-section-title">Top queries</h2>
          <p class="app-section-sub font-mono text-[11px] tracking-tight text-gray-400">visible sites · query × page × country · rowLimit 1000 · click pos → SERP · click row → 16-mo history</p>
        </div>
        <div class="flex items-center gap-3 text-xs">
          <button
            type="button"
            class="app-pill app-pill-secondary"
            onclick={copyKeys}
            title="Copy all unique queries of the current (filtered) view to the clipboard, one per line"
          >{keysCopied ? 'Copied ✓' : 'Copy keys'}</button>
          <a
            class="app-pill app-pill-secondary"
            href="/properties/queries-export?days={data.days}&hidden={encodeURIComponent([...hidden].join(','))}"
            download
            title="Download all queries (query · country · impressions · clicks), filters applied"
          >Export all CSV</a>
          <span class="text-gray-500">{aggregatedQueries.length} of {data.queryEntries.length > 0 ? data.queryEntries.reduce((a, e) => a + e.rows.length, 0) : 0}</span>
        </div>
      </div>
      {#snippet facet(label: string, options: string[], selected: Set<string>, onToggle: (v: string) => void, onClear: () => void, search: string, onSearch: (v: string) => void)}
        <details class="facet relative">
          <summary class="app-pill app-pill-secondary cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            {label}{selected.size > 0 ? ` · ${selected.size}` : ' · all'} ▾
          </summary>
          <div class="absolute z-20 mt-1 flex max-h-72 w-52 flex-col rounded border border-gray-200 bg-white p-1 shadow-lg">
            {#if options.length === 0}
              <div class="px-2 py-1 text-gray-400">—</div>
            {:else}
              {@const shown = search.trim() ? options.filter((o) => o.toLowerCase().includes(search.trim().toLowerCase())) : options}
              <input
                class="mb-1 w-full rounded border border-gray-300 px-2 py-1 text-[11px]"
                placeholder="search…"
                value={search}
                oninput={(e) => onSearch(e.currentTarget.value)}
              />
              {#if selected.size > 0}
                <button type="button" class="mb-1 w-full rounded px-2 py-1 text-left text-blue-600 hover:bg-gray-50 hover:underline" onclick={onClear}>Clear ({selected.size})</button>
              {/if}
              <div class="overflow-auto">
                {#each shown as opt}
                  <label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-gray-50">
                    <input type="checkbox" checked={selected.has(opt)} onchange={() => onToggle(opt)} />
                    <span class="break-all font-mono text-[11px]">{opt}</span>
                  </label>
                {/each}
                {#if shown.length === 0}
                  <div class="px-2 py-1 text-gray-400">no match</div>
                {/if}
              </div>
            {/if}
          </div>
        </details>
      {/snippet}
      <div class="mb-2 flex flex-wrap items-center gap-2 text-xs print:hidden">
        <span class="text-gray-500">Filter:</span>
        {@render facet('Country', availableCountries, selectedCountries, toggleCountry, () => (selectedCountries = new Set()), countrySearch, (v) => (countrySearch = v))}
        {@render facet('Domain', availableDomains, selectedDomains, toggleDomain, () => (selectedDomains = new Set()), domainSearch, (v) => (domainSearch = v))}
        <select class="rounded border border-gray-300 px-2 py-1 text-xs" bind:value={querySource} title="Откуда ключ — GSC и/или Bing">
          <option value="all">Источник · все</option>
          <option value="gsc">только GSC</option>
          <option value="bing">только Bing</option>
          <option value="both">в обоих</option>
        </select>
        <span class="inline-flex items-center gap-1 text-gray-500">
          Avg Pos
          <input type="number" min="0" step="0.1" class="w-14 rounded border border-gray-300 px-1.5 py-1 text-xs" placeholder="от" bind:value={posMin} title="Avg Pos от (включительно)" />
          <span>–</span>
          <input type="number" min="0" step="0.1" class="w-14 rounded border border-gray-300 px-1.5 py-1 text-xs" placeholder="до" bind:value={posMax} title="Avg Pos до (включительно), пусто = без верхней границы" />
        </span>
        {#if selectedCountries.size > 0 || selectedDomains.size > 0 || querySource !== 'gsc' || (posMin ?? 0) > 0 || posMax != null}
          <button type="button" class="text-blue-600 hover:underline" onclick={() => { selectedCountries = new Set(); selectedDomains = new Set(); querySource = 'gsc'; posMin = 0; posMax = null; }}>reset all</button>
        {/if}
      </div>
      <div class="mb-2 flex flex-wrap items-center gap-1.5 text-xs print:hidden">
        <span class="text-gray-500">Hide queries containing:</span>
        {#each queryFilters as f}
          <span class="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 font-mono text-gray-700">
            {f.pattern}
            <button type="button" class="text-gray-400 hover:text-red-600" title="Remove filter" onclick={() => removeQueryFilter(f.id)}>✕</button>
          </span>
        {/each}
        <form class="inline-flex items-center" onsubmit={(e) => { e.preventDefault(); addQueryFilter(newQueryFilter); }}>
          <input class="w-24 rounded border border-gray-300 px-1.5 py-0.5" placeholder="site:" bind:value={newQueryFilter} />
          <button type="submit" class="ml-1 rounded bg-gray-100 px-2 py-0.5 text-gray-700 hover:bg-gray-200">Add</button>
        </form>
        {#if hiddenQueryCount > 0 || showFilteredQueries}
          <button type="button" class="ml-auto text-blue-600 hover:underline" onclick={() => (showFilteredQueries = !showFilteredQueries)}>
            {showFilteredQueries ? 'hide filtered' : `show ${hiddenQueryCount} filtered`}
          </button>
        {/if}
      </div>
      <div class="-mx-3 overflow-x-auto sm:-mx-6">
      <table class="app-table">
        <thead>
          <tr>
            <th class="cursor-pointer pl-3 hover:underline sm:pl-6" onclick={() => toggleQSort('query')}>Query{qIndicator('query')}</th>
            <th class="hidden cursor-pointer hover:underline md:table-cell" onclick={() => toggleQSort('page')}>Page{qIndicator('page')}</th>
            <th class="cursor-pointer hover:underline" onclick={() => toggleQSort('country')}>Country{qIndicator('country')}</th>
            <th class="cursor-pointer hover:underline" onclick={() => toggleQSort('clicks')}>GSC clk{qIndicator('clicks')}</th>
            <th class="hidden cursor-pointer hover:underline sm:table-cell" onclick={() => toggleQSort('impressions')}>GSC imp{qIndicator('impressions')}</th>
            <th class="hidden cursor-pointer hover:underline md:table-cell" onclick={() => toggleQSort('ctr')}>CTR{qIndicator('ctr')}</th>
            <th class="cursor-pointer hover:underline" onclick={() => toggleQSort('position')}>Avg Pos{qIndicator('position')}</th>
            <th class="cursor-pointer hover:underline" onclick={() => toggleQSort('bingClicks')}>Bing clk{qIndicator('bingClicks')}</th>
            <th class="hidden cursor-pointer pr-3 hover:underline sm:table-cell sm:pr-0" onclick={() => toggleQSort('bingImpr')}>Bing imp{qIndicator('bingImpr')}</th>
          </tr>
        </thead>
        <tbody>
          {#each aggregatedQueries as q}
            {@const qKey = `${q.query}|${q.page}|${q.country}`}
            {@const serpUrl = googleSerpUrl(q.query, q.country)}
            {@const pos = q.gsc?.position ?? q.bing?.position ?? 0}
            {@const posClass = pos > 0 && pos <= 10 ? 'bg-green-50 hover:bg-green-100' : pos > 0 && pos <= 20 ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-50'}
            <tr class="cursor-pointer {posClass}" onclick={() => toggleQuery(q.query, q.page, q.country)}>
              <td class="pl-3 sm:pl-6">
                <span class="mr-1 text-gray-400 print:hidden">{expandedQuery === qKey ? '▾' : '▸'}</span>
                {q.query}
                {#if q.gsc}<span class="ml-1 inline-flex items-center rounded-sm bg-green-100 px-1 py-0 align-middle text-[9px] font-medium text-green-700" title="Есть в Google Search Console">GSC</span>{/if}
                {#if q.bing}<span class="ml-1 inline-flex items-center rounded-sm bg-blue-100 px-1 py-0 align-middle text-[9px] font-medium text-blue-700" title="Есть в Bing">Bing</span>{/if}
                <button
                  type="button"
                  class="ml-1 text-gray-300 hover:text-red-600"
                  title="Hide this query (adds it as a filter)"
                  onclick={(e) => { e.stopPropagation(); addQueryFilter(q.query); }}
                >✕</button>
              </td>
              <td class="hidden break-all md:table-cell">
                {#if q.page}
                  <a class="text-blue-600 hover:underline" href={q.page} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>{q.page}</a>
                {:else}
                  <span class="font-mono text-[11px] text-gray-500" title="Только Bing — страница неизвестна, показан домен">{q.domain}</span>
                {/if}
              </td>
              <td>
                {#if q.country}
                  <span class="inline-flex items-center rounded-sm bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-gray-600">{q.country}</span>
                {/if}
              </td>
              <td class="app-num">{q.gsc ? fmtNum(q.gsc.clicks) : '—'}</td>
              <td class="app-num hidden sm:table-cell">{q.gsc ? fmtNum(q.gsc.impressions) : '—'}</td>
              <td class="app-num hidden md:table-cell">{q.gsc ? fmtCtr(q.gsc.ctr) : '—'}</td>
              <td class="app-num">
                {#if q.gsc}
                  {#if serpUrl}
                    <a class="group inline-flex items-baseline gap-0.5 text-gray-800 transition-colors duration-150 hover:text-blue-600 hover:underline hover:decoration-blue-600 hover:underline-offset-2" href={serpUrl} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()} title="Open Google SERP · {q.country.toUpperCase()}">{fmtPos(q.gsc.position)}<span class="text-[9px] text-gray-400 transition-colors duration-150 group-hover:text-blue-500">↗</span></a>
                  {:else}
                    {fmtPos(q.gsc.position)}
                  {/if}
                {:else}
                  <span class="text-gray-400">—</span>
                {/if}
              </td>
              <td class="app-num">{q.bing ? fmtNum(q.bing.clicks) : '—'}</td>
              <td class="app-num hidden pr-3 sm:table-cell sm:pr-0">{q.bing ? fmtNum(q.bing.impressions) : '—'}</td>
            </tr>
            {#if expandedQuery === qKey}
              <tr class="bg-gray-50">
                <td class="px-2 py-3" colspan="9">
                  {#if historyState.kind === 'loading'}
                    <div class="text-sm text-gray-500">Loading 16-month history…</div>
                  {:else if historyState.kind === 'error'}
                    <div class="text-sm text-red-600">Failed: {historyState.message}</div>
                  {:else if historyState.kind === 'loaded'}
                    {@const chart = buildHistoryChart(historyState.aggregated)}
                    {#if historyState.aggregated.length === 0}
                      <div class="text-sm text-gray-500">No data for this query in the last 16 months on visible sites.</div>
                    {:else}
                      <svg viewBox="0 0 {chart.width} {chart.height}" class="w-full" role="img" aria-label="16-month query history">
                        <!-- horizontal grid lines -->
                        {#each chart.gridLines as gl}
                          <line x1={gl.x1} y1={gl.y} x2={gl.x2} y2={gl.y} stroke="rgb(229 231 235)" stroke-width="0.5" stroke-dasharray="2 2" />
                        {/each}
                        <!-- left axis line -->
                        <line x1={chart.padLeft} y1={chart.padTop} x2={chart.padLeft} y2={chart.height - chart.padBottom} stroke="rgb(229 231 235)" stroke-width="0.5" />
                        <!-- impressions bars -->
                        {#each chart.bars as bar}
                          <rect x={bar.x} y={bar.y} width={bar.w} height={bar.h} fill="rgb(191 219 254)"><title>{bar.date}: {fmtNum(bar.impr)} impressions</title></rect>
                        {/each}
                        <!-- position line (red, lower=better=top) -->
                        <path d={chart.posPath} stroke="rgb(220 38 38)" stroke-width="1.5" fill="none" />
                        <!-- date labels -->
                        {#each chart.dateLabels as lab}
                          <text x={lab.x} y={chart.height - 5} text-anchor="middle" font-size="10" fill="rgb(107 114 128)">{lab.date}</text>
                        {/each}
                        <!-- y-axis labels: position min/max -->
                        <text x={chart.padLeft - 4} y={chart.padTop + 3} text-anchor="end" font-size="10" fill="rgb(220 38 38)">{chart.minPos.toFixed(1)}</text>
                        <text x={chart.padLeft - 4} y={chart.padTop + chart.innerH} text-anchor="end" font-size="10" fill="rgb(220 38 38)">{chart.maxPos.toFixed(1)}</text>
                      </svg>
                      <div class="mt-2 flex items-center gap-4 text-[11px] text-gray-500">
                        <span class="inline-flex items-center gap-1.5"><span class="inline-block h-0.5 w-3 bg-red-600"></span>Position</span>
                        <span class="inline-flex items-center gap-1.5"><span class="inline-block h-2 w-2 bg-blue-200"></span>Impressions</span>
                        <span class="ml-auto text-gray-400">Aggregated across {historyState.entries.length} visible site{historyState.entries.length === 1 ? '' : 's'} · Position {chart.minPos.toFixed(1)}–{chart.maxPos.toFixed(1)} · Max impr {fmtNum(chart.maxImpr)}</span>
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
    <section class="app-section">
      <div class="app-section-head">
        <div>
          <h2 class="app-section-title">Top pages</h2>
          <p class="app-section-sub">Aggregated across visible sites only. Per-site rowLimit 200.</p>
        </div>
        <span class="text-xs text-gray-500">{aggregatedPages.length} of {data.pageEntries.length > 0 ? data.pageEntries.reduce((a, e) => a + e.rows.length, 0) : 0}</span>
      </div>
      <div class="-mx-3 overflow-x-auto sm:-mx-6">
      <table class="app-table">
        <thead>
          <tr>
            <th class="cursor-pointer pl-3 hover:underline sm:pl-6" onclick={() => togglePSort('page')}>Page{pIndicator('page')}</th>
            <th class="cursor-pointer hover:underline" onclick={() => togglePSort('clicks')}>Clicks{pIndicator('clicks')}</th>
            <th class="hidden cursor-pointer hover:underline sm:table-cell" onclick={() => togglePSort('impressions')}>Impressions{pIndicator('impressions')}</th>
            <th class="hidden cursor-pointer hover:underline md:table-cell" onclick={() => togglePSort('ctr')}>CTR{pIndicator('ctr')}</th>
            <th class="cursor-pointer pr-3 hover:underline sm:pr-0" onclick={() => togglePSort('position')}>Avg Pos{pIndicator('position')}</th>
          </tr>
        </thead>
        <tbody>
          {#each aggregatedPages as p}
            <tr>
              <td class="break-all pl-3 sm:pl-6">
                <a class="text-blue-600 hover:underline" href={p.page} target="_blank" rel="noopener noreferrer">{p.page}</a>
              </td>
              <td class="app-num">{fmtNum(p.clicks)}</td>
              <td class="app-num hidden sm:table-cell">{fmtNum(p.impressions)}</td>
              <td class="app-num hidden md:table-cell">{fmtCtr(p.ctr)}</td>
              <td class="app-num pr-3 sm:pr-0">{fmtPos(p.position)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      </div>
    </section>
  {/if}

  {#if sitemapModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onclick={closeSitemapModal} role="presentation">
      <div class="max-h-[85vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-5 shadow-xl" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-base font-semibold">Sitemaps — {sitemapModal.title}</h2>
          <button class="text-gray-400 hover:text-gray-700" onclick={closeSitemapModal} aria-label="Close">✕</button>
        </div>

        {#if sitemapModal.load === 'loading'}
          <div class="text-sm text-gray-500">Loading…</div>
        {:else if sitemapModal.load === 'error'}
          <div class="text-sm text-red-600">{sitemapModal.loadError}</div>
        {:else}
          <div class="mb-4">
            <div class="mb-1 text-xs font-medium uppercase text-gray-500">Registered in Search Console ({sitemapModal.current.length})</div>
            {#if sitemapModal.current.length === 0}
              <div class="text-sm text-gray-400">None.</div>
            {:else}
              <ul class="space-y-1">
                {#each sitemapModal.current as sm}
                  <li class="break-all text-sm">
                    <span class="text-gray-800">{sm.path}</span>
                    {#if sm.errors && sm.errors !== '0'}<span class="ml-1 text-[11px] text-red-600">{sm.errors} errors</span>{/if}
                    {#if sm.isPending}<span class="ml-1 text-[11px] text-amber-600">pending</span>{/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <div class="mb-4">
            <div class="mb-1 text-xs font-medium uppercase text-gray-500">Declared in robots.txt ({sitemapModal.robots.length})</div>
            {#if sitemapModal.robotsError}
              <div class="text-sm text-amber-700">robots.txt: {sitemapModal.robotsError}</div>
            {:else if sitemapModal.robots.length === 0}
              <div class="text-sm text-gray-400">None found.</div>
            {:else}
              <ul class="space-y-1">
                {#each sitemapModal.robots as r}
                  <li class="break-all text-sm text-gray-800">{r}</li>
                {/each}
              </ul>
            {/if}
          </div>

          {#if sitemapModal.resync.kind === 'done'}
            <div class="mb-3 rounded bg-green-50 px-3 py-2 text-sm text-green-800">
              Deleted {sitemapModal.resync.deleted}, submitted {sitemapModal.resync.submitted}.
              {#if sitemapModal.resync.failed.length > 0}
                <div class="mt-1 text-red-700">{sitemapModal.resync.failed.length} failed:
                  {#each sitemapModal.resync.failed as f}<div class="break-all text-xs">{f.op} {f.path}: {f.reason}</div>{/each}
                </div>
              {/if}
            </div>
          {:else if sitemapModal.resync.kind === 'error'}
            <div class="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{sitemapModal.resync.message}</div>
          {/if}

          <div class="flex justify-end gap-2">
            <button class="rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200" onclick={closeSitemapModal}>Close</button>
            <button
              class="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={sitemapModal.resync.kind === 'running' || sitemapModal.robots.length === 0}
              title={sitemapModal.robots.length === 0 ? 'robots.txt declares no sitemaps' : 'Delete all registered sitemaps, then submit the ones from robots.txt'}
              onclick={resyncSitemaps}
            >{sitemapModal.resync.kind === 'running' ? 'Resyncing…' : 'Delete all + add from robots.txt'}</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</main>
