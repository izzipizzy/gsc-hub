<script lang="ts">
  import { INDEX_CHECK_PROVIDERS, INDEX_CHECK_SERVICE_LINKS } from '$lib/utils/index-check';
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  let { data, form } = $props();
  const feedback = $derived({ provider: form?.provider, error: form?.error, saved: form?.saved, balance: form?.balance });
  let balances = $state<Record<string, { busy?: boolean; amount?: number; currency?: string; checkedAt?: number; error?: string }>>({});
  async function refreshBalance(provider: 'xmlriver' | 'dataforseo') {
    if (balances[provider]?.busy) return;
    balances[provider] = { busy: true };
    try {
      const response = await fetch(`/settings/integrations/balance?provider=${provider}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Баланс недоступен');
      balances[provider] = result.balance;
    } catch (e) { balances[provider] = { error: (e as Error).name === 'TimeoutError' ? 'Баланс недоступен: истекло время ожидания' : (e as Error).message }; }
  }
  onMount(() => { for (const provider of data.indexCheck) if (provider.configured) refreshBalance(provider.id); });
</script>
<svelte:head><title>Индексаторы · GSC Hub</title></svelte:head>
<div class="mx-auto max-w-2xl p-6">
  <h1 class="mb-4 text-xl font-semibold">Индексаторы</h1>
  <p class="mb-4 text-ink-2">Сервисы индексации и их API-ключи. Ключ каждого сервиса используется для всех доменов.</p>
  <div class="rounded-sm border border-line bg-pane p-5">
    <h2 class="mb-2 font-semibold">NeuralIndexer · Inderixing</h2>
    <p class="mb-4 text-ink-2">Один API-ключ для всех доменов. Отправка страниц и карт сайта — кнопка «Индексация» на странице домена.</p>
    <p class="mb-3">{data.configured ? 'Ключ настроен' : 'Ключ не настроен'}{data.source === 'env' ? ' · задан в окружении' : ''}</p>
    {#if feedback.error && !feedback.provider}<p class="mb-3 text-red-600">{feedback.error}</p>{/if}
    {#if feedback.saved && !feedback.provider}<p class="mb-3 text-emerald-600">Настройки сохранены</p>{/if}
    {#if feedback.balance !== undefined}<p class="mb-3">Баланс: ${Number(feedback.balance).toFixed(4)}</p>{/if}
    {#if data.source !== 'env'}
      <form method="POST" action="?/save" use:enhance class="flex gap-2 mb-3">
        <input class="input flex-1" type="password" name="token" autocomplete="new-password" placeholder="API-ключ" aria-label="API-ключ NeuralIndexer" required />
        <button class="btn btn-pri">Сохранить</button>
      </form>
    {/if}
    <div class="flex gap-2">
      {#if data.configured}<form method="POST" action="?/test" use:enhance><button class="btn btn-sec">Проверить доступ и баланс</button></form>{/if}
      {#if data.configured && data.source !== 'env'}<form method="POST" action="?/clear" use:enhance><button class="btn btn-ghost">Удалить ключ</button></form>{/if}
      <a class="btn btn-ghost" href="https://inderixingbot.com/docs" target="_blank" rel="noopener noreferrer">Документация сервиса ↗</a>
    </div>
  </div>

  <section class="mt-5" aria-labelledby="index-check-settings">
    <h2 id="index-check-settings" class="mb-2 font-semibold">Проверка индексации</h2>
    <p class="mb-4 text-ink-2">Выбери сайт, получи URL из sitemap и проверь их через настроенный сервис. Запросы к провайдеру оплачиваются по его тарифу.</p>
    <a href="/index-check" class="btn btn-sec mb-4">Открыть проверку индексации</a>
    <div class="grid gap-4">
      {#each data.indexCheck as provider (provider.id)}
        <section class="rounded-sm border border-line bg-pane p-5" aria-labelledby={'provider-' + provider.id}>
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 id={'provider-' + provider.id} class="font-semibold">{INDEX_CHECK_PROVIDERS[provider.id]}</h3>
            <span class="badge {provider.configured ? 'badge-ok' : 'badge-muted'}">{provider.configured ? 'Настроен' : 'Не настроен'}</span>
          </div>
          <div class="mb-3 flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
            <span>Баланс: <span class="app-num">{balances[provider.id]?.amount !== undefined ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: balances[provider.id].currency, maximumFractionDigits: 4 }).format(balances[provider.id].amount!) : balances[provider.id]?.busy ? 'Загружается…' : provider.configured ? 'Недоступен' : 'Настрой API'}</span></span>
            {#if provider.configured}<button class="btn btn-ghost btn-sm" disabled={balances[provider.id]?.busy} onclick={() => refreshBalance(provider.id)}>Обновить баланс</button>{/if}
            {#if balances[provider.id]?.checkedAt}<span class="text-xs text-ink-3">{new Date(balances[provider.id].checkedAt!).toLocaleString('ru-RU')}</span>{/if}
          </div>
          {#if balances[provider.id]?.error}<p class="mb-3 text-xs text-dn" role="status">{balances[provider.id].error}. Проверь ключ и нажми «Обновить баланс».</p>{/if}
          <p class="mb-3 text-xs text-ink-3">{provider.id === 'xmlriver' ? 'User ID и ключ из настроек сбора Google в кабинете XML River.' : 'API Login и API Password из API Access, а не пароль входа в кабинет. Выдача: Google, США, английский.'}</p>
          {#if feedback.provider === provider.id && feedback.error}<p class="mb-3 text-dn" role="alert">{feedback.error}</p>{/if}
          {#if feedback.provider === provider.id && feedback.saved}<p class="mb-3 text-up" role="status">Настройки сохранены</p>{/if}
          <form method="POST" action="?/saveIndexCheck" use:enhance={() => async ({ update, result }) => { await update(); if (result.type === 'success') refreshBalance(provider.id); }} class="mb-3 grid gap-3">
            <input type="hidden" name="provider" value={provider.id} />
            {#each provider.fields as field (field.key)}
              <label class="grid gap-1 text-xs text-ink-2">
                <span>{field.label}{field.source === 'env' ? ' · задан в окружении' : ''}</span>
                <input class="input w-full" name={field.key} type={field.key.endsWith('USER') || field.key.endsWith('LOGIN') ? 'text' : 'password'}
                  autocomplete="off" disabled={field.source === 'env'} maxlength="512" required={!field.configured}
                  placeholder={field.configured ? 'Сохранено; пустое поле сохраняет значение' : field.label} />
              </label>
            {/each}
            {#if provider.fields.some((f) => f.source !== 'env')}<button class="btn btn-pri justify-self-start">Сохранить {INDEX_CHECK_PROVIDERS[provider.id]}</button>{/if}
          </form>
          <form method="POST" action="?/saveCheckOptions" use:enhance class="mb-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
            <input type="hidden" name="provider" value={provider.id} />
            {#each provider.options as option (option.key)}
              <label class="grid gap-1 text-xs text-ink-2"><span>{option.label}</span>
                <input class="input w-full" type="number" name={option.key} value={option.value} min={option.min} max={option.max} step="1" required disabled={option.source === 'env'} />
                {#if option.source === 'env'}<span class="text-ink-3">Задано в окружении</span>{/if}
              </label>
            {/each}
            <p class="text-xs text-ink-3 sm:col-span-3">Настройки применяются к новым запускам. Повторяются временные ошибки, тайм-ауты и занятые каналы. 0 повторов отключает их. Сервис может продлить паузу при блокировке. После тайм-аута возможна повторная оплата; ошибки ключа и баланса не повторяются.{provider.id === 'xmlriver' ? ' Если каналы заняты, уменьши число потоков.' : ''}</p>
            <button class="btn btn-sec justify-self-start sm:col-span-3" disabled={provider.options.every((o) => o.source === 'env')}>Сохранить параметры {INDEX_CHECK_PROVIDERS[provider.id]}</button>
          </form>
          <div class="flex flex-wrap gap-2">
            {#if provider.fields.some((f) => f.source === 'db')}
              <form method="POST" action="?/clearIndexCheck" use:enhance={() => async ({ update, result }) => { await update(); if (result.type === 'success') balances[provider.id] = {}; }}>
                <input type="hidden" name="provider" value={provider.id} /><button class="btn btn-ghost">Удалить API-данные</button>
              </form>
            {/if}
            <a class="btn btn-ghost" href={INDEX_CHECK_SERVICE_LINKS[provider.id].homepage} target="_blank" rel={provider.id === 'dataforseo' ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}>Открыть {INDEX_CHECK_PROVIDERS[provider.id]}</a>
            <a class="btn btn-ghost" href={INDEX_CHECK_SERVICE_LINKS[provider.id].docs} target="_blank" rel="noopener noreferrer">API-документация</a>
          </div>
        </section>
      {/each}
    </div>
  </section>
</div>
