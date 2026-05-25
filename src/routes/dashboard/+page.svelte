<script lang="ts">
  import type { PageData } from './$types';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { displaySite, siteHref } from '$lib/utils/site';

  let { data }: { data: PageData } = $props();

  // Hidden sites (same localStorage key as /properties).
  let hidden = $state<Set<string>>(new Set());

  onMount(() => {
    try {
      const raw = localStorage.getItem('gsc-hub:hidden-sites');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) hidden = new Set(arr);
      }
    } catch (e) {
      console.warn('Failed to load hidden sites:', e);
    }
  });

  const visibleEntries = $derived(
    data.entries.filter((e) => !hidden.has(`${e.accountId}|${e.siteUrl}`))
  );

  const nf = new Intl.NumberFormat('en-US');
  function fmtNum(n: number) { return nf.format(Math.round(n)); }
  function fmtCtr(c: number) { return (c * 100).toFixed(1) + '%'; }
  function fmtPos(p: number) { return p.toFixed(1); }

  function delta(current: number, previous: number): { value: number | null; sign: '+' | '-' | '' } {
    if (previous === 0) return { value: null, sign: '' };
    const v = (current - previous) / previous;
    return { value: v, sign: v > 0 ? '+' : v < 0 ? '-' : '' };
  }

  function fmtDelta(d: { value: number | null; sign: '+' | '-' | '' }): string {
    if (d.value === null) return '—';
    return d.sign + (Math.abs(d.value * 100).toFixed(1)) + '%';
  }

  function deltaColor(d: { value: number | null; sign: '+' | '-' | '' }, inverted = false): string {
    if (d.value === null) return 'text-gray-400';
    const pos = inverted ? d.sign === '-' : d.sign === '+';
    if (pos) return 'text-green-600';
    if (d.sign === '') return 'text-gray-400';
    return 'text-red-600';
  }

  // Sparkline path generator.
  function sparkPath(rows: { clicks: number }[], width = 100, height = 30): string {
    if (rows.length === 0) return '';
    const max = Math.max(1, ...rows.map((r) => r.clicks));
    const step = rows.length > 1 ? width / (rows.length - 1) : 0;
    return rows
      .map((r, i) => {
        const x = i * step;
        const y = height - (r.clicks / max) * height;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  // Sparkline area fill path.
  function sparkAreaPath(rows: { clicks: number }[], width = 100, height = 30): string {
    if (rows.length === 0) return '';
    const max = Math.max(1, ...rows.map((r) => r.clicks));
    const step = rows.length > 1 ? width / (rows.length - 1) : 0;
    const top = rows
      .map((r, i) => {
        const x = i * step;
        const y = height - (r.clicks / max) * height;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return `${top} L${((rows.length - 1) * step).toFixed(1)},${height} L0,${height} Z`;
  }

  function colsClass(n: number): string {
    if (n === 2) return 'grid-cols-1 md:grid-cols-2';
    if (n === 4) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
    return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6';
  }
</script>

<svelte:head><title>Dashboard — gsc-hub</title></svelte:head>

<main class="w-full p-3 sm:p-6">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs">
        <a href="/">Accounts</a>
        <span aria-hidden="true">/</span>
        <span class="text-gray-800">Dashboard</span>
      </nav>
      <h1 class="app-pagetitle">Dashboard</h1>
    </div>
    <div class="app-toolbar-right">
      <a href="/properties?days={data.days}" class="app-pill app-pill-secondary">Sites</a>
      <span class="app-toolbar-divider" aria-hidden="true"></span>
      <div class="app-segmented">
        <span class="app-segmented-label">Period</span>
        {#each [1, 3, 7, 28, 60] as d}
          <a class:is-active={data.days === d} href="?days={d}&cols={data.cols}">{d}d</a>
        {/each}
      </div>
      <div class="app-segmented">
        <span class="app-segmented-label">Cols</span>
        {#each [2, 4, 6] as c}
          <a class:is-active={data.cols === c} href="?days={data.days}&cols={c}">{c}</a>
        {/each}
      </div>
      <button type="button" class="app-pill app-pill-secondary" onclick={() => invalidateAll()}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7a4.5 4.5 0 0 1 7.96-2.86M11.5 7a4.5 4.5 0 0 1-7.96 2.86M11 2.5v2.5h-2.5M3 11.5v-2.5h2.5"/></svg>
        Refresh
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

  {#if visibleEntries.length === 0}
    <div class="app-empty">
      <div class="app-empty-title">No visible sites</div>
      <p class="app-empty-sub">Connect a Google account on <a class="text-blue-600 hover:underline" href="/">Accounts</a>{hidden.size > 0 ? ' or unhide a site on Sites' : ''}.</p>
    </div>
  {:else}
    <div class="grid {colsClass(data.cols)} gap-4">
      {#each visibleEntries as e}
        {@const dClicks = delta(e.currentTotals.clicks, e.previousTotals.clicks)}
        {@const dImpressions = delta(e.currentTotals.impressions, e.previousTotals.impressions)}
        {@const dCtr = delta(e.currentTotals.ctr, e.previousTotals.ctr)}
        {@const dPos = delta(e.currentTotals.position, e.previousTotals.position)}
        <article class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-shadow duration-150 hover:shadow">
          <header class="mb-3">
            <div class="text-[11px] uppercase tracking-wide text-gray-400">{e.accountLabel ?? e.accountEmail}</div>
            <a class="block break-all text-sm font-medium text-gray-900 hover:text-blue-600" href={siteHref(e.siteUrl)} target="_blank" rel="noopener noreferrer">{displaySite(e.siteUrl)}</a>
          </header>

          {#if e.error}
            <div class="rounded bg-red-50 p-2 text-[11px] text-red-700">{e.error}</div>
          {:else}
            <svg viewBox="0 0 100 30" class="mb-3 h-12 w-full" preserveAspectRatio="none">
              <path d={sparkAreaPath(e.current)} fill="rgb(37 99 235)" fill-opacity="0.08" />
              <path d={sparkPath(e.current)} fill="none" stroke="rgb(37 99 235)" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round" />
            </svg>

            <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <div class="flex items-baseline justify-between">
                  <dt class="text-[11px] uppercase tracking-wide text-gray-500">Clicks</dt>
                  <dd class="text-[11px] {deltaColor(dClicks)} app-num">{fmtDelta(dClicks)}</dd>
                </div>
                <dd class="app-num text-base font-semibold text-gray-900">{fmtNum(e.currentTotals.clicks)}</dd>
              </div>
              <div>
                <div class="flex items-baseline justify-between">
                  <dt class="text-[11px] uppercase tracking-wide text-gray-500">Impressions</dt>
                  <dd class="text-[11px] {deltaColor(dImpressions)} app-num">{fmtDelta(dImpressions)}</dd>
                </div>
                <dd class="app-num text-base font-semibold text-gray-900">{fmtNum(e.currentTotals.impressions)}</dd>
              </div>
              <div>
                <div class="flex items-baseline justify-between">
                  <dt class="text-[11px] uppercase tracking-wide text-gray-500">CTR</dt>
                  <dd class="text-[11px] {deltaColor(dCtr)} app-num">{fmtDelta(dCtr)}</dd>
                </div>
                <dd class="app-num text-base font-semibold text-gray-900">{fmtCtr(e.currentTotals.ctr)}</dd>
              </div>
              <div>
                <div class="flex items-baseline justify-between">
                  <dt class="text-[11px] uppercase tracking-wide text-gray-500">Avg Pos</dt>
                  <dd class="text-[11px] {deltaColor(dPos, true)} app-num">{fmtDelta(dPos)}</dd>
                </div>
                <dd class="app-num text-base font-semibold text-gray-900">{fmtPos(e.currentTotals.position)}</dd>
              </div>
            </dl>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</main>
