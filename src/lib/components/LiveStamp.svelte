<script lang="ts">
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, getLocale } from '$lib/i18n/index.svelte';
  // Freshness stamp for every screen with live Search Console data:
  // `live 14:02`, a green dot while current, amber-ochre (warn) while a refresh
  // runs behind old numbers. The full timestamp sits in the tooltip.
  import { stamp, fullStamp, dateTime } from '$lib/utils/time';

  // `full`: always date and time, not just the time for today.
  let { at, updating = false, note = '', full = false }: { at: number | null; updating?: boolean; note?: string; full?: boolean } = $props();
</script>

{#if at}
  <span class="live-stamp" class:is-updating={updating} title="{fullStamp(at)}{note ? ` · ${tx(note)}` : ''}">
    <i aria-hidden="true"></i>{t('обновлено')} <time class="app-num" datetime={new Date(at).toISOString()}>{full ? dateTime(at) : stamp(at)}</time>
  </span>
{/if}

<style>
  .live-stamp {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    font-size: 12px;
    color: rgb(var(--ink-3));
  }
  .live-stamp time {
    color: rgb(var(--ink-2));
  }
  i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgb(var(--up));
  }
  .is-updating i {
    background: rgb(var(--warn));
  }
</style>
