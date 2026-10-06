<script lang="ts">
  import type { checkSummary } from '$lib/server/backlink-monitor';
  let { summary, percentages = false }: { summary: ReturnType<typeof checkSummary>; percentages?: boolean } = $props();
  const share = (n: number) => percentages && summary.total > 0 ? ` · ${(100 * n / summary.total).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%` : '';
</script>
<div class="flex flex-wrap gap-1 text-xs">
  {#if summary.total === 0}<span class="text-ink-3">нет проверок</span>{/if}
  {#if summary.found}<span class="badge badge-ok">найдено {summary.found}{share(summary.found)}</span>{/if}
  {#if summary.missing}<span class="badge badge-bad">проблемы {summary.missing}{share(summary.missing)}</span>{/if}
  {#if summary.suspect}<span class="badge badge-warn">перепроверка {summary.suspect}{share(summary.suspect)}</span>{/if}
  {#if summary.errors}<span class="badge badge-warn">ошибки проверки {summary.errors}{share(summary.errors)}</span>{/if}
  {#if summary.changed}<span class="badge badge-warn">анкор / rel {summary.changed}{share(summary.changed)}</span>{/if}
  {#if summary.unchecked}<span class="text-ink-3">не проверено {summary.unchecked}{share(summary.unchecked)}</span>{/if}
</div>
