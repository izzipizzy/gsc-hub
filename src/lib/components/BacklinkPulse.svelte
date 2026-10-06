<script lang="ts">
  import BacklinkSummary from './BacklinkSummary.svelte';
  import type { BacklinkDashboard, BacklinkScope } from '$lib/server/backlink-snapshots';
  let { dashboard }: { dashboard: BacklinkDashboard } = $props();
  let scope = $state<BacklinkScope>('all');
  let hover = $state<number | null>(null);
  const scopes = $derived([{ id: 'all', label: 'Все поставщики' }, ...dashboard.providers.map((p) => ({ id: p.id, label: p.name }))]);
  const percentage = (n: number, total: number) => total ? `${(100*n/total).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%` : '—';
  const selected = $derived(dashboard.totals[scope]);
  const points = $derived.by(() => {
    const history = dashboard.history.map((p) => ({ at: p.at, summary: p.totals[scope] ?? { total: 0, found: 0, missing: 0, suspect: 0, errors: 0, changed: 0, unchecked: 0, checkedAt: null }, current: false }));
    const last = history.at(-1)?.summary;
    const keys = ['total','found','missing','suspect','errors','changed','unchecked'] as const;
    if (!last || keys.some((k) => last[k] !== selected[k])) history.push({ at: dashboard.at, summary: selected, current: true });
    return history;
  });
  const series = [
    { id: 'total', label: 'Всего', color: '#64748b', dash: '4 4' },
    { id: 'found', label: 'Живые', color: '#059669', dash: '' },
    { id: 'missing', label: 'Нет купленной ссылки', color: '#e11d48', dash: '' },
    { id: 'unknown', label: 'Не подтверждено / ошибки', color: '#d97706', dash: '' }
  ] as const;
  const value = (p: (typeof points)[number], id: (typeof series)[number]['id']) => id === 'unknown'
    ? p.summary.suspect + p.summary.errors + p.summary.unchecked : p.summary[id];
  const maxY = $derived(Math.max(1, ...points.map((p) => p.summary.total)));
  const x = (i: number) => points.length < 2 ? 422 : 42 + (points[i].at - points[0].at) / Math.max(1, points.at(-1)!.at - points[0].at) * 760;
  const y = (v: number) => 132 - v / maxY * 112;
  const path = (id: (typeof series)[number]['id']) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(value(p,id)).toFixed(2)}`).join(' ');
  const activeIndex = $derived(hover === null ? points.length - 1 : Math.min(hover, points.length - 1));
  const activePoint = $derived(points[activeIndex]);
  const date = (n: number) => new Date(n).toISOString().replace('T',' ').slice(0,16) + ' UTC';
  const shortDate = (n: number) => new Date(n).toISOString().slice(5,16).replace('T',' ');
  function move(event: PointerEvent) {
    const rect = event.currentTarget instanceof SVGElement ? event.currentTarget.getBoundingClientRect() : null;
    if (!rect) return;
    const pos = (event.clientX - rect.left) / rect.width * 840;
    hover = points.reduce((best, _, i) => Math.abs(x(i)-pos) < Math.abs(x(best)-pos) ? i : best, 0);
  }
</script>

<div class="flex flex-col gap-3">
  <div class="grid gap-2 sm:grid-cols-3" role="group" aria-label="Поставщик ссылок">
    {#each scopes as provider}
      {@const s = dashboard.totals[provider.id]}
      <button type="button" aria-pressed={scope === provider.id} onclick={() => { scope = provider.id; hover = null; }} class="rounded border px-3 py-2 text-left transition-colors {scope === provider.id ? 'border-acc bg-acc-t' : 'border-line hover:bg-sunk'}">
        <span class="text-xs text-ink-2">{provider.label}</span>
        <div class="mt-1 flex items-baseline gap-2"><span class="app-num text-lg font-semibold text-up">{percentage(s.found,s.total)}</span><span class="text-xs text-ink-3">живых</span></div>
        <span class="app-num text-xs text-ink-2">{s.found} из {s.total}</span>
        {#if s.missing}<span class="ml-2 text-xs text-dn">без ссылки {s.missing}</span>{/if}
      </button>
    {/each}
  </div>
  <div class="rounded border border-line px-2 py-2">
    <div class="mb-1 flex flex-wrap items-center justify-between gap-1 px-1 text-xs">
      <span class="font-medium text-ink">История количества ссылок</span>
      {#if activePoint}<span class="app-num text-ink-3">{date(activePoint.at)}{activePoint.current ? ' · текущая проверка' : ''}</span>{/if}
    </div>
    <svg viewBox="0 0 840 158" class="h-36 w-full" preserveAspectRatio="none" role="img" aria-label="Количество живых, отсутствующих и непроверенных ссылок во времени" onpointermove={move} onpointerleave={() => hover = null}>
      {#each [0,0.5,1] as fraction}
        <line x1="42" x2="802" y1={y(maxY*fraction)} y2={y(maxY*fraction)} stroke="currentColor" class="text-line" />
        <text x="35" y={y(maxY*fraction)+3} text-anchor="end" font-size="10" fill="currentColor" class="text-ink-3">{Math.round(maxY*fraction)}</text>
      {/each}
      {#each series as line}
        {#if points.length > 1}<path d={path(line.id)} fill="none" stroke={line.color} stroke-width="2" stroke-dasharray={line.dash} vector-effect="non-scaling-stroke" />{/if}
        {#if activePoint}<circle cx={x(activeIndex)} cy={y(value(activePoint,line.id))} r="3" fill={line.color}><title>{line.label}: {value(activePoint,line.id)}</title></circle>{/if}
      {/each}
      {#if points.length > 1 && hover !== null}<line x1={x(activeIndex)} x2={x(activeIndex)} y1="16" y2="135" stroke="currentColor" stroke-dasharray="2 3" class="text-ink-3" />{/if}
      {#if points.length}
        <text x="42" y="152" font-size="10" fill="currentColor" class="text-ink-3">{shortDate(points[0].at)}</text>
        {#if points.length > 1}<text x="802" y="152" text-anchor="end" font-size="10" fill="currentColor" class="text-ink-3">{shortDate(points.at(-1)!.at)}</text>{/if}
      {/if}
    </svg>
    <div class="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs">
      {#each series as line}<span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style:background={line.color}></span>{line.label}: <b class="app-num text-ink">{activePoint ? value(activePoint,line.id) : 0}</b></span>{/each}
    </div>
    {#if points.length === 1}<p class="mt-2 px-1 text-xs text-ink-3">Пока один замер. История пополняется после каждой завершённой проверки.</p>{/if}
  </div>
  <BacklinkSummary summary={selected} percentages />
  <p class="text-xs text-ink-3">Проценты — от всех публикаций выбранного поставщика. «Нет купленной ссылки» — отсутствие подтверждено повторной проверкой. Анкор / rel — отдельный признак, может пересекаться с другими статусами.</p>
</div>
