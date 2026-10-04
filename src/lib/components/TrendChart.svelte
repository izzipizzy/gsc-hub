<script lang="ts">
  // Site traffic chart in the trading-desk grammar: clicks are the price line with
  // its scale on the right, impressions are the volume pane underneath, Google
  // updates are shaded rollout bands with a label strip, site events are marked
  // days. Hover draws a crosshair with axis tags; the legend row reads out the
  // hovered day, so nothing floats over the data. Hand-rolled SVG — no chart lib.
  import { SERIES, UPDATE_COLORS } from '$lib/chart-theme';

  export interface ChartUpdate {
    date: string; // ISO, clipped to the chart window
    end: string; // ISO, clipped to the chart window
    name: string; // "Jun 2026 Spam"
    type: string;
    color: string;
    ongoing?: boolean;
    impact: { clicks: number | null; confident: boolean } | null;
  }

  export interface ChartEvent {
    id?: number;
    date: string; // ISO — drawn as a marked day
    label: string; // shown verbatim, e.g. "← donordomain.com"
    color: string;
    typeLabel?: string;
  }

  let {
    points,
    updates = [],
    events = [],
    height = 320,
    showUpdates = $bindable(true),
    showEvents = $bindable(true)
  }: {
    points: { date: string; clicks: number; impressions: number }[];
    updates?: ChartUpdate[];
    events?: ChartEvent[];
    height?: number;
    showUpdates?: boolean;
    showEvents?: boolean;
  } = $props();

  const uid = $props.id();

  let showImpr = $state(true);

  // ── layout: price pane on top, volume pane below, shared x ──
  const M = { right: 58, bottom: 22, left: 10 };
  let width = $state(720);
  const innerW = $derived(Math.max(50, width - M.left - M.right));

  // ── scales ──
  const n = $derived(points.length);
  const x = $derived((i: number) => (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW));
  const barW = $derived(Math.max(1, Math.min(10, (innerW / Math.max(n, 1)) * 0.62)));
  const niceMax = (v: number): number => {
    if (v <= 0) return 1;
    const exp = Math.floor(Math.log10(v));
    const base = Math.pow(10, exp);
    for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
      if (v <= m * base) return m * base;
    }
    return 10 * base;
  };
  const maxClicks = $derived(niceMax(Math.max(...points.map((p) => p.clicks), 0) * 1.06));
  const maxImpr = $derived(Math.max(...points.map((p) => p.impressions), 1));
  const yC = $derived((v: number) => priceH - (v / maxClicks) * priceH);
  const yV = $derived((v: number) => innerH - (v / maxImpr) * volH);

  const Y_TICKS = 4;
  const yTicks = $derived(Array.from({ length: Y_TICKS + 1 }, (_, i) => maxClicks * (i / Y_TICKS)));

  const xTicks = $derived.by(() => {
    const out: { i: number; label: string }[] = [];
    const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(innerW / 90))));
    for (let i = 0; i < n; i += every) out.push({ i, label: dayLabel(points[i].date) });
    return out;
  });

  function dayLabel(iso: string): string {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function fullDay(iso: string): string {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  const nf = new Intl.NumberFormat('en-US');
  function fmtNum(v: number): string {
    return nf.format(Math.round(v));
  }
  function fmtShort(v: number): string {
    if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
    if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
    return fmtNum(v);
  }

  // ── annotations ──
  const bands = $derived(
    showUpdates
      ? updates.map((u) => {
          let i0 = points.findIndex((p) => p.date >= u.date);
          if (i0 === -1) i0 = n - 1;
          let i1 = -1;
          for (let i = n - 1; i >= 0; i--) {
            if (points[i].date <= u.end) { i1 = i; break; }
          }
          if (i1 === -1) i1 = i0;
          const x0 = x(i0);
          const x1 = Math.max(x(i1), x0 + 3);
          const impact = u.ongoing
            ? 'идёт'
            : u.impact?.clicks != null
              ? `${u.impact.confident ? '' : '≈'}${u.impact.clicks > 0 ? '+' : '−'}${Math.abs(u.impact.clicks)}%`
              : null;
          const impactTone = u.impact?.clicks != null && !u.ongoing ? (u.impact.clicks >= 0 ? 'up' : 'dn') : null;
          const text = `${u.name}${impact ? ` · ${impact}` : ''}`;
          const w = text.length * 6.1 + 8;
          // Near the right edge the label ends at the band instead; either way it stays in the plot.
          const want = x0 + 4 + w > innerW ? x1 - 4 - w : x0 + 4;
          const lx0 = Math.max(0, Math.min(want, innerW - w));
          return { ...u, x0, x1, impact, impactTone, lx0, lx1: lx0 + w, lane: 0, labelled: true, color: UPDATE_COLORS[u.type] ?? u.color };
        })
      : []
  );

  // Update labels that would collide stack into lanes (at most three); anything
  // still colliding keeps its band and shows its name in the legend on hover.
  const MAX_LANES = 3;
  const laidBands = $derived.by(() => {
    const ends: number[] = [];
    return [...bands]
      .sort((a, b) => a.lx0 - b.lx0)
      .map((b) => {
        let lane = ends.findIndex((e) => e < b.lx0 - 6);
        if (lane === -1 && ends.length < MAX_LANES) lane = ends.push(-Infinity) - 1;
        if (lane === -1) return { ...b, labelled: false, lane: 0 };
        ends[lane] = b.lx1;
        return { ...b, lane };
      });
  });
  const lanes = $derived(Math.max(1, ...laidBands.filter((b) => b.labelled).map((b) => b.lane + 1)));
  const top = $derived(6 + lanes * 16);
  const innerH = $derived(Math.max(60, height - top - M.bottom));
  const volH = $derived(showImpr ? Math.round(innerH * 0.22) : 0);
  const gap = $derived(showImpr ? 10 : 0);
  const priceH = $derived(innerH - volH - gap);

  // Events that land within a few pixels of each other merge into one mark with a
  // count, so markers never stack into an unreadable smear.
  const eventMarks = $derived.by(() => {
    if (!showEvents) return [];
    const placed = events
      .map((ev) => {
        let i = points.findIndex((p) => p.date >= ev.date);
        if (i === -1) i = n - 1;
        return { ev, x: x(i) };
      })
      .sort((a, b) => a.x - b.x);
    const groups: { x: number; items: ChartEvent[] }[] = [];
    for (const p of placed) {
      const last = groups[groups.length - 1];
      if (last && p.x - last.x < 14) last.items.push(p.ev);
      else groups.push({ x: p.x, items: [p.ev] });
    }
    return groups.map((g) => {
      const label = g.items.length === 1 ? g.items[0].label : `${g.items.length} events`;
      const w = label.length * 6.4 + 12;
      const anchor = g.x > innerW - w - 12 ? 'end' : 'start';
      return {
        key: g.items.map((e) => e.date + e.label).join('|'),
        x: g.x,
        count: g.items.length,
        color: g.items[0].color,
        colors: [...new Set(g.items.map((e) => e.color))],
        details: g.items.map((e) => `${e.date}: ${e.label}`).join('\n'),
        label,
        anchor,
        lx0: anchor === 'end' ? g.x - 12 - w : g.x,
        lx1: anchor === 'end' ? g.x : g.x + 12 + w
      } as const;
    });
  });
  // Only labels that fit without overlap are drawn; the rest read out in the legend on hover.
  const labelledEvents = $derived.by(() => {
    const shown = new Set<string>();
    let lastEnd = -Infinity;
    for (const ev of eventMarks) {
      // a label never runs over another event's marker
      const crossesMark = eventMarks.some((o) => o !== ev && o.x > ev.lx0 - 8 && o.x < ev.lx1 + 8);
      if (!crossesMark && ev.lx0 > lastEnd + 8) {
        shown.add(ev.key);
        lastEnd = ev.lx1;
      }
    }
    return shown;
  });

  // ── paths ──
  function linePath(ys: number[]): string {
    return ys.map((y, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y.toFixed(1)}`).join('');
  }
  const clicksPath = $derived(linePath(points.map((p) => yC(p.clicks))));
  const clicksArea = $derived(
    n ? `${clicksPath}L${x(n - 1).toFixed(1)},${priceH}L${x(0).toFixed(1)},${priceH}Z` : ''
  );
  const last = $derived(n ? points[n - 1] : null);
  const eventSwatch = $derived(events[0]?.color ?? 'rgb(19 23 34)');
  const eventLegend = $derived([...new Map(events.map((ev) =>
    [ev.color, { color: ev.color, label: ev.typeLabel ?? 'Events' }]
  )).values()]);

  // ── hover ──
  let hoverI = $state<number | null>(null);
  function onMove(e: PointerEvent) {
    if (n === 0) return;
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width - M.left;
    hoverI = Math.max(0, Math.min(n - 1, Math.round((px / innerW) * (n - 1))));
  }
  function onKey(e: KeyboardEvent) {
    if (n === 0) return;
    if (e.key === 'ArrowLeft') hoverI = Math.max(0, (hoverI ?? n) - 1);
    else if (e.key === 'ArrowRight') hoverI = Math.min(n - 1, (hoverI ?? -1) + 1);
    else if (e.key === 'Escape') hoverI = null;
    else return;
    e.preventDefault();
  }
  const shown = $derived(hoverI !== null ? points[hoverI] : last);
  // The axis tag (last value, or the hovered one) hides any tick label it would sit on.
  const tagY = $derived(hoverI !== null ? yC(points[hoverI].clicks) : last ? yC(last.clicks) : null);
  const hoverEvents = $derived.by(() => {
    if (hoverI === null) return [];
    const d = points[hoverI].date;
    return events.filter((ev) => ev.date === d);
  });
  const hoverUpdates = $derived.by(() => {
    if (hoverI === null) return [];
    const d = points[hoverI].date;
    return updates.filter((u) => u.date <= d && d <= u.end);
  });
</script>

<div class="w-full select-none" bind:clientWidth={width}>
  <!-- legend row: series toggles that double as the hovered-day readout -->
  <div class="mb-1 flex min-h-[26px] flex-wrap items-center gap-x-1 gap-y-1 text-xs">
    <span class="mr-2 font-mono text-[11.5px] text-ink-3">{shown ? fullDay(shown.date) : ''}</span>
    <span class="legend-item" style:--c={SERIES.clicks}>
      <i></i>Clicks <b class="font-mono">{shown ? fmtNum(shown.clicks) : '—'}</b>
    </span>
    <button type="button" class="legend-item" class:is-off={!showImpr} style:--c={SERIES.impr}
      onclick={() => (showImpr = !showImpr)} aria-pressed={showImpr}>
      <i></i>Impressions <b class="font-mono">{shown ? fmtNum(shown.impressions) : '—'}</b>
    </button>
    <button type="button" class="legend-item" class:is-off={!showUpdates} style:--c={UPDATE_COLORS.core}
      onclick={() => (showUpdates = !showUpdates)} aria-pressed={showUpdates}
      title="Google algorithm update rollouts (feed: status.search.google.com, fallback to built-in list)">
      <i></i>Updates <span class="text-ink-3">{updates.length}</span>
    </button>
    {#if events.length > 0}
      <button type="button" class="legend-item" class:is-off={!showEvents} style:--c={eventSwatch}
        onclick={() => (showEvents = !showEvents)} aria-pressed={showEvents}
        title="События сайта: склейки доменов и покупки ссылок">
        <i></i>Events <span class="text-ink-3">{events.length}</span>
      </button>
      {#each eventLegend as kind (kind.color)}
        <span class="legend-item" style:--c={kind.color}><i></i>{kind.label}</span>
      {/each}
    {/if}
    {#each hoverUpdates as u (u.date + u.name)}
      <span class="rounded-[3px] px-1.5 py-px text-[11px] font-medium" style:background="{UPDATE_COLORS[u.type] ?? u.color}22" style:color="rgb(var(--upd-ink))">{u.name}</span>
    {/each}
    {#each hoverEvents as ev, i (i)}
      <span class="rounded-[3px] px-1.5 py-px text-[11px] font-medium text-white" style:background={ev.color}>{ev.label}</span>
    {/each}
  </div>

  <svg
    viewBox="0 0 {width} {height}"
    class="block w-full touch-none outline-none"
    style="height:{height}px"
    onpointermove={onMove}
    onpointerleave={() => (hoverI = null)}
    onkeydown={onKey}
    tabindex="0"
    role="application"
    aria-label="Daily clicks and impressions. Use left and right arrows to read single days."
  >
    <defs>
      <linearGradient id="gc-{uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color={SERIES.clicks} stop-opacity="0.14" />
        <stop offset="100%" stop-color={SERIES.clicks} stop-opacity="0" />
      </linearGradient>
      <clipPath id="cp-{uid}"><rect x="0" y="-2" width={innerW} height={innerH + 4} /></clipPath>
    </defs>

    <g transform="translate({M.left},{top})">
      <!-- update bands: shade + label strip on top -->
      {#each laidBands as b (b.date + b.name)}
        {@const ly = -top + 2 + b.lane * 16}
        <rect x={b.x0} y={ly} width={b.x1 - b.x0} height={innerH - ly} fill={b.color} fill-opacity="0.08" />
        {#if b.labelled}
          <rect x={Math.min(b.x0, b.lx0 - 4)} y={ly} width={Math.max(b.x1, b.lx1) - Math.min(b.x0, b.lx0 - 4)} height="15" fill={b.color} fill-opacity="0.16" />
          <rect x={b.x0} y={ly} width={b.x1 - b.x0} height="15" fill={b.color} fill-opacity="0.2" />
        {/if}
        {#if b.ongoing}
          <line x1={b.x1} x2={b.x1} y1={-top + 2} y2={innerH} stroke={b.color} stroke-dasharray="2 3" />
        {/if}
        {#if b.labelled}
        <text
          x={b.lx0}
          y={ly + 11}
          font-size="10"
          font-weight="600"
          fill="rgb(138 74 12)"
          text-anchor="start"
          class="font-mono"
        >{b.name}{#if b.impact}<tspan fill={b.impactTone === 'up' ? 'rgb(8 135 113)' : b.impactTone === 'dn' ? 'rgb(224 42 58)' : 'rgb(138 74 12)'}>{' · '}{b.impact}</tspan>{/if}</text>
        {/if}
      {/each}

      <!-- price grid + right axis -->
      {#each yTicks as tv, i (i)}
        <line x1="0" x2={innerW} y1={yC(tv)} y2={yC(tv)} stroke="rgb(238 240 243)" />
        {#if !tagY || Math.abs(yC(tv) - tagY) > 12}
          <text x={innerW + 8} y={yC(tv) + 3.5} font-size="10.5" fill="rgb(110 118 132)" class="font-mono">{fmtShort(tv)}</text>
        {/if}
      {/each}

      <!-- volume pane -->
      {#if showImpr}
        <line x1="0" x2={innerW} y1={innerH - volH - gap / 2} y2={innerH - volH - gap / 2} stroke="rgb(228 231 236)" />
        <text x={innerW + 8} y={innerH - volH + 7} font-size="10.5" fill="rgb(110 118 132)" class="font-mono">{fmtShort(maxImpr)}</text>
        <text x="4" y={innerH - volH + 8} font-size="10" fill="rgb(110 118 132)">Impressions</text>
        {#each points as p, i (p.date)}
          <rect
            x={x(i) - barW / 2}
            y={yV(p.impressions)}
            width={barW}
            height={Math.max(0.5, innerH - yV(p.impressions))}
            fill={hoverI === i ? 'rgb(67 74 87)' : SERIES.impr}
            fill-opacity={hoverI === i ? 0.9 : 0.45}
          />
        {/each}
      {/if}

      <!-- clicks: area + line -->
      <g clip-path="url(#cp-{uid})">
        <path d={clicksArea} fill="url(#gc-{uid})" />
        <path d={clicksPath} fill="none" stroke={SERIES.clicks} stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
      </g>

      <!-- event days -->
      {#each eventMarks as ev (ev.key)}
        <g><title>{ev.details}</title>
        {#each ev.colors as color, i (color)}
        {@const markX = ev.x + (i - (ev.colors.length - 1) / 2) * 12}
        <!-- solid hairline: the dashed rule belongs to the hover crosshair -->
        <line x1={markX} x2={markX} y1="0" y2={innerH} stroke={color} stroke-width="1" stroke-opacity="0.28" />
        <g transform="translate({markX},{priceH - 4})">
          <rect x={ev.count > 1 ? -6.5 : -5} y={ev.count > 1 ? -14.5 : -13} width={ev.count > 1 ? 13 : 10} height={ev.count > 1 ? 13 : 10} rx="1.5" fill={color} transform="rotate(45 0 -8)" stroke="#fff" stroke-width="1.5" />
          {#if ev.count > 1 && i === 0}
            <text y="-5" font-size="8.5" font-weight="700" fill="#fff" text-anchor="middle" class="font-mono">{ev.count}</text>
          {/if}
        </g>
        {/each}
        {#if labelledEvents.has(ev.key)}
        {@const tw = ev.label.length * 6.3 + 8}
        <rect x={ev.anchor === 'end' ? ev.x - 8 - tw : ev.x + 8} y={priceH - 20} width={tw} height="16" rx="2" fill="#fff" fill-opacity="0.94" stroke="rgb(228 231 236)" />
        <text
          x={ev.anchor === 'end' ? ev.x - 12 : ev.x + 12}
          y={priceH - 8}
          font-size="10.5"
          font-weight="600"
          fill={ev.color}
          text-anchor={ev.anchor}
        >{ev.label}</text>
        {/if}
        </g>
      {/each}

      <!-- last value: dotted level + tag on the axis -->
      {#if last && hoverI === null}
        <line x1="0" x2={innerW} y1={yC(last.clicks)} y2={yC(last.clicks)} stroke={SERIES.clicks} stroke-dasharray="1 3" stroke-opacity="0.7" />
        <g transform="translate({innerW + 2},{yC(last.clicks)})">
          <rect y="-9" width={M.right - 4} height="18" rx="2" fill={SERIES.clicks} />
          <text x={(M.right - 4) / 2} y="3.5" font-size="10.5" font-weight="600" fill="#fff" text-anchor="middle" class="font-mono">{fmtShort(last.clicks)}</text>
        </g>
      {/if}

      <!-- x axis -->
      {#each xTicks as t (t.i)}
        {#if hoverI === null || Math.abs(x(t.i) - x(hoverI)) > 58}
        <text x={Math.min(Math.max(x(t.i), 22), innerW - 22)} y={innerH + 15} font-size="10.5" fill="rgb(110 118 132)" text-anchor="middle" class="font-mono">{t.label}</text>
        {/if}
      {/each}

      <!-- crosshair with axis tags -->
      {#if hoverI !== null}
        {@const hx = x(hoverI)}
        {@const hy = yC(points[hoverI].clicks)}
        <line x1={hx} x2={hx} y1="0" y2={innerH} stroke="rgb(67 74 87)" stroke-dasharray="3 3" />
        <line x1="0" x2={innerW} y1={hy} y2={hy} stroke="rgb(67 74 87)" stroke-dasharray="3 3" stroke-opacity="0.6" />
        <circle cx={hx} cy={hy} r="3.5" fill={SERIES.clicks} stroke="#fff" stroke-width="1.5" />
        <g transform="translate({innerW + 2},{hy})">
          <rect y="-9" width={M.right - 4} height="18" rx="2" fill="rgb(19 23 34)" />
          <text x={(M.right - 4) / 2} y="3.5" font-size="10.5" font-weight="600" fill="#fff" text-anchor="middle" class="font-mono">{fmtShort(points[hoverI].clicks)}</text>
        </g>
        <g transform="translate({Math.min(Math.max(hx, 34), innerW - 34)},{innerH + 3})">
          <rect x="-34" width="68" height="17" rx="2" fill="rgb(19 23 34)" />
          <text y="12" font-size="10.5" fill="#fff" text-anchor="middle" class="font-mono">{dayLabel(points[hoverI].date)}</text>
        </g>
      {/if}
    </g>
  </svg>
</div>

<style>
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px;
    border-radius: 4px;
    color: rgb(var(--ink-2));
    transition: background-color 150ms, color 150ms;
  }
  button.legend-item:hover {
    background: rgb(var(--bg));
    color: rgb(var(--ink));
  }
  .legend-item i {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    background: var(--c);
  }
  .legend-item b {
    font-weight: 600;
    color: rgb(var(--ink));
    font-size: 11.5px;
  }
  .legend-item.is-off {
    color: rgb(var(--ink-4));
  }
  .legend-item.is-off i {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px rgb(var(--ink-4));
  }
  .legend-item.is-off b {
    color: rgb(var(--ink-4));
  }
  svg:focus-visible {
    outline: 2px solid rgb(var(--acc));
    outline-offset: 2px;
  }
</style>
