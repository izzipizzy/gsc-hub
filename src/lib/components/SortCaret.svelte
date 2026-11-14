<script lang="ts">
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, getLocale } from '$lib/i18n/index.svelte';
  // Sort direction mark for table headers; renders nothing for unsorted columns.
  let { dir }: { dir: 'asc' | 'desc' | '' } = $props();
</script>

{#if dir}
  <svg viewBox="0 0 10 10" class="ml-0.5 inline-block h-2.5 w-2.5 align-[-1px] text-acc" aria-label={dir === 'asc' ? t('по возрастанию') : t('по убыванию')} role="img">
    <path d={dir === 'asc' ? 'M2 6.5 5 3.5l3 3' : 'M2 3.5 5 6.5l3-3'} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
{/if}
