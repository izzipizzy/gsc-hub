<script lang="ts">
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, getLocale } from '$lib/i18n/index.svelte';
  import { invalidateAll } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import LiveStamp from './LiveStamp.svelte';

  type Status = {
    state: 'cold' | 'ready';
    refreshing: boolean;
    done: number;
    total: number;
    startedAt: number | null;
    updatedAt: number | null;
    error: string | null;
  };
  let { status }: { status: Status } = $props();

  // While a pass runs the page re-reads its data: often while there is nothing
  // to show yet, now and then while old numbers are on screen. A failed reload
  // just waits for the next tick.
  let timer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!status.refreshing) return;
    const delay = status.state === 'cold' ? 3_000 : 15_000;
    timer = setTimeout(() => invalidateAll().catch(() => undefined), delay);
  });
  onDestroy(() => { if (timer) clearTimeout(timer); });

  async function retry() {
    await fetch('/cache/clear', { method: 'POST' }).catch(() => undefined);
    await invalidateAll();
  }
</script>

<div class="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-ink-3" role="status" aria-live="polite">
  {#if status.state === 'cold' && status.refreshing}
    <span class="loading">{t('Загружаем данные Search Console: {done} из {total} сайтов', { done: fmtNum(status.done), total: status.total ? fmtNum(status.total) : '…' })}</span>
    <span>{t('— карточки появляются по мере загрузки.')}</span>
  {:else if status.state === 'cold' && status.error}
    <span class="badge badge-warn">{t('Нет данных')}</span>
    <span class="pii">{t('Не удалось загрузить данные Search Console: {error}', { error: tx(status.error) })}</span>
    <button type="button" class="btn btn-ghost btn-sm" onclick={retry}>{t('Повторить')}</button>
  {:else if status.updatedAt}
    <LiveStamp at={status.updatedAt} updating={status.refreshing} />
    {#if status.refreshing}
      <span class="loading">· {t('обновляется {done} из {total}', { done: fmtNum(status.done), total: status.total ? fmtNum(status.total) : '…' })}</span>
    {:else if status.error}
      <span class="badge badge-warn" title={tx(status.error)}>{t('последнее обновление не удалось')}</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick={retry}>{t('Повторить')}</button>
    {/if}
  {/if}
</div>
