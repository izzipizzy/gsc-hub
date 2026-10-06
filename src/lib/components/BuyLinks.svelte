<script lang="ts">
  import { FIELDLINK_SIGNUP_URL, MAGIC369_CONTACT } from '$lib/utils/magiclinks-signup';
  import { customPurchaseUrl, siteHostname } from '$lib/utils/url-filters';
  import { untrack } from 'svelte';
  import { LANGUAGE_OPTIONS, defaultLanguageForHost } from '$lib/utils/lang';

  interface BuyRow {
    targetUrl: string;
    query: string;
    siteHost: string;
  }
  interface BoughtEvent {
    orderId: string;
    items: { targetUrl: string; query: string; quantity: number }[];
  }
  interface ProviderInfo {
    id: string;
    name: string;
    unit: string;
    configured: boolean;
    balanceMinor: number | null;
    priceMinor: number | null;
    error: string | null;
  }

  let {
    rows,
    customSite,
    onclose,
    onbought
  }: {
    rows: BuyRow[];
    customSite?: string;
    onclose: () => void;
    onbought: (e: BoughtEvent) => void;
  } = $props();

  let path = $state('');
  let customText = $state('');
  const customOrigin = $derived(customSite ? new URL(customSite.startsWith('sc-domain:') ? `https://${customSite.slice(10)}/` : customSite).origin : '');
  const hosts = $derived(customSite ? [siteHostname(customSite)] : [...new Set(rows.map((r) => r.siteHost))].sort());
  let quotedRows = $state<BuyRow[]>([]);

  function purchaseRows(): BuyRow[] {
    if (!customSite) return rows;
    const targetUrl = customPurchaseUrl(path, customSite);
    const query = customText.trim();
    if (!query || query.length > 300) throw new Error('Текст ссылки должен содержать от 1 до 300 символов');
    return [{ targetUrl, query, siteHost: siteHostname(customSite) }];
  }

  // Язык на каждый сайт: гео из Search Console языком не является, поэтому
  // домен только подсказывает, а неоднозначный (.com и прочие) оператор
  // выбирает сам. Считаем один раз при открытии: связанный select пишет в эту
  // же карту, и эффект-досыльщик затирал бы ручной выбор.
  // untrack: набор строк на время жизни окна не меняется, и подсказка нужна
  // ровно одна — стартовая.
  let langs = $state<Record<string, string>>(
    untrack(() =>
      Object.fromEntries(
        hosts.map((h) => [h, defaultLanguageForHost(h)])
      )
    )
  );

  let count = $state(5);
  const missingLang = $derived(hosts.filter((h) => !langs[h]));
  const requested = $derived((customSite ? 1 : rows.length) * count);
  const estimateBonus = $derived(Math.ceil(requested / 4));

  type Quote = {
    placementCount: number;
    bonusCount: number;
    totalPlacementCount: number;
    amountMinor: number;
    balanceMinor: number;
    shortfallMinor: number;
    canSubmit: boolean;
    indexingIncluded?: boolean;
  };

  // Провайдеры читаются живьём при открытии окна; по умолчанию выбирается тот,
  // у кого больше денег. Пока список не приехал, выбора нет — кнопка расчёта
  // заблокирована.
  let providers = $state<ProviderInfo[]>([]);
  let providerId = $state('');
  let providersFailed = $state(false);
  const provider = $derived(providers.find((p) => p.id === providerId) ?? null);
  const configuredProviders = $derived(providers.filter((p) => p.configured));
  const unit = $derived(provider?.unit ?? 'кр.');
  const priceMinor = $derived(provider?.priceMinor ?? null);
  const estimateMinor = $derived(priceMinor !== null ? requested * priceMinor : null);

  $effect(() => {
    loadProviders();
  });

  async function loadProviders() {
    try {
      const res = await fetch('/magiclinks/providers');
      if (!res.ok) {
        providersFailed = true;
        return;
      }
      const data = (await res.json()) as { providers?: ProviderInfo[] };
      providers = data.providers ?? [];
      const ready = providers.filter((p) => p.configured && p.balanceMinor != null);
      // По умолчанию — провайдер, где больше денег; при равенстве побеждает
      // первый в списке.
      const best = [...ready].sort((a, b) => (b.balanceMinor ?? 0) - (a.balanceMinor ?? 0))[0];
      providerId = best?.id ?? providers.find((p) => p.configured)?.id ?? '';
    } catch {
      providersFailed = true;
    }
  }

  let step = $state<'form' | 'quote' | 'done'>('form');
  let busy = $state(false);
  let err = $state<string | null>(null);
  let quote = $state<Quote | null>(null);
  let taskId = $state<string | null>(null);
  let orderId = $state<string | null>(null);

  const credits = (minor: number) => (minor / 100).toFixed(2);

  function changeProvider() {
    // Смена провайдера обнуляет расчёт: суммы у них разные.
    step = 'form';
    quote = null;
    taskId = null;
    err = null;
  }

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* прокси мог вернуть не JSON */
    }
    if (!res.ok) throw new Error(data?.message ?? `Ошибка ${res.status}`);
    return data;
  }

  async function getQuote() {
    if (busy || missingLang.length > 0 || !providerId) return;
    busy = true;
    err = null;
    try {
      const items = purchaseRows();
      const data = await post('/magiclinks/purchase', {
        provider: providerId,
        items: items.map((r) => ({
          targetUrl: r.targetUrl,
          query: r.query,
          language: langs[r.siteHost],
          count
        }))
      });
      quotedRows = items;
      taskId = data.taskId ?? null;
      quote = data.quote;
      step = 'quote';
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function submit() {
    if (busy || !quote) return;
    busy = true;
    err = null;
    try {
      // Платим ровно по той сумме, которую вернул расчёт. 369Team одноразовый:
      // строки уходят заново, цену он перепроверяет перед созданием заказа.
      const data = await post('/magiclinks/purchase/submit', {
        provider: providerId,
        taskId,
        expectedMinor: quote.amountMinor,
        items:
          providerId === 'magic369'
            ? quotedRows.map((r) => ({
                targetUrl: r.targetUrl,
                query: r.query,
                language: langs[r.siteHost],
                count
              }))
            : undefined
      });
      orderId = data.orderId;
      step = 'done';
      onbought({
        orderId: data.orderId,
        items: quotedRows.map((r) => ({ targetUrl: r.targetUrl, query: r.query, quantity: count }))
      });
    } catch (e) {
      err = (e as Error).message;
      // Расчёт мог устареть: возвращаем на шаг назад, чтобы посчитать заново.
      step = 'form';
      quote = null;
    } finally {
      busy = false;
    }
  }
</script>

<div
  class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4"
  role="presentation"
  onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}
>
  <div class="mt-10 w-full max-w-xl rounded border border-line bg-pane text-[12.5px] shadow-[0_12px_40px_-12px_rgb(19_23_34/0.35)]" role="dialog" aria-modal="true" aria-labelledby="buylinks-title">
    <div class="pane-head">
      <h2 id="buylinks-title">Купить ссылки</h2>
      <div class="flex items-center gap-2">
        {#if quote}
          <span class="aside text-ink-2">Баланс <b class="app-num text-ink">{credits(quote.balanceMinor)}</b> {unit}</span>
        {/if}
        <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Закрыть" onclick={onclose}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-3 p-3">
    {#if step === 'done'}
      <p class="notice border-up/25 bg-up-t text-up">
        Заказ создан. Позиции появляются по мере публикации.
      </p>
      <div class="flex items-center gap-2">
        <button type="button" class="btn btn-sec" onclick={onclose}>Закрыть</button>
        <a class="btn btn-pri ml-auto" href="/magiclinks/{orderId}">Смотреть заказ <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg></a>
      </div>
    {:else}
      {#if customSite}
        <label class="flex flex-col gap-1">
          <span class="text-[11px] text-ink-3">Путь страницы</span>
          <span class="pii break-all text-ink-2">{customOrigin}</span>
          <input class="input w-full disabled:bg-sunk disabled:text-ink-3" bind:value={path} placeholder="/page/" maxlength="2000" disabled={step === 'quote' || busy} />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-[11px] text-ink-3">Текст ссылки / ключевые слова статьи</span>
          <input class="input w-full disabled:bg-sunk disabled:text-ink-3" bind:value={customText} placeholder="Текст для ссылки" maxlength="300" disabled={step === 'quote' || busy} />
        </label>
      {:else}
        <p class="text-ink-2">
          Выбрано строк: <b class="app-num text-ink">{rows.length}</b>. Анкор и ключевые слова для статьи - сам запрос,
          акцептор - URL страницы из строки.
        </p>
      {/if}

      <div class="flex flex-col gap-1">
        <span class="text-[11px] text-ink-3">Провайдер</span>
        <select
          bind:value={providerId}
          disabled={step === 'quote' || busy}
          onchange={changeProvider}
          class="input h-7 text-xs disabled:bg-sunk disabled:text-ink-3"
        >
          {#if providers.length === 0}
            <option value="">загружаю балансы…</option>
          {/if}
          {#each configuredProviders as p (p.id)}
            <option value={p.id}>
              {p.name} · {p.balanceMinor != null ? `${credits(p.balanceMinor)} ${p.unit}` : 'баланс не читается'}
            </option>
          {/each}
        </select>
        {#each providers.filter((p) => !p.configured) as p (p.id)}
          <p class="text-xs text-ink-3">
            {#if p.id === 'magic369'}
              {p.name}: нет ключа - пиши в Telegram <a class="text-acc hover:underline" href={MAGIC369_CONTACT.url} target="_blank" rel="noopener">{MAGIC369_CONTACT.handle}</a>.
              No API key - message <a class="text-acc hover:underline" href={MAGIC369_CONTACT.url} target="_blank" rel="noopener">{MAGIC369_CONTACT.handle}</a> on Telegram.
            {:else}
              {p.name}: нет ключа - <a class="text-acc hover:underline" href={FIELDLINK_SIGNUP_URL} target="_blank" rel="noopener">регистрация</a>, ключ потом на странице MagicLinks.
              No API key - <a class="text-acc hover:underline" href={FIELDLINK_SIGNUP_URL} target="_blank" rel="noopener">sign up</a> first.
            {/if}
          </p>
        {/each}
        {#if providersFailed}
          <p class="text-xs text-warn">
            Балансы провайдеров не загрузились, выбор недоступен. Закрой окно и открой снова;
            если не поможет - проверь ключи на странице MagicLinks.
          </p>
        {/if}
        {#if provider?.error}
          <p class="text-xs text-warn">Баланс {provider.name} не читается: {provider.error}</p>
        {/if}
      </div>

      {#if !customSite}
      <div class="flex flex-col gap-1">
        <span class="text-[11px] text-ink-3">Позиции</span>
        <div class="max-h-40 overflow-y-auto rounded border border-line">
          <table class="w-full text-[12px]">
            <tbody>
              {#each rows.slice(0, 50) as r (r.targetUrl + r.query)}
                <tr class="border-b border-line-soft last:border-0">
                  <td class="px-2 py-1 pii text-ink">{r.query}</td>
                  <td class="px-2 py-1 pii text-ink-3">{r.targetUrl.replace(/^https?:\/\//, '')}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if rows.length > 50}
            <p class="px-2 py-1 text-xs text-ink-3">…и ещё {rows.length - 50}</p>
          {/if}
        </div>
      </div>

      {/if}

      <label class="flex flex-col gap-1">
        <span class="text-[11px] text-ink-3">Ссылок на строку</span>
        <input
          type="number"
          min="1"
          max="250"
          bind:value={count}
          disabled={step === 'quote' || busy}
          class="input app-num w-24 disabled:bg-sunk disabled:text-ink-3"
        />
      </label>

      <div class="flex flex-col gap-1">
        <span class="text-[11px] text-ink-3">Язык статьи по сайтам</span>
        <div class="flex flex-col divide-y divide-line-soft rounded border border-line">
          {#each hosts as h (h)}
            <label class="flex items-center justify-between gap-2 px-2 py-1">
              <span class="pii min-w-0 truncate text-ink">{h}</span>
              <select bind:value={langs[h]} disabled={step === 'quote' || busy} class="input h-6 text-xs disabled:bg-sunk disabled:text-ink-3">
                <option value="">выбери</option>
                {#each LANGUAGE_OPTIONS as l (l.code)}
                  <option value={l.code}>{l.label}</option>
                {/each}
              </select>
            </label>
          {/each}
        </div>
        {#if missingLang.length > 0}
          <p class="text-xs text-warn">
            Язык не угадывается по домену, выбери сам: {missingLang.join(', ')}
          </p>
        {/if}
      </div>

      {#if err}
        <p class="app-errors mb-0">{err}</p>
      {/if}

      <div class="flex flex-col">
        {#if step === 'quote' && quote}
          <div class="flex justify-between py-[3px]"><span>Заказано</span><span class="app-num">{quote.placementCount}</span></div>
          {#if quote.bonusCount > 0}
            <div class="flex justify-between py-[3px] text-up"><span>Бонус</span><span class="app-num">+{quote.bonusCount}</span></div>
            <div class="flex justify-between py-[3px]"><span>Итого позиций</span><span class="app-num">{quote.totalPlacementCount}</span></div>
          {/if}
          <div class="flex justify-between py-[3px] text-ink-3"><span>На балансе</span><span class="app-num">{credits(quote.balanceMinor)} {unit}</span></div>
          {#if quote.shortfallMinor > 0}
            <div class="flex justify-between py-[3px] text-dn"><span>Не хватает</span><span class="app-num">{credits(quote.shortfallMinor)} {unit}</span></div>
          {/if}
          <div class="mt-1 flex justify-between border-t border-line pt-2 font-bold text-ink"><span>К списанию</span><span class="app-num text-[12.5px]">{credits(quote.amountMinor)} {unit}</span></div>
          {#if quote.indexingIncluded}
            <p class="notice notice-warn mt-2 text-xs">
              Индексация включена: отправленный заказ нельзя отменить или убрать в корзину.
            </p>
          {/if}
        {:else}
          <div class="flex justify-between py-[3px]"><span>Заказано</span><span class="app-num">{requested}</span></div>
          {#if providerId === 'fieldlink'}
            <div class="flex justify-between py-[3px] text-up"><span>Бонус</span><span class="app-num">+{estimateBonus}</span></div>
          {/if}
          <div class="mt-1 flex justify-between border-t border-line pt-2 font-bold text-ink"><span>Примерно</span><span class="app-num text-[12.5px]">{estimateMinor !== null ? `${credits(estimateMinor)} ${unit}` : '—'}</span></div>
        {/if}
      </div>

      <div class="flex flex-col gap-2">
        {#if step === 'form'}
          <button
            type="button"
            class="btn btn-sec w-full"
            disabled={busy || (!customSite && rows.length === 0) || count < 1 || missingLang.length > 0 || !providerId}
            onclick={getQuote}
          >{busy ? 'Считаю…' : 'Посчитать цену'}</button>
        {:else if quote}
          <button
            type="button"
            class="btn btn-buy btn-lg w-full"
            disabled={busy || !quote.canSubmit}
            onclick={submit}
          >{busy ? 'Отправляю…' : `Оплатить ${credits(quote.amountMinor)} ${unit} и запустить`}</button>
        {/if}
        <div class="flex items-center gap-2">
          <button type="button" class="btn btn-ghost" onclick={onclose}>Отмена</button>
          {#if step === 'quote' && quote}
            <button
              type="button"
              class="btn btn-sec ml-auto"
              disabled={busy}
              onclick={() => { step = 'form'; quote = null; }}
            >Назад</button>
          {/if}
        </div>
      </div>

      <p class="text-[11px] text-ink-3">
        {#if step === 'form'}
          {#if providerId === 'magic369'}
            Расчёт по текущей цене сервиса. Оплата создаст заказ сразу: деньги списываются
            в момент создания, отменить нельзя.
          {:else}
            Денег не тратит: сохраняет задание в сервисе и показывает точную сумму от него.
            Списание - только на следующем шаге, по кнопке с суммой.
          {/if}
        {:else if providerId === 'magic369'}
          Вот это уже платит: заказ уходит сразу, токены списываются в момент создания.
        {:else}
          Вот это уже платит: резервирует сумму и запускает размещение.
          Списываются только проверенные выполненные позиции, бонусные бесплатны.
        {/if}
      </p>
    {/if}
    </div>
  </div>
</div>
