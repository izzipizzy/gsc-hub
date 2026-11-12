<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import IndexSitePicker from '$lib/components/IndexSitePicker.svelte';
  import CopyNotFoundUrls from '$lib/components/CopyNotFoundUrls.svelte';
  import { displaySite } from '$lib/utils/site';
  import { INDEX_CHECK_PROVIDERS, INDEX_CHECK_STATUS, indexCheckCounts,
    type IndexCheckBatch, type IndexCheckProvider, type IndexCheckDraft, type IndexCheckRun, type IndexCheckHistoryPage } from '$lib/utils/index-check';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let selection = $state<string[]>(untrack(() => data.initialSelection ? [data.initialSelection] : []));
  let sitemap = $state('');
  let provider = $state<IndexCheckProvider>(untrack(() => data.providers.find((p) => p.configured)?.id ?? 'xmlriver'));
  let restoreId = $state<string | null>(untrack(() => page.url.searchParams.get('run')));
  let drafts = $state<IndexCheckDraft[]>([]);
  const draft = $derived(drafts[0] ?? null);
  let batch = $state<IndexCheckBatch | null>(null);
  let restoreBatchId = $state<string | null>(untrack(() => page.url.searchParams.get('batch')));
  let batchView = $state<string | null>(untrack(() => page.url.searchParams.get('batch') ? page.url.searchParams.get('run') : null));
  let prepareErrors = $state<{ site: string; message: string }[]>([]);
  let preparedCount = $state(0);
  const totalDraftUrls = $derived(drafts.reduce((n, d) => n + d.urls.length, 0));
  let run = $state<IndexCheckRun | null>(null);
  let busy = $state(false);
  let message = $state('');
  let pollError = $state('');
  let status = $state('');
  let resultPage = $state(0);
  let history = $state<IndexCheckHistoryPage>(untrack(() => data.history));
  let historyError = $state('');
  let historyBusy = $state(false);
  let historyRequest = 0;
  let clock = $state(Date.now());
  const selectedSites = $derived(data.sites.filter((s) => selection.includes(s.key)));
  const selected = $derived(selectedSites.length === 1 ? selectedSites[0] : undefined);
  const executionOptions = $derived({ concurrency: data.providers.find((p) => p.id === provider)?.options.find((o) => o.option === 'concurrency')?.value ?? (provider === 'xmlriver' ? 10 : 1), retries: data.providers.find((p) => p.id === provider)?.options.find((o) => o.option === 'retries')?.value ?? 3, retryDelayMinutes: data.providers.find((p) => p.id === provider)?.options.find((o) => o.option === 'retryDelayMinutes')?.value ?? 3 });
  const configured = $derived(data.providers.find((p) => p.id === provider)?.configured ?? false);
  const running = $derived(['running', 'queued'].includes(batch?.state ?? run?.state ?? ''));
  const counts = $derived(run ? indexCheckCounts(run.rows) : null);
  const nextRetryAt = $derived(run ? Math.min(...run.rows.filter((r) => r.status === 'retrying' && r.nextAttemptAt).map((r) => r.nextAttemptAt!)) : Infinity);
  const retryWait = $derived(Number.isFinite(nextRetryAt) ? Math.max(0, Math.ceil((nextRetryAt - clock) / 1000)) : 0);
  const processed = $derived(counts ? counts.completed + counts.skipped : 0);
  const validChecked = $derived(counts ? counts.found + counts.not_found : 0);
  const rows = $derived(run ? run.rows.filter((r) => !status || r.status === status) : []);
  const visibleRows = $derived(rows.slice(resultPage * 100, (resultPage + 1) * 100));
  const stateLabels = { queued: 'В очереди', running: 'Идёт проверка', completed: 'Проверка завершена', partial: 'Завершено частично', failed: 'Проверка не удалась', cancelled: 'Проверка остановлена', interrupted: 'Прервана сервером' };
  const fmtTime = (ms: number | null) => ms === null ? '—' : new Date(ms).toLocaleString('ru-RU');
  async function api(body: unknown, timeout = 20_000) {
    const response = await fetch('/index-check/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message ?? `HTTP ${response.status}`);
    return result;
  }
  async function refreshHistory(offset = history.offset) {
    const request = ++historyRequest;
    historyBusy = true;
    const query = new URLSearchParams({ action: 'history', offset: String(offset) });
    if (selected) { query.set('site', selected.site); query.set('account', selected.accountId); }
    try {
      const response = await fetch(`/index-check/api?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? `HTTP ${response.status}`);
      if (request === historyRequest) { history = result.history; historyError = ''; }
    } catch (e) { if (request === historyRequest) historyError = (e as Error).message; }
    finally { if (request === historyRequest) historyBusy = false; }
  }
  function selectionChanged() {
    drafts = []; run = null; batch = null; restoreId = null; restoreBatchId = null; batchView = null;
    message = ''; pollError = ''; prepareErrors = []; preparedCount = 0;
    if (selection.length > 1) sitemap = '';
    refreshHistory(0);
  }
  function applyBatch(result: { batch: IndexCheckBatch; run: IndexCheckRun }) {
    batch = result.batch; run = result.run;
    selection = batch.runs.map((r) => JSON.stringify([r.accountId, r.site]));
    provider = batch.provider;
  }
  async function showBatchRun(id: string) {
    if (busy || !batch) return;
    batchView = id; busy = true; message = '';
    try {
      const response = await fetch(`/index-check/api?action=batch&id=${encodeURIComponent(batch.id)}&run=${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message ?? 'Не удалось открыть результат');
      applyBatch(result);
      const url = new URL(page.url); url.searchParams.set('batch', batch!.id); url.searchParams.set('run', id);
      await goto(url, { replaceState: true, noScroll: true, keepFocus: true });
    } catch (e) { message = (e as Error).message; } finally { busy = false; }
  }
  async function openHistory(id: string) {
    if (batch?.runs.some((r) => r.id === id)) { await showBatchRun(id); return; }
    if (busy || running) return;
    busy = true; message = ''; pollError = '';
    try {
      const response = await fetch(`/index-check/api?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? `HTTP ${response.status}`);
      run = result.run; restoreId = id; drafts = []; status = ''; resultPage = 0; batch = null; restoreBatchId = null; batchView = null;
      selection = [JSON.stringify([run!.accountId, run!.site])]; provider = run!.provider;
      const url = new URL(page.url); url.searchParams.set('run', id); url.searchParams.delete('batch');
      url.searchParams.set('site', run!.site); url.searchParams.set('account', run!.accountId);
      await goto(url, { replaceState: true, noScroll: true, keepFocus: true });
      await refreshHistory(0);
    } catch (e) { message = (e as Error).message; }
    finally { busy = false; }
  }
  async function prepare() {
    if (!selectedSites.length || busy || running) return;
    const targets = [...selectedSites];
    busy = true; message = ''; pollError = ''; restoreId = null; restoreBatchId = null; batch = null; batchView = null; drafts = []; run = null; status = ''; resultPage = 0; prepareErrors = []; preparedCount = 0;
    try {
      for (let i = 0; i < targets.length; i += 2) {
        const group = targets.slice(i, i + 2);
        const results = await Promise.allSettled(group.map(async (target) => {
          try { return (await api({ action: 'prepare', site: target.site, accountId: target.accountId, sitemap: targets.length === 1 ? sitemap : '' }, 150_000)).draft as IndexCheckDraft; }
          finally { preparedCount++; }
        }));
        results.forEach((result, j) => {
          if (result.status === 'fulfilled') drafts = [...drafts, result.value];
          else prepareErrors = [...prepareErrors, { site: group[j].site, message: (result.reason as Error).message }];
        });
      }
      const url = new URL(page.url); url.searchParams.delete('run'); url.searchParams.delete('batch');
      if (targets.length === 1) { url.searchParams.set('site', targets[0].site); url.searchParams.set('account', targets[0].accountId); }
      else { url.searchParams.delete('site'); url.searchParams.delete('account'); }
      await goto(url, { replaceState: true, noScroll: true, keepFocus: true });
      await refreshHistory(0);
    } catch (e) { message = (e as Error).message; }
    finally { busy = false; }
  }
  async function start() {
    if (!drafts.length || prepareErrors.length || !configured || busy || running) return;
    busy = true; message = ''; pollError = ''; status = ''; resultPage = 0;
    try {
      const result = await api(drafts.length === 1
        ? { action: 'start', draftId: drafts[0].id, provider, confirmed: true, expectedOptions: executionOptions }
        : { action: 'startBatch', draftIds: drafts.map((d) => d.id), provider, confirmed: true, expectedOptions: executionOptions });
      run = result.run;
      const url = new URL(page.url);
      if (result.batch) { applyBatch(result); restoreBatchId = result.batch.id; batchView = null; restoreId = null; url.searchParams.set('batch', result.batch.id); url.searchParams.delete('run'); }
      else { restoreId = run!.id; url.searchParams.set('run', run!.id); url.searchParams.delete('batch'); }
      drafts = [];
      await goto(url, { replaceState: true, noScroll: true, keepFocus: true });
      await refreshHistory(0);
    } catch (e) { message = (e as Error).message; }
    finally { busy = false; }
  }
  async function cancel() {
    if (!run || busy) return;
    busy = true; message = '';
    try {
      if (batch) batch = (await api({ action: 'cancelBatch', id: batch.id })).batch;
      else run = (await api({ action: 'cancel', id: run.id })).run;
    } catch (e) { message = (e as Error).message; }
    finally { busy = false; }
  }
  onMount(() => {
    const tick = setInterval(() => { clock = Date.now(); }, 1000);
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      const batchId = batch?.id ?? restoreBatchId;
      const id = run?.id ?? restoreId;
      if (batchId && (batch === null || ['running', 'queued'].includes(batch.state))) {
        const view = batchView;
        try {
          const query = new URLSearchParams({ action: 'batch', id: batchId }); if (view) query.set('run', view);
          const response = await fetch(`/index-check/api?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
          const result = await response.json(); if (!response.ok) throw new Error(result.message ?? 'Не удалось получить очередь');
          if (stopped) return;
          if (batchId !== (batch?.id ?? restoreBatchId) || view !== batchView) { timer = setTimeout(poll, 1500); return; }
          applyBatch(result); pollError = ''; await refreshHistory();
        } catch (e) { if (!stopped) pollError = (e as Error).message; }
      } else if (!batchId && id && (run === null || ['running', 'queued'].includes(run.state))) {
        try {
          const response = await fetch(`/index-check/api?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
          const result = await response.json().catch(() => ({}));
          if (response.status === 404) { restoreId = null; run = null; }
          if (!response.ok) throw new Error(result.message ?? `HTTP ${response.status}`);
          if (stopped) return;
          if (id === (run?.id ?? restoreId)) {
            if (!result.run) throw new Error('Не удалось получить состояние проверки; обнови страницу или войди заново');
            run = result.run; selection = [JSON.stringify([run!.accountId, run!.site])]; provider = run!.provider; pollError = ''; await refreshHistory();
          }
        } catch (e) { if (!stopped) pollError = (e as Error).message; }
      }
      if (!stopped) timer = setTimeout(poll, 1500);
    }
    poll();
    return () => { stopped = true; clearTimeout(timer); clearInterval(tick); };
  });
</script>
<svelte:head><title>Проверка индексации · gsc-hub</title></svelte:head>
<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs"><a href="/properties">Sites</a><span aria-hidden="true">/</span><span>Проверка индексации</span></nav>
      <h1 class="app-pagetitle">Проверка индексации</h1>
      <p class="text-xs text-ink-3">URL из sitemap: поиск точного адреса через XML River или DataForSEO.</p>
    </div>
    <div class="app-toolbar-right"><a href="/settings/integrations" class="btn btn-sec">Настройки сервисов</a></div>
  </header>
  {#if data.errors.length}<div class="app-errors">Не удалось получить сайты из {data.errors.length} аккаунтов. Переподключи их в <a href="/" class="underline">Accounts</a>.</div>{/if}
  {#if message}<p class="app-errors" role="alert">{message}</p>{/if}
  <div class="desk">
    <section class="pane">
      <div class="pane-head">Сайт и страницы</div>
      <form class="pane-body grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end" onsubmit={(event) => { event.preventDefault(); prepare(); }}>
        <IndexSitePicker sites={data.sites} bind:value={selection} disabled={busy || running} onchange={selectionChanged} />
        <label class="grid min-w-0 gap-1 text-xs text-ink-2"><span>Sitemap URL <span class="text-ink-3">· необязательно</span></span>
          <input class="input pii w-full" bind:value={sitemap} placeholder={selectedSites.length > 1 ? 'Автоматически для каждого сайта' : 'Автоматически: GSC и robots.txt'} disabled={busy || running || selectedSites.length > 1} maxlength="2000" oninput={() => { drafts = []; }} />
        </label>
        <button class="btn btn-sec" disabled={!selectedSites.length || busy || running}>{busy && !run ? `Получаем страницы… ${preparedCount}/${selectedSites.length}` : 'Получить URL из sitemap'}</button>
      </form>
      {#if !data.sites.length}<p class="px-3 pb-3 text-xs text-ink-3">Нет доступных сайтов. <a href="/" class="text-acc hover:underline">Подключи аккаунт Google</a>.</p>{/if}
    </section>
    {#if prepareErrors.length}<div class="pane-body text-xs text-dn" role="alert"><p>Не удалось подготовить все сайты. Исправь ошибки или убери эти сайты из выбора и получи URL заново.</p><ul class="mt-2 list-disc pl-4">{#each prepareErrors as failure}<li class="pii break-all">{displaySite(failure.site)}: {failure.message}</li>{/each}</ul></div>{/if}
    {#if draft}
      <section class="pane">
        <div class="pane-head">Готово к проверке <span class="aside app-num">{drafts.length} сайтов · {totalDraftUrls} URL</span></div>
        <div class="pane-body flex flex-wrap items-end gap-3">
          <label class="grid gap-1 text-xs text-ink-2"><span>Сервис</span>
            <select class="input" bind:value={provider} disabled={busy || running}>
              {#each data.providers as item (item.id)}<option value={item.id}>{INDEX_CHECK_PROVIDERS[item.id]}{item.configured ? '' : ' · не настроен'}</option>{/each}
            </select>
          </label>
          <button class="btn btn-pri" onclick={start} disabled={!configured || busy || running || prepareErrors.length > 0}>Проверить {totalDraftUrls} URL на {drafts.length} сайтах через {INDEX_CHECK_PROVIDERS[provider]}</button>
          {#if !configured}<a href="/settings/integrations" class="text-xs text-acc hover:underline">Настроить выбранный сервис</a>{/if}
          <p class="w-full text-xs text-ink-3">Запуск отправит до {totalDraftUrls * (executionOptions.retries + 1)} платных запросов с учётом повторов ошибок. DataForSEO: Google США, английский; оператор site: имеет повышенный тариф. XML River: настройки Google из кабинета.</p>
          <p class="w-full text-xs text-ink-3">Сайты проверяются по очереди. Общий лимит потоков: {executionOptions.concurrency}; результаты каждого сайта сохраняются отдельно.</p>
          {#each drafts as prepared (prepared.id)}
            {#each prepared.warnings as warning}<p class="w-full text-xs text-warn" role="status">{displaySite(prepared.site)}: {warning}</p>{/each}
            <details class="w-full text-xs"><summary class="cursor-pointer text-ink-2 pii">{displaySite(prepared.site)} · {prepared.urls.length} URL — посмотреть список URL и карты</summary>
              <div class="mt-2 max-h-60 overflow-auto border border-line p-2 font-mono text-[11px]">
                {#each prepared.sitemaps as address}<div class="pii break-all text-ink-3">Sitemap: {address}</div>{/each}
                {#each prepared.urls.slice(0, 100) as address}<div class="pii break-all">{address}</div>{/each}
                {#if prepared.urls.length > 100}<p class="text-ink-3">Показаны первые 100 URL из {prepared.urls.length}; проверены будут все.</p>{/if}
              </div>
            </details>
          {/each}
        </div>
      </section>
    {/if}
    {#if batch}
      <section class="pane min-w-0" aria-label="Очередь сайтов">
        <div class="pane-head h-auto min-h-9 flex-wrap gap-y-2 py-2"><span>Очередь сайтов · {stateLabels[batch.state]}</span>{#if running}<button class="btn btn-ghost btn-sm normal-case tracking-normal" onclick={cancel} disabled={busy}>Остановить все сайты</button>{/if}</div>
        <p class="pane-body text-xs" role="status">Завершено сайтов: <span class="app-num">{batch.finishedSites}/{batch.runs.length}</span> · Проверено URL: <span class="app-num">{batch.checkedUrls}/{batch.totalUrls}</span> · Найдено: <span class="app-num">{batch.foundCount ?? '—'}</span></p>
        <CopyNotFoundUrls id={batch.id} scope="batch" count={batch.checkedUrls - (batch.foundCount ?? 0)} />
        <p class="border-b border-line px-3 py-1 text-[11px] text-ink-3 md:hidden">Таблица прокручивается по горизонтали.</p>
        <div class="overflow-x-auto"><table class="app-table min-w-[40rem]"><caption class="sr-only">Состояния выбранных сайтов в очереди</caption><thead><tr><th>Сайт</th><th>Состояние</th><th class="num">Проверено URL</th><th class="num">Найдено</th><th></th></tr></thead><tbody>
          {#each batch.runs as item (item.id)}<tr class:bg-acc-t={run?.id === item.id}><td class="pii break-all">{displaySite(item.site)}</td><td>{stateLabels[item.state]}</td><td class="num app-num">{item.checkedUrls}/{item.totalUrls}</td><td class="num app-num">{item.foundCount ?? '—'}</td><td><button class="btn btn-ghost btn-sm" disabled={busy} onclick={() => showBatchRun(item.id)} aria-label={'Показать результат ' + displaySite(item.site)}>Результаты</button></td></tr>{/each}
        </tbody></table></div>
      </section>
    {/if}
    {#if run && counts}
      <section class="pane min-w-0" aria-label="Результаты проверки">
        {#if run.stopReason}<p class="app-errors" role="status">{run.stopReason}</p>{/if}
        {#if run.persistenceError}<p class="app-errors" role="alert">{run.persistenceError}</p>{/if}
        <div class="pane-head h-auto min-h-9 flex-wrap gap-y-2 py-2">
          <span>{stateLabels[run.state]} <span class="aside">{INDEX_CHECK_PROVIDERS[run.provider]}</span></span>
          {#if running && !batch}<button class="btn btn-ghost btn-sm normal-case tracking-normal" onclick={cancel} disabled={busy}>Остановить</button>{/if}
        </div>
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-3 py-2" role="status" aria-live="polite">
          <span class="text-xs">Проверено <span class="app-num">{validChecked}/{counts.total}</span></span>
          <span class="text-xs">Найдено <span class="app-num">{validChecked ? counts.found : '—'}</span></span>
          <span class="text-xs">Не найдено <span class="app-num">{validChecked ? counts.not_found : '—'}</span></span>
          <span class="text-xs">Ошибок <span class="app-num">{counts.error}</span></span>
          <span class="text-xs">Не проверено <span class="app-num">{counts.pending + counts.checking + counts.retrying + counts.skipped}</span></span>
          <span class="flex items-center gap-2 text-xs text-ink-3"><span>Обработано URL <span class="app-num">{processed}/{counts.total}</span></span><progress class="h-2 w-32 accent-acc" max={counts.total} value={processed} aria-label="Обработано URL, включая ошибки и пропуски"></progress></span>
        </div>
        <CopyNotFoundUrls id={run.id} scope="run" count={counts.not_found} />
        {#if running || run.options}
          <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-3 py-2 text-xs" aria-live="polite">
            {#if run.options}<span class="text-ink-3">Потоки: {run.options.concurrency} · Повторы: {run.options.retries} · Пауза: {run.options.retryDelayMinutes} мин</span>{/if}
            {#if running}<span>В работе: <span class="app-num">{counts.checking}</span></span><span>В очереди: <span class="app-num">{counts.pending}</span></span><span>Ожидают повтора: <span class="app-num">{counts.retrying}</span></span>{/if}
            {#if running && Number.isFinite(nextRetryAt)}<span class="text-warn" aria-live="off">Следующая попытка через <span class="app-num">{Math.floor(retryWait / 60)}:{String(retryWait % 60).padStart(2, '0')}</span></span>{/if}
          </div>
        {/if}
        <div class="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2 text-xs">
          <span class="pii break-all text-ink-2">{displaySite(run.site)}</span>
          <span class="text-ink-3">Начало: {fmtTime(run.startedAt)}{run.finishedAt ? ` · Конец: ${fmtTime(run.finishedAt)}` : ''}</span>
          <label class="ml-auto flex items-center gap-2 text-ink-2"><span>Статус</span><select class="input" bind:value={status} onchange={() => resultPage = 0}>
            <option value="">Все страницы</option>{#each Object.entries(INDEX_CHECK_STATUS) as [key, label]}<option value={key}>{label}</option>{/each}
          </select></label>
        </div>
        <p class="border-b border-line px-3 py-1 text-[11px] text-ink-3 md:hidden">Таблица прокручивается по горизонтали.</p>
        <div class="overflow-x-auto">
          <table class="app-table min-w-[56rem]"><caption class="sr-only">Результаты проверки URL выбранного сайта в Google</caption><thead><tr><th>URL</th><th>Результат</th><th>Время</th><th>Подробности</th></tr></thead>
            <tbody>{#each visibleRows as row (row.url)}<tr>
              <td class="pii min-w-64 max-w-lg break-all"><a href={row.url} target="_blank" rel="noopener noreferrer" class="hover:text-acc hover:underline">{row.url}</a></td>
              <td class="whitespace-nowrap"><span class="badge {row.status === 'found' ? 'badge-ok' : row.status === 'error' ? 'badge-bad' : 'badge-muted'}">{INDEX_CHECK_STATUS[row.status]}</span></td>
              <td class="app-num whitespace-nowrap text-ink-3">{fmtTime(row.checkedAt)}</td>
              <td class="min-w-64 max-w-md text-xs text-ink-2">{#if row.attempts}<span class="mr-2 app-num text-ink-3">Попытка {row.attempts}/{(run.options?.retries ?? 0) + 1}.</span>{/if}{#if row.status === 'retrying' && row.nextAttemptAt}<span>Повтор: {fmtTime(row.nextAttemptAt)}. </span>{/if}{#if row.status === 'checking' && row.attemptStartedAt}<span>Ожидание ответа: {Math.max(0, Math.floor((clock - row.attemptStartedAt) / 1000))} с (не более 70 с). </span>{/if}{row.message ?? (row.matchedUrl ? 'Точный URL найден в органической выдаче' : row.status === 'not_found' ? 'Совпадение не получено; это не доказательство отсутствия в индексе' : '—')}</td>
            </tr>{:else}<tr><td colspan="4" class="py-5 text-ink-3">Нет страниц с этим статусом.</td></tr>{/each}</tbody>
          </table>
        </div>
        {#if rows.length > 100}<div class="flex items-center justify-end gap-3 px-3 py-2 text-xs">
          <button class="btn btn-ghost btn-sm" disabled={resultPage === 0} onclick={() => resultPage--}>Предыдущие</button>
          <span class="app-num">{resultPage * 100 + 1}–{Math.min((resultPage + 1) * 100, rows.length)} из {rows.length}</span>
          <button class="btn btn-ghost btn-sm" disabled={(resultPage + 1) * 100 >= rows.length} onclick={() => resultPage++}>Следующие</button>
        </div>{/if}
      </section>
    {/if}
    <section class="pane min-w-0" aria-label="История проверок">
      <div class="pane-head h-auto min-h-9 flex-wrap gap-y-2 py-2">
        <span>История проверок <span class="aside">{selected ? 'выбранный сайт' : 'все сайты'} · {history.total}</span></span>
        <button class="btn btn-ghost btn-sm normal-case tracking-normal" disabled={historyBusy} onclick={() => refreshHistory()}>Обновить историю</button>
      </div>
      {#if historyError}<p class="app-errors" role="alert">История недоступна: {historyError}. Показаны последние полученные данные.</p>{/if}
      <p class="border-b border-line px-3 py-2 text-xs text-ink-3">Каждый запуск сохраняется отдельно вместе с результатами по URL. «Найдено» — число точных совпадений в выдаче; при отсутствии проверенных данных стоит прочерк, а не ноль.</p>
      <p class="border-b border-line px-3 py-1 text-[11px] text-ink-3 md:hidden">Таблица прокручивается по горизонтали.</p>
      <div class="overflow-x-auto">
        <table class="app-table min-w-[64rem]">
          <caption class="sr-only">Сохранённые проверки Google: сервис, время, число страниц и найденные URL</caption>
          <thead><tr><th>Сайт</th><th>Сервис</th><th>Начало</th><th>Завершение</th><th class="num">Всего URL</th><th class="num">Проверено</th><th class="num">Найдено в Google</th><th>Состояние</th><th></th></tr></thead>
          <tbody>
            {#each history.entries as entry (entry.id)}
              <tr class:bg-acc-t={run?.id === entry.id}>
                <td class="pii min-w-48 max-w-xs break-all">{displaySite(entry.site)}</td>
                <td class="whitespace-nowrap">{INDEX_CHECK_PROVIDERS[entry.provider]}</td>
                <td class="app-num whitespace-nowrap">{fmtTime(entry.startedAt)}</td>
                <td class="app-num whitespace-nowrap text-ink-3">{fmtTime(entry.finishedAt)}</td>
                <td class="num app-num">{entry.totalUrls}</td>
                <td class="num app-num" title="Страницы с найденным или отсутствующим совпадением; ошибки не включены">{entry.checkedUrls}/{entry.totalUrls}</td>
                <td class="num app-num">{entry.foundCount ?? '—'}</td>
                <td class="whitespace-nowrap"><span class="badge {entry.state === 'failed' ? 'badge-bad' : 'badge-muted'}">{stateLabels[entry.state]}</span></td>
                <td><button class="btn btn-ghost btn-sm" disabled={busy || (running && run?.id !== entry.id)} onclick={() => openHistory(entry.id)} aria-label="Открыть проверку {fmtTime(entry.startedAt)} через {INDEX_CHECK_PROVIDERS[entry.provider]}">Результаты</button></td>
              </tr>
            {:else}<tr><td colspan="9" class="py-5 text-ink-3">Сохранённых проверок {selected ? 'этого сайта ' : ''}пока нет.</td></tr>{/each}
          </tbody>
        </table>
      </div>
      {#if history.total > history.limit}<div class="flex items-center justify-end gap-3 px-3 py-2 text-xs">
        <button class="btn btn-ghost btn-sm" disabled={historyBusy || history.offset === 0} onclick={() => refreshHistory(Math.max(0, history.offset - history.limit))}>Предыдущие проверки</button>
        <span class="app-num">{history.offset + 1}–{Math.min(history.offset + history.limit, history.total)} из {history.total}</span>
        <button class="btn btn-ghost btn-sm" disabled={historyBusy || history.offset + history.limit >= history.total} onclick={() => refreshHistory(history.offset + history.limit)}>Следующие проверки</button>
      </div>{/if}
    </section>
  </div>
  {#if pollError}<p class="app-errors mt-3" role="alert">Обновление результата недоступно: {pollError}. Отображаются последние полученные данные; незавершённые строки не считаются проверенными.</p>{/if}
  <p class="mt-3 text-xs text-ink-3">Проверка показывает видимость точного URL в Google. Отсутствие совпадения не подтверждает удаление из индекса. Ошибка или непроверенная страница не считаются отрицательным результатом.</p>
  <p class="mt-2 text-xs text-ink-3">История и результаты сохраняются после перезапуска сервера. После перезапуска сервера прерванные запросы не возобновляются. Временные ошибки повторяются только в пределах настроек запуска. При остановке уже отправленный запрос может быть оплачен.</p>
</main>

<style>
  progress { appearance: none; border: 0; border-radius: 2px; overflow: hidden; background: rgb(var(--line)); }
  progress::-webkit-progress-bar { background: rgb(var(--line)); }
  progress::-webkit-progress-value { background: rgb(var(--acc)); }
  progress::-moz-progress-bar { background: rgb(var(--acc)); }
</style>
