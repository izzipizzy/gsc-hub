<script lang="ts">
  import SortCaret from '$lib/components/SortCaret.svelte';
  import { goto, replaceState } from '$app/navigation';
  import { displaySite, siteHref } from '$lib/utils/site';
  import type { PageData } from './$types';
  import BuyLinks from '$lib/components/BuyLinks.svelte';

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
  // Signed change for chips: always a sign, and a real minus.
  const signedPct = (x: number) => (x > 0 ? `+${pct(x)}` : x < 0 ? `−${pct(-x)}` : pct(x));
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
  const ind = (k: SortKey): 'asc' | 'desc' | '' => (sortKey === k ? sortDir : '');
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

  // ── MagicLinks: выделение строк, покупка, история ──
  // Ключ пары — URL страницы и запрос: одна и та же пара приходит из разных гео,
  // но покупается один раз.
  type BuyableRow = { siteUrl: string; page: string; query: string };
  const pairKey = (r: BuyableRow) => `${r.page}\n${r.query}`;
  const hostOf = (u: string) => {
    try {
      return new URL(u).host.replace(/^www\./, '');
    } catch {
      return '';
    }
  };

  let selected = $state<Set<string>>(new Set());
  let buyRows = $state<{ targetUrl: string; query: string; siteHost: string }[] | null>(null);
  let historyOpen = $state<string | null>(null);

  type PurchaseSummary = {
    targetUrl: string;
    query: string;
    quantity: number;
    lastAt: number;
    orders: { orderId: string; quantity: number; createdAt: number }[];
  };
  let purchases = $state<Record<string, PurchaseSummary>>({});
  // Своя копия истории: после покупки обновляем её на месте, а при смене
  // данных страницы (другой период, другой сайт, перезагрузка) берём серверную
  // заново — иначе на соседней странице осталась бы чужая история.
  $effect(() => {
    purchases = { ...(data.purchases ?? {}) };
  });

  const boughtFor = (r: BuyableRow) => purchases[pairKey(r)];
  const dayfmt = (ms: number) =>
    new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

  function toggleRow(r: BuyableRow) {
    const k = pairKey(r);
    const next = new Set(selected);
    next.has(k) ? next.delete(k) : next.add(k);
    selected = next;
  }

  // Выделяем то, что видно после фильтра по гео, схлопывая дубли пар.
  const selectablePairs = $derived([...new Set(filteredStriking.map(pairKey))]);
  const allSelected = $derived(
    selectablePairs.length > 0 && selectablePairs.every((k) => selected.has(k))
  );
  function toggleAll() {
    selected = allSelected ? new Set() : new Set(selectablePairs);
  }

  function toBuyRow(r: BuyableRow) {
    return { targetUrl: r.page, query: r.query, siteHost: hostOf(r.page) || hostOf(r.siteUrl) };
  }
  function buyOne(r: BuyableRow) {
    buyRows = [toBuyRow(r)];
  }
  function buySelected() {
    const seen = new Set<string>();
    const out: { targetUrl: string; query: string; siteHost: string }[] = [];
    for (const r of filteredStriking) {
      const k = pairKey(r);
      if (!selected.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push(toBuyRow(r));
    }
    buyRows = out;
  }

  function applyBought(e: { orderId: string; items: { targetUrl: string; query: string; quantity: number }[] }) {
    const now = Date.now();
    const next = { ...purchases };
    for (const it of e.items) {
      const k = `${it.targetUrl}\n${it.query}`;
      const cur = next[k];
      next[k] = {
        targetUrl: it.targetUrl,
        query: it.query,
        quantity: (cur?.quantity ?? 0) + it.quantity,
        lastAt: now,
        orders: [...(cur?.orders ?? []), { orderId: e.orderId, quantity: it.quantity, createdAt: now }]
      };
    }
    purchases = next;
    selected = new Set();
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
    if (v === 'PASS') return { cls: 'badge-ok', label: 'Indexed' };
    if (v === 'PARTIAL') return { cls: 'badge-warn', label: 'Partial' };
    if (v === 'FAIL') return { cls: 'badge-bad', label: 'Not indexed' };
    if (v === 'ERR') return { cls: 'badge-muted', label: 'error' };
    return { cls: 'badge-muted', label: '—' };
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


{#snippet sortTh(k: SortKey, label: string, num = false)}
  <th class="sort-th {num ? 'num' : ''}"><button class="hover:text-ink" onclick={() => toggleSort(k)}>{label}<SortCaret dir={ind(k)} /></button></th>
{/snippet}

{#snippet siteLink(r: { siteUrl: string; accountId: string })}
  <a class="pii font-medium text-acc hover:underline" href={detailHref(r)}>{displaySite(r.siteUrl)}</a>
{/snippet}

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs">
        <a href="/">Accounts</a>
        <span aria-hidden="true">/</span>
        <a href="/properties">Sites</a>
        <span aria-hidden="true">/</span>
        <span class="text-ink-2">Portfolio</span>
      </nav>
      <h1 class="app-pagetitle">Portfolio analytics — all sites</h1>
      <p class="text-xs text-ink-3">Every non-hidden site, aggregated. Decay compares the recent period vs the one before it.</p>
    </div>
    <div class="app-toolbar-right">
      <a href="/properties" class="btn btn-ghost"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 8H3M7 4 3 8l4 4"/></svg>Sites</a>
      <span class="app-toolbar-divider" aria-hidden="true"></span>
      <div class="app-segmented">
        <span class="app-segmented-label">Period</span>
        {#each [7, 28, 60, 90] as d}
          <a class:is-active={data.days === d} href="?days={d}&tab={tab}">{d}D</a>
        {/each}
        <input
          type="number" min="1" max="480" placeholder="days"
          value={[7, 28, 60, 90].includes(data.days) ? '' : data.days}
          class="input app-num ml-0.5 h-6 w-16 px-1.5 text-xs"
          onkeydown={(e) => { if (e.key === 'Enter') goToDays(e.currentTarget.value); }}
          onchange={(e) => goToDays(e.currentTarget.value)}
        />
      </div>
    </div>
  </header>

  {#if tab !== 'decay' && pf && pf.errors.length > 0}
    <div class="app-errors">
      <div class="app-errors-title">Errors</div>
      <ul class="ml-4 list-disc">
        {#each pf.errors as e}<li><span class="font-medium">{e.accountEmail}</span>: {e.reason}</li>{/each}
      </ul>
    </div>
  {/if}

  <section class="pane min-w-0">
    <div class="tabs px-2" role="tablist">
      {#each TABS as t (t.id)}
        <button role="tab" aria-selected={tab === t.id} class:is-active={tab === t.id} onclick={() => openTab(t.id)}>{t.label}</button>
      {/each}
    </div>

    <div class="min-w-0">
      {#if tab === 'decay'}
        {#if decayLoading}<p class="loading p-3">Loading… (fetches 2 windows per site — a bit slower)</p>{/if}
        {#if decayErr}<p class="text-err p-3">{decayErr}</p>{/if}
        {#if decay}
          <div class="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2 text-[12.5px] text-ink-2">
            <span>
              <span class="app-num font-semibold text-ink">{fmt(decay.total)}</span> decaying pages
              {#if decay.total > decay.rows.length}<span class="text-ink-3"> · top {decay.rows.length}</span>{/if}
            </span>
            {#if decay.rows.length > 0}
              <button onclick={checkIndex} disabled={idxRunning} class="btn btn-pri btn-sm">
                {idxRunning ? `Checking… ${idxDone}/${idxTotal}` : 'Check index status'}
              </button>
              <span class="text-xs text-ink-3">GSC URL Inspection · cached 12h · quota 2000/day/site</span>
            {/if}
          </div>
          {#if decay.rows.length === 0}
            <p class="loading p-3">No decaying pages found — no page lost ≥20% vs the previous period (from ≥20 prior clicks, or ≥50 prior impressions).</p>
          {:else}
            <div class="overflow-x-auto">
              <table class="app-table">
                <thead>
                  <tr>
                    <th>Site</th><th>Page</th>
                    <th class="num">Clk prior→recent</th><th class="num">Δclk</th>
                    <th class="num">Impr prior→recent</th><th class="num">Δimpr</th>
                    <th>Index</th>
                  </tr>
                </thead>
                <tbody>
                  {#each decay.rows as d (d.siteUrl + '|' + d.page)}
                    {@const st = idx.get(d.page)}
                    <tr>
                      <td>{@render siteLink(d)}</td>
                      <td class="max-w-xs truncate text-ink-3"><span class="pii" title={d.page}>{shortUrl(d.page)}</span></td>
                      <td class="num app-num pii">{fmt(d.priorClicks)} → {fmt(d.recentClicks)}</td>
                      <td class="num"><span class="chip {d.deltaClicksPct < 0 ? 'chip-dn' : 'chip-flat'}">{signedPct(d.deltaClicksPct)}</span></td>
                      <td class="num app-num pii">{fmt(d.priorImpressions)} → {fmt(d.recentImpressions)}</td>
                      <td class="num"><span class="chip {d.deltaImprPct < 0 ? 'chip-dn' : 'chip-flat'}">{signedPct(d.deltaImprPct)}</span></td>
                      <td class="whitespace-nowrap">
                        {#if st}
                          {@const b = idxBadge(st.verdict)}
                          <span class="badge {b.cls}" title={st.error ?? st.coverage ?? ''}>{st.coverage ?? b.label}</span>
                          {#if st.lastCrawl}<span class="app-num ml-1 text-[11px] text-ink-3">{st.lastCrawl.slice(0, 10)}</span>{/if}
                          {#if st.link}<a class="ml-1 text-[11px] text-ink-3 hover:text-acc hover:underline" href={st.link + (d.accountEmail ? `&authuser=${encodeURIComponent(d.accountEmail)}` : '')} target="_blank" rel="noopener noreferrer" title="Open in GSC ({d.accountEmail}) → Request indexing">GSC</a>{/if}
                        {:else}
                          <span class="text-ink-4">—</span>
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
        <p class="text-err p-3">Failed to load portfolio: {pfErr}</p>
      {:else if !pf}
        <p class="loading p-3">Loading portfolio…</p>

      {:else if tab === 'striking'}
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2 text-[12.5px] text-ink-2">
          <span>
            <span class="app-num font-semibold text-ink">{fmt(pf.strikingTotal)}</span> striking keywords (pos 4–20)
            {#if pf.strikingTotal > pf.striking.length}<span class="text-ink-3"> · top {pf.striking.length}</span>{/if}
            {#if selectedCountries.size > 0}<span class="text-ink-3"> · {fmt(filteredStriking.length)} shown</span>{/if}
          </span>
          <button onclick={copyQueries} class="btn btn-ghost btn-sm" title="Copy unique queries (respects the Geo filter)">
            {copied ? 'copied' : 'Copy queries'}
          </button>
          {#if availableCountries.length > 1}
            <span class="app-toolbar-divider" aria-hidden="true"></span>
            <div class="flex flex-wrap items-center gap-1">
              <span class="app-segmented-label pl-0">Geo</span>
              {#each availableCountries as c (c)}
                <button
                  onclick={() => toggleCountry(c)}
                  aria-pressed={selectedCountries.has(c)}
                  class="btn btn-sm uppercase {selectedCountries.has(c) ? 'bg-acc-t text-acc' : 'btn-sec'}"
                >{c}</button>
              {/each}
              {#if selectedCountries.size > 0}<button onclick={() => (selectedCountries = new Set())} class="btn btn-ghost btn-sm">clear</button>{/if}
            </div>
          {/if}
        </div>
        {#if filteredStriking.length === 0}
          <p class="loading p-3">{selectedCountries.size > 0 ? 'No rows for the selected geo.' : 'Nothing at position 4–20 with enough impressions.'}</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="app-table">
              <thead>
                <tr>
                  <th class="w-8">
                    <input type="checkbox" checked={allSelected} onchange={toggleAll} aria-label="Выделить всё" />
                  </th>
                  {@render sortTh('site', 'Site')}
                  {@render sortTh('page', 'Page')}
                  {@render sortTh('query', 'Query')}
                  {@render sortTh('country', 'Geo')}
                  {@render sortTh('position', 'Pos', true)}
                  {@render sortTh('impressions', 'Impr', true)}
                  {@render sortTh('clicks', 'Clicks', true)}
                  {@render sortTh('ctr', 'CTR', true)}
                  <th class="num" title="Куплено ссылок MagicLinks на связку «страница + запрос»">Куплено</th>
                  <th class="num w-20"></th>
                </tr>
              </thead>
              <tbody>
                {#each filteredStriking as r (r.siteUrl + '|' + r.query + '|' + r.page + '|' + r.country)}
                  <tr class:is-selected={selected.has(pairKey(r))}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(pairKey(r))}
                        onchange={() => toggleRow(r)}
                        aria-label="Выделить строку"
                      />
                    </td>
                    <td class="whitespace-nowrap">
                      {@render siteLink(r)}
                      <a class="ml-1 inline-flex align-middle text-ink-4 hover:text-ink-2" href={siteHref(r.siteUrl)} target="_blank" rel="noopener noreferrer" aria-label="Open site">
                        <svg class="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7 9"/></svg>
                      </a>
                    </td>
                    <td class="max-w-xs truncate text-ink-3"><span class="pii" title={r.page}>{shortUrl(r.page)}</span></td>
                    <td class="font-medium"><span class="pii">{r.query}</span></td>
                    <td class="app-num uppercase text-ink-3">{r.country || '—'}</td>
                    <td class="num app-num">{posf(r.position)}</td>
                    <td class="num app-num pii">{fmt(r.impressions)}</td>
                    <td class="num app-num pii">{fmt(r.clicks)}</td>
                    <td class="num app-num">{pct(r.ctr)}</td>
                    <td class="num whitespace-nowrap">
                      {#if boughtFor(r)}
                        <button
                          class="chip chip-up hover:brightness-95"
                          title="Показать заказы по этой связке"
                          aria-expanded={historyOpen === pairKey(r)}
                          onclick={() => (historyOpen = historyOpen === pairKey(r) ? null : pairKey(r))}
                        >{boughtFor(r)!.quantity} шт · {dayfmt(boughtFor(r)!.lastAt)}</button>
                      {:else}
                        <span class="text-ink-4">—</span>
                      {/if}
                    </td>
                    <td class="num">
                      {#if data.magicLinksReady}
                        <button
                          class="btn btn-sec btn-sm"
                          title="Купить ссылки на эту связку"
                          onclick={() => buyOne(r)}
                        >Купить</button>
                      {/if}
                    </td>
                  </tr>
                  {#if historyOpen === pairKey(r) && boughtFor(r)}
                    <tr class="bg-sunk">
                      <td></td>
                      <td colspan="10" class="text-xs">
                        {#each boughtFor(r)!.orders as o (o.orderId)}
                          <a
                            class="mr-4 text-acc hover:underline"
                            href="/magiclinks/{o.orderId}?url={encodeURIComponent(r.page)}&q={encodeURIComponent(r.query)}"
                          >
                            <span class="app-num">{o.quantity}</span> шт · {dayfmt(o.createdAt)} · заказ <span class="app-num">{o.orderId.slice(0, 8)}</span>
                          </a>
                        {/each}
                      </td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

      {:else if tab === 'cannibal'}
        <div class="border-b border-line px-3 py-2 text-[12.5px] text-ink-2">
          <span class="app-num font-semibold text-ink">{fmt(pf.cannibalTotal)}</span> cannibalized queries
          {#if pf.cannibalTotal > pf.cannibal.length}<span class="text-ink-3"> · top {pf.cannibal.length}</span>{/if}
        </div>
        {#if pf.cannibal.length === 0}
          <p class="loading p-3">No cannibalization detected.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="app-table">
              <thead><tr><th>Query / competing pages</th><th class="num">Clicks</th><th class="num">Impr</th><th class="num">Pos</th></tr></thead>
              {#each pf.cannibal as g (g.siteUrl + '|' + g.query)}
                <tbody>
                  <tr class="bg-sunk hover:bg-sunk">
                    <td colspan="4">
                      {@render siteLink(g)}
                      <span class="ml-1.5 font-semibold"><span class="pii">{g.query}</span></span>
                      <span class="ml-1 text-xs text-ink-3">{g.pages.length} pages</span>
                    </td>
                  </tr>
                  {#each g.pages as p, i (p.page)}
                    <tr>
                      <td class="pl-6">
                        <span class="pii {i === 0 ? '' : 'text-ink-2'}">{shortUrl(p.page)}</span>
                        {#if i === 0}<span class="badge badge-acc ml-1.5">leader</span>{/if}
                      </td>
                      <td class="num app-num pii">{fmt(p.clicks)}</td>
                      <td class="num app-num pii text-ink-2">{fmt(p.impressions)}</td>
                      <td class="num app-num text-ink-2">{posf(p.position)}</td>
                    </tr>
                  {/each}
                </tbody>
              {/each}
            </table>
          </div>
        {/if}

      {:else if tab === 'ctr'}
        <div class="grid gap-px bg-line lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <div class="bg-pane">
            <div class="pane-head">Portfolio CTR by position vs benchmark</div>
            <table class="app-table">
              <thead><tr><th>Pos</th><th class="num">Your CTR</th><th class="num">Benchmark</th><th class="num">Impr</th></tr></thead>
              <tbody>
                {#each pf.ctr.buckets as b (b.position)}
                  <tr>
                    <td class="app-num">{b.position}</td>
                    <td class="num app-num {b.yourCtr < b.benchmark ? 'text-dn' : 'text-up'}">{pct(b.yourCtr)}</td>
                    <td class="num app-num text-ink-3">{pct(b.benchmark)}</td>
                    <td class="num app-num pii text-ink-3">{fmt(b.impressions)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="min-w-0 bg-pane">
            <div class="pane-head">
              <span>Opportunities <span class="normal-case tracking-normal font-medium">(below-benchmark CTR)</span></span>
              <span class="aside">
                <span class="app-num">{fmt(pf.ctr.opportunitiesTotal)}</span>
                {#if pf.ctr.opportunitiesTotal > pf.ctr.opportunities.length}<span> · top {pf.ctr.opportunities.length}</span>{/if}
              </span>
            </div>
            {#if pf.ctr.opportunities.length === 0}
              <p class="loading p-3">None.</p>
            {:else}
              <div class="overflow-x-auto">
                <table class="app-table">
                  <thead>
                    <tr>
                      <th>Site</th><th>Page</th><th>Query</th>
                      <th class="num">Pos</th><th class="num">Impr</th><th class="num">CTR</th><th class="num">Bench</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each pf.ctr.opportunities as o (o.siteUrl + '|' + o.query + '|' + o.page)}
                      <tr>
                        <td class="whitespace-nowrap">{@render siteLink(o)}</td>
                        <td class="max-w-xs truncate text-ink-3"><span class="pii" title={o.page}>{shortUrl(o.page)}</span></td>
                        <td><span class="pii">{o.query}</span></td>
                        <td class="num app-num">{posf(o.position)}</td>
                        <td class="num app-num pii">{fmt(o.impressions)}</td>
                        <td class="num app-num text-dn">{pct(o.ctr)}</td>
                        <td class="num app-num text-ink-3">{pct(o.benchmark)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </div>
        </div>

      {:else if tab === 'branded'}
        {@const t = pf.branded.total}
        <div class="grid gap-px border-b border-line bg-line sm:grid-cols-3">
          <div class="bg-pane p-3">
            <div class="stat-label">Branded</div>
            <div class="stat-value pii">{fmt(t.branded.clicks)} <span class="text-xs font-normal text-ink-3">clicks</span></div>
          </div>
          <div class="bg-pane p-3">
            <div class="stat-label">Non-branded</div>
            <div class="stat-value pii">{fmt(t.nonBranded.clicks)} <span class="text-xs font-normal text-ink-3">clicks</span></div>
          </div>
          <div class="bg-pane p-3">
            <div class="stat-label">Branded share</div>
            <div class="stat-value pii">{pct(t.brandedPct)}</div>
          </div>
        </div>
        <div class="pane-head">Per site</div>
        <div class="overflow-x-auto">
          <table class="app-table">
            <thead>
              <tr><th>Site</th><th class="num">Branded clk</th><th class="num">Non-branded clk</th><th class="num">Branded %</th></tr>
            </thead>
            <tbody>
              {#each pf.branded.perSite as s (s.siteUrl)}
                <tr>
                  <td>{@render siteLink(s)}</td>
                  <td class="num app-num pii">{fmt(s.branded.clicks)}</td>
                  <td class="num app-num pii">{fmt(s.nonBranded.clicks)}</td>
                  <td class="num app-num pii">{pct(s.brandedPct)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if tab === 'striking' && selected.size > 0}
        <div class="sticky bottom-3 z-20 m-3 flex flex-wrap items-center gap-3 rounded border border-acc/30 bg-pane px-3 py-2 shadow-[0_6px_20px_-6px_rgb(19_23_34/0.25)]">
          <span class="text-[12.5px]">Выбрано пар: <b class="app-num">{selected.size}</b></span>
          <span class="text-xs text-ink-3">одним заданием; провайдер выбирается в окне покупки</span>
          <span class="flex-1"></span>
          <button class="btn btn-ghost" onclick={() => (selected = new Set())}>Снять выделение</button>
          {#if data.magicLinksReady}
            <button class="btn btn-pri" onclick={buySelected}>Купить ссылки</button>
          {:else}
            <a class="btn btn-sec" href="/magiclinks">Сначала введи ключ провайдера на MagicLinks</a>
          {/if}
        </div>
      {/if}
    </div>
  </section>

  {#if buyRows}
    <BuyLinks rows={buyRows} onclose={() => (buyRows = null)} onbought={applyBought} />
  {/if}
</main>
