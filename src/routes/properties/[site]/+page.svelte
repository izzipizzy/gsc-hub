<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';
  import { SHORT_TERM_MAX } from '$lib/utils/branded';
  import TrendChart from '$lib/components/TrendChart.svelte';
  import BuyLinks from '$lib/components/BuyLinks.svelte';
  import IndexingModal from '$lib/components/IndexingModal.svelte';
  let indexingOpen = $state(false);
  import SortCaret from '$lib/components/SortCaret.svelte';
  import { sortStriking, type StrikingSortKey, type SortDirection } from '$lib/utils/striking-sort';
  import { siteHostname, urlExcluded, urlMatchesMask, type UrlExclusion } from '$lib/utils/url-filters';

  let { data }: { data: PageData } = $props();

  const siteUrl = $derived(data.siteUrl);
  const accId = $derived(data.accId);
  const base = $derived(`/properties/${encodeURIComponent(data.siteUrl)}`);
  const accQ = $derived(`acc=${encodeURIComponent(data.accId)}`);
  const daysHref = (d: number) => `${base}?${accQ}&days=${d}`;

  type Tab = 'overview' | 'keywords' | 'cannibal' | 'ctr' | 'branded' | 'decay' | 'health';
  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'keywords', label: 'Striking Distance' },
    { id: 'cannibal', label: 'Cannibalization' },
    { id: 'ctr', label: 'CTR Benchmark' },
    { id: 'branded', label: 'Branded' },
    { id: 'decay', label: 'Decay' },
    { id: 'health', label: 'Health' }
  ];
  let tab = $state<Tab>(untrack(() => data.viewSettings.tab as Tab));
  let strikingSort = $state<StrikingSortKey>(untrack(() => data.viewSettings.sort));
  let strikingDir = $state<SortDirection>(untrack(() => data.viewSettings.dir));
  let viewSaveError = $state('');
  let viewWrites = Promise.resolve();
  function saveView(patch: Record<string, unknown>) {
    const endpoint = `${base}/view-settings`;
    viewWrites = viewWrites.then(async () => {
      try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        viewSaveError = '';
      } catch (e) { viewSaveError = `Не удалось сохранить настройки: ${(e as Error).message}`; }
    });
  }
  function sortBy(key: StrikingSortKey) {
    if (strikingSort === key) strikingDir = strikingDir === 'asc' ? 'desc' : 'asc';
    else {
      strikingSort = key;
      strikingDir = ['query', 'page', 'position', 'serp'].includes(key) ? 'asc' : 'desc';
    }
    saveView({ sort: strikingSort, dir: strikingDir });
  }
  const sortArrow = (key: StrikingSortKey): SortDirection | '' => strikingSort === key ? strikingDir : '';
  const sortAria = (key: StrikingSortKey): 'ascending' | 'descending' | 'none' => strikingSort !== key ? 'none' : strikingDir === 'asc' ? 'ascending' : 'descending';

  // ── MagicLinks: покупка ссылок на пару «запрос + страница» ──
  type PurchaseSummary = {
    targetUrl: string;
    query: string;
    quantity: number;
    lastAt: number;
    orders: { orderId: string; quantity: number; createdAt: number }[];
  };
  const pairKey = (page: string, query: string) => `${page}\n${query}`;
  const siteHost = $derived(siteHostname(data.siteUrl));

  let purchases = $state<Record<string, PurchaseSummary>>({});
  // Своя копия истории: после покупки обновляем её на месте, а при смене
  // данных страницы (другой период, другой сайт, перезагрузка) берём серверную
  // заново — иначе на соседней странице осталась бы чужая история.
  $effect(() => {
    purchases = { ...(data.purchases ?? {}) };
  });
  let selectedPairs = $state<Set<string>>(new Set());
  let buyRows = $state<{ targetUrl: string; query: string; siteHost: string }[] | null>(null);
  let historyOpen = $state<string | null>(null);

  const boughtFor = (page: string, query: string) => purchases[pairKey(page, query)];
  const dayfmt = (ms: number) =>
    new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

  function togglePair(page: string, query: string) {
    const k = pairKey(page, query);
    const next = new Set(selectedPairs);
    next.has(k) ? next.delete(k) : next.add(k);
    selectedPairs = next;
  }

  function buyOne(page: string, query: string) {
    buyRows = [{ targetUrl: page, query, siteHost }];
  }

  function buySelected(rows: { page: string; query: string }[]) {
    const seen = new Set<string>();
    const out: { targetUrl: string; query: string; siteHost: string }[] = [];
    for (const r of rows) {
      const k = pairKey(r.page, r.query);
      if (!selectedPairs.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push({ targetUrl: r.page, query: r.query, siteHost });
    }
    buyRows = out;
  }

  function applyBought(e: { orderId: string; items: { targetUrl: string; query: string; quantity: number }[] }) {
    const now = Date.now();
    const next = { ...purchases };
    for (const it of e.items) {
      const k = pairKey(it.targetUrl, it.query);
      const cur = next[k];
      next[k] = {
        targetUrl: it.targetUrl,
        query: it.query,
        quantity: (cur?.quantity ?? 0) + it.quantity,
        lastAt: now,
        orders: [...(cur?.orders ?? []), { orderId: e.orderId, quantity: it.quantity, createdAt: now }]
      };
    }
    purchases = next;
    selectedPairs = new Set();
    void invalidateAll(); // Refresh the purchase marker and order history immediately.
  }

  let analytics = $state<any>(null);
  let serpPositions = $state<Map<string, number | null>>(new Map());
  let serpAsked = $state<Set<string>>(new Set());
  let urlMask = $state('');
  let urlMode = $state('contains');
  let appliedMask = $state('');
  let appliedMode = $state('contains');
  let exclusionInput = $state('');
  let exclusionKind = $state<'mask' | 'not_contains'>('mask');
  let exclusions = $state<UrlExclusion[]>([]);
  let exclusionBusy = $state(false);
  let exclusionError = $state('');
  $effect(() => { exclusions = [...data.urlExclusions]; });
  const filteredStrikingRows = $derived((analytics?.striking ?? []).filter((r: { page: string }) =>
    !urlExcluded(r.page, exclusions) && (!appliedMask ||
      (appliedMode === 'contains' ? urlMatchesMask(r.page, appliedMask) : !urlMatchesMask(r.page, appliedMask)))
  ));
  const strikingRows = $derived(sortStriking(filteredStrikingRows, strikingSort, strikingDir,
    (query) => serpAsked.has(query) ? serpPositions.get(query) ?? null : null,
    (page, query) => boughtFor(page, query)?.quantity ?? 0
  ));
  const selectedVisible = $derived(strikingRows.filter((r: { page: string; query: string }) => selectedPairs.has(pairKey(r.page, r.query))).length);

  async function filterUrls() {
    if (analyticsLoading) return;
    appliedMask = urlMask.trim();
    appliedMode = urlMode;
    selectedPairs = new Set();
    analytics = null;
    await loadAnalytics();
  }

  async function updateExclusions(method: 'POST' | 'DELETE', body: unknown) {
    if (exclusionBusy) return;
    exclusionBusy = true;
    exclusionError = '';
    try {
      const res = await fetch(`${base}/url-exclusions`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message ?? `HTTP ${res.status}`);
      exclusions = result.exclusions;
      exclusionInput = '';
      selectedPairs = new Set();
      analytics = null;
      await loadAnalytics();
      await invalidateAll();
    } catch (e) { exclusionError = (e as Error).message; }
    finally { exclusionBusy = false; }
  }

  let customOpen = $state(false);

  // ── formatting helpers ──
  const nf = new Intl.NumberFormat('en-US');
  const fmt = (n: number) => nf.format(Math.round(n));
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const pos = (x: number) => x.toFixed(1);
  const shortUrl = (u: string) => u.replace(/^https?:\/\/[^/]+/, '') || '/';
  // Live, not cached: stamp the moment this page's data arrived.
  const fetchedAt = $derived.by(() => {
    void data;
    return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  });
  const signedPct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)}%`;

  // Refresh drops the GSC cache, then re-runs the page load and keeps the URL state.
  let refreshing = $state(false);
  async function refresh() {
    refreshing = true;
    analytics = null;
    decay = null;
    try {
      // A failed drop is not fatal: the reload still runs, just maybe on cached numbers.
      try { await fetch('/cache/clear', { method: 'POST' }); } catch { /* fall through */ }
      await invalidateAll();
      loadAnalytics();
      if (tab === 'decay') loadDecay();
    } finally {
      refreshing = false;
    }
  }

  function tabCount(t: Tab): number | null {
    if (t === 'keywords') return analytics ? strikingRows.length : null;
    if (t === 'cannibal') return analytics?.cannibalization?.length ?? null;
    if (t === 'ctr') return analytics?.ctr?.opportunities?.length ?? null;
    if (t === 'decay') return decay?.decay?.length ?? null;
    return null;
  }

  // ── site events: custom chart markers (domain merges etc.) ──
  let evDate = $state(new Date().toISOString().slice(0, 10));
  let evNote = $state('');
  let evType = $state('merge');
  let evSaving = $state(false);
  let evError = $state<string | null>(null);

  async function addEvent() {
    const note = evNote.trim();
    if (!note || evSaving) return;
    evSaving = true;
    evError = null;
    try {
      const res = await fetch('/properties/site-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: siteUrl, date: evDate, note, type: evType })
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? `HTTP ${res.status}`);
      }
      evNote = '';
      await invalidateAll(); // chart + chips re-render from the fresh load
    } catch (e) {
      evError = (e as Error).message;
    } finally {
      evSaving = false;
    }
  }

  async function removeEvent(id: number) {
    if (evSaving) return;
    evSaving = true;
    evError = null;
    try {
      const res = await fetch('/properties/site-events', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await invalidateAll();
    } catch (e) {
      evError = (e as Error).message;
    } finally {
      evSaving = false;
    }
  }

  // ── SERP-монитор: реальная позиция рядом со средней из GSC ──
  // Гео берём у самого серпмонитора: property его не содержит, а угадывать
  // страну значит молча показать позиции другого рынка.
  type SerpBinding = { geo: string; project_id: number; name: string; keywords: number; checked_at: string | null };
  let serpBindings = $state<SerpBinding[]>([]);
  let serpGeo = $state('');
  let serpCheckedAt = $state<string | null>(null);
  let serpNote = $state('');
  // off — интеграция не настроена, absent — спросили и сайта нет,
  // error — спросить не удалось. Последнее НЕ равно «не на мониторинге».
  let serpState = $state<'off' | 'ok' | 'absent' | 'error'>('off');
  let serpReason = $state<string | null>(null);
  // Запросы, которые мы РЕАЛЬНО спросили у серпмонитора. Остальные строки
  // обязаны говорить «не спрашивали», а не показывать прочерк: прочерк
  // читается как «позиции нет», и это разные вещи.

  // A configured monitor with bindings earns the top of the rail; otherwise it sinks.
  const serpActive = $derived(serpState === 'ok' && serpBindings.length > 0);

  let serpRequest = 0;
  async function loadSerp(geo = '') {
    const requestId = ++serpRequest;
    serpPositions = new Map();
    const params = new URLSearchParams();
    if (geo) params.set('geo', geo);
    // Просим позиции для показанных запросов. Потолок тот же, что у клиента
    // (500): всё, что за ним, помечается «не спрашивали».
    const shown: string[] = [
      ...new Set(((analytics?.striking ?? []) as { query: string }[]).map((r) => r.query))
    ];
    const asked = shown.slice(0, 500);
    serpAsked = new Set(asked);
    for (const q of asked) params.append('q', q);
    const res = await fetch(`${base}/serp?${params.toString()}`);
    if (requestId !== serpRequest) return;
    if (!res.ok) {
      serpState = 'error';
      serpReason = `HTTP ${res.status}`;
      return;
    }
    const data = await res.json();
    if (requestId !== serpRequest) return;
    serpState = data.state ?? 'error';
    serpReason = data.reason ?? null;
    serpBindings = data.bindings ?? [];
    serpGeo = data.geo ?? '';
    serpCheckedAt = data.positions?.checked_at ?? null;
    serpPositions = new Map(
      (data.positions?.rows ?? []).map((r: { query: string; position: number | null }) => [r.query, r.position])
    );
  }

  async function askCheck() {
    if (!serpGeo) return;
    serpNote = '…';
    const res = await fetch(`${base}/serp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ geo: serpGeo })
    });
    const data = await res.json();
    serpNote =
      data.status === 'queued' ? 'проверка поставлена в очередь'
      : data.status === 'already_active' ? 'проверка уже идёт'
      : data.status === 'unavailable' ? 'серпмонитор недоступен'
      : String(data.status ?? '');
  }

  $effect(() => {
    if (siteUrl) loadSerp();
  });

  // ── shared analytics payload (one GSC fetch feeds 4 tabs) ──
  let analyticsErr = $state<string | null>(null);
  let analyticsLoading = $state(false);
  async function loadAnalytics() {
    if (analytics || analyticsLoading) return;
    analyticsLoading = true;
    analyticsErr = null;
    try {
      const r = await fetch(`${base}/analytics?${accQ}&days=${data.days}&urlMask=${encodeURIComponent(appliedMask)}&urlMode=${appliedMode}`);
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      analytics = await r.json();
      brandInput = (analytics.brandedTerms ?? []).join(', ');
    } catch (e) {
      analyticsErr = (e as Error).message;
    } finally {
      analyticsLoading = false;
    }
  }
  // Eager: one call, populates Keywords/Cannibalization/CTR/Branded.
  $effect(() => {
    loadAnalytics();
  });

  // Смена периода наверху страницы — это навигация по тому же роуту: компонент
  // остаётся, и без сброса вкладки продолжали бы показывать прежние 28 дней.
  let lastSite = untrack(() => `${data.siteUrl}|${data.accId}`);
  let lastDays = untrack(() => data.days);
  $effect(() => {
    if (`${data.siteUrl}|${data.accId}` !== lastSite) {
      lastSite = `${data.siteUrl}|${data.accId}`;
      tab = data.viewSettings.tab as Tab; strikingSort = data.viewSettings.sort; strikingDir = data.viewSettings.dir; viewSaveError = '';
      urlMask = ''; appliedMask = ''; urlMode = 'contains'; appliedMode = 'contains';
      exclusionInput = ''; exclusionError = '';
      customOpen = false; selectedPairs = new Set(); buyRows = null;
      lastDays = -1;
    }
    if (data.days === lastDays) return;
    lastDays = data.days;
    analytics = null;
    analyticsErr = null;
    decay = null;
    decayErr = null;
    loadAnalytics();
    if (tab === 'decay') loadDecay();
  });

  // ── decay (lazy) ──
  let decay = $state<any>(null);
  let decayErr = $state<string | null>(null);
  let decayLoading = $state(false);
  async function loadDecay() {
    if (decay || decayLoading) return;
    decayLoading = true;
    decayErr = null;
    try {
      const r = await fetch(`${base}/decay?${accQ}&days=${data.days}`);
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      decay = await r.json();
    } catch (e) {
      decayErr = (e as Error).message;
    } finally {
      decayLoading = false;
    }
  }

  // ── health (lazy GET cache; POST re-check) ──
  let health = $state<any>(null);
  let healthErr = $state<string | null>(null);
  let healthLoading = $state(false);
  async function loadHealth() {
    if (health || healthLoading) return;
    healthLoading = true;
    try {
      const r = await fetch(`${base}/health`);
      health = await r.json();
    } catch (e) {
      healthErr = (e as Error).message;
    } finally {
      healthLoading = false;
    }
  }
  async function runHealth() {
    healthLoading = true;
    healthErr = null;
    try {
      const r = await fetch(`${base}/health`, { method: 'POST' });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      health = await r.json();
    } catch (e) {
      healthErr = (e as Error).message;
    } finally {
      healthLoading = false;
    }
  }

  function openTab(t: Tab) {
    tab = t;
    saveView({ tab: t });
    if (t === 'decay') loadDecay();
    if (t === 'health') loadHealth();
  }

  // ── branded terms editor ──
  let brandInput = $state((data.brandedTerms ?? []).join(', '));

  const shortTerms = $derived(
    brandInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length <= SHORT_TERM_MAX)
  );
  let brandSaving = $state(false);
  async function saveBrand() {
    brandSaving = true;
    try {
      const terms = brandInput.split(',').map((s) => s.trim()).filter(Boolean);
      const r = await fetch(`${base}/branded`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms })
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      brandInput = (j.brandedTerms ?? []).join(', ');
      // Force branded split to recompute with the new terms.
      analytics = null;
      await loadAnalytics();
    } finally {
      brandSaving = false;
    }
  }

  const ageText = (ts: number | null) => {
    if (!ts) return 'never';
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };
</script>

<svelte:head><title>{siteUrl} · gsc-hub</title></svelte:head>

{#snippet serpCell(query: string)}
  <td class="num app-num {serpPositions.get(query) ? 'text-ink' : 'text-ink-4'}"
      title={serpState === 'error'
        ? 'SERP-монитор не ответил — позиция неизвестна'
        : serpState === 'ok' && !serpAsked.has(query)
          ? 'не спрашивали: запросов на экране больше, чем помещается в один запрос'
          : serpCheckedAt
            ? `измерено ${serpCheckedAt}`
            : 'сайт не на мониторинге'}>
    {serpState === 'error'
      ? '?'
      : serpState === 'ok' && !serpAsked.has(query)
        ? '·'
        : (serpPositions.get(query) ?? '—')}
  </td>
{/snippet}

{#snippet serpPane()}
      <section class="pane">
  <div class="pane-head">SERP monitor
    {#if serpState === 'ok' && serpBindings.length > 0}
      <button class="btn btn-sec btn-sm normal-case tracking-normal" onclick={askCheck}>Проверить</button>
    {/if}
  </div>
  <div class="pane-body text-[12.5px]">
    {#if serpState === 'error'}
      <p class="text-dn">Не ответил{serpReason ? ` (${serpReason})` : ''} — состояние мониторинга неизвестно</p>
    {:else if serpState === 'off'}
      <p class="text-ink-3">Интеграция не настроена</p>
    {:else if serpBindings.length === 0}
      <p class="text-ink-3">Сайт не на мониторинге</p>
    {:else}
      <div class="mb-2 flex flex-wrap gap-1">
        {#each serpBindings as b (b.geo)}
          <button
            class="btn btn-sm {b.geo === serpGeo ? 'bg-acc-t text-acc' : 'btn-sec'}"
            aria-pressed={b.geo === serpGeo}
            onclick={() => loadSerp(b.geo)}
          >{b.geo.toUpperCase()} <span class="app-num font-normal">{b.keywords}</span></button>
        {/each}
      </div>
      <p class="text-xs text-ink-3">
        {serpCheckedAt ? `последняя проверка ${serpCheckedAt.slice(0, 10)}` : 'проверок ещё не было'}{#if serpNote} · {serpNote}{/if}
      </p>
    {/if}
  </div>
</section>
{/snippet}

<main class="page">
  <div class="desk xl:grid-cols-[minmax(0,1fr)_300px]">
    <!-- ── centre: symbol, chart, tabs ── -->
    <div class="desk-col">
      <section class="pane">
        <div class="symbol border-b border-line px-4 py-3">
          <div class="w-full min-w-0 sm:w-auto">
            <div class="app-breadcrumbs mb-0.5">
              <a href={`/dashboard?days=${data.days}`}>Dashboard</a><span aria-hidden="true">/</span><a href="/properties">Sites</a>
            </div>
            <h1 class="symbol-name pii truncate">{siteHost}</h1>
            <div class="symbol-sub pii">{data.account.label ?? data.account.email}{siteUrl.startsWith('sc-domain:') ? ' · domain property' : ''} · <span class="font-mono" title="Данные получены из GSC в это время">live {fetchedAt}</span></div>
          </div>
          {#if data.daily}
            <div class="grid grid-cols-2 gap-y-2 sm:flex sm:gap-x-5">
            <div class="stat"><span class="stat-label">Clicks · {data.days}d</span><span class="stat-value pii">{fmt(data.daily.clicks)}</span></div>
            <div class="stat"><span class="stat-label">Impressions</span><span class="stat-value pii">{fmt(data.daily.impressions)}</span></div>
            <div class="stat"><span class="stat-label">CTR</span><span class="stat-value pii">{pct(data.daily.ctr)}</span></div>
            <div class="stat"><span class="stat-label">Avg position</span><span class="stat-value pii">{pos(data.daily.position)}</span></div>
            </div>
          {/if}
          <div class="ml-auto flex items-center gap-2">
            <button class="btn btn-sec" onclick={() => indexingOpen = true}>Индексация</button>
            <button class="btn btn-pri" onclick={() => { buyRows = null; customOpen = true; }}>Купить на свой URL</button>
            <a class="btn btn-ghost" href={siteUrl.startsWith('sc-domain:') ? `https://${siteHost}/` : siteUrl} target="_blank" rel="noopener noreferrer" title="Открыть сайт">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7 9"/></svg>Open
            </a>
            <button class="btn btn-sec" onclick={refresh} disabled={refreshing}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" class:animate-spin={refreshing}><path d="M13.5 8A5.5 5.5 0 1 1 11.8 4M13.5 2v3h-3"/></svg>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
          <div class="app-segmented" aria-label="Period">
            {#each [28, 60, 90, 180, 365, 480] as d}
              <a class:is-active={data.days === d} href={daysHref(d)}>{d === 480 ? '16M' : d === 365 ? '1Y' : `${d}D`}</a>
            {/each}
          </div>
          {#if data.algoSource === 'builtin'}
            <span class="text-[11px] text-ink-3">Update feed unreachable — built-in update list</span>
          {/if}
        </div>

        <div class="px-3 pb-2 pt-2">
          {#if data.dailyError}
            <p class="text-err py-10 text-center">Failed to load: {data.dailyError}</p>
          {:else if data.daily}
            <TrendChart points={data.daily.series} updates={data.algoUpdates} events={data.siteEvents} height={340} />
          {/if}
        </div>
      </section>

      <section class="pane min-w-0">
        <div class="tabs px-2" role="tablist">
          {#each TABS as t (t.id)}
            <button role="tab" aria-selected={tab === t.id} class:is-active={tab === t.id} onclick={() => openTab(t.id)}>
              {t.label}
              {#if tabCount(t.id) != null}<span class="count">{tabCount(t.id)}</span>{/if}
            </button>
          {/each}
        </div>

        <div class="min-w-0">
          {#if tab === 'overview'}
            <div class="grid gap-px bg-line sm:grid-cols-2">
              <div class="bg-pane p-3">
                <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Top striking queries</div>
                {#if analyticsLoading}<p class="loading">Loading…</p>
                {:else if strikingRows.length}
                  <table class="app-table">
                    <thead><tr><th>Query</th><th class="num">Pos</th><th class="num">Impr</th></tr></thead>
                    <tbody>
                      {#each strikingRows.slice(0, 6) as r (r.query + r.page)}
                        <tr><td><span class="pii">{r.query}</span></td><td class="num app-num">{pos(r.position)}</td><td class="num app-num pii">{fmt(r.impressions)}</td></tr>
                      {/each}
                    </tbody>
                  </table>
                  <button class="btn btn-ghost btn-sm mt-1.5 -ml-2" onclick={() => openTab('keywords')}>All {strikingRows.length} <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg></button>
                {:else}<p class="loading">No striking-distance keywords.</p>{/if}
              </div>
              <div class="flex flex-col bg-pane p-3">
                <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">CTR below benchmark</div>
                {#if analyticsLoading}<p class="loading">Loading…</p>
                {:else if analytics?.ctr?.opportunities?.length}
                  <table class="app-table">
                    <thead><tr><th>Query</th><th class="num">Pos</th><th class="num">CTR</th><th class="num">Bench</th></tr></thead>
                    <tbody>
                      {#each analytics.ctr.opportunities.slice(0, 6) as o (o.query + o.page)}
                        <tr><td><span class="pii">{o.query}</span></td><td class="num app-num">{pos(o.position)}</td><td class="num app-num text-dn">{pct(o.ctr)}</td><td class="num app-num text-ink-3">{pct(o.benchmark)}</td></tr>
                      {/each}
                    </tbody>
                  </table>
                  <button class="btn btn-ghost btn-sm mt-1.5 -ml-2 self-start" onclick={() => openTab('ctr')}>All {analytics.ctr.opportunities.length} <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg></button>
                {:else if analytics}<p class="loading">Every query is at or above the benchmark CTR.</p>{/if}

                {#if analytics?.branded}
                  {@const b = analytics.branded}
                  <div class="mt-auto border-t border-line-soft pt-2.5">
                    <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Branded split</div>
                    {#if b.branded.clicks === 0}
                      <p class="text-[12.5px] text-ink-2">No branded clicks — all <b class="app-num pii">{fmt(b.nonBranded.clicks)}</b> are non-branded <span class="text-ink-3">· terms: {(analytics.brandedTerms ?? []).join(', ') || '—'}</span></p>
                    {:else}
                      <div class="mb-1.5 flex h-2 overflow-hidden rounded-sm bg-bg" aria-hidden="true">
                        <div class="bg-acc" style:width="{Math.round(b.brandedPct * 100)}%"></div>
                      </div>
                      <div class="flex justify-between text-[12.5px]">
                        <span><i class="mr-1.5 inline-block h-2 w-2 rounded-sm bg-acc"></i>Branded <b class="app-num pii">{fmt(b.branded.clicks)}</b> <span class="text-ink-3">· {pct(b.brandedPct)}</span></span>
                        <span><i class="mr-1.5 inline-block h-2 w-2 rounded-sm bg-bg ring-1 ring-line"></i>Non-branded <b class="app-num pii">{fmt(b.nonBranded.clicks)}</b></span>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>

          {:else if tab === 'health'}
            <div class="flex items-center gap-2 border-b border-line px-3 py-2">
              <button onclick={runHealth} disabled={healthLoading} class="btn btn-pri btn-sm">
                {healthLoading ? 'Checking…' : 'Check now'}
              </button>
              <span class="text-xs text-ink-3">checked {ageText(health?.checkedAt ?? null)}</span>
            </div>
            <div class="p-3">
              {#if healthErr}<p class="text-err">{healthErr}</p>{/if}
              {#if health?.data}
                {@const d = health.data}
                <div class="grid gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-3">
                  <div class="bg-pane p-3">
                    <div class="stat-label">SSL</div>
                    {#if 'error' in d.ssl}
                      <div class="text-err mt-1">{d.ssl.error}</div>
                    {:else}
                      <div class="mt-1 text-[13px]"><span class="badge {d.ssl.daysLeft < 14 ? 'badge-bad' : 'badge-ok'}">{d.ssl.grade}</span> <span class="app-num">{d.ssl.daysLeft}</span> days left <span class="text-ink-3">· {d.ssl.issuer}</span></div>
                    {/if}
                  </div>
                  <div class="bg-pane p-3">
                    <div class="stat-label">Safe Browsing</div>
                    {#if 'skipped' in d.safeBrowsing}
                      <div class="mt-1 text-[13px] text-ink-3">not configured (no key)</div>
                    {:else if 'error' in d.safeBrowsing}
                      <div class="text-err mt-1">{d.safeBrowsing.error}</div>
                    {:else}
                      <div class="mt-1"><span class="badge {d.safeBrowsing.safe ? 'badge-ok' : 'badge-bad'}">{d.safeBrowsing.safe ? 'clean' : d.safeBrowsing.threats.join(', ')}</span></div>
                    {/if}
                  </div>
                  <div class="bg-pane p-3">
                    <div class="stat-label">Core Web Vitals · mobile</div>
                    {#if 'skipped' in d.cwv}
                      <div class="mt-1 text-[13px] text-ink-3">not configured (no key)</div>
                    {:else if 'error' in d.cwv}
                      <div class="text-err mt-1">{d.cwv.error}</div>
                    {:else}
                      <div class="mt-1 flex flex-wrap gap-x-3 text-[12.5px]">
                        <span>Perf <b class="app-num">{Math.round(d.cwv.score * 100)}</b></span>
                        <span>LCP <b class="app-num">{(d.cwv.lcpMs / 1000).toFixed(1)}s</b></span>
                        <span>CLS <b class="app-num">{d.cwv.cls.toFixed(2)}</b></span>
                        <span>TBT <b class="app-num">{Math.round(d.cwv.tbtMs)}ms</b></span>
                      </div>
                    {/if}
                  </div>
                </div>
              {:else if !healthLoading}
                <p class="loading">No check yet — press “Check now”.</p>
              {/if}
            </div>

          {:else if tab === 'decay'}
            {#if decayLoading}<p class="loading p-3">Loading…</p>{/if}
            {#if decayErr}<p class="text-err p-3">{decayErr}</p>{/if}
            {#if decay}
              {#if decay.decay.length === 0}
                <p class="loading p-3">No decaying pages found — no page lost ≥20% vs the previous period (from ≥20 prior clicks, or ≥50 prior impressions).</p>
              {:else}
                <div class="overflow-x-auto">
                  <table class="app-table">
                    <thead>
                      <tr><th>Page</th><th class="num">Clicks prior → recent</th><th class="num">Δ clicks</th><th class="num">Impr prior → recent</th><th class="num">Δ impr</th></tr>
                    </thead>
                    <tbody>
                      {#each decay.decay as d (d.page)}
                        <tr>
                          <td class="max-w-md truncate"><span class="pii" title={d.page}>{shortUrl(d.page)}</span></td>
                          <td class="num app-num pii">{fmt(d.priorClicks)} → {fmt(d.recentClicks)}</td>
                          <td class="num"><span class="chip {d.deltaClicksPct < 0 ? 'chip-dn' : 'chip-flat'}">{signedPct(d.deltaClicksPct)}</span></td>
                          <td class="num app-num pii">{fmt(d.priorImpressions)} → {fmt(d.recentImpressions)}</td>
                          <td class="num"><span class="chip {d.deltaImprPct < 0 ? 'chip-dn' : 'chip-flat'}">{signedPct(d.deltaImprPct)}</span></td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            {/if}

          {:else}
            <!-- analytics-backed tabs -->
            {#if analyticsLoading}<p class="loading p-3">Loading…</p>{/if}
            {#if analyticsErr}<p class="text-err p-3">{analyticsErr}</p>{/if}
            {#if analytics}
              {#if tab === 'keywords'}
                <div class="border-b border-line p-3 space-y-3">
                  <form class="flex flex-wrap items-center gap-2" onsubmit={(e) => { e.preventDefault(); filterUrls(); }}>
                    <select class="input" bind:value={urlMode} aria-label="Условие фильтра URL"><option value="contains">URL содержит</option><option value="not_contains">URL не содержит</option></select>
                    <input class="input min-w-0 flex-1" bind:value={urlMask} maxlength="2000" placeholder="Часть URL: /b/ или маска */b/*" aria-label="Фильтр URL" />
                    <button class="btn btn-sec" type="submit" disabled={analyticsLoading}>Применить</button>
                    <button class="btn btn-ghost" type="button" onclick={() => { urlMask = ''; filterUrls(); }} disabled={analyticsLoading}>Сбросить</button>
                    <span class="text-xs text-ink-3">Показано {strikingRows.length}</span>
                  </form>
                  {#if viewSaveError}<p class="text-err text-xs" role="alert">{viewSaveError}</p>{/if}
                  <details>
                    <summary class="cursor-pointer text-xs font-medium">Исключения домена ({exclusions.length})</summary>
                    <p class="mt-2 text-xs text-ink-3">Сохраняются для {siteHost}, для всех периодов и Google-аккаунтов. URL, подходящие хотя бы под одно правило исключения, скрываются в Striking Distance. * — любой текст, ? — один символ.</p>
                    <form class="mt-2 flex gap-2" onsubmit={(e) => { e.preventDefault(); updateExclusions('POST', { pattern: exclusionInput, kind: exclusionKind }); }}>
                      <select class="input" bind:value={exclusionKind} aria-label="Условие исключения"><option value="mask">URL содержит</option><option value="not_contains">URL не содержит</option></select>
                      <input class="input min-w-0 flex-1" bind:value={exclusionInput} placeholder="Не показывать URL, содержащие /b/" maxlength="2000" aria-label="Исключаемая часть URL" required />
                      <button class="btn btn-sec" type="submit" disabled={exclusionBusy || !exclusionInput.trim()}>Исключить</button>
                    </form>
                    {#each exclusions as ex (ex.id)}
                      <div class="mt-1 flex items-center gap-2 text-xs"><span class="min-w-0 flex-1 break-all">{ex.kind === 'exact' ? 'Точный URL' : ex.kind === 'not_contains' ? 'URL не содержит' : 'URL содержит'}: {ex.pattern}</span><button class="btn btn-ghost btn-sm" disabled={exclusionBusy} onclick={() => updateExclusions('DELETE', { id: ex.id })}>Удалить</button></div>
                    {/each}
                  </details>
                  {#if exclusionError}<p class="text-err text-xs" role="alert">{exclusionError}</p>{/if}
                </div>
                {#if strikingRows.length === 0}
                  <p class="loading p-3">Нет запросов с учётом фильтра и исключений.</p>
                {:else}
                  <div class="overflow-x-auto">
                    <table class="app-table">
                      <thead>
                        <tr><th class="w-8"></th>
                          <th class="sort-th" aria-sort={sortAria('query')}><button type="button" class="hover:text-ink" onclick={() => sortBy('query')}>Query<SortCaret dir={sortArrow('query')} /></button></th>
                          <th class="sort-th" aria-sort={sortAria('page')}><button type="button" class="hover:text-ink" onclick={() => sortBy('page')}>Page<SortCaret dir={sortArrow('page')} /></button></th>
                          <th class="sort-th num" aria-sort={sortAria('position')}><button type="button" class="hover:text-ink" onclick={() => sortBy('position')}>Pos<SortCaret dir={sortArrow('position')} /></button></th>
                          <th class="sort-th num" aria-sort={sortAria('serp')}><button type="button" class="hover:text-ink" onclick={() => sortBy('serp')}>SERP<SortCaret dir={sortArrow('serp')} /></button></th>
                          <th class="sort-th num" aria-sort={sortAria('impressions')}><button type="button" class="hover:text-ink" onclick={() => sortBy('impressions')}>Impr<SortCaret dir={sortArrow('impressions')} /></button></th>
                          <th class="sort-th num" aria-sort={sortAria('clicks')}><button type="button" class="hover:text-ink" onclick={() => sortBy('clicks')}>Clicks<SortCaret dir={sortArrow('clicks')} /></button></th>
                          <th class="sort-th num" aria-sort={sortAria('ctr')}><button type="button" class="hover:text-ink" onclick={() => sortBy('ctr')}>CTR<SortCaret dir={sortArrow('ctr')} /></button></th>
                          <th class="sort-th num" aria-sort={sortAria('bought')}><button type="button" class="hover:text-ink" onclick={() => sortBy('bought')}>Куплено<SortCaret dir={sortArrow('bought')} /></button></th>
                          <th class="num w-20"></th></tr>
                      </thead>
                      <tbody>
                        {#each strikingRows as r (r.query + r.page)}
                          {@const k = pairKey(r.page, r.query)}
                          <tr class:is-selected={selectedPairs.has(k)}>
                            <td>
                              <input type="checkbox" checked={selectedPairs.has(k)} onchange={() => togglePair(r.page, r.query)} aria-label="Выделить строку" />
                            </td>
                            <td class="font-medium"><span class="pii">{r.query}</span></td>
                            <td class="max-w-xs text-ink-3"><div class="flex items-center gap-1"><span class="pii min-w-0 truncate" title={r.page}>{shortUrl(r.page)}</span><button class="btn btn-ghost btn-sm shrink-0" title="Исключить этот URL для домена" aria-label="Исключить {r.page}" disabled={exclusionBusy} onclick={() => updateExclusions('POST', { pattern: r.page, kind: 'exact' })}>×</button></div></td>
                            <td class="num app-num">{pos(r.position)}</td>
                            {@render serpCell(r.query)}
                            <td class="num app-num pii">{fmt(r.impressions)}</td>
                            <td class="num app-num pii">{fmt(r.clicks)}</td>
                            <td class="num app-num">{pct(r.ctr)}</td>
                            <td class="num whitespace-nowrap">
                              {#if boughtFor(r.page, r.query)}
                                <button
                                  class="chip chip-up hover:brightness-95"
                                  title="Показать заказы по этой связке"
                                  aria-expanded={historyOpen === k}
                                  onclick={() => (historyOpen = historyOpen === k ? null : k)}
                                >{boughtFor(r.page, r.query)!.quantity} шт · {dayfmt(boughtFor(r.page, r.query)!.lastAt)}</button>
                              {:else}
                                <span class="text-ink-4">—</span>
                              {/if}
                            </td>
                            <td class="num">
                              {#if data.magicLinksReady}
                                <button class="btn btn-sec btn-sm" title="Купить ссылки на эту связку" onclick={() => buyOne(r.page, r.query)}>Купить</button>
                              {/if}
                            </td>
                          </tr>
                          {#if historyOpen === k && boughtFor(r.page, r.query)}
                            <tr class="bg-sunk">
                              <td></td>
                              <td colspan="9" class="text-xs">
                                {#each boughtFor(r.page, r.query)!.orders as o (o.orderId)}
                                  <a class="mr-4 text-acc hover:underline"
                                    href="/magiclinks/{o.orderId}?url={encodeURIComponent(r.page)}&q={encodeURIComponent(r.query)}">
                                    <span class="app-num">{o.quantity}</span> шт · {dayfmt(o.createdAt)} · заказ <span class="app-num">{o.orderId.slice(0, 8)}</span>
                                  </a>
                                {/each}
                              </td>
                            </tr>
                          {/if}
                        {/each}
                      </tbody>
                    </table>
                  </div>
                  {#if selectedVisible > 0}
                    <div class="sticky bottom-3 z-20 m-3 flex flex-wrap items-center gap-3 rounded border border-acc/30 bg-pane px-3 py-2 shadow-[0_6px_20px_-6px_rgb(19_23_34/0.25)]">
                      <span class="text-[12.5px]">Выбрано пар: <b class="app-num">{selectedVisible}</b></span>
                      <span class="text-xs text-ink-3">одним заданием; провайдер выбирается в окне покупки</span>
                      <span class="flex-1"></span>
                      <button class="btn btn-ghost" onclick={() => (selectedPairs = new Set())}>Снять выделение</button>
                      {#if data.magicLinksReady}
                        <button class="btn btn-pri" onclick={() => buySelected(strikingRows)}>Купить ссылки</button>
                      {:else}
                        <a class="btn btn-sec" href="/magiclinks">Сначала введи ключ провайдера на MagicLinks</a>
                      {/if}
                    </div>
                  {/if}
                {/if}

              {:else if tab === 'cannibal'}
                {#if analytics.cannibalization.length === 0}
                  <p class="loading p-3">No cannibalization detected.</p>
                {:else}
                  <div class="overflow-x-auto">
                    <table class="app-table">
                      <thead><tr><th>Query / competing pages</th><th class="num">Clicks</th><th class="num">Impr</th><th class="num">Pos</th></tr></thead>
                      {#each analytics.cannibalization as g (g.query)}
                        <tbody>
                          <tr class="bg-sunk hover:bg-sunk">
                            <td colspan="4" class="font-semibold"><span class="pii">{g.query}</span> <span class="ml-1 text-xs font-normal text-ink-3">{g.pages.length} pages</span></td>
                          </tr>
                          {#each g.pages as p, i (p.page)}
                            <tr>
                              <td class="pl-6">
                                <span class="pii {i === 0 ? '' : 'text-ink-2'}">{shortUrl(p.page)}</span>
                                {#if i === 0}<span class="badge badge-acc ml-1.5">leader</span>{/if}
                              </td>
                              <td class="num app-num pii">{fmt(p.clicks)}</td>
                              <td class="num app-num pii text-ink-2">{fmt(p.impressions)}</td>
                              <td class="num app-num text-ink-2">{pos(p.position)}</td>
                            </tr>
                          {/each}
                        </tbody>
                      {/each}
                    </table>
                  </div>
                {/if}

              {:else if tab === 'ctr'}
                <div class="grid gap-px bg-line lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
                  <div class="bg-pane">
                    <div class="pane-head">CTR by position</div>
                    <table class="app-table">
                      <thead><tr><th>Pos</th><th class="num">Your CTR</th><th class="num">Benchmark</th><th class="num">Impr</th></tr></thead>
                      <tbody>
                        {#each analytics.ctr.buckets as b (b.position)}
                          <tr>
                            <td class="app-num">{b.position}</td>
                            <td class="num app-num {b.yourCtr < b.benchmark ? 'text-dn' : 'text-up'}">{pct(b.yourCtr)}</td>
                            <td class="num app-num text-ink-3">{pct(b.benchmark)}</td>
                            <td class="num app-num pii text-ink-3">{fmt(b.impressions)}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                  <div class="min-w-0 bg-pane">
                    <div class="pane-head">Opportunities <span class="aside">below-benchmark CTR</span></div>
                    {#if analytics.ctr.opportunities.length === 0}
                      <p class="loading p-3">None.</p>
                    {:else}
                      <div class="overflow-x-auto">
                        <table class="app-table">
                          <thead><tr><th>Query</th><th>Page</th><th class="num">Pos</th><th class="num">Impr</th><th class="num">CTR</th><th class="num">Bench</th></tr></thead>
                          <tbody>
                            {#each analytics.ctr.opportunities as o (o.query + o.page)}
                              <tr>
                                <td><span class="pii">{o.query}</span></td>
                                <td class="max-w-xs truncate text-ink-3"><span class="pii">{shortUrl(o.page)}</span></td>
                                <td class="num app-num">{pos(o.position)}</td>
                                <td class="num app-num pii">{fmt(o.impressions)}</td>
                                <td class="num app-num text-dn">{pct(o.ctr)}</td>
                                <td class="num app-num text-ink-3">{pct(o.benchmark)}</td>
                              </tr>
                            {/each}
                          </tbody>
                        </table>
                      </div>
                    {/if}
                  </div>
                </div>

              {:else if tab === 'branded'}
                {@const b = analytics.branded}
                <div class="p-3">
                  <div class="mb-3 flex h-2.5 max-w-xl overflow-hidden rounded-sm bg-bg" aria-hidden="true">
                    <div class="bg-acc" style:width="{Math.round(b.brandedPct * 100)}%"></div>
                  </div>
                  <div class="grid max-w-xl grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line">
                    <div class="bg-pane p-3">
                      <div class="stat-label">Branded · {pct(b.brandedPct)}</div>
                      <div class="stat-value pii">{fmt(b.branded.clicks)} <span class="text-xs font-normal text-ink-3">clicks</span></div>
                      <div class="app-num pii text-ink-3">{fmt(b.branded.impressions)} impr</div>
                    </div>
                    <div class="bg-pane p-3">
                      <div class="stat-label">Non-branded</div>
                      <div class="stat-value pii">{fmt(b.nonBranded.clicks)} <span class="text-xs font-normal text-ink-3">clicks</span></div>
                      <div class="app-num pii text-ink-3">{fmt(b.nonBranded.impressions)} impr</div>
                    </div>
                  </div>
                  <p class="mt-2 text-xs text-ink-3">Terms: {(analytics.brandedTerms ?? []).join(', ')} — edit in the Brand terms panel.</p>
                </div>
              {/if}
            {/if}
          {/if}
        </div>
      </section>
    </div>

    <!-- ── right rail: monitor, events, brand terms ── -->
    <aside class="desk-col">
      {#if serpActive}{@render serpPane()}{/if}

      <section class="pane">
        <div class="pane-head">Site events <span class="aside">{data.eventRows.length}</span></div>
        {#if data.eventRows.length > 0}
          <ul class="divide-y divide-line-soft border-b border-line">
            {#each data.eventRows as ev (ev.id)}
              <li class="group flex items-center gap-2 px-3 py-1.5 text-[12.5px]">
                <span class="inline-block h-2 w-2 shrink-0 rotate-45 rounded-[1px]" style:background={data.eventTypes[ev.type]?.color ?? 'rgb(var(--ink-3))'}></span>
                <span class="app-num shrink-0 text-ink-3">{ev.date.slice(5).split('-').reverse().join('.')}</span>
                {#if ev.orderHref}
                  <a class="min-w-0 flex-1 truncate font-medium hover:underline" href={ev.orderHref} title="{ev.note} · открыть заказ">{ev.note}</a>
                {:else}
                  <span class="min-w-0 flex-1 truncate font-medium pii" title={ev.note}>{ev.note}</span>
                {/if}
                {#if !ev.orderHref}
                <button
                  type="button"
                  class="btn btn-ghost btn-sm btn-icon text-ink-4 opacity-0 hover:text-dn focus:opacity-100 group-hover:opacity-100"
                  title="Delete event"
                  aria-label="Delete event {ev.note}"
                  onclick={() => removeEvent(ev.id)}
                ><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
        <div class="pane-body flex flex-col gap-2">
          <div class="flex gap-2">
            <input type="date" bind:value={evDate} required class="input app-num w-[8.5rem]" title="Event date" />
            <select bind:value={evType} class="input min-w-0 flex-1">
              {#each Object.entries(data.eventTypes) as [id, t] (id)}
                {#if id === 'merge'}<option value={id}>{t.label}</option>{/if}
              {/each}
            </select>
          </div>
          <div class="flex gap-2">
            <input
              bind:value={evNote}
              placeholder="← donordomain.com"
              class="input min-w-0 flex-1"
              onkeydown={(e) => { if (e.key === 'Enter') addEvent(); }}
            />
            <button type="button" onclick={addEvent} disabled={evSaving || !evNote.trim()} class="btn btn-pri">{evSaving ? '…' : 'Add'}</button>
          </div>
          {#if evError}<p class="text-err text-xs">{evError}</p>{/if}
          <p class="text-[11px] text-ink-3">Покупки автоматически из <a href="/magiclinks" class="hover:underline">Magiclinks</a>, по дате заказа. Маркеры видны также на дашборде и в portfolio pulse.</p>
        </div>
      </section>

      <section class="pane">
        <div class="pane-head">Brand terms</div>
        <div class="pane-body flex flex-col gap-2">
          <div class="flex gap-2">
            <input bind:value={brandInput} placeholder="ikea, ikea chair" class="input min-w-0 flex-1" />
            <button onclick={saveBrand} disabled={brandSaving} class="btn btn-sec">{brandSaving ? 'Saving…' : 'Save'}</button>
          </div>
          <p class="text-[11px] text-ink-3">Через запятую. Пусто — термин по домену.</p>
          {#if shortTerms.length > 0}
            <p class="notice notice-warn text-xs">
              {shortTerms.map((t) => `“${t}”`).join(', ')}
              {shortTerms.length === 1 ? 'is' : 'are'} matched as whole words only —
              a term this short would otherwise appear inside ordinary ones.
            </p>
          {/if}
        </div>
      </section>
      {#if !serpActive}{@render serpPane()}{/if}
    </aside>
  </div>

  {#if buyRows || customOpen}
    <BuyLinks rows={buyRows ?? []} customSite={customOpen ? siteUrl : undefined} onclose={() => { buyRows = null; customOpen = false; }} onbought={applyBought} />
  {/if}
</main>

{#if indexingOpen}<IndexingModal site={data.siteUrl} onclose={() => indexingOpen = false} />{/if}
