<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const siteUrl = $derived(data.siteUrl);
  const accId = $derived(data.accId);
  const base = $derived(`/properties/${encodeURIComponent(data.siteUrl)}`);
  const accQ = $derived(`acc=${encodeURIComponent(data.accId)}`);

  type Tab = 'overview' | 'keywords' | 'cannibal' | 'ctr' | 'branded' | 'decay' | 'health';
  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'keywords', label: 'Striking Distance' },
    { id: 'cannibal', label: 'Cannibalization' },
    { id: 'ctr', label: 'CTR Benchmark' },
    { id: 'branded', label: 'Branded' },
    { id: 'decay', label: 'Decay' },
    { id: 'health', label: 'Health' }
  ];
  let tab = $state<Tab>('overview');

  // ── formatting helpers ──
  const nf = new Intl.NumberFormat('en-US');
  const fmt = (n: number) => nf.format(Math.round(n));
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const pos = (x: number) => x.toFixed(1);
  const shortUrl = (u: string) => u.replace(/^https?:\/\/[^/]+/, '') || '/';

  function sparkPath(series: number[], w = 260, h = 40): string {
    if (!series.length) return '';
    const max = Math.max(...series, 1);
    const step = series.length > 1 ? w / (series.length - 1) : w;
    return series
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
      .join(' ');
  }

  // ── shared analytics payload (one GSC fetch feeds 4 tabs) ──
  let analytics = $state<any>(null);
  let analyticsErr = $state<string | null>(null);
  let analyticsLoading = $state(false);
  async function loadAnalytics() {
    if (analytics || analyticsLoading) return;
    analyticsLoading = true;
    analyticsErr = null;
    try {
      const r = await fetch(`${base}/analytics?${accQ}`);
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      analytics = await r.json();
      brandInput = (analytics.brandedTerms ?? []).join(', ');
    } catch (e) {
      analyticsErr = (e as Error).message;
    } finally {
      analyticsLoading = false;
    }
  }
  // Eager: one call, populates Keywords/Cannibalization/CTR/Branded.
  $effect(() => {
    loadAnalytics();
  });

  // ── decay (lazy) ──
  let decay = $state<any>(null);
  let decayErr = $state<string | null>(null);
  let decayLoading = $state(false);
  async function loadDecay() {
    if (decay || decayLoading) return;
    decayLoading = true;
    decayErr = null;
    try {
      const r = await fetch(`${base}/decay?${accQ}`);
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      decay = await r.json();
    } catch (e) {
      decayErr = (e as Error).message;
    } finally {
      decayLoading = false;
    }
  }

  // ── health (lazy GET cache; POST re-check) ──
  let health = $state<any>(null);
  let healthErr = $state<string | null>(null);
  let healthLoading = $state(false);
  async function loadHealth() {
    if (health || healthLoading) return;
    healthLoading = true;
    try {
      const r = await fetch(`${base}/health`);
      health = await r.json();
    } catch (e) {
      healthErr = (e as Error).message;
    } finally {
      healthLoading = false;
    }
  }
  async function runHealth() {
    healthLoading = true;
    healthErr = null;
    try {
      const r = await fetch(`${base}/health`, { method: 'POST' });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      health = await r.json();
    } catch (e) {
      healthErr = (e as Error).message;
    } finally {
      healthLoading = false;
    }
  }

  function openTab(t: Tab) {
    tab = t;
    if (t === 'decay') loadDecay();
    if (t === 'health') loadHealth();
  }

  // ── branded terms editor ──
  let brandInput = $state((data.brandedTerms ?? []).join(', '));
  let brandSaving = $state(false);
  async function saveBrand() {
    brandSaving = true;
    try {
      const terms = brandInput.split(',').map((s) => s.trim()).filter(Boolean);
      const r = await fetch(`${base}/branded`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms })
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      brandInput = (j.brandedTerms ?? []).join(', ');
      // Force branded split to recompute with the new terms.
      analytics = null;
      await loadAnalytics();
    } finally {
      brandSaving = false;
    }
  }

  const ageText = (ts: number | null) => {
    if (!ts) return 'never';
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };
</script>

<svelte:head><title>{siteUrl} · gsc-hub</title></svelte:head>

<main class="mx-auto max-w-5xl px-4 py-4">
  <div class="mb-3 flex items-center gap-2 text-sm">
    <a href="/properties" class="text-blue-600 hover:underline">← Sites</a>
    <span class="text-gray-400">/</span>
    <span class="pii font-semibold text-gray-900">{siteUrl}</span>
    <span class="ml-auto pii text-gray-500">{data.account.label ?? data.account.email}</span>
  </div>

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

  {#if tab === 'overview'}
    {#if data.dailyError}
      <p class="text-sm text-red-600">Failed to load: {data.dailyError}</p>
    {:else if data.daily}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded border border-gray-200 p-3">
          <div class="text-xs text-gray-500">Clicks (28d)</div>
          <div class="pii text-xl font-semibold">{fmt(data.daily.clicks)}</div>
        </div>
        <div class="rounded border border-gray-200 p-3">
          <div class="text-xs text-gray-500">Impressions</div>
          <div class="pii text-xl font-semibold">{fmt(data.daily.impressions)}</div>
        </div>
        <div class="rounded border border-gray-200 p-3">
          <div class="text-xs text-gray-500">CTR</div>
          <div class="pii text-xl font-semibold">{pct(data.daily.ctr)}</div>
        </div>
        <div class="rounded border border-gray-200 p-3">
          <div class="text-xs text-gray-500">Avg position</div>
          <div class="pii text-xl font-semibold">{pos(data.daily.position)}</div>
        </div>
      </div>
      <div class="mt-4 rounded border border-gray-200 p-3">
        <div class="mb-1 text-xs text-gray-500">Daily clicks (28d)</div>
        <svg viewBox="0 0 260 40" class="h-12 w-full" preserveAspectRatio="none">
          <path d={sparkPath(data.daily.series.map((s) => s.clicks))} fill="none" stroke="#2563eb" stroke-width="1.5" />
        </svg>
      </div>
    {/if}

    <div class="mt-4 rounded border border-gray-200 p-3">
      <div class="mb-1 text-xs font-medium text-gray-700">Brand terms (for branded split)</div>
      <div class="flex gap-2">
        <input
          bind:value={brandInput}
          placeholder="comma-separated, e.g. ikea, ikea chair"
          class="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <button onclick={saveBrand} disabled={brandSaving} class="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50">
          {brandSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p class="mt-1 text-xs text-gray-400">Empty reverts to the domain default.</p>
    </div>

  {:else if tab === 'health'}
    <div class="mb-3 flex items-center gap-2">
      <button onclick={runHealth} disabled={healthLoading} class="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50">
        {healthLoading ? 'Checking…' : 'Check now'}
      </button>
      <span class="text-xs text-gray-500">checked {ageText(health?.checkedAt ?? null)}</span>
    </div>
    {#if healthErr}<p class="text-sm text-red-600">{healthErr}</p>{/if}
    {#if health?.data}
      {@const d = health.data}
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="rounded border border-gray-200 p-3">
          <div class="text-xs font-medium text-gray-700">SSL</div>
          {#if 'error' in d.ssl}
            <div class="text-sm text-red-600">{d.ssl.error}</div>
          {:else}
            <div class="text-sm">Grade <b>{d.ssl.grade}</b> · {d.ssl.daysLeft} days left · {d.ssl.issuer}</div>
          {/if}
        </div>
        <div class="rounded border border-gray-200 p-3">
          <div class="text-xs font-medium text-gray-700">Safe Browsing</div>
          {#if 'skipped' in d.safeBrowsing}
            <div class="text-sm text-gray-400">not configured (no key)</div>
          {:else if 'error' in d.safeBrowsing}
            <div class="text-sm text-red-600">{d.safeBrowsing.error}</div>
          {:else}
            <div class="text-sm {d.safeBrowsing.safe ? 'text-green-700' : 'text-red-600'}">
              {d.safeBrowsing.safe ? 'clean' : d.safeBrowsing.threats.join(', ')}
            </div>
          {/if}
        </div>
        <div class="rounded border border-gray-200 p-3 sm:col-span-2">
          <div class="text-xs font-medium text-gray-700">Core Web Vitals (mobile)</div>
          {#if 'skipped' in d.cwv}
            <div class="text-sm text-gray-400">not configured (no key)</div>
          {:else if 'error' in d.cwv}
            <div class="text-sm text-red-600">{d.cwv.error}</div>
          {:else}
            <div class="text-sm">
              Perf <b>{Math.round(d.cwv.score * 100)}</b> · LCP {(d.cwv.lcpMs / 1000).toFixed(1)}s · CLS {d.cwv.cls.toFixed(2)} · TBT {Math.round(d.cwv.tbtMs)}ms
            </div>
          {/if}
        </div>
      </div>
    {:else if !healthLoading}
      <p class="text-sm text-gray-500">No check yet — press “Check now”.</p>
    {/if}

  {:else if tab === 'decay'}
    {#if decayLoading}<p class="text-sm text-gray-500">Loading…</p>{/if}
    {#if decayErr}<p class="text-sm text-red-600">{decayErr}</p>{/if}
    {#if decay}
      {#if decay.decay.length === 0}
        <p class="text-sm text-gray-500">No decaying pages found — no page lost ≥20% vs the previous period (from ≥20 prior clicks, or ≥50 prior impressions).</p>
      {:else}
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-gray-500">
            <tr>
              <th class="py-1">Page</th>
              <th class="text-right">Clk prior→recent</th>
              <th class="text-right">Δclk</th>
              <th class="text-right">Impr prior→recent</th>
              <th class="text-right">Δimpr</th>
            </tr>
          </thead>
          <tbody>
            {#each decay.decay as d (d.page)}
              <tr class="border-t border-gray-100">
                <td class="py-1"><span class="pii" title={d.page}>{shortUrl(d.page)}</span></td>
                <td class="pii text-right">{fmt(d.priorClicks)} → {fmt(d.recentClicks)}</td>
                <td class="text-right {d.deltaClicksPct < 0 ? 'text-red-600' : 'text-gray-400'}">{pct(d.deltaClicksPct)}</td>
                <td class="pii text-right">{fmt(d.priorImpressions)} → {fmt(d.recentImpressions)}</td>
                <td class="text-right {d.deltaImprPct < 0 ? 'text-red-600' : 'text-gray-400'}">{pct(d.deltaImprPct)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {/if}

  {:else}
    <!-- analytics-backed tabs -->
    {#if analyticsLoading}<p class="text-sm text-gray-500">Loading…</p>{/if}
    {#if analyticsErr}<p class="text-sm text-red-600">{analyticsErr}</p>{/if}
    {#if analytics}
      {#if tab === 'keywords'}
        {#if analytics.striking.length === 0}
          <p class="text-sm text-gray-500">No striking-distance keywords.</p>
        {:else}
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-gray-500">
              <tr><th class="py-1">Query</th><th>Page</th><th class="text-right">Pos</th><th class="text-right">Impr</th><th class="text-right">Clicks</th><th class="text-right">CTR</th></tr>
            </thead>
            <tbody>
              {#each analytics.striking as r (r.query + r.page)}
                <tr class="border-t border-gray-100">
                  <td class="py-1"><span class="pii">{r.query}</span></td>
                  <td class="max-w-xs truncate text-gray-500"><span class="pii">{shortUrl(r.page)}</span></td>
                  <td class="text-right">{pos(r.position)}</td>
                  <td class="pii text-right">{fmt(r.impressions)}</td>
                  <td class="pii text-right">{fmt(r.clicks)}</td>
                  <td class="text-right">{pct(r.ctr)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {:else if tab === 'cannibal'}
        {#if analytics.cannibalization.length === 0}
          <p class="text-sm text-gray-500">No cannibalization detected.</p>
        {:else}
          <div class="space-y-3">
            {#each analytics.cannibalization as g (g.query)}
              <div class="rounded border border-gray-200 p-2">
                <div class="mb-1 text-sm font-medium"><span class="pii">{g.query}</span> <span class="text-xs text-gray-400">· {g.pages.length} pages</span></div>
                <table class="w-full text-sm">
                  <tbody>
                    {#each g.pages as p, i (p.page)}
                      <tr class="border-t border-gray-100">
                        <td class="py-1">{i === 0 ? '🏆' : '·'} <span class="pii">{shortUrl(p.page)}</span></td>
                        <td class="pii text-right">{fmt(p.clicks)} clk</td>
                        <td class="pii text-right text-gray-500">{fmt(p.impressions)} impr</td>
                        <td class="text-right text-gray-500">pos {pos(p.position)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/each}
          </div>
        {/if}
      {:else if tab === 'ctr'}
        <table class="mb-4 w-full max-w-md text-sm">
          <thead class="text-left text-xs text-gray-500">
            <tr><th class="py-1">Pos</th><th class="text-right">Your CTR</th><th class="text-right">Benchmark</th><th class="text-right">Impr</th></tr>
          </thead>
          <tbody>
            {#each analytics.ctr.buckets as b (b.position)}
              <tr class="border-t border-gray-100">
                <td class="py-1">{b.position}</td>
                <td class="text-right {b.yourCtr < b.benchmark ? 'text-red-600' : 'text-green-700'}">{pct(b.yourCtr)}</td>
                <td class="text-right text-gray-500">{pct(b.benchmark)}</td>
                <td class="pii text-right text-gray-500">{fmt(b.impressions)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <div class="text-xs font-medium text-gray-700">Opportunities (below-benchmark CTR)</div>
        {#if analytics.ctr.opportunities.length === 0}
          <p class="text-sm text-gray-500">None.</p>
        {:else}
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-gray-500">
              <tr><th class="py-1">Query</th><th>Page</th><th class="text-right">Pos</th><th class="text-right">Impr</th><th class="text-right">CTR</th><th class="text-right">Bench</th></tr>
            </thead>
            <tbody>
              {#each analytics.ctr.opportunities as o (o.query + o.page)}
                <tr class="border-t border-gray-100">
                  <td class="py-1"><span class="pii">{o.query}</span></td>
                  <td class="max-w-xs truncate text-gray-500"><span class="pii">{shortUrl(o.page)}</span></td>
                  <td class="text-right">{pos(o.position)}</td>
                  <td class="pii text-right">{fmt(o.impressions)}</td>
                  <td class="text-right text-red-600">{pct(o.ctr)}</td>
                  <td class="text-right text-gray-500">{pct(o.benchmark)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {:else if tab === 'branded'}
        {@const b = analytics.branded}
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="rounded border border-gray-200 p-3">
            <div class="text-xs text-gray-500">Branded</div>
            <div class="pii text-xl font-semibold">{fmt(b.branded.clicks)} <span class="text-sm font-normal text-gray-400">clicks</span></div>
            <div class="pii text-sm text-gray-500">{fmt(b.branded.impressions)} impr</div>
          </div>
          <div class="rounded border border-gray-200 p-3">
            <div class="text-xs text-gray-500">Non-branded</div>
            <div class="pii text-xl font-semibold">{fmt(b.nonBranded.clicks)} <span class="text-sm font-normal text-gray-400">clicks</span></div>
            <div class="pii text-sm text-gray-500">{fmt(b.nonBranded.impressions)} impr</div>
          </div>
        </div>
        <div class="mt-3 text-sm text-gray-600">Branded share of clicks: <b class="pii">{pct(b.brandedPct)}</b></div>
        <p class="mt-1 text-xs text-gray-400">Terms: {(analytics.brandedTerms ?? []).join(', ')} — edit on the Overview tab.</p>
      {/if}
    {/if}
  {/if}
</main>
