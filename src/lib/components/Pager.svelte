<script lang="ts">
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, getLocale } from '$lib/i18n/index.svelte';
  import { page as appPage } from '$app/state';

  let { page, pageCount, total, size = 100 }: { page: number; pageCount: number; total: number; size?: number } = $props();

  // Every other parameter (period, sort, search…) rides along unchanged.
  function href(p: number): string {
    const url = new URL(appPage.url);
    if (p <= 1) url.searchParams.delete('page');
    else url.searchParams.set('page', String(p));
    return `${url.pathname}${url.search}`;
  }

  // First, last, and a window around the current page.
  const pages = $derived.by(() => {
    const set = new Set([1, pageCount, page - 2, page - 1, page, page + 1, page + 2]);
    return [...set].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  });
  const from = $derived(total === 0 ? 0 : (page - 1) * size + 1);
  const to = $derived(Math.min(total, page * size));
</script>

{#if pageCount > 1}
  <nav class="mt-4 flex flex-wrap items-center gap-1 text-xs" aria-label={t('Страницы')}>
    <span class="mr-2 text-ink-3 app-num">{t('{from}–{to} из {total}', { from: fmtNum(from), to: fmtNum(to), total: fmtNum(total) })}</span>
    {#if page > 1}
      <a class="btn btn-ghost btn-sm" href={href(page - 1)} rel="prev">{t('Назад')}</a>
    {/if}
    {#each pages as p, i}
      {#if i > 0 && p - pages[i - 1] > 1}<span class="px-1 text-ink-3">…</span>{/if}
      {#if p === page}
        <span class="btn btn-sec btn-sm app-num" aria-current="page">{p}</span>
      {:else}
        <a class="btn btn-ghost btn-sm app-num" href={href(p)}>{p}</a>
      {/if}
    {/each}
    {#if page < pageCount}
      <a class="btn btn-ghost btn-sm" href={href(page + 1)} rel="next">{t('Дальше')}</a>
    {/if}
  </nav>
{/if}
