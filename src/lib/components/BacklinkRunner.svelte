<script lang="ts">
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, getLocale } from '$lib/i18n/index.svelte';
  import { isoDate, dateTime, clock } from '$lib/utils/time';
  import { invalidateAll } from '$app/navigation';
  import type { BacklinkDashboard } from '$lib/server/backlink-snapshots';
  import type { CheckJob } from '$lib/server/backlink-monitor';
  let { job = null, provider, orderId, placementId, compact = false, onprogress }: {
    job?: CheckJob | null; provider?: string; orderId?: string; placementId?: string; compact?: boolean; onprogress?: (dashboard: BacklinkDashboard) => void;
  } = $props();
  let pending = $state<CheckJob | null>(null);
  let busy = $state(false);
  let err = $state('');
  const current = $derived(pending ?? job);
  const active = $derived(current?.status === 'queued' || current?.status === 'running');
  async function run() {
    busy = true; err = '';
    try {
      const response = await fetch('/magiclinks/checks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, orderId, placementId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? t('Не удалось запустить проверку'));
      if (!compact) pending = data.job;
      await invalidateAll();
    } catch (e) { err = (e as Error).message; }
    finally { busy = false; }
  }
  $effect(() => {
    if (!active || compact) return;
    let disposed = false;
    let polling = false;
    const timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch('/magiclinks/checks');
        if (!response.ok) return;
        const data = await response.json();
        if (disposed) return;
        if (data.dashboard) onprogress?.(data.dashboard);
        pending = data.job;
        if (data.job && !['queued', 'running'].includes(data.job.status)) {
          await invalidateAll();
          if (!disposed) pending = null;
        }
      } catch { /* retry on next poll */ }
      finally { polling = false; }
    }, 4000);
    return () => { disposed = true; clearInterval(timer); };
  });
</script>
<div class="flex flex-col items-start gap-1">
  <button class="btn btn-sec btn-sm" disabled={busy || active} onclick={run}>{busy ? t('Запускаю…') : active ? t('Проверка идёт…') : compact ? t('Проверить') : orderId ? t('Проверить ссылки заказа') : t('Проверить все ссылки')}</button>
  {#if err}<span class="text-xs text-dn" role="alert">{tx(err)}</span>{/if}
  {#if !compact && current}
    <span class="text-xs text-ink-3" aria-live="polite">{active ? t('В фоне') : current.status === 'failed' ? t('Проверка завершилась с ошибкой') : t('Последняя проверка')}: {current.checked}/{current.total}{#if !active} · {dateTime(current.finished_at ?? current.created_at)}{/if}</span>
    {#if current.errors.length}<details class="max-w-lg text-xs text-warn"><summary class="cursor-pointer">{t('Не удалось получить размещения:')} {current.errors.length}</summary>{#each current.errors as message}<p class="break-all">{tx(message)}</p>{/each}</details>{/if}
  {/if}
</div>
