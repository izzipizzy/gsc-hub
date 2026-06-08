<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { displaySite, siteHref, siteSearchHref } from '$lib/utils/site';
  import { googleSerpUrl } from '$lib/utils/country';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  const nf = new Intl.NumberFormat('en-US');
  function fmtNum(n: number) { return nf.format(n); }
  function fmtCtr(c: number) { return (c * 100).toFixed(1) + '%'; }
  function fmtPos(p: number) { return p.toFixed(1); }

  const STORAGE_KEY = 'gsc-hub:hidden-sites';

  type SiteWithSummary = (typeof data.sites)[number];

  function keyOf(s: SiteWithSummary): string {
    return `${s.accountId}|${s.siteUrl}`;
  }

  let hidden = $state<Set<string>>(new Set());
  let showHidden = $state(false);

  onMount(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          hidden = new Set(arr);
        }
      }
    } catch (e) {
      console.warn('[gsc-hub] Could not parse hidden sites from localStorage:', e);
      hidden = new Set();
    }
  });

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...hidden]));
    } catch (e) {
      console.warn('[gsc-hub] Could not persist hidden sites to localStorage:', e);
    }
  }

  function hideSite(s: SiteWithSummary) {
    hidden.add(keyOf(s));
    hidden = new Set(hidden);
    persist();
  }

  function unhideSite(s: SiteWithSummary) {
    hidden.delete(keyOf(s));
    hidden = new Set(hidden);
    persist();
  }

  let visibleSites = $derived(
    data.sites.filter(s => !hidden.has(keyOf(s)) || showHidden)
  );

  function sortHref(field: string, currentSort: string, currentDir: 'asc' | 'desc', days: number) {
    const nextDir = currentSort === field && currentDir === 'desc' ? 'asc' : 'desc';
    return `?days=${days}&sort=${field}&dir=${nextDir}`;
  }

  function sortIndicator(field: string, currentSort: string, currentDir: 'asc' | 'desc') {
    if (currentSort !== field) return '';
    return currentDir === 'asc' ? ' ↑' : ' ↓';
  }

  // Queries table: client-side sort state
  let qSort = $state<'query' | 'page' | 'country' | 'clicks' | 'impressions' | 'ctr' | 'position'>('impressions');
  let qDir = $state<'asc' | 'desc'>('desc');

  const aggregatedQueries = $derived.by(() => {
    type Bucket = { query: string; page: string; country: string; clicks: number; impressions: number; posSum: number; posWeight: number };
    const map = new Map<string, Bucket>();
    for (const entry of data.queryEntries) {
      const k = `${entry.accountId}|${entry.siteUrl}`;
      if (hidden.has(k)) continue;
      for (const r of entry.rows) {
        if (!r.query) continue;
        const key = `${r.query}|${r.page}|${r.country}`;
        const cur = map.get(key) ?? { query: r.query, page: r.page, country: r.country, clicks: 0, impressions: 0, posSum: 0, posWeight: 0 };
        cur.clicks += r.clicks;
        cur.impressions += r.impressions;
        cur.posSum += r.position * r.impressions;
        cur.posWeight += r.impressions;
        map.set(key, cur);
      }
    }
    const arr = Array.from(map.values()).map((b) => ({
      query: b.query,
      page: b.page,
      country: b.country,
      clicks: b.clicks,
      impressions: b.impressions,
      ctr: b.impressions > 0 ? b.clicks / b.impressions : 0,
      position: b.posWeight > 0 ? b.posSum / b.posWeight : 0
    }));
    const dirMul = qDir === 'desc' ? -1 : 1;
    arr.sort((a, b) => {
      if (qSort === 'query') return dirMul * a.query.localeCompare(b.query);
      if (qSort === 'page') return dirMul * a.page.localeCompare(b.page);
      if (qSort === 'country') return dirMul * a.country.localeCompare(b.country);
      return dirMul * (a[qSort] - b[qSort]);
    });
    return arr.slice(0, 200);
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
  let submitAllState = $state<
    | { kind: 'idle' }
    | { kind: 'loading'; done: number; total: number }
    | { kind: 'done'; sites: number; sitemaps: number; failed: number }
  >({ kind: 'idle' });

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

  async function submitAllSitemaps() {
    const sites = visibleSites;
    if (sites.length === 0) return;
    submitAllState = { kind: 'loading', done: 0, total: sites.length };
    let sitemaps = 0;
    let failed = 0;
    let doneCount = 0;
    const results = await Promise.all(
      sites.map(async (s) => {
        const r = await submitSitemapFor({ accountId: s.accountId, siteUrl: s.siteUrl });
        doneCount++;
        submitAllState = { kind: 'loading', done: doneCount, total: sites.length };
        return r;
      })
    );
    for (const r of results) {
      if (r) {
        sitemaps += r.submitted;
        failed += r.failed;
      } else {
        failed += 1;
      }
    }
    submitAllState = { kind: 'done', sites: sites.length, sitemaps, failed };
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

<main class="w-full p-3 sm:p-6">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs">
        <a href="/">Accounts</a>
        <span aria-hidden="true">/</span>
        <span class="text-gray-800">Sites</span>
      </nav>
      <h1 class="app-pagetitle">All sites</h1>
    </div>
    <div class="app-toolbar-right">
      <a href="/dashboard?days={data.days}" class="app-pill app-pill-secondary">Dashboard</a>
      <span class="app-toolbar-divider" aria-hidden="true"></span>
      <div class="app-segmented">
        <span class="app-segmented-label">Period</span>
        {#each [1, 3, 7, 28, 60] as d}
          <a class:is-active={data.days === d} href="?days={d}&sort={data.sort}&dir={data.dir}">{d}d</a>
        {/each}
      </div>
      <button type="button" class="app-pill app-pill-secondary" onclick={() => invalidateAll()}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7a4.5 4.5 0 0 1 7.96-2.86M11.5 7a4.5 4.5 0 0 1-7.96 2.86M11 2.5v2.5h-2.5M3 11.5v-2.5h2.5"/></svg>
        Refresh
      </button>
      <button type="button" class="app-pill app-pill-secondary" onclick={submitAllSitemaps} disabled={submitAllState.kind === 'loading'}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 1.5v7M4 5l3-3 3 3M2.5 9.5v2a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2"/></svg>
        {#if submitAllState.kind === 'loading'}Submitting {submitAllState.done}/{submitAllState.total}…{:else}Submit all sitemaps{/if}
      </button>
    </div>
  </header>

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

  {#if submitAllState.kind === 'done'}
    <p class="mb-3 text-xs {submitAllState.failed > 0 ? 'text-amber-700' : 'text-green-700'}">
      Submit all: {submitAllState.sitemaps} sitemap{submitAllState.sitemaps === 1 ? '' : 's'} submitted across {submitAllState.sites} site{submitAllState.sites === 1 ? '' : 's'}{#if submitAllState.failed > 0} · {submitAllState.failed} failed{/if}.
    </p>
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
          <th class="hidden md:table-cell">Export</th>
          <th class="hidden md:table-cell">Visibility</th>
        </tr>
      </thead>
      <tbody>
        {#each visibleSites as s}
          {@const sKey = `${s.accountId}|${s.siteUrl}`}
          {@const expanded = expandedSite === sKey}
          {@const isHidden = hidden.has(keyOf(s))}
          {@const subSt = submitStates.get(sKey)}
          <tr class="cursor-pointer hover:bg-gray-50 {isHidden ? 'is-hidden-row' : ''}" onclick={() => toggleSite(s)}>
            <td class="pl-3 sm:pl-6">
              <span class="mr-1 text-gray-400">{expanded ? '▾' : '▸'}</span>
              <a class="text-blue-600 hover:underline" href={siteHref(s.siteUrl)} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>{displaySite(s.siteUrl)}</a>
              <a
                class="app-gsearch"
                href={siteSearchHref(s.siteUrl)}
                target="_blank"
                rel="noopener noreferrer"
                title="Google site:{displaySite(s.siteUrl)} — проверить индексацию"
                aria-label="Google site search"
                onclick={(e) => e.stopPropagation()}
              >G</a>
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
            </td>
            <td class="hidden md:table-cell">
              {s.accountLabel ?? s.accountEmail}
              {#if s.accountLabel}<span class="text-gray-400"> ({s.accountEmail})</span>{/if}
            </td>
            {#if s.summary !== null}
              <td class="app-num">{fmtNum(s.summary.clicks)}</td>
              <td class="app-num hidden sm:table-cell">{fmtNum(s.summary.impressions)}</td>
              <td class="app-num hidden md:table-cell">{fmtCtr(s.summary.ctr)}</td>
              <td class="app-num pr-3 sm:pr-0">{fmtPos(s.summary.position)}</td>
            {:else}
              <td class="text-gray-400" title={s.summaryError ?? ''}>—</td>
              <td class="hidden text-gray-400 sm:table-cell" title={s.summaryError ?? ''}>—</td>
              <td class="hidden text-gray-400 md:table-cell" title={s.summaryError ?? ''}>—</td>
              <td class="pr-3 text-gray-400 sm:pr-0" title={s.summaryError ?? ''}>
                — <span class="inline-block h-2 w-2 rounded-full bg-red-500" title={s.summaryError ?? 'error'}></span>
              </td>
            {/if}
            <td class="hidden md:table-cell" onclick={(e) => e.stopPropagation()}>
              <a
                class="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700 hover:bg-blue-200"
                href="/properties/export?account={encodeURIComponent(s.accountId)}&site={encodeURIComponent(s.siteUrl)}&days={data.days}&dim=query"
              >query CSV</a>
              <a
                class="ml-1 rounded bg-blue-100 px-2 py-1 text-xs text-blue-700 hover:bg-blue-200"
                href="/properties/export?account={encodeURIComponent(s.accountId)}&site={encodeURIComponent(s.siteUrl)}&days={data.days}&dim=page"
              >page CSV</a>
            </td>
            <td class="hidden md:table-cell" onclick={(e) => e.stopPropagation()}>
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
              <td class="px-3 py-3" colspan="8">
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
        <span class="text-xs text-gray-500">{aggregatedQueries.length} of {data.queryEntries.length > 0 ? data.queryEntries.reduce((a, e) => a + e.rows.length, 0) : 0}</span>
      </div>
      <div class="-mx-3 overflow-x-auto sm:-mx-6">
      <table class="app-table">
        <thead>
          <tr>
            <th class="cursor-pointer pl-3 hover:underline sm:pl-6" onclick={() => toggleQSort('query')}>Query{qIndicator('query')}</th>
            <th class="hidden cursor-pointer hover:underline md:table-cell" onclick={() => toggleQSort('page')}>Page{qIndicator('page')}</th>
            <th class="cursor-pointer hover:underline" onclick={() => toggleQSort('country')}>Country{qIndicator('country')}</th>
            <th class="cursor-pointer hover:underline" onclick={() => toggleQSort('clicks')}>Clicks{qIndicator('clicks')}</th>
            <th class="hidden cursor-pointer hover:underline sm:table-cell" onclick={() => toggleQSort('impressions')}>Impressions{qIndicator('impressions')}</th>
            <th class="hidden cursor-pointer hover:underline md:table-cell" onclick={() => toggleQSort('ctr')}>CTR{qIndicator('ctr')}</th>
            <th class="cursor-pointer pr-3 hover:underline sm:pr-0" onclick={() => toggleQSort('position')}>Avg Pos{qIndicator('position')}</th>
          </tr>
        </thead>
        <tbody>
          {#each aggregatedQueries as q}
            {@const qKey = `${q.query}|${q.page}|${q.country}`}
            {@const serpUrl = googleSerpUrl(q.query, q.country)}
            {@const posClass = q.position > 0 && q.position <= 10 ? 'bg-green-50 hover:bg-green-100' : q.position > 0 && q.position <= 20 ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-50'}
            <tr class="cursor-pointer {posClass}" onclick={() => toggleQuery(q.query, q.page, q.country)}>
              <td class="pl-3 sm:pl-6">
                <span class="mr-1 text-gray-400">{expandedQuery === qKey ? '▾' : '▸'}</span>
                {q.query}
              </td>
              <td class="hidden break-all md:table-cell">
                {#if q.page}
                  <a class="text-blue-600 hover:underline" href={q.page} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>{q.page}</a>
                {:else}
                  <span class="text-gray-400">—</span>
                {/if}
              </td>
              <td>
                {#if q.country}
                  <span class="inline-flex items-center rounded-sm bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-gray-600">{q.country}</span>
                {/if}
              </td>
              <td class="app-num">{fmtNum(q.clicks)}</td>
              <td class="app-num hidden sm:table-cell">{fmtNum(q.impressions)}</td>
              <td class="app-num hidden md:table-cell">{fmtCtr(q.ctr)}</td>
              <td class="app-num pr-3 sm:pr-0">
                {#if serpUrl}
                  <a class="group inline-flex items-baseline gap-0.5 text-gray-800 transition-colors duration-150 hover:text-blue-600 hover:underline hover:decoration-blue-600 hover:underline-offset-2" href={serpUrl} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()} title="Open Google SERP · {q.country.toUpperCase()}">{fmtPos(q.position)}<span class="text-[9px] text-gray-400 transition-colors duration-150 group-hover:text-blue-500">↗</span></a>
                {:else}
                  {fmtPos(q.position)}
                {/if}
              </td>
            </tr>
            {#if expandedQuery === qKey}
              <tr class="bg-gray-50">
                <td class="px-2 py-3" colspan="7">
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
</main>
