<script lang="ts">
  import PeriodPicker from '$lib/components/PeriodPicker.svelte';
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, fmtCompact, getLocale } from '$lib/i18n/index.svelte';
  import SiteSearch from '$lib/components/SiteSearch.svelte';
  import Pager from '$lib/components/Pager.svelte';
  import SnapshotStatus from '$lib/components/SnapshotStatus.svelte';
  import { FAVS_COOKIE, parseFavs, writeFavsCookie } from '$lib/utils/favs';
  import SortCaret from '$lib/components/SortCaret.svelte';
  import type { PageData } from './$types';
  import { onMount } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { siteHref, siteDomain, siteSearchHref } from '$lib/utils/site';
  import { SERIES, eventPosition } from '$lib/chart-theme';

  let { data }: { data: PageData } = $props();

  type Entry = PageData['entries'][number];
  type DailyRow = Entry['current'][number];

  const keyOf = (e: Entry) => `${e.accountId}|${e.siteUrl}`;

  // Hidden sites — server-side store, shared with /properties; the server puts
  // them last, after favorites and the rest, so each card knows its group.
  // Favorites — localStorage (single-user tool, no backend table needed),
  // mirrored into a cookie so the server can page them first.
  const FAVS_KEY = 'gsc-hub:favs';
  let favs = $state<Set<string>>(new Set());

  // Optional metric chips (CTR / position) — off by default, like the reference UI.
  const METRICS_KEY = 'gsc-hub:metrics';
  let showCtr = $state(false);
  let showPos = $state(false);

  // Today is deliberately outside the day ranges: it is still accumulating, so
  // it cannot be compared against whole days without lying about the delta.
  // Fetched after render because it costs one request per property.
  type Today = {
    date: string;
    totals: { clicks: number; impressions: number };
    partial: boolean;
    errors: { accountEmail: string; reason: string }[];
  };
  let today = $state<Today | null>(null);
  let todayFailed = $state(false);
  let todayErrorsOpen = $state(false);

  // Today is fetched on its own, outside page data, so Refresh calls it again.
  function loadToday() {
    todayFailed = false;
    return fetch('/dashboard/today')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((t: Today) => { today = t; })
      // Stale numbers must not pass for today's: a failed reload clears them
      // so the block says it is unavailable.
      .catch(() => { today = null; todayFailed = true; });
  }

  let refreshError = $state<string | null>(null);

  onMount(() => {
    try {
      const raw = localStorage.getItem(FAVS_KEY);
      if (raw) favs = new Set(JSON.parse(raw) as string[]);
      // Favorites saved before the cookie existed: hand them to the server once.
      const cookie = document.cookie.split('; ').find((c) => c.startsWith(`${FAVS_COOKIE}=`));
      const mirrored = parseFavs(cookie ? decodeURIComponent(cookie.slice(FAVS_COOKIE.length + 1)) : null);
      if (favs.size !== mirrored.size || [...favs].some((k) => !mirrored.has(k))) {
        writeFavsCookie(favs);
        invalidateAll();
      }
      const m = JSON.parse(localStorage.getItem(METRICS_KEY) ?? '{}') as { ctr?: boolean; pos?: boolean };
      showCtr = m.ctr === true;
      showPos = m.pos === true;
    } catch {
      // corrupted prefs are not worth a broken dashboard
    }
    loadToday();
  });

  function toggleFav(e: Entry) {
    const k = keyOf(e);
    const next = new Set(favs);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    favs = next;
    try { localStorage.setItem(FAVS_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
    writeFavsCookie(next);
    invalidateAll();
  }

  let hideError = $state<string | null>(null);
  async function toggleHide(e: Entry) {
    const isHidden = e.group === 'hidden';
    hideError = null;
    try {
      const r = await fetch('/properties/hidden-sites', {
        method: isHidden ? 'DELETE' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account: e.accountId, site: e.siteUrl })
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (err) {
      // The card stays where the server has it, so the UI never lies about persisted state.
      hideError = `Could not ${isHidden ? 'unhide' : 'hide'} ${siteDomain(e.siteUrl)}: ${(err as Error).message}`;
    }
    await invalidateAll();
  }

  function toggleMetric(m: 'ctr' | 'pos') {
    if (m === 'ctr') showCtr = !showCtr;
    else showPos = !showPos;
    try { localStorage.setItem(METRICS_KEY, JSON.stringify({ ctr: showCtr, pos: showPos })); } catch { /* ignore */ }
  }

  const searchQuery = $derived(data.q);
  const searchParam = $derived(searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : '');

  // This page's cards, by group; the counts are over the whole portfolio.
  const favEntries = $derived(data.entries.filter((e) => e.group === 'fav'));
  const restEntries = $derived(data.entries.filter((e) => e.group === 'rest'));
  const hiddenEntries = $derived(data.entries.filter((e) => e.group === 'hidden'));
  const visibleCount = $derived(data.counts.fav + data.counts.rest);

  // Custom day range, capped at GSC's 16-month window (480 days).

  // Toggle the active field; domains start A–Z and metrics start descending.
  function sortHref(field: 'clicks' | 'impressions' | 'site') {
    const dir = data.sort === field ? (data.dir === 'desc' ? 'asc' : 'desc') : (field === 'site' ? 'asc' : 'desc');
    return `?days=${data.days}&cols=${data.cols}&sort=${field}&dir=${dir}${searchParam}`;
  }

  // Numbers follow the interface language: 1 908 852 / 1,908,852.
  function num(n: number) { return fmtNum(Math.round(n)); }
  function fmtK(n: number) {
    const r = Math.round(n);
    return r >= 1000 ? fmtCompact(r) : String(r);
  }
  function fmtCtr(c: number) { return fmtPct(c); }
  function fmtPos(p: number) { return fmtDec(p, 1); }

  // Rounded percent change vs the previous period; null when there is no base.
  function pctDelta(cur: number, prev: number): number | null {
    if (!prev) return null;
    return Math.round(((cur - prev) / prev) * 100);
  }

  // ── Chart: dual-metric sparkline, each series normalized to its own range so
  // clicks stay visible next to impressions. Previous period is dashed. ──
  const CHART_W = 100;
  const CHART_H = 40;

  function seriesPath(rows: DailyRow[], key: 'clicks' | 'impressions'): string {
    if (rows.length === 0) return '';
    const vals = rows.map((r) => r[key]);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const yTop = CHART_H * 0.08;
    const yBottom = CHART_H * 0.92;
    const yOf = (v: number) =>
      hi === lo ? (yTop + yBottom) / 2 : yBottom - ((v - lo) / (hi - lo)) * (yBottom - yTop);
    const step = rows.length > 1 ? CHART_W / (rows.length - 1) : 0;
    return rows
      .map((r, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${yOf(r[key]).toFixed(2)}`)
      .join(' ');
  }

  function areaPath(rows: DailyRow[], key: 'clicks' | 'impressions'): string {
    const line = seriesPath(rows, key);
    if (!line) return '';
    const step = rows.length > 1 ? CHART_W / (rows.length - 1) : 0;
    return `${line} L${((rows.length - 1) * step).toFixed(2)},${CHART_H} L0,${CHART_H} Z`;
  }

  function eventX(rows: DailyRow[], date: string): number | null {
    const position = eventPosition(rows.map((r) => r.date), date);
    return position === null ? null : position * CHART_W;
  }

  // Market chip — derived from the ccTLD; generic TLDs read as "unknown market".
  const GENERIC_TLDS = new Set([
    'com', 'net', 'org', 'edu', 'gov', 'int', 'mil', 'io', 'co', 'ai', 'app',
    'dev', 'me', 'tv', 'info', 'xyz', 'online', 'site', 'store', 'tech', 'top',
    'club', 'pro', 'biz', 'cloud', 'website', 'space', 'fun', 'shop', 'live',
    'life', 'world', 'link', 'zone', 'blog', 'news'
  ]);
  function marketOf(siteUrl: string): string | null {
    const d = siteDomain(siteUrl).replace(/^www\./, '');
    const parts = d.split('.').filter(Boolean);
    if (parts.length < 2) return null;
    const tld = parts[parts.length - 1].toLowerCase();
    if (tld.length !== 2 || GENERIC_TLDS.has(tld)) return null;
    return tld.toUpperCase();
  }

  function siteDetailHref(e: Entry) {
    return `/properties/${encodeURIComponent(e.siteUrl)}?acc=${encodeURIComponent(e.accountId)}`;
  }

  function colsClass(n: number): string {
    if (n === 2) return 'grid-cols-1 md:grid-cols-2';
    if (n === 4) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
    return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6';
  }

</script>


<svelte:head><title>{t('Дашборд')} · gsc-hub</title></svelte:head>

{#snippet deltaChip(d: number | null, invert = false)}
  {#if data.comparable && d !== null && d !== 0}
    <span class="pii chip {(invert ? d <= 0 : d >= 0) ? 'chip-up' : 'chip-dn'}">{d > 0 ? '+' : '−'}{Math.abs(d)}%</span>
  {/if}
{/snippet}

{#snippet metricCell(label: string, value: string, d: number | null, invert = false)}
  <div class="flex min-w-0 flex-col">
    <span class="text-[10px] font-medium uppercase tracking-wider text-ink-3">{label}</span>
    <span class="flex items-center gap-1 whitespace-nowrap">
      <span class="pii app-num font-semibold text-ink">{value}</span>
      {@render deltaChip(d, invert)}
    </span>
  </div>
{/snippet}

{#snippet siteCard(e: Entry, uid: string, dim = false)}
  {@const dC = pctDelta(e.currentTotals.clicks, e.previousTotals.clicks)}
  {@const dI = pctDelta(e.currentTotals.impressions, e.previousTotals.impressions)}
  {@const falling = data.comparable && ((dC ?? 0) < 0 || (dI ?? 0) < 0)}
  {@const worst = Math.max(-(dC ?? 0), -(dI ?? 0), 0)}
  {@const isFav = favs.has(keyOf(e))}
  {@const isHidden = e.group === 'hidden'}
  {@const market = marketOf(e.siteUrl)}
  {@const domain = siteDomain(e.siteUrl)}
  <article
    class="pane flex min-w-0 cursor-pointer flex-col transition-colors hover:border-ink-4 {dim ? 'opacity-60' : ''}"
    style:border-color={falling ? `rgb(var(--dn) / ${Math.min(0.75, 0.25 + (worst / 100) * 0.5)})` : undefined}
    role="link"
    tabindex="0"
    onclick={() => goto(siteDetailHref(e))}
    onkeydown={(ev) => { if (ev.key === 'Enter') goto(siteDetailHref(e)); }}
  >
    <!-- Header: favicon + domain, market/account meta; clicks on the right -->
    <header class="flex items-start justify-between gap-2 px-3 pt-2.5">
      <div class="flex min-w-0 flex-col gap-0.5">
        <div class="flex min-w-0 items-center gap-1.5">
          <img
            src="https://www.google.com/s2/favicons?sz=64&domain={encodeURIComponent(domain)}"
            width="14"
            height="14"
            alt=""
            loading="lazy"
            class="pii shrink-0 rounded-xs"
            onerror={(ev) => ((ev.currentTarget as HTMLImageElement).style.display = 'none')}
          />
          <span class="pii truncate text-[13px] font-semibold text-ink">{domain}</span>
        </div>
        <div class="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-3">
          {#if market}
            <span class="badge badge-muted px-1 py-0 font-mono text-[10px] font-semibold" title={t('Рынок (по ccTLD)')}>{market}</span>
          {:else}
            <span class="badge badge-warn px-1 py-0 text-[10px]" title={t('Рынок неизвестен: общий домен верхнего уровня')}>{t('нет рынка')}</span>
          {/if}
          <span class="pii truncate">{e.accountLabel ?? e.accountEmail}</span>
        </div>
      </div>
      <div class="flex shrink-0 flex-col items-end gap-0.5">
        <span class="pii font-mono text-[14px] font-semibold tabular-nums text-ink">{num(e.currentTotals.clicks)}</span>
        {@render deltaChip(dC)}
      </div>
    </header>

    <!-- Chart: clicks line over a faint area, previous period dashed, impressions thin gray -->
    {#if e.error}
      <div class="pii mx-3 mt-2 rounded-sm bg-dn-t px-2 py-1.5 text-[11px] text-dn">{e.error}</div>
    {:else if e.pending}
      <div class="loading mx-3 mt-2 h-16 text-[11px] text-ink-3">{t('Загрузка…')}</div>
    {:else}
      <svg viewBox="0 0 {CHART_W} {CHART_H}" class="mt-1.5 h-16 w-full px-3" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="gc-{uid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color={SERIES.clicks} stop-opacity="0.12" />
            <stop offset="100%" stop-color={SERIES.clicks} stop-opacity="0" />
          </linearGradient>
        </defs>
        {#if data.comparable && e.previous.length > 0}
          <path d={seriesPath(e.previous, 'impressions')} fill="none" stroke={SERIES.prev} stroke-width="1" stroke-opacity="0.6" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" />
          <path d={seriesPath(e.previous, 'clicks')} fill="none" stroke={SERIES.prev} stroke-width="1.25" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" />
        {/if}
        <path d={seriesPath(e.current, 'impressions')} fill="none" stroke={SERIES.impr} stroke-width="1" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        <path d={areaPath(e.current, 'clicks')} fill="url(#gc-{uid})" />
        <path d={seriesPath(e.current, 'clicks')} fill="none" stroke={SERIES.clicks} stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
        {#each e.events as ev (ev.id)}
          {@const ex = eventX(e.current, ev.date)}
          {#if ex !== null}
            <line x1={ex} x2={ex} y1="1" y2={CHART_H - 1} stroke={ev.color} stroke-width="1.25" stroke-opacity="0.85" vector-effect="non-scaling-stroke">
              <title>{ev.label} · {ev.date}</title>
            </line>
          {/if}
        {/each}
      </svg>
    {/if}

    <!-- Footer: compact stats + action buttons -->
    <footer
      class="mt-1.5 flex items-end justify-between gap-2 border-t border-line-soft px-3 py-1.5"
      onclick={(ev) => ev.stopPropagation()}
      onkeydown={(ev) => ev.stopPropagation()}
      role="presentation"
    >
      <div class="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-1">
        {@render metricCell(t('Показы'), fmtK(e.currentTotals.impressions), dI)}
        {#if showCtr}
          {@render metricCell('CTR', fmtCtr(e.currentTotals.ctr), pctDelta(e.currentTotals.ctr, e.previousTotals.ctr))}
        {/if}
        {#if showPos}
          {@render metricCell(t('Поз.'), fmtPos(e.currentTotals.position), pctDelta(e.currentTotals.position, e.previousTotals.position), true)}
        {/if}
      </div>
      <div class="-mr-1.5 flex shrink-0 items-center">
        <a class="btn btn-ghost btn-sm btn-icon text-ink-3" href={siteHref(e.siteUrl)} target="_blank" rel="noopener noreferrer" onclick={(ev) => ev.stopPropagation()} title={t('Открыть сайт')}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7 9"/></svg>
        </a>
        <a class="btn btn-ghost btn-sm btn-icon text-ink-3" href={siteSearchHref(e.siteUrl)} target="_blank" rel="noopener noreferrer" title={t('Найти сайт в Google')}>
          <span class="text-[11px] font-extrabold leading-none">G</span>
        </a>
        <a
          class="btn btn-ghost btn-sm btn-icon text-ink-3"
          href="/properties/export?account={encodeURIComponent(e.accountId)}&site={encodeURIComponent(e.siteUrl)}&days={data.days}&dim=query"
          download
          title={t('Выгрузить CSV (запросы, {n} дн.)', { n: data.days })}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 10.5v2h11v-2M5 7l3 3 3-3M8 10V2.5"/></svg>
        </a>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-icon {isHidden ? 'bg-acc-t text-acc hover:bg-acc-t hover:text-acc' : 'text-ink-3'}"
          onclick={() => toggleHide(e)}
          title={isHidden ? t('Вернуть сайт') : t('Скрыть сайт')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" /></svg>
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-icon {isFav ? 'text-acc hover:text-acc' : 'text-ink-3'}"
          onclick={() => toggleFav(e)}
          title={isFav ? t('Убрать из избранного') : t('В избранное')}
        >
          <svg viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
        </button>
      </div>
    </footer>
  </article>
{/snippet}

{#snippet sectionHead(label: string, count: number)}
  <div class="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
    {label} <span class="font-mono font-normal">{count}</span>
  </div>
{/snippet}

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs">
        <span>{t('Обзор')}</span>
        <span aria-hidden="true">/</span>
        <span class="text-ink-2">{t('Дашборд')}</span>
      </nav>
      <h1 class="app-pagetitle">{t('Дашборд')}</h1>
    </div>
    <div class="app-toolbar-right">
      <PeriodPicker days={data.days} href={(d) => `?days=${d}&cols=${data.cols}&sort=${data.sort}&dir=${data.dir}${searchParam}`} />
      <span class="app-toolbar-divider" aria-hidden="true"></span>
      <div class="app-segmented">
        <span class="app-segmented-label">{t('Сортировка')}</span>
        <a class:is-active={data.sort === 'site'} href={sortHref('site')}>{t('Домен')}<SortCaret dir={data.sort === 'site' ? data.dir : ''} /></a>
        <a class:is-active={data.sort === 'clicks'} href={sortHref('clicks')}>{t('Клики')}<SortCaret dir={data.sort === 'clicks' ? data.dir : ''} /></a>
        <a class:is-active={data.sort === 'impressions'} href={sortHref('impressions')}>{t('Показы')}<SortCaret dir={data.sort === 'impressions' ? data.dir : ''} /></a>
      </div>
      <div class="app-segmented">
        <span class="app-segmented-label">{t('Метрики')}</span>
        <button type="button" class:is-active={showCtr} onclick={() => toggleMetric('ctr')}>CTR</button>
        <button type="button" class:is-active={showPos} onclick={() => toggleMetric('pos')}>{t('Поз.')}</button>
      </div>
      <div class="app-segmented">
        <span class="app-segmented-label">{t('Колонки')}</span>
        {#each [2, 4, 6] as c}
          <a class:is-active={data.cols === c} href="?days={data.days}&cols={c}&sort={data.sort}&dir={data.dir}{searchParam}">{c}</a>
        {/each}
      </div>
      <span class="app-toolbar-divider" aria-hidden="true"></span>
      <a href="/properties?days={data.days}" class="btn btn-ghost">{t('Сайты')}</a>
      <button
        type="button"
        class="btn btn-sec"
        onclick={async () => {
          // Refresh starts a fresh pass over the portfolio; the page keeps
          // showing the current numbers and the pass's progress meanwhile.
          refreshError = null;
          try {
            const r = await fetch('/cache/clear', { method: 'POST' });
            if (!r.ok) refreshError = t('Обновление не запущено (HTTP {status}) - цифры могут быть до часа старыми.', { status: r.status });
          } catch {
            refreshError = t('Обновление не запущено: сервер не ответил - цифры могут быть до часа старыми.');
          }
          await invalidateAll();
          await loadToday();
        }}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M13.5 8A5.5 5.5 0 1 1 11.8 4M13.5 2v3h-3"/></svg>
        {t('Обновить')}
      </button>
    </div>
  </header>
  {#if refreshError}<p class="app-errors">{tx(refreshError)}</p>{/if}

  <div class="mb-3"><SiteSearch /></div>
  <SnapshotStatus status={data.status} />
  {#if hideError}<p class="app-errors">{tx(hideError)}</p>{/if}

  <section class="pane mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-3 py-2">
    <div class="stat-label">
      {t('Сегодня')}{#if today}<span class="app-num normal-case tracking-normal"> · {today.date}</span>{/if}
    </div>
    {#if today}
      <div class="stat">
        <span class="stat-label">{t('Клики')}</span>
        <span class="stat-value pii">{num(today.totals.clicks)}</span>
      </div>
      <div class="stat">
        <span class="stat-label">{t('Показы')}</span>
        <span class="stat-value pii">{num(today.totals.impressions)}</span>
      </div>
      <div class="text-[11px] text-ink-3">{t('день ещё идёт — без сравнения')}</div>
      {#if today.errors.length > 0}
        <button
          type="button"
          class="badge badge-warn cursor-pointer"
          aria-expanded={todayErrorsOpen}
          aria-controls="today-errors"
          onclick={() => (todayErrorsOpen = !todayErrorsOpen)}
        >
          {t('неполные данные')} — {plural('ошибка чтения', today.errors.length)}
        </button>
      {:else if today.partial}
        <span class="text-[11px] text-ink-3">{t('неполные данные — часть сайтов ещё загружается')}</span>
      {/if}
      {#if todayErrorsOpen && today.errors.length > 0}
        <!-- Name what failed and where to fix it: a token problem is fixed by reconnecting the account. -->
        <ul id="today-errors" class="w-full border-t border-line-soft pt-1.5 text-[12px] text-ink-2">
          {#each today.errors.slice(0, 20) as e, i (i)}
            <li class="flex flex-wrap items-baseline gap-x-2">
              <span class="pii font-medium text-ink">{e.accountEmail}</span>
              <span class="pii min-w-0 break-all">{tx(e.reason)}</span>
              <a class="link text-[11.5px]" href="/settings/accounts">{t('Reconnect в аккаунтах')}</a>
            </li>
          {/each}
          {#if today.errors.length > 20}<li class="text-ink-3">{t('и ещё')} {today.errors.length - 20}</li>{/if}
        </ul>
      {/if}
    {:else if todayFailed}
      <div class="text-[11px] text-ink-3">{t('недоступно')}</div>
    {:else}
      <div class="loading text-[11px]">{t('Загрузка…')}</div>
    {/if}
  </section>

  {#if data.errors.length > 0}
    <div class="app-errors">
      <div class="app-errors-title">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="6" cy="6" r="5"/><path d="M6 3.5v3M6 8.5v.01"/></svg>
        {t('Ошибки')}
      </div>
      <ul class="ml-4 list-disc">
        {#each data.errors as e}
          <li class="pii"><span class="font-medium">{e.accountEmail}</span>: {tx(e.reason)}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if data.status.state === 'cold' && data.totalSites === 0}
    <!-- Nothing to list until the site lists arrive; the status line says why. -->
  {:else if searchQuery.trim() && data.total === 0}
    <div class="app-empty" role="status">
      <div class="app-empty-title">{t('Подходящих сайтов нет')}</div>
      <p class="app-empty-sub">{t('Попробуйте другой домен или сбросьте поиск.')}</p>
    </div>
  {:else if visibleCount === 0}
    <div class="app-empty">
      <div class="app-empty-title">{t('Видимых сайтов нет')}</div>
      <p class="app-empty-sub">{t('Подключите Google-аккаунт в')} <a class="link" href="/settings/accounts">{t('Настройках')}</a>{data.counts.hidden > 0 ? t(' или верните сайт ниже') : ''}.</p>
    </div>
  {/if}
  {#if visibleCount > 0}
    {#if favEntries.length > 0}
      <section class="mb-5">
        {@render sectionHead(t('Избранное'), data.counts.fav)}
        <div class="grid {colsClass(data.cols)} gap-3">
          {#each favEntries as e, i}
            {@render siteCard(e, `f${i}`)}
          {/each}
        </div>
      </section>
    {/if}

    {#if restEntries.length > 0}
    <section>
      {@render sectionHead(t('Все сайты'), data.counts.rest)}
      <div class="grid {colsClass(data.cols)} gap-3">
        {#each restEntries as e, i}
          {@render siteCard(e, `r${i}`)}
        {/each}
      </div>
    </section>
    {/if}
  {/if}

  {#if hiddenEntries.length > 0}
    <section class="mt-5">
      <div class="opacity-60">{@render sectionHead(t('Скрытые'), data.counts.hidden)}</div>
      <div class="grid {colsClass(data.cols)} gap-3 opacity-60">
        {#each hiddenEntries as e, i}
          {@render siteCard(e, `h${i}`, true)}
        {/each}
      </div>
    </section>
  {/if}

  <Pager page={data.page} pageCount={data.pageCount} total={data.total} />
</main>
