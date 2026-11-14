<script lang="ts">
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, getLocale } from '$lib/i18n/index.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';

  // Search runs on the server: the portfolio is paged, so the browser only
  // ever holds one page of it. Typing is debounced into one navigation, and a
  // new query starts again from page 1.
  let value = $state(page.url.searchParams.get('q') ?? '');
  let timer: ReturnType<typeof setTimeout> | null = null;

  function update(next: string, delay = 300) {
    value = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const url = new URL(page.url);
      if (next) url.searchParams.set('q', next);
      else url.searchParams.delete('q');
      url.searchParams.delete('page');
      goto(url, { replaceState: true, keepFocus: true, noScroll: true });
    }, delay);
  }
</script>

<div class="flex min-w-0 flex-wrap items-center gap-2">
  <label class="flex min-w-0 items-center gap-2">
    <span class="text-xs text-ink-3">{t('Поиск сайтов')}</span>
    <input
      type="search"
      class="input pii w-48 max-w-full"
      placeholder="example.com"
      {value}
      oninput={(event) => update(event.currentTarget.value)}
    />
  </label>
  {#if value}
    <button type="button" class="btn btn-ghost btn-sm" onclick={() => update('', 0)}>{t('Сбросить поиск')}</button>
  {/if}
</div>
