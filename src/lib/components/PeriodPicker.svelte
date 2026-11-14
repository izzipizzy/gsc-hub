<script lang="ts">
  // The period control used on every page: same presets, same custom field,
  // same labels. Each preset is a link, so the period lives in the URL.
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/index.svelte';
  import { PERIODS, parsePeriod } from '$lib/utils/periods';

  let {
    days,
    href,
    label = true,
    custom = true,
    onpick
  }: {
    days: number;
    /** Address for a period; the picker navigates there. */
    href: (d: number) => string;
    label?: boolean;
    custom?: boolean;
    /** Client-side switch instead of navigation (the pulse chart). */
    onpick?: (d: number) => void;
  } = $props();

  function name(d: number): string {
    if (d === 480) return t('16 мес');
    if (d === 365) return t('1 год');
    return t('{n} дн', { n: d });
  }
  function pick(raw: string) {
    const d = parsePeriod(raw);
    if (d === null) return;
    if (onpick) onpick(d);
    else goto(href(d));
  }
</script>

<div class="app-segmented" role="group" aria-label={t('Период')}>
  {#if label}<span class="app-segmented-label">{t('Период')}</span>{/if}
  {#each PERIODS as d (d)}
    <a
      class:is-active={days === d}
      href={href(d)}
      aria-current={days === d ? 'true' : undefined}
      onclick={(e) => { if (onpick) { e.preventDefault(); onpick(d); } }}
    >{name(d)}</a>
  {/each}
  {#if custom}
    <input
      type="number"
      min="1"
      max="480"
      placeholder={t('дней')}
      value={(PERIODS as readonly number[]).includes(days) ? '' : days}
      class="input app-num ml-1 h-6 w-16 px-1.5 text-[11.5px]"
      title={t('Своё число дней, до 480 (16 месяцев)')}
      aria-label={t('Своё число дней, до 480 (16 месяцев)')}
      onkeydown={(e) => { if (e.key === 'Enter') pick(e.currentTarget.value); }}
      onchange={(e) => pick(e.currentTarget.value)}
    />
  {/if}
</div>
