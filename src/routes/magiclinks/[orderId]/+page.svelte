<script lang="ts">
  import BacklinkRunner from '$lib/components/BacklinkRunner.svelte';
  import BacklinkStatus from '$lib/components/BacklinkStatus.svelte';
  import BacklinkSummary from '$lib/components/BacklinkSummary.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  const credits = (minor: number | null | undefined) =>
    minor === null || minor === undefined ? '—' : (minor / 100).toFixed(2);

  const badge = (status: string) =>
    status === 'completed'
      ? 'badge-ok'
      : status === 'failed'
        ? 'badge-bad'
        : 'badge-muted';

  // Статусы заказа 369Team: завершённые — цветом, остальное — очередь.
  const badge369 = (status: string) =>
    status === 'completed'
      ? 'badge-ok'
      : status === 'partially_completed'
        ? 'badge-warn'
        : status === 'failed'
          ? 'badge-bad'
          : 'badge-muted';

  const indexingLabel: Record<string, string> = {
    in_progress: 'идёт',
    completed: 'передано',
    attention: 'нужна проверка'
  };

  // Фильтр приходит ссылкой из striking; сбрасывается тут же, без перезагрузки.
  let filterOn = $state(true);
  const host = (u: string) => {
    try {
      return new URL(u).host;
    } catch {
      return u;
    }
  };
  const fmt = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(0, 16) : '—');

  // Позиции есть только у заказов FieldLink; у 369Team другие таблицы.
  const filtered = $derived(
    data.content.kind === 'fieldlink'
      ? data.filter && filterOn
        ? data.content.rows.filter(
            (r) =>
              (!data.filter!.targetUrl || r.targetUrl === data.filter!.targetUrl) &&
              (!data.filter!.query || r.anchor === data.filter!.query)
          )
        : data.content.rows
      : []
  );
  const published = $derived(filtered.filter((r) => r.url).length);
  const articlesShown = $derived(data.content.kind === 'magic369' ? data.content.articles.length : 0);
</script>

<svelte:head><title>Заказ {data.content.order.id.slice(0, 8)} · MagicLinks</title></svelte:head>

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs"><a href="/magiclinks">MagicLinks</a><span aria-hidden="true">/</span><span class="text-ink-2">Заказ</span></nav>
      <h1 class="app-pagetitle">
        Заказ <span class="font-mono text-[15px]">{data.content.order.id}</span>
        <section class="pane mb-3">
    <div class="pane-head">Проверка ссылок</div>
    <div class="pane-body flex flex-col gap-2"><BacklinkSummary summary={data.checkSummary} /><BacklinkRunner job={data.checkJob} provider={data.content.kind} orderId={data.content.order.id} /></div>
  </section>

  {#if data.content.kind === 'magic369'}<span class="badge badge-muted ml-2 align-middle">369Team</span>{/if}
      </h1>
    </div>
    <div class="app-toolbar-right">
      <a class="btn btn-sec" href="/magiclinks/{data.content.order.id}/csv">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>
        Скачать CSV
      </a>
    </div>
  </header>

  {#if data.content.kind === 'magic369'}
    {@const order = data.content.order}
    <section class="pane mb-3">
      <div class="pane-body flex flex-col gap-2 text-[12.5px] text-ink-2">
        <p class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span class="badge {badge369(order.status)}">{order.status}</span>
          <span>· размещено <span class="app-num text-ink">{order.progress.published}</span> из <span class="app-num text-ink">{order.progress.total}</span></span>
          {#if order.progress.inProgress > 0}<span>· в работе <span class="app-num text-ink">{order.progress.inProgress}</span></span>{/if}
          {#if order.progress.awaitingContent > 0}<span>· ждут подготовки <span class="app-num text-ink">{order.progress.awaitingContent}</span></span>{/if}
          {#if order.progress.failed > 0}<span>· <span class="text-dn">ошибок <span class="app-num">{order.progress.failed}</span></span></span>{/if}
          <span>· создан <span class="app-num text-ink-3">{fmt(order.createdAt)}</span></span>
          {#if order.finalizedAt}<span>· завершён <span class="app-num text-ink-3">{fmt(order.finalizedAt)}</span></span>{/if}
        </p>
        <p class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span>Оплата: <span class="app-num text-ink">{credits(order.totalPriceMinor)}</span> ток.</span>
          <span>· цена размещения <span class="app-num text-ink">{credits(order.priceMinor)}</span></span>
          {#if order.refundedMinor > 0}
            <span>· <span class="text-up">возвращено <span class="app-num">{credits(order.refundedMinor)}</span></span></span>
          {/if}
        </p>
        {#if data.filter}
          <p class="flex flex-wrap items-center gap-2">
            <span class="rounded border border-acc/25 bg-acc-t px-2 py-1 text-xs text-ink-2">
              {#if filterOn}Показаны статьи связки{:else}Фильтр снят, показан весь заказ{/if}:
              <b class="pii text-ink">{data.filter.query}</b>
              <span class="pii text-ink-3">{data.filter.targetUrl.replace(/^https?:\/\//, '')}</span>
            </span>
            <button class="btn btn-ghost btn-sm" onclick={() => (filterOn = !filterOn)}>
              {filterOn ? 'показать весь заказ' : 'вернуть фильтр'}
            </button>
          </p>
        {/if}
      </div>
    </section>

    <section class="pane mb-3">
      <div class="pane-head">Строки заказа <span class="aside app-num">{data.content.lines.length}</span></div>
      <div class="overflow-x-auto">
        <table class="app-table">
          <thead>
            <tr><th>акцептор</th><th>анкор</th><th>язык</th><th class="num">заказано</th><th class="num">размещено</th><th class="num">в работе</th><th class="num">ошибок</th></tr>
          </thead>
          <tbody>
            {#each data.content.lines as l (l.url + l.anchor)}
              <tr>
                <td class="pii max-w-xs truncate" title={l.url}>{l.url}</td>
                <td class="pii max-w-xs truncate font-medium text-ink" title={l.anchor}>{l.anchor}</td>
                <td class="text-ink-2">{l.language}</td>
                <td class="num app-num">{l.count}</td>
                <td class="num app-num text-up">{l.published}</td>
                <td class="num app-num">{l.inProgress + l.awaitingContent}</td>
                <td class="num app-num {l.failed > 0 ? 'text-dn' : ''}">{l.failed}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section class="pane">
      <div class="pane-head">Публикации <span class="aside app-num">{articlesShown}</span></div>
      {#if data.content.articles.length === 0}
        <p class="pane-body text-[12.5px] text-ink-3">Пока ни одной: список пополняется по мере выполнения заказа.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="app-table">
            <thead>
              <tr><th>опубликовано</th><th>заголовок</th><th>анкор</th><th>акцептор</th><th>статья</th><th>проверка ссылки</th><th></th></tr>
            </thead>
            <tbody>
              {#each data.content.articles as a (a.id)}
                <tr>
                  <td class="app-num whitespace-nowrap text-ink-3">{fmt(a.publishedAt)}</td>
                  <td class="pii max-w-xs truncate" title={a.title}>{a.title || '—'}</td>
                  <td class="pii max-w-xs truncate font-medium text-ink" title={a.anchor}>{a.anchor}</td>
                  <td class="pii max-w-xs truncate" title={a.targetUrl}>{a.targetUrl}</td>
                  <td class="pii">
                    <a class="text-acc hover:underline" href={a.publishedUrl} target="_blank" rel="noopener noreferrer nofollow" title={a.publishedUrl}>
                      {host(a.publishedUrl)}
                    </a>
                  </td>
                  <td><BacklinkStatus check={data.checks[String(a.id)]} /></td>
                  <td><BacklinkRunner job={data.checkJob} provider="magic369" orderId={data.content.order.id} placementId={String(a.id)} compact /></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {:else}
    {@const order = data.content.order}
    <section class="pane mb-3">
      <div class="pane-body flex flex-col gap-2 text-[12.5px] text-ink-2">
        <p class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span class="badge {badge(order.status)}">{order.status}</span>
          <span>· заказано <span class="app-num text-ink">{order.requestedCount ?? '—'}</span> + бонус <span class="app-num text-ink">{order.bonusCount ?? 0}</span>
          = <span class="app-num text-ink">{order.rowCount}</span> позиций</span>
          <span>· выполнено <span class="app-num text-ink">{order.completedCount}</span>{#if order.failedCount > 0}, <span class="text-dn">ошибок <span class="app-num">{order.failedCount}</span></span>{/if}</span>
          {#if data.filter && filterOn}
            <span>· в этой связке <span class="app-num text-ink">{filtered.length}</span>, из них с URL публикации <span class="app-num text-ink">{published}</span></span>
          {:else}
            <span>· с URL публикации <span class="app-num text-ink">{published}</span></span>
          {/if}
          {#if order.trashed}<span class="badge badge-bad">в корзине</span>{/if}
          {#if order.held}<span class="badge badge-warn">удержан</span>{/if}
        </p>

        {#if order.billing}
          <p class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span>Оплата: {order.billing.mode}</span>
            {#if order.billing.mode === 'reserved'}
              <span>· цена <span class="app-num text-ink">{credits(order.billing.amountMinor)}</span> кр.</span>
              <span>· списано <span class="app-num text-ink">{credits(order.billing.settledMinor)}</span></span>
              <span>· в резерве <span class="app-num text-ink">{credits(order.billing.reservedMinor)}</span></span>
              <span>· освобождено <span class="app-num text-ink">{credits(order.billing.releasedMinor)}</span></span>
            {:else}
              <span>· <span class="app-num text-ink">{credits(order.billing.amountMinor)}</span> кр.</span>
            {/if}
            {#if order.locked}<span class="badge badge-warn">отмена заблокирована (индексация включена)</span>{/if}
          </p>
        {/if}

        {#if data.filter}
          <p class="flex flex-wrap items-center gap-2">
            <span class="rounded border border-acc/25 bg-acc-t px-2 py-1 text-xs text-ink-2">
              {#if filterOn}Показаны позиции связки{:else}Фильтр снят, показан весь заказ{/if}:
              <b class="pii text-ink">{data.filter.query}</b>
              <span class="pii text-ink-3">{data.filter.targetUrl.replace(/^https?:\/\//, '')}</span>
            </span>
            <button class="btn btn-ghost btn-sm" onclick={() => (filterOn = !filterOn)}>
              {filterOn ? 'показать весь заказ' : 'вернуть фильтр'}
            </button>
          </p>
        {/if}
      </div>
    </section>

    <section class="pane">
      <div class="pane-head">Позиции <span class="aside app-num">{filtered.length}</span></div>
      <div class="overflow-x-auto">
        <table class="app-table">
          <thead>
            <tr>
              <th class="num">#</th><th>акцептор</th><th>анкор</th><th>язык</th>
              <th>статус</th><th>публикация</th><th>индексация</th><th>проверка ссылки</th><th></th>
            </tr>
          </thead>
          <tbody>
            {#each filtered as r (r.id)}
              <tr>
                <td class="num app-num whitespace-nowrap text-ink-3">
                  {#if r.isBonus}<span class="badge badge-ok mr-1 font-sans">бонус</span>{/if}{r.placementIndex ?? ''}
                </td>
                <td class="pii max-w-xs truncate" title={r.targetUrl}>{r.targetUrl}</td>
                <td class="pii max-w-xs truncate font-medium text-ink" title={r.anchor}>{r.anchor}</td>
                <td class="text-ink-2">{r.language}</td>
                <td><span class="badge {badge(r.status)}">{r.status}</span></td>
                <td class="pii">
                  {#if r.url}
                    <a class="text-acc hover:underline" href={r.url} target="_blank" rel="noopener noreferrer nofollow" title={r.url}>
                      {host(r.url)}
                    </a>
                  {:else if r.error}
                    <span class="text-dn" title={r.error}>ошибка</span>
                  {:else}
                    <span class="text-ink-4">—</span>
                  {/if}
                </td>
                <td class="text-ink-2">{r.indexing ? (indexingLabel[r.indexing] ?? r.indexing) : '—'}</td>
                <td>{#if r.url}<BacklinkStatus check={data.checks[r.id]} />{:else}<span class="text-ink-3">ждёт публикации</span>{/if}</td>
                <td>{#if r.url}<BacklinkRunner job={data.checkJob} provider="fieldlink" orderId={data.content.order.id} placementId={r.id} compact />{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <p class="mt-3 text-xs text-ink-3">
      Индексация идёт отдельно от публикации: «передано» не доказывает появление в поиске,
      и занять это может несколько дней. Отдельной команды на переотправку нет.
    </p>
  {/if}
</main>
