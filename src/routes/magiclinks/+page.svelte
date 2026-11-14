<script lang="ts">
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, getLocale } from '$lib/i18n/index.svelte';
  import { isoDate, dateTime, clock } from '$lib/utils/time';
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

<svelte:head><title>{t('Меджики')} · gsc-hub</title></svelte:head>

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs"><span>{t('Работа')}</span><span aria-hidden="true">/</span><span class="text-ink-2">{t('Меджики')}</span></nav>
      <h1 class="app-pagetitle">{t('Меджики')}</h1>
      <p class="text-xs text-ink-3">
        {t('Задания на посты и ссылки, их статусы и URL публикаций. Статусы заказов и публикации кешируются; результаты проверки ссылок сохраняются в хабе.')}
      </p>
    </div>
    <div class="app-toolbar-right flex flex-col items-end gap-1">
      <form method="POST" action="?/refreshProviders"><button class="btn btn-sec btn-sm">{t('Обновить данные поставщиков')}</button></form>
      {#if data.providerCache.updatedAt}<span class="text-xs text-ink-3">{t('Кеш:')} <span class="app-num">{dateTime(data.providerCache.updatedAt)}</span>{data.providerCache.stale ? t(' · есть ошибки обновления') : ''}</span>{/if}
    </div>
  </header>

  {#if form && 'error' in form && form.error}
    <p class="app-errors">{tx(form.error)}</p>
  {/if}
  {#if form && 'saved' in form && form.saved}
    <p class="notice mb-4 border-up/25 bg-up-t text-up">{t('Ключ сохранён.')}</p>
  {/if}
  {#if form && 'saved369' in form && form.saved369}
    <p class="notice mb-4 border-up/25 bg-up-t text-up">{t('Ключ 369Team сохранён.')}</p>
  {/if}
  {#if form && 'cleared369' in form && form.cleared369}
    <p class="notice mb-4 border-warn/25 bg-warn-t text-warn">{t('Ключ 369Team убран из базы.')}</p>
  {/if}
  {#if form && 'imported' in form && form.imported}
    <p class="notice mb-4 border-up/25 bg-up-t text-up">
      {t('Подтянуто заказов:')} <span class="app-num">{form.imported.orders}</span>{t(', позиций в истории:')} <span class="app-num">{form.imported.rows}</span>.
      {#if form.imported.orders === 0}{t('Новых заказов не нашлось.')}{/if}
    </p>
  {/if}

  <!-- One desk: work on the left (link checks, orders), keys and check settings in a 360px column. -->
  <div class="desk lg:grid-cols-[minmax(0,1fr)_360px]">
    <div class="desk-col">
      <section class="pane">
        <div class="pane-head">{t('Проверка купленных ссылок')}</div>
        <div class="pane-body flex flex-col gap-2">
          <BacklinkPulse dashboard={liveDashboard ?? data.checkDashboard} />
          <BacklinkRunner job={data.checkJob} onprogress={(dashboard) => (liveDashboard = dashboard)} />
          <p class="text-xs text-ink-3">{t('Автопроверка раз в неделю. Можно проверить все ссылки, отдельный заказ или публикацию вручную. Проверяем HTML без JavaScript.')}</p>
        </div>
      </section>
      {#if data.configured || data.orders.length > 0}
        <section class="pane">
          <div class="pane-head">{t('Заказы')} <span class="aside app-num">{data.orders.length}</span></div>
          {#if data.orders.length === 0}
            <p class="pane-body text-[12.5px] text-ink-3">
              {data.error ? t('Список не загрузился.') : t('Заказов пока нет.')}
            </p>
          {:else}
            <div class="overflow-x-auto">
              <table class="app-table">
                <thead>
                  <tr>
                    <th>{t('задание')}</th><th>{t('провайдер')}</th><th>{t('тип')}</th><th class="num">{t('брифов')}</th><th class="num">{t('заказано')}</th>
                    <th>{t('заказ')}</th><th>{t('готово')}</th><th>{t('индексация')}</th><th>{t('проверка ссылок')}</th><th>{t('создано')}</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {#each data.orders as it (it.provider + it.id)}
                    <tr>
                      <td>
                        <div class="pii font-medium text-ink">{it.name ?? it.code ?? it.id}</div>
                        <div class="app-num text-[11px] text-ink-3">{it.code ?? it.id.slice(0, 8)}</div>
                      </td>
                      <td class="whitespace-nowrap text-ink-2">{providerName[it.provider] ?? it.provider}</td>
                      <td class="text-ink-2">{it.type === 'links' ? t('Ссылки с главных') : it.type === 'posts' ? t('Посты') : it.type}</td>
                      <td class="num app-num">{it.rowCount}</td>
                      <td class="num app-num">{it.placementCount}</td>
                      <td class="whitespace-nowrap">
                        {#if it.order}
                          <span class="badge {badge(it.order.status)}">{it.order.status}</span>
                          {#if it.order.trashed}<span class="badge badge-bad ml-1">{t('в корзине')}</span>
                          {:else if it.order.held}<span class="badge badge-warn ml-1">{t('удержан')}</span>{/if}
                        {:else}
                          <span class="text-ink-4">{t('не отправлено')}</span>
                        {/if}
                      </td>
                      <td class="whitespace-nowrap">
                        {#if it.order && it.order.rowCount > 0}
                          <span class="app-num">{it.order.completedCount}/{it.order.rowCount}</span>
                          <span class="app-num text-ink-3">({progress(it.order)}%)</span>
                          {#if it.order.failedCount > 0}
                            <span class="ml-1 text-dn">{t('ошибок')} <span class="app-num">{it.order.failedCount}</span></span>
                          {/if}
                        {:else}
                          <span class="text-ink-4">-</span>
                        {/if}
                      </td>
                      <td class="whitespace-nowrap text-[12px]">
                        {#if it.indexing && it.indexing.none < it.indexing.inProgress + it.indexing.completed + it.indexing.attention + it.indexing.none}
                          {#if it.indexing.completed > 0}<span class="badge badge-ok">{t('готово')} <span class="app-num">{it.indexing.completed}</span></span>{/if}
                          {#if it.indexing.inProgress > 0}<span class="badge badge-muted">{t('в работе')} <span class="app-num">{it.indexing.inProgress}</span></span>{/if}
                          {#if it.indexing.attention > 0}<span class="badge badge-warn">{t('внимание')} <span class="app-num">{it.indexing.attention}</span></span>{/if}
                          {#if it.indexing.none > 0}<span class="text-ink-3">{t('ждут')} <span class="app-num">{it.indexing.none}</span></span>{/if}
                        {:else if it.indexing}
                          <span class="text-ink-4" title={t('Сервис отправляет URL на индексацию, когда опубликованы все позиции заказа')}>{t('не отправлено')}</span>
                        {:else}
                          <span class="text-ink-4">-</span>
                        {/if}
                      </td>
                      <td><BacklinkSummary summary={it.backlinks} /></td>
                      <td class="app-num whitespace-nowrap text-ink-3">{fmt(it.createdAt)}</td>
                      <td class="text-right">
                        {#if it.order}
                          <a class="btn btn-sec btn-sm" href="/magiclinks/{it.order.id}">{t('позиции')} <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg></a>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
          <p class="border-t border-line-soft px-3 py-2 text-xs text-ink-3">
            {t('Статус')} <code class="font-mono">queued</code> {t('и')} <code class="font-mono">processing</code> {t('- это очередь, а не публикация. У FieldLink списываются только проверенные выполненные платные позиции, бонусные бесплатны; у 369Team деньги списываются при создании заказа. Индексацию FieldLink запускает сам, когда опубликованы все позиции заказа; у 369Team индексации в API нет.')}
        </p>
        </section>
      {/if}
    </div>

    <aside class="desk-col order-first lg:order-0">
      <section class="pane">
        <div class="pane-head">{t('Настройки проверки ссылок')}</div>
        <div class="pane-body flex flex-col gap-3 text-xs">
          {#if form && 'backlinkSaved' in form && form.backlinkSaved}<p class="text-up">{t('Настройки проверки сохранены.')}</p>{/if}
          <p class="text-ink-3">{data.backlinkSettings.proxyConfigured ? t('Прокси: {proxy} ({source}).', { proxy: data.backlinkSettings.proxyLabel ?? '', source: data.backlinkSettings.source }) : t('Прокси не задан: проверка с IP сервера.')}</p>
          <form method="POST" action="?/saveBacklinkSettings" class="flex flex-col gap-2">
            <label class="flex flex-col gap-1">{t('SOCKS-прокси (опционально)')}<input class="input" name="proxy" type="password" autocomplete="new-password" placeholder="socks5://user:pass@host:port" maxlength="1000" /></label>
            <p class="text-ink-3">{t('SOCKS5 — логин и пароль, SOCKS4 — только User ID: socks4://user@host:port. Пустое поле сохраняет текущий прокси.')}</p>
            {#if data.backlinkSettings.source === 'env'}<p class="text-ink-3">{t('Прокси задан BACKLINK_PROXY_URL в окружении; изменение — там.')}</p>{:else if data.backlinkSettings.proxyConfigured}<label class="flex items-center gap-2"><input type="checkbox" name="clearProxy" />{t('Убрать сохранённый прокси')}</label>{/if}
            <label class="flex items-center gap-2"><input type="checkbox" name="automatic" checked={data.backlinkSettings.automatic} />{t('Автопроверка раз в неделю')}</label>
            <p class="break-all text-ink-3">User-Agent: {data.backlinkSettings.userAgent}</p>
            <button class="btn btn-sec">{t('Сохранить')}</button>
          </form>
        </div>
      </section>
      <section class="pane">
        <div class="pane-head">{t('Ключ доступа')}
          {#if data.configured && data.balance}
            <span class="aside text-ink-2">{t('Баланс')} <b class="app-num text-ink">{credits(data.balance.balanceMinor)}</b> {t('кр.')}</span>
          {/if}
        </div>
        <div class="pane-body flex flex-col gap-3 text-[12.5px] text-ink-2">
          {#if data.configured}
            <p>
              {t('Ключ')} <code class="pii font-mono text-[12px] text-ink">{data.masked}</code>
              {#if data.source === 'env'}
                {t('задан переменной окружения')} <code class="font-mono text-[12px]">MAGICLINKS_API_TOKEN</code> {t('- она главнее базы, и со страницы её не снять.')}
              {:else}
                {t('хранится в базе хаба.')}
              {/if}
              <br />API: <code class="pii break-all font-mono text-[12px] text-ink">{data.base}</code>
            </p>
            {#if data.balance}
              <div class="grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-line bg-line">
                <div class="flex flex-col bg-pane px-2 py-1.5"><span class="stat-label">{t('Доступно')}</span><span class="stat-value">{credits(data.balance.balanceMinor)}</span></div>
                <div class="flex flex-col bg-pane px-2 py-1.5"><span class="stat-label">{t('В резерве')}</span><span class="stat-value">{credits(data.balance.reservedMinor)}</span></div>
                <div class="flex flex-col bg-pane px-2 py-1.5"><span class="stat-label">{t('Всего')}</span><span class="stat-value">{credits(data.balance.totalBalanceMinor)}</span></div>
              </div>
            {/if}
            <form method="POST" action="?/importHistory" class="flex flex-col items-start gap-1.5">
              <button class="btn btn-sec">{t('Подтянуть покупки из сервиса')}</button>
              <span class="text-[11px] text-ink-3">
                {t('История подтягивается сама при заходе сюда; кнопка нужна, только если заказ появился прямо сейчас. Заказов в истории:')} <span class="app-num">{data.purchasedOrders}</span>.
              </span>
            </form>

            {#if data.error}
              <p class="notice notice-warn">{data.error}</p>
            {/if}
            <details class="border-t border-line-soft pt-2">
              <summary class="cursor-pointer text-ink-3 hover:text-ink">{t('Заменить или убрать ключ')}</summary>
              <form method="POST" action="?/saveToken" class="mt-2 flex flex-wrap items-end gap-2">
                <input
                  name="token"
                  type="password"
                  required
                  autocomplete="off"
                  placeholder="flk_…"
                  aria-label={t('ключ MagicLinks')}
                  class="input min-w-0 flex-1 font-mono"
                />
                <button class="btn btn-pri">{t('Сохранить')}</button>
              </form>
              {#if data.source === 'db'}
                <form
                  method="POST"
                  action="?/clearToken"
                  class="mt-3"
                  onsubmit={(e) => { if (!confirm(t('Убрать ключ MagicLinks из базы? Страница перестанет показывать задания.'))) e.preventDefault(); }}
                >
                  <button class="btn btn-danger btn-sm">{t('Убрать ключ')}</button>
                </form>
              {/if}
            </details>
          {:else}
            <p class="notice border-line bg-sunk text-ink-2">
              {t('Нет аккаунта?')} <a class="link" href={FIELDLINK_SIGNUP_URL} target="_blank" rel="noopener">{t('Зарегистрируйся в сервисе')}</a>{t(', затем создай ключ в кабинете.')}
            </p>
            <p>
              {t('Ключ создаётся в кабинете MagicLinks и показывается там один раз. Хаб хранит его в своей базе и шлёт только на')} <code class="pii break-all font-mono text-[12px] text-ink">{data.base}</code>.
            </p>
            <form method="POST" action="?/saveToken" class="flex flex-wrap items-end gap-2">
              <input
                name="token"
                type="password"
                required
                autocomplete="off"
                placeholder="flk_…"
                aria-label={t('ключ MagicLinks')}
                class="input min-w-0 flex-1 font-mono"
              />
              <button class="btn btn-pri">{t('Сохранить ключ')}</button>
            </form>
          {/if}
        </div>
      </section>

      <section class="pane">
        <div class="pane-head">{t('369Team · второй провайдер')}
          {#if data.m369.configured && data.m369.balance}
            <span class="aside text-ink-2">{t('Баланс')} <b class="app-num text-ink">{credits(data.m369.balance.balanceMinor)}</b> {t('ток.')}</span>
          {/if}
        </div>
        <div class="pane-body flex flex-col gap-3 text-[12.5px] text-ink-2">
          {#if data.m369.configured}
            <p>
              {t('Ключ')} <code class="pii font-mono text-[12px] text-ink">{data.m369.masked}</code>
              {#if data.m369.source === 'env'}
                {t('задан переменной окружения')} <code class="font-mono text-[12px]">MAGIC369_API_TOKEN</code> {t('- она главнее базы, и со страницы её не снять.')}
              {:else}
                {t('хранится в базе хаба.')}
              {/if}
              <br />API: <code class="pii break-all font-mono text-[12px] text-ink">{data.m369.base}</code>
            </p>
            {#if data.m369.balance}
              <div class="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line bg-line">
                <div class="flex flex-col bg-pane px-2 py-1.5"><span class="stat-label">{t('Доступно')}</span><span class="stat-value">{credits(data.m369.balance.balanceMinor)}</span></div>
                <div class="flex flex-col bg-pane px-2 py-1.5"><span class="stat-label">{t('Цена поста')}</span><span class="stat-value">{credits(data.m369.balance.priceMinor)}</span></div>
                <div class="flex flex-col bg-pane px-2 py-1.5"><span class="stat-label">{t('Цена морды')}</span><span class="stat-value">{data.m369.balance.linkPriceMinor != null ? credits(data.m369.balance.linkPriceMinor) : '—'}</span></div>
              </div>
            {/if}
            <p class="text-[11px] text-ink-3">
              {t('Заказ здесь одношаговый: оплата списывает токены сразу. Списка заказов в API нет, поэтому покупки видны в истории striking и по прямой ссылке на заказ.')}
            </p>
            {#if data.m369.error}
              <p class="notice notice-warn">{data.m369.error}</p>
            {/if}
            <details class="border-t border-line-soft pt-2">
              <summary class="cursor-pointer text-ink-3 hover:text-ink">{t('Заменить или убрать ключ')}</summary>
              <form method="POST" action="?/save369Token" class="mt-2 flex flex-wrap items-end gap-2">
                <input
                  name="token"
                  type="password"
                  required
                  autocomplete="off"
                  placeholder="sk_…"
                  aria-label={t('ключ 369Team')}
                  class="input min-w-0 flex-1 font-mono"
                />
                <button class="btn btn-pri">{t('Сохранить')}</button>
              </form>
              {#if data.m369.source === 'db'}
                <form
                  method="POST"
                  action="?/clear369Token"
                  class="mt-3"
                  onsubmit={(e) => { if (!confirm(t('Убрать ключ 369Team из базы? Покупки пойдут только через FieldLink.'))) e.preventDefault(); }}
                >
                  <button class="btn btn-danger btn-sm">{t('Убрать ключ')}</button>
                </form>
              {/if}
            </details>
          {:else}
            <p class="notice border-line bg-sunk text-ink-2">
              {t('Нет регистрации или ключа? Пиши в Telegram')}
              <a class="link" href={MAGIC369_CONTACT.url} target="_blank" rel="noopener">{MAGIC369_CONTACT.handle}</a>.
            </p>
            <p>
              {t('Ключ выдаётся в сервисе 369Team (magiclinks.online). Хаб хранит его в своей базе и шлёт только на')}
              <code class="pii break-all font-mono text-[12px] text-ink">{data.m369.base}</code>{t('. Без ключа покупки идут только через FieldLink.')}
            </p>
            <form method="POST" action="?/save369Token" class="flex flex-wrap items-end gap-2">
              <input
                name="token"
                type="password"
                required
                autocomplete="off"
                placeholder="sk_…"
                aria-label={t('ключ 369Team')}
                class="input min-w-0 flex-1 font-mono"
              />
              <button class="btn btn-pri">{t('Сохранить ключ')}</button>
            </form>
          {/if}
        </div>
      </section>
    </aside>
  </div>
</main>
