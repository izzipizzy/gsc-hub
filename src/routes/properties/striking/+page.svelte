<script lang="ts">
  import { goto, replaceState } from '$app/navigation';
  import { displaySite, siteHref } from '$lib/utils/site';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // The portfolio data is streamed from the server (unawaited promise) so the shell renders
  // immediately; resolve it into local state. Re-resolves when the period (data.portfolio) changes.
  let pf = $state<Awaited<PageData['portfolio']> | null>(null);
  let pfErr = $state<string | null>(null);
  $effect(() => {
    const p = data.portfolio;
    pf = null;
    pfErr = null;
    p.then((v) => { if (data.portfolio === p) pf = v; })
     .catch((e) => { if (data.portfolio === p) pfErr = String((e as Error).message ?? e); });
  });

  // Reset the period-specific lazy state (decay + index) when the period changes.
  let lastDays = data.days;
  $effect(() => {
    if (data.days !== lastDays) {
      lastDays = data.days;
      decay = null;
      decayErr = null;
      idx = new Map();
      selectedCountries = new Set();
    }
  });

  const nf = new Intl.NumberFormat('en-US');
  const fmt = (n: number) => nf.format(Math.round(n));
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const posf = (x: number) => x.toFixed(1);
  const shortUrl = (u: string) => u.replace(/^https?:\/\/[^/]+/, '') || '/';
  const detailHref = (r: { siteUrl: string; accountId: string }) =>
    `/properties/${encodeURIComponent(r.siteUrl)}?acc=${encodeURIComponent(r.accountId)}`;

  function goToDays(raw: string | number) {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 1) return;
    goto(`?days=${Math.min(n, 480)}&tab=${tab}`);
  }

  type Tab = 'striking' | 'cannibal' | 'ctr' | 'branded' | 'decay';
  const TABS: { id: Tab; label: string }[] = [
    { id: 'striking', label: 'Striking Distance' },
    { id: 'cannibal', label: 'Cannibalization' },
    { id: 'ctr', label: 'CTR Benchmark' },
    { id: 'branded', label: 'Branded' },
    { id: 'decay', label: 'Decay' }
  ];
  let tab = $state<Tab>(data.initialTab as Tab);

  // ── Striking: client-side sort ──
  type SortKey = 'site' | 'page' | 'query' | 'country' | 'position' | 'impressions' | 'clicks' | 'ctr';
  let sortKey = $state<SortKey>('impressions');
  let sortDir = $state<'asc' | 'desc'>('desc');
  function toggleSort(k: SortKey) {
    if (sortKey === k) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    else { sortKey = k; sortDir = k === 'position' ? 'asc' : 'desc'; }
  }
  const ind = (k: SortKey) => (sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');
  type StrikingRow = NonNullable<typeof pf>['striking'][number];
  const sortedStriking = $derived.by(() => {
    const dir = sortDir === 'desc' ? -1 : 1;
    const val = (r: StrikingRow) => {
      switch (sortKey) {
        case 'site': return displaySite(r.siteUrl);
        case 'page': return r.page;
        case 'query': return r.query;
        case 'country': return r.country;
        default: return r[sortKey as 'position' | 'impressions' | 'clicks' | 'ctr'];
      }
    };
    return [...(pf?.striking ?? [])].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === 'string' && typeof bv === 'string') return dir * av.localeCompare(bv);
      return dir * ((av as number) - (bv as number));
    });
  });

  // ── Striking: country filter (empty set = all) ──
  let selectedCountries = $state<Set<string>>(new Set());
  const availableCountries = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const r of pf?.striking ?? []) if (r.country) counts.set(r.country, (counts.get(r.country) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  });
  function toggleCountry(c: string) {
    const next = new Set(selectedCountries);
    next.has(c) ? next.delete(c) : next.add(c);
    selectedCountries = next;
  }
  const filteredStriking = $derived(
    selectedCountries.size === 0
      ? sortedStriking
      : sortedStriking.filter((r) => selectedCountries.has(r.country))
  );

  // ── Copy the (filtered) unique queries to the clipboard ──
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  async function copyQueries() {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const r of filteredStriking) if (!seen.has(r.query)) { seen.add(r.query); lines.push(r.query); }
    await navigator.clipboard.writeText(lines.join('\n'));
    copied = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 1500);
  }

  // ── Decay: lazy ──
  let decay = $state<any>(null);
  let decayErr = $state<string | null>(null);
  let decayLoading = $state(false);
  async function loadDecay() {
    if (decay || decayLoading) return;
    decayLoading = true;
    decayErr = null;
    try {
      const r = await fetch(`/properties/striking/decay?days=${data.days}`);
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      decay = await r.json();
      // Auto-populate index status + GSC links for the shown rows (cached 12h, so cheap on re-open).
      checkIndex();
    } catch (e) {
      decayErr = (e as Error).message;
    } finally {
      decayLoading = false;
    }
  }
  function openTab(t: Tab) {
    tab = t;
    // Shallow URL update so the tab is shareable/refreshable without re-running the SSR fetch.
    replaceState(`?days=${data.days}&tab=${t}`, {});
  }

  // ── Index status for decay rows (GSC URL Inspection, on-demand + cached) ──
  type IdxStatus = { verdict: string; coverage?: string; lastCrawl?: string; link?: string; error?: string };
  let idx = $state<Map<string, IdxStatus>>(new Map());
  let idxRunning = $state(false);
  let idxDone = $state(0);
  let idxTotal = $state(0);

  function idxBadge(v: string): { cls: string; label: string } {
    if (v === 'PASS') return { cls: 'bg-green-50 text-green-700', label: 'Indexed' };
    if (v === 'PARTIAL') return { cls: 'bg-yellow-50 text-yellow-700', label: 'Partial' };
    if (v === 'FAIL') return { cls: 'bg-red-50 text-red-700', label: 'Not indexed' };
    if (v === 'ERR') return { cls: 'bg-gray-100 text-gray-500', label: 'error' };
    return { cls: 'bg-gray-100 text-gray-500', label: '—' };
  }

  async function checkIndex() {
    if (idxRunning || !decay) return;
    idxRunning = true;
    idxDone = 0;

    // Group rows by account|site, then chunk into <=25 URLs per request (API limit).
    const groups = new Map<string, { account: string; site: string; urls: string[] }>();
    for (const r of decay.rows as { accountId: string; siteUrl: string; page: string }[]) {
      const k = `${r.accountId}|${r.siteUrl}`;
      let g = groups.get(k);
      if (!g) { g = { account: r.accountId, site: r.siteUrl, urls: [] }; groups.set(k, g); }
      g.urls.push(r.page);
    }
    const tasks: { account: string; site: string; urls: string[] }[] = [];
    for (const g of groups.values())
      for (let i = 0; i < g.urls.length; i += 25) tasks.push({ ...g, urls: g.urls.slice(i, i + 25) });
    idxTotal = decay.rows.length;

    const next = new Map(idx);
    let ti = 0;
    async function worker() {
      while (ti < tasks.length) {
        const t = tasks[ti++];
        try {
          const r = await fetch('/properties/inspect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(t)
          });
          if (r.ok) {
            const j = await r.json();
            for (const res of j.results) {
              next.set(res.inspectionUrl, {
                verdict: res.status === 'error' ? 'ERR' : res.index?.verdict ?? 'VERDICT_UNSPECIFIED',
                coverage: res.index?.coverageState,
                lastCrawl: res.index?.lastCrawlTime,
                link: res.link,
                error: res.error
              });
            }
          } else {
            for (const u of t.urls) next.set(u, { verdict: 'ERR', error: `HTTP ${r.status}` });
          }
        } catch (e) {
          for (const u of t.urls) next.set(u, { verdict: 'ERR', error: (e as Error).message });
        }
        idxDone += t.urls.length;
        idx = new Map(next);
      }
    }
    // Bounded concurrency — kind to the URL Inspection quota (2000/day/site).
    await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, worker));
    idxRunning = false;
  }
  // Load Decay on first visit (covers both a click and a direct ?tab=decay link).
  $effect(() => {
    if (tab === 'decay') loadDecay();
  });
</script>

<svelte:head><title>Portfolio analytics — all sites — gsc-hub</title></svelte:head>

<main class="w-full p-3 sm:p-6">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs">
        <a href="/">Accounts</a>
        <span aria-hidden="true">/</span>
        <a href="/properties">Sites</a>
        <span aria-hidden="true">/</span>
        <span class="text-gray-800">Portfolio</span>
      </nav>
      <h1 class="app-pagetitle">Portfolio analytics — all sites</h1>
      <p class="text-xs text-gray-500">Every non-hidden site, aggregated. Decay compares the recent period vs the one before it.</p>
    </div>
    <div class="app-toolbar-right">
      <a href="/properties" class="app-pill app-pill-secondary">← Sites</a>
      <div class="app-segmented">
        <span class="app-segmented-label">Period</span>
        {#each [7, 28, 60, 90] as d}
          <a class:is-active={data.days === d} href="?days={d}&tab={tab}">{d}d</a>
        {/each}
        <input
          type="number" min="1" max="480" placeholder="days"
          value={[7, 28, 60, 90].includes(data.days) ? '' : data.days}
          class="ml-0.5 w-16 rounded border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-700"
          onkeydown={(e) => { if (e.key === 'Enter') goToDays(e.currentTarget.value); }}
          onchange={(e) => goToDays(e.currentTarget.value)}
        />
      </div>
    </div>
  </header>

  <!-- tab bar -->
  <div class="mb-4 flex flex-wrap gap-1 border-b border-gray-200 text-sm">
    {#each TABS as t (t.id)}
      <button
        class="border-b-2 px-3 py-1.5 {tab === t.id
          ? 'border-blue-600 font-medium text-blue-700'
          : 'border-transparent text-gray-600 hover:text-gray-900'}"
        onclick={() => openTab(t.id)}
      >{t.label}</button>
    {/each}
  </div>

  {#if tab !== 'decay' && pf && pf.errors.length > 0}
    <div class="app-errors mb-3">
      <div class="app-errors-title">Errors</div>
      <ul class="ml-4 list-disc text-sm">
        {#each pf.errors as e}<li><span class="font-medium">{e.accountEmail}</span>: {e.reason}</li>{/each}
      </ul>
    </div>
  {/if}

  {#if tab === 'decay'}
    {#if decayLoading}<p class="text-sm text-gray-500">Loading… (fetches 2 windows per site — a bit slower)</p>{/if}
    {#if decayErr}<p class="text-sm text-red-600">{decayErr}</p>{/if}
    {#if decay}
      <div class="mb-3 flex flex-wrap items-center gap-3 text-sm text-gray-600">
        <span>
          <span class="font-semibold tabular-nums text-gray-900">{fmt(decay.total)}</span> decaying pages
          {#if decay.total > decay.rows.length}<span class="text-gray-400"> · top {decay.rows.length}</span>{/if}
        </span>
        {#if decay.rows.length > 0}
          <button onclick={checkIndex} disabled={idxRunning} class="rounded bg-blue-600 px-2.5 py-1 text-xs text-white disabled:opacity-50">
            {idxRunning ? `Checking… ${idxDone}/${idxTotal}` : 'Check index status'}
          </button>
          <span class="text-xs text-gray-400">GSC URL Inspection · cached 12h · quota 2000/day/site</span>
        {/if}
      </div>
      {#if decay.rows.length === 0}
        <p class="text-sm text-gray-500">No decaying pages found — no page lost ≥20% vs the previous period (from ≥20 prior clicks, or ≥50 prior impressions).</p>
      {:else}
        <div class="-mx-3 overflow-x-auto sm:-mx-6">
          <table class="app-table">
            <thead>
              <tr>
                <th class="pl-3 sm:pl-6">Site</th><th>Page</th>
                <th>Clk prior→recent</th><th>Δclk</th>
                <th>Impr prior→recent</th><th>Δimpr</th>
                <th class="pr-3 sm:pr-6">Index</th>
              </tr>
            </thead>
            <tbody>
              {#each decay.rows as d (d.siteUrl + '|' + d.page)}
                {@const st = idx.get(d.page)}
                <tr class="hover:bg-gray-50">
                  <td class="pl-3 sm:pl-6"><a class="pii text-blue-600 hover:underline" href={detailHref(d)}>{displaySite(d.siteUrl)}</a></td>
                  <td class="max-w-xs truncate text-gray-500"><span class="pii" title={d.page}>{shortUrl(d.page)}</span></td>
                  <td class="app-num pii">{fmt(d.priorClicks)} → {fmt(d.recentClicks)}</td>
                  <td class="app-num {d.deltaClicksPct < 0 ? 'text-red-600' : 'text-gray-400'}">{pct(d.deltaClicksPct)}</td>
                  <td class="app-num pii">{fmt(d.priorImpressions)} → {fmt(d.recentImpressions)}</td>
                  <td class="app-num {d.deltaImprPct < 0 ? 'text-red-600' : 'text-gray-400'}">{pct(d.deltaImprPct)}</td>
                  <td class="whitespace-nowrap pr-3 sm:pr-6">
                    {#if st}
                      {@const b = idxBadge(st.verdict)}
                      <span class="rounded px-1.5 py-0.5 text-xs {b.cls}" title={st.error ?? st.coverage ?? ''}>{st.coverage ?? b.label}</span>
                      {#if st.lastCrawl}<span class="ml-1 text-[11px] text-gray-400">{st.lastCrawl.slice(0, 10)}</span>{/if}
                      {#if st.link}<a class="ml-1 text-[11px] text-gray-400 hover:text-blue-600" href={st.link + (d.accountEmail ? `&authuser=${encodeURIComponent(d.accountEmail)}` : '')} target="_blank" rel="noopener noreferrer" title="Open in GSC ({d.accountEmail}) → Request indexing">↳ GSC</a>{/if}
                    {:else}
                      <span class="text-gray-300">—</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}

  {:else if pfErr}
    <p class="text-sm text-red-600">Failed to load portfolio: {pfErr}</p>
  {:else if !pf}
    <p class="text-sm text-gray-500">Loading portfolio…</p>

  {:else if tab === 'striking'}
    <div class="mb-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
      <span>
        <span class="font-semibold tabular-nums text-gray-900">{fmt(pf.strikingTotal)}</span> striking keywords (pos 4–20)
        {#if pf.strikingTotal > pf.striking.length}<span class="text-gray-400"> · top {pf.striking.length}</span>{/if}
        {#if selectedCountries.size > 0}<span class="text-gray-400"> · {fmt(filteredStriking.length)} shown</span>{/if}
      </span>
      <button onclick={copyQueries} class="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-200" title="Copy unique queries (respects the Geo filter)">
        {copied ? '✓ copied' : 'Copy queries'}
      </button>
    </div>
    {#if availableCountries.length > 1}
      <div class="mb-3 flex flex-wrap items-center gap-1">
        <span class="mr-1 text-xs text-gray-400">Geo:</span>
        {#each availableCountries as c (c)}
          <button
            onclick={() => toggleCountry(c)}
            class="rounded px-1.5 py-0.5 text-xs uppercase {selectedCountries.has(c) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
          >{c}</button>
        {/each}
        {#if selectedCountries.size > 0}<button onclick={() => (selectedCountries = new Set())} class="ml-1 text-xs text-blue-600 hover:underline">clear</button>{/if}
      </div>
    {/if}
    {#if filteredStriking.length === 0}
      <p class="text-sm text-gray-500">{selectedCountries.size > 0 ? 'No rows for the selected geo.' : 'Nothing at position 4–20 with enough impressions.'}</p>
    {:else}
      <div class="-mx-3 overflow-x-auto sm:-mx-6">
        <table class="app-table">
          <thead>
            <tr>
              <th class="pl-3 sm:pl-6"><button class="hover:underline" onclick={() => toggleSort('site')}>Site{ind('site')}</button></th>
              <th><button class="hover:underline" onclick={() => toggleSort('page')}>Page{ind('page')}</button></th>
              <th><button class="hover:underline" onclick={() => toggleSort('query')}>Query{ind('query')}</button></th>
              <th><button class="hover:underline" onclick={() => toggleSort('country')}>Geo{ind('country')}</button></th>
              <th><button class="hover:underline" onclick={() => toggleSort('position')}>Pos{ind('position')}</button></th>
              <th><button class="hover:underline" onclick={() => toggleSort('impressions')}>Impr{ind('impressions')}</button></th>
              <th><button class="hover:underline" onclick={() => toggleSort('clicks')}>Clicks{ind('clicks')}</button></th>
              <th class="pr-3 sm:pr-6"><button class="hover:underline" onclick={() => toggleSort('ctr')}>CTR{ind('ctr')}</button></th>
            </tr>
          </thead>
          <tbody>
            {#each filteredStriking as r (r.siteUrl + '|' + r.query + '|' + r.page + '|' + r.country)}
              <tr class="hover:bg-gray-50">
                <td class="pl-3 sm:pl-6">
                  <a class="pii text-blue-600 hover:underline" href={detailHref(r)}>{displaySite(r.siteUrl)}</a>
                  <a class="ml-1 text-gray-300 hover:text-gray-600" href={siteHref(r.siteUrl)} target="_blank" rel="noopener noreferrer" aria-label="Open site">↗</a>
                </td>
                <td class="max-w-xs truncate text-gray-500"><span class="pii" title={r.page}>{shortUrl(r.page)}</span></td>
                <td><span class="pii">{r.query}</span></td>
                <td class="uppercase text-gray-500">{r.country || '—'}</td>
                <td class="app-num">{posf(r.position)}</td>
                <td class="app-num pii">{fmt(r.impressions)}</td>
                <td class="app-num pii">{fmt(r.clicks)}</td>
                <td class="app-num pr-3 sm:pr-6">{pct(r.ctr)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

  {:else if tab === 'cannibal'}
    <div class="mb-3 text-sm text-gray-600">
      <span class="font-semibold tabular-nums text-gray-900">{fmt(pf.cannibalTotal)}</span> cannibalized queries
      {#if pf.cannibalTotal > pf.cannibal.length}<span class="text-gray-400"> · top {pf.cannibal.length}</span>{/if}
    </div>
    {#if pf.cannibal.length === 0}
      <p class="text-sm text-gray-500">No cannibalization detected.</p>
    {:else}
      <div class="space-y-3">
        {#each pf.cannibal as g (g.siteUrl + '|' + g.query)}
          <div class="rounded border border-gray-200 p-2">
            <div class="mb-1 flex items-baseline gap-2 text-sm">
              <a class="pii text-blue-600 hover:underline" href={detailHref(g)}>{displaySite(g.siteUrl)}</a>
              <span class="font-medium"><span class="pii">{g.query}</span></span>
              <span class="text-xs text-gray-400">· {g.pages.length} pages</span>
            </div>
            <table class="w-full text-sm">
              <tbody>
                {#each g.pages as p, i (p.page)}
                  <tr class="border-t border-gray-100">
                    <td class="py-1">{i === 0 ? '🏆' : '·'} <span class="pii">{shortUrl(p.page)}</span></td>
                    <td class="pii text-right">{fmt(p.clicks)} clk</td>
                    <td class="pii text-right text-gray-500">{fmt(p.impressions)} impr</td>
                    <td class="text-right text-gray-500">pos {posf(p.position)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/each}
      </div>
    {/if}

  {:else if tab === 'ctr'}
    <div class="mb-4">
      <div class="mb-1 text-xs font-medium text-gray-700">Portfolio CTR by position vs benchmark</div>
      <table class="w-full max-w-md text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr><th class="py-1">Pos</th><th class="text-right">Your CTR</th><th class="text-right">Benchmark</th><th class="text-right">Impr</th></tr>
        </thead>
        <tbody>
          {#each pf.ctr.buckets as b (b.position)}
            <tr class="border-t border-gray-100">
              <td class="py-1">{b.position}</td>
              <td class="text-right {b.yourCtr < b.benchmark ? 'text-red-600' : 'text-green-700'}">{pct(b.yourCtr)}</td>
              <td class="text-right text-gray-500">{pct(b.benchmark)}</td>
              <td class="pii text-right text-gray-500">{fmt(b.impressions)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="mb-1 text-xs font-medium text-gray-700">
      Opportunities (below-benchmark CTR) — {fmt(pf.ctr.opportunitiesTotal)}
      {#if pf.ctr.opportunitiesTotal > pf.ctr.opportunities.length}<span class="text-gray-400"> · top {pf.ctr.opportunities.length}</span>{/if}
    </div>
    {#if pf.ctr.opportunities.length === 0}
      <p class="text-sm text-gray-500">None.</p>
    {:else}
      <div class="-mx-3 overflow-x-auto sm:-mx-6">
        <table class="app-table">
          <thead>
            <tr>
              <th class="pl-3 sm:pl-6">Site</th><th>Page</th><th>Query</th>
              <th>Pos</th><th>Impr</th><th>CTR</th><th class="pr-3 sm:pr-6">Bench</th>
            </tr>
          </thead>
          <tbody>
            {#each pf.ctr.opportunities as o (o.siteUrl + '|' + o.query + '|' + o.page)}
              <tr class="hover:bg-gray-50">
                <td class="pl-3 sm:pl-6"><a class="pii text-blue-600 hover:underline" href={detailHref(o)}>{displaySite(o.siteUrl)}</a></td>
                <td class="max-w-xs truncate text-gray-500"><span class="pii" title={o.page}>{shortUrl(o.page)}</span></td>
                <td><span class="pii">{o.query}</span></td>
                <td class="app-num">{posf(o.position)}</td>
                <td class="app-num pii">{fmt(o.impressions)}</td>
                <td class="app-num text-red-600">{pct(o.ctr)}</td>
                <td class="app-num pr-3 text-gray-500 sm:pr-6">{pct(o.benchmark)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

  {:else if tab === 'branded'}
    {@const t = pf.branded.total}
    <div class="mb-4 grid gap-3 sm:grid-cols-3">
      <div class="rounded border border-gray-200 p-3">
        <div class="text-xs text-gray-500">Branded</div>
        <div class="pii text-xl font-semibold">{fmt(t.branded.clicks)} <span class="text-sm font-normal text-gray-400">clicks</span></div>
      </div>
      <div class="rounded border border-gray-200 p-3">
        <div class="text-xs text-gray-500">Non-branded</div>
        <div class="pii text-xl font-semibold">{fmt(t.nonBranded.clicks)} <span class="text-sm font-normal text-gray-400">clicks</span></div>
      </div>
      <div class="rounded border border-gray-200 p-3">
        <div class="text-xs text-gray-500">Branded share</div>
        <div class="pii text-xl font-semibold">{pct(t.brandedPct)}</div>
      </div>
    </div>
    <div class="mb-1 text-xs font-medium text-gray-700">Per site</div>
    <div class="-mx-3 overflow-x-auto sm:-mx-6">
      <table class="app-table">
        <thead>
          <tr><th class="pl-3 sm:pl-6">Site</th><th>Branded clk</th><th>Non-branded clk</th><th class="pr-3 sm:pr-6">Branded %</th></tr>
        </thead>
        <tbody>
          {#each pf.branded.perSite as s (s.siteUrl)}
            <tr class="hover:bg-gray-50">
              <td class="pl-3 sm:pl-6"><a class="pii text-blue-600 hover:underline" href={detailHref(s)}>{displaySite(s.siteUrl)}</a></td>
              <td class="app-num pii">{fmt(s.branded.clicks)}</td>
              <td class="app-num pii">{fmt(s.nonBranded.clicks)}</td>
              <td class="app-num pii">{pct(s.brandedPct)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</main>
