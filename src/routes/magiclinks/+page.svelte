<script lang="ts">
  import BacklinkPulse from '$lib/components/BacklinkPulse.svelte';
  import type { BacklinkDashboard } from '$lib/server/backlink-snapshots';
  import BacklinkRunner from '$lib/components/BacklinkRunner.svelte';
  import BacklinkSummary from '$lib/components/BacklinkSummary.svelte';
  import { FIELDLINK_SIGNUP_URL, MAGIC369_CONTACT } from '$lib/utils/magiclinks-signup';
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();

  let liveDashboard = $state<BacklinkDashboard | null>(null);
  $effect(() => { data.checkDashboard; liveDashboard = null; });

  const credits = (minor: number | null | undefined) =>
    minor === null || minor === undefined ? '—' : (minor / 100).toFixed(2);

  const fmt = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(0, 16) : '—');

  const badge = (status: string) =>
    status === 'completed'
      ? 'badge-ok'
      : status === 'failed'
        ? 'badge-bad'
        : status === 'partial' || status === 'partially_completed'
          ? 'badge-warn'
          : 'badge-muted';

  const providerName = $derived(Object.fromEntries(data.checkDashboard.providers.map((p) => [p.id, p.name])));

  const progress = (o: { completedCount: number; rowCount: number }) =>
    o.rowCount > 0 ? Math.round((o.completedCount / o.rowCount) * 100) : 0;
</script>

<svelte:head><title>MagicLinks · gsc-hub</title></svelte:head>

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs"><a href="/properties">Properties</a><span aria-hidden="true">/</span><span class="text-ink-2">MagicLinks</span></nav>
      <h1 class="app-pagetitle">MagicLinks</h1>
      <p class="text-xs text-ink-3">
        Задания на посты и ссылки, их статусы и URL публикаций. Статусы заказов и публикации кешируются; результаты проверки ссылок сохраняются в хабе.
      </p>
    </div>
    <div class="app-toolbar-right flex flex-col items-end gap-1">
      <form method="POST" action="?/refreshProviders"><button class="btn btn-sec btn-sm">Обновить данные поставщиков</button></form>
      {#if data.providerCache.updatedAt}<span class="text-xs text-ink-3">Кеш: {fmt(new Date(data.providerCache.updatedAt).toISOString())} UTC{data.providerCache.stale ? ' · есть ошибки обновления' : ''}</span>{/if}
    </div>
  </header>

  <section class="pane mb-3">
    <div class="pane-head">Проверка купленных ссылок</div>
    <div class="pane-body flex flex-col gap-2">
      <BacklinkPulse dashboard={liveDashboard ?? data.checkDashboard} />
      <BacklinkRunner job={data.checkJob} onprogress={(dashboard) => (liveDashboard = dashboard)} />
      <p class="text-xs text-ink-3">Автопроверка раз в неделю. Можно проверить все ссылки, отдельный заказ или публикацию вручную. Проверяем HTML без JavaScript.</p>
    </div>
  </section>

  {#if form && 'error' in form && form.error}
    <p class="app-errors">{form.error}</p>
  {/if}
  {#if form && 'saved' in form && form.saved}
    <p class="notice mb-4 border-up/25 bg-up-t text-up">Ключ сохранён.</p>
  {/if}
  {#if form && 'saved369' in form && form.saved369}
    <p class="notice mb-4 border-up/25 bg-up-t text-up">Ключ 369Team сохранён.</p>
  {/if}
  {#if form && 'cleared369' in form && form.cleared369}
    <p class="notice mb-4 border-warn/25 bg-warn-t text-warn">Ключ 369Team убран из базы.</p>
  {/if}
  {#if form && 'imported' in form && form.imported}
    <p class="notice mb-4 border-up/25 bg-up-t text-up">
      Подтянуто заказов: <span class="app-num">{form.imported.orders}</span>, позиций в истории: <span class="app-num">{form.imported.rows}</span>.
      {#if form.imported.orders === 0}Новых заказов не нашлось.{/if}
    </p>
  {/if}

  <div class="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
    <div class="flex min-w-0 flex-col gap-3">
      {#if data.configured || data.orders.length > 0}
        <section class="pane">
          <div class="pane-head">Заказы <span class="aside app-num">{data.orders.length}</span></div>
          {#if data.orders.length === 0}
            <p class="pane-body text-[12.5px] text-ink-3">
              {data.error ? 'Список не загрузился.' : 'Заказов пока нет.'}
            </p>
          {:else}
            <div class="overflow-x-auto">
              <table class="app-table">
                <thead>
                  <tr>
                    <th>задание</th><th>провайдер</th><th>тип</th><th class="num">брифов</th><th class="num">заказано</th>
                    <th>заказ</th><th>готово</th><th>индексация</th><th>проверка ссылок</th><th>создано</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {#each data.orders as t (t.provider + t.id)}
                    <tr>
                      <td>
                        <div class="pii font-medium text-ink">{t.name ?? t.code ?? t.id}</div>
                        <div class="app-num text-[11px] text-ink-3">{t.code ?? t.id.slice(0, 8)}</div>
                      </td>
                      <td class="whitespace-nowrap text-ink-2">{providerName[t.provider] ?? t.provider}</td>
                      <td class="text-ink-2">{t.type}</td>
                      <td class="num app-num">{t.rowCount}</td>
                      <td class="num app-num">{t.placementCount}</td>
                      <td class="whitespace-nowrap">
                        {#if t.order}
                          <span class="badge {badge(t.order.status)}">{t.order.status}</span>
                          {#if t.order.trashed}<span class="badge badge-bad ml-1">в корзине</span>
                          {:else if t.order.held}<span class="badge badge-warn ml-1">удержан</span>{/if}
                        {:else}
                          <span class="text-ink-4">не отправлено</span>
                        {/if}
                      </td>
                      <td class="whitespace-nowrap">
                        {#if t.order && t.order.rowCount > 0}
                          <span class="app-num">{t.order.completedCount}/{t.order.rowCount}</span>
                          <span class="app-num text-ink-3">({progress(t.order)}%)</span>
                          {#if t.order.failedCount > 0}
                            <span class="ml-1 text-dn">ошибок <span class="app-num">{t.order.failedCount}</span></span>
                          {/if}
                        {:else}
                          <span class="text-ink-4">-</span>
                        {/if}
                      </td>
                      <td class="whitespace-nowrap text-[12px]">
                        {#if t.indexing && t.indexing.none < t.indexing.inProgress + t.indexing.completed + t.indexing.attention + t.indexing.none}
                          {#if t.indexing.completed > 0}<span class="badge badge-ok">готово <span class="app-num">{t.indexing.completed}</span></span>{/if}
                          {#if t.indexing.inProgress > 0}<span class="badge badge-muted">в работе <span class="app-num">{t.indexing.inProgress}</span></span>{/if}
                          {#if t.indexing.attention > 0}<span class="badge badge-warn">внимание <span class="app-num">{t.indexing.attention}</span></span>{/if}
                          {#if t.indexing.none > 0}<span class="text-ink-3">ждут <span class="app-num">{t.indexing.none}</span></span>{/if}
                        {:else if t.indexing}
                          <span class="text-ink-4" title="Сервис отправляет URL на индексацию, когда опубликованы все позиции заказа">не отправлено</span>
                        {:else}
                          <span class="text-ink-4">-</span>
                        {/if}
                      </td>
                      <td><BacklinkSummary summary={t.backlinks} /></td>
                      <td class="app-num whitespace-nowrap text-ink-3">{fmt(t.createdAt)}</td>
                      <td class="text-right">
                        {#if t.order}
                          <a class="btn btn-sec btn-sm" href="/magiclinks/{t.order.id}">позиции <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg></a>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </section>

        <p class="text-xs text-ink-3">
          Статус <code class="font-mono">queued</code> и <code class="font-mono">processing</code> - это очередь, а не публикация.
          У FieldLink списываются только проверенные выполненные платные позиции, бонусные бесплатны; у 369Team деньги списываются при создании заказа.
          Индексацию FieldLink запускает сам, когда опубликованы все позиции заказа; у 369Team индексации в API нет.
        </p>
      {/if}
    </div>

    <aside class="order-first flex min-w-0 flex-col gap-3 lg:order-none">
      <section class="pane">
        <div class="pane-head">Настройки проверки ссылок</div>
        <div class="pane-body flex flex-col gap-3 text-xs">
          {#if form && 'backlinkSaved' in form && form.backlinkSaved}<p class="text-up">Настройки проверки сохранены.</p>{/if}
          <p class="text-ink-3">{data.backlinkSettings.proxyConfigured ? `Прокси: ${data.backlinkSettings.proxyLabel} (${data.backlinkSettings.source}).` : 'Прокси не задан: проверка с IP сервера.'}</p>
          <form method="POST" action="?/saveBacklinkSettings" class="flex flex-col gap-2">
            <label class="flex flex-col gap-1">SOCKS-прокси (опционально)<input class="input" name="proxy" type="password" autocomplete="new-password" placeholder="socks5://user:pass@host:port" maxlength="1000" /></label>
            <p class="text-ink-3">SOCKS5 — логин и пароль, SOCKS4 — только User ID: socks4://user@host:port. Пустое поле сохраняет текущий прокси.</p>
            {#if data.backlinkSettings.source === 'env'}<p class="text-ink-3">Прокси задан BACKLINK_PROXY_URL в окружении; изменение — там.</p>{:else if data.backlinkSettings.proxyConfigured}<label class="flex items-center gap-2"><input type="checkbox" name="clearProxy" />Убрать сохранённый прокси</label>{/if}
            <label class="flex items-center gap-2"><input type="checkbox" name="automatic" checked={data.backlinkSettings.automatic} />Автопроверка раз в неделю</label>
            <p class="break-all text-ink-3">User-Agent: {data.backlinkSettings.userAgent}</p>
            <button class="btn btn-sec">Сохранить</button>
          </form>
        </div>
      </section>
      <section class="pane">
        <div class="pane-head">Ключ доступа
          {#if data.configured && data.balance}
            <span class="aside text-ink-2">Баланс <b class="app-num text-ink">{credits(data.balance.balanceMinor)}</b> кр.</span>
          {/if}
        </div>
        <div class="pane-body flex flex-col gap-3 text-[12.5px] text-ink-2">
          {#if data.configured}
            <p>
              Ключ <code class="pii font-mono text-[12px] text-ink">{data.masked}</code>
              {#if data.source === 'env'}
                задан переменной окружения <code class="font-mono text-[12px]">MAGICLINKS_API_TOKEN</code> - она главнее базы,
                и со страницы её не снять.
              {:else}
                хранится в базе хаба.
              {/if}
              <br />API: <code class="pii break-all font-mono text-[12px] text-ink">{data.base}</code>
            </p>
            {#if data.balance}
              <div class="grid grid-cols-3 gap-px overflow-hidden rounded border border-line bg-line">
                <div class="flex flex-col bg-pane px-2 py-1.5"><span class="stat-label">Доступно</span><span class="stat-value">{credits(data.balance.balanceMinor)}</span></div>
                <div class="flex flex-col bg-pane px-2 py-1.5"><span class="stat-label">В резерве</span><span class="stat-value">{credits(data.balance.reservedMinor)}</span></div>
                <div class="flex flex-col bg-pane px-2 py-1.5"><span class="stat-label">Всего</span><span class="stat-value">{credits(data.balance.totalBalanceMinor)}</span></div>
              </div>
            {/if}
            <form method="POST" action="?/importHistory" class="flex flex-col items-start gap-1.5">
              <button class="btn btn-sec">Подтянуть покупки из сервиса</button>
              <span class="text-[11px] text-ink-3">
                История подтягивается сама при заходе сюда; кнопка нужна, только если заказ
                появился прямо сейчас. Заказов в истории: <span class="app-num">{data.purchasedOrders}</span>.
              </span>
            </form>

            {#if data.error}
              <p class="notice notice-warn">{data.error}</p>
            {/if}
            <details class="border-t border-line-soft pt-2">
              <summary class="cursor-pointer text-ink-3 hover:text-ink">Заменить или убрать ключ</summary>
              <form method="POST" action="?/saveToken" class="mt-2 flex flex-wrap items-end gap-2">
                <input
                  name="token"
                  type="password"
                  required
                  autocomplete="off"
                  placeholder="flk_…"
                  aria-label="ключ MagicLinks"
                  class="input min-w-0 flex-1 font-mono"
                />
                <button class="btn btn-pri">Сохранить</button>
              </form>
              {#if data.source === 'db'}
                <form
                  method="POST"
                  action="?/clearToken"
                  class="mt-3"
                  onsubmit={(e) => { if (!confirm('Убрать ключ MagicLinks из базы? Страница перестанет показывать задания.')) e.preventDefault(); }}
                >
                  <button class="btn btn-danger btn-sm">Убрать ключ</button>
                </form>
              {/if}
            </details>
          {:else}
            <p class="notice border-line bg-sunk text-ink-2">
              Нет аккаунта? <a class="text-acc hover:underline" href={FIELDLINK_SIGNUP_URL} target="_blank" rel="noopener">Зарегистрируйся в сервисе</a>,
              затем создай ключ в кабинете.<br />
              <span class="text-ink-3">No account yet? <a class="text-acc hover:underline" href={FIELDLINK_SIGNUP_URL} target="_blank" rel="noopener">Sign up</a>, then create an API key in the dashboard.</span>
            </p>
            <p>
              Ключ создаётся в кабинете MagicLinks и показывается там один раз. Хаб хранит его
              в своей базе и шлёт только на <code class="pii break-all font-mono text-[12px] text-ink">{data.base}</code>.
            </p>
            <form method="POST" action="?/saveToken" class="flex flex-wrap items-end gap-2">
              <input
                name="token"
                type="password"
                required
                autocomplete="off"
                placeholder="flk_…"
                aria-label="ключ MagicLinks"
                class="input min-w-0 flex-1 font-mono"
              />
              <button class="btn btn-pri">Сохранить ключ</button>
            </form>
          {/if}
        </div>
      </section>

      <section class="pane">
        <div class="pane-head">369Team · второй провайдер
          {#if data.m369.configured && data.m369.balance}
            <span class="aside text-ink-2">Баланс <b class="app-num text-ink">{credits(data.m369.balance.balanceMinor)}</b> ток.</span>
          {/if}
        </div>
        <div class="pane-body flex flex-col gap-3 text-[12.5px] text-ink-2">
          {#if data.m369.configured}
            <p>
              Ключ <code class="pii font-mono text-[12px] text-ink">{data.m369.masked}</code>
              {#if data.m369.source === 'env'}
                задан переменной окружения <code class="font-mono text-[12px]">MAGIC369_API_TOKEN</code> - она главнее базы,
                и со страницы её не снять.
              {:else}
                хранится в базе хаба.
              {/if}
              <br />API: <code class="pii break-all font-mono text-[12px] text-ink">{data.m369.base}</code>
            </p>
            {#if data.m369.balance}
              <div class="grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line">
                <div class="flex flex-col bg-pane px-2 py-1.5"><span class="stat-label">Доступно</span><span class="stat-value">{credits(data.m369.balance.balanceMinor)}</span></div>
                <div class="flex flex-col bg-pane px-2 py-1.5"><span class="stat-label">Цена размещения</span><span class="stat-value">{credits(data.m369.balance.priceMinor)}</span></div>
              </div>
            {/if}
            <p class="text-[11px] text-ink-3">
              Заказ здесь одношаговый: оплата списывает токены сразу. Списка заказов в API нет,
              поэтому покупки видны в истории striking и по прямой ссылке на заказ.
            </p>
            {#if data.m369.error}
              <p class="notice notice-warn">{data.m369.error}</p>
            {/if}
            <details class="border-t border-line-soft pt-2">
              <summary class="cursor-pointer text-ink-3 hover:text-ink">Заменить или убрать ключ</summary>
              <form method="POST" action="?/save369Token" class="mt-2 flex flex-wrap items-end gap-2">
                <input
                  name="token"
                  type="password"
                  required
                  autocomplete="off"
                  placeholder="sk_…"
                  aria-label="ключ 369Team"
                  class="input min-w-0 flex-1 font-mono"
                />
                <button class="btn btn-pri">Сохранить</button>
              </form>
              {#if data.m369.source === 'db'}
                <form
                  method="POST"
                  action="?/clear369Token"
                  class="mt-3"
                  onsubmit={(e) => { if (!confirm('Убрать ключ 369Team из базы? Покупки пойдут только через FieldLink.')) e.preventDefault(); }}
                >
                  <button class="btn btn-danger btn-sm">Убрать ключ</button>
                </form>
              {/if}
            </details>
          {:else}
            <p class="notice border-line bg-sunk text-ink-2">
              Нет регистрации или ключа? Пиши в Telegram
              <a class="text-acc hover:underline" href={MAGIC369_CONTACT.url} target="_blank" rel="noopener">{MAGIC369_CONTACT.handle}</a>.<br />
              <span class="text-ink-3">No account or API key? Message
              <a class="text-acc hover:underline" href={MAGIC369_CONTACT.url} target="_blank" rel="noopener">{MAGIC369_CONTACT.handle}</a> on Telegram.</span>
            </p>
            <p>
              Ключ выдаётся в сервисе 369Team (magiclinks.online). Хаб хранит его
              в своей базе и шлёт только на
              <code class="pii break-all font-mono text-[12px] text-ink">{data.m369.base}</code>.
              Без ключа покупки идут только через FieldLink.
            </p>
            <form method="POST" action="?/save369Token" class="flex flex-wrap items-end gap-2">
              <input
                name="token"
                type="password"
                required
                autocomplete="off"
                placeholder="sk_…"
                aria-label="ключ 369Team"
                class="input min-w-0 flex-1 font-mono"
              />
              <button class="btn btn-pri">Сохранить ключ</button>
            </form>
          {/if}
        </div>
      </section>
    </aside>
  </div>
</main>
