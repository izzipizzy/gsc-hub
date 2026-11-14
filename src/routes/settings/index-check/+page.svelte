<script lang="ts">
  import { dateTime } from '$lib/utils/time';
  import SettingsNav from '$lib/components/SettingsNav.svelte';
  import { INDEX_CHECK_PROVIDERS, INDEX_CHECK_SERVICE_LINKS } from '$lib/utils/index-check';
  import { onMount } from 'svelte';
  import { t, tx, fmtDec, getLocale } from '$lib/i18n/index.svelte';
  import { intlTag } from '$lib/i18n/locale';
  import { enhance } from '$app/forms';
  let { data, form } = $props();
  const feedback = $derived({ provider: form?.provider, error: form?.error, saved: form?.saved });
  let balances = $state<Record<string, { busy?: boolean; amount?: number; currency?: string; checkedAt?: number; error?: string }>>({});
  async function refreshBalance(provider: 'xmlriver' | 'dataforseo') {
    if (balances[provider]?.busy) return;
    balances[provider] = { busy: true };
    try {
      const response = await fetch(`/settings/index-check/balance?provider=${provider}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? t('Баланс недоступен'));
      balances[provider] = result.balance;
    } catch (e) { balances[provider] = { error: (e as Error).name === 'TimeoutError' ? t('Баланс недоступен: истекло время ожидания') : (e as Error).message }; }
  }
  // One primary per page: only the first service still waiting for a key gets the blue Save.
  const firstPending = $derived(data.indexCheck.find((p) => !p.configured)?.id ?? null);
  const money = (amount: number, currency: string) => new Intl.NumberFormat(intlTag(getLocale()), { style: 'currency', currency, maximumFractionDigits: 4 }).format(amount);
  onMount(() => { for (const provider of data.indexCheck) if (provider.configured) refreshBalance(provider.id); });
</script>
<svelte:head><title>{t('Проверка индексации')} · {t('Настройки')} · gsc-hub</title></svelte:head>
<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs"><span>{t('Настройки')}</span><span aria-hidden="true">/</span><span class="text-ink-2">{t('Проверка индексации')}</span></nav>
      <h1 class="app-pagetitle">{t('Сервисы проверки индексации')}</h1>
      <p class="text-xs text-ink-3">{t('Проверяют, есть ли точный URL в выдаче Google. Ключи общие для всех доменов; запросы оплачиваются по тарифу сервиса.')}</p>
    </div>
    <div class="app-toolbar-right">
      <a href="/index-check" class="btn btn-ghost">{t('Открыть проверку индексации')}</a>
    </div>
  </header>

  <div class="desk md:grid-cols-[220px_minmax(0,1fr)]">
    <SettingsNav />
    <div class="desk-col">
      {#each data.indexCheck as provider (provider.id)}
        <section class="pane" aria-labelledby={'provider-' + provider.id}>
          <div class="pane-head">
            <span id={'provider-' + provider.id}>{INDEX_CHECK_PROVIDERS[provider.id]}</span>
            <span class="aside flex items-center gap-2" aria-live="polite">
              {#if provider.configured}
                <span>{t('баланс')} <span class="app-num text-ink-2">{balances[provider.id]?.amount !== undefined ? money(balances[provider.id].amount!, balances[provider.id].currency!) : balances[provider.id]?.busy ? t('загружается…') : t('недоступен')}</span></span>
                {#if balances[provider.id]?.checkedAt}<span class="app-num" title={t('Баланс проверен')}>{dateTime(balances[provider.id].checkedAt!)}</span>{/if}
                <button class="btn btn-ghost btn-sm" disabled={balances[provider.id]?.busy} onclick={() => refreshBalance(provider.id)}>{t('Обновить')}</button>
              {/if}
              <span class="badge {provider.configured ? 'badge-ok' : 'badge-muted'}">{provider.configured ? t('настроен') : t('не настроен')}</span>
            </span>
          </div>
          <div class="pane-body grid gap-3">
            {#if balances[provider.id]?.error}<p class="text-xs text-dn" role="status">{tx(balances[provider.id].error)}. {t('Проверьте ключ и нажмите «Обновить».')}</p>{/if}
            <p class="text-xs text-ink-3">{provider.id === 'xmlriver' ? t('User ID и ключ из настроек сбора Google в кабинете XML River.') : t('API Login и API Password из API Access, а не пароль входа в кабинет. Выдача: Google, США, английский.')}</p>
            {#if feedback.provider === provider.id && feedback.error}<p class="text-err" role="alert">{tx(feedback.error)}</p>{/if}
            {#if feedback.provider === provider.id && feedback.saved}<p class="text-[12.5px] text-up" role="status">{t('Настройки сохранены')}</p>{/if}
            <form method="POST" action="?/saveIndexCheck" use:enhance={() => async ({ update, result }) => { await update(); if (result.type === 'success') refreshBalance(provider.id); }} class="flex flex-wrap items-end gap-2">
              <input type="hidden" name="provider" value={provider.id} />
              {#each provider.fields as field (field.key)}
                <label class="grid min-w-48 flex-1 gap-1 text-xs text-ink-2">
                  <span>{tx(field.label)}{field.source === 'env' ? ` · ${t('задан в окружении')}` : ''}</span>
                  <input class="input w-full" name={field.key} type={field.key.endsWith('USER') || field.key.endsWith('LOGIN') ? 'text' : 'password'}
                    autocomplete="off" disabled={field.source === 'env'} maxlength="512" required={!field.configured}
                    placeholder={field.configured ? t('Сохранено; пустое поле сохраняет значение') : tx(field.label)} />
                </label>
              {/each}
              {#if provider.fields.some((f) => f.source !== 'env')}<button class="btn {firstPending === provider.id ? 'btn-pri' : 'btn-sec'}">{t('Сохранить')}</button>{/if}
            </form>
          </div>
          <form method="POST" action="?/saveCheckOptions" use:enhance class="pane-body grid gap-3 border-t border-line-soft sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end">
            <input type="hidden" name="provider" value={provider.id} />
            {#each provider.options as option (option.key)}
              <label class="grid gap-1 text-xs text-ink-2"><span>{tx(option.label)}</span>
                <input class="input app-num w-full" type="number" name={option.key} value={option.value} min={option.min} max={option.max} step="1" required disabled={option.source === 'env'} />
                {#if option.source === 'env'}<span class="text-ink-3">{t('Задано в окружении')}</span>{/if}
              </label>
            {/each}
            <button class="btn btn-sec" disabled={provider.options.every((o) => o.source === 'env')}>{t('Сохранить')}</button>
            <p class="text-xs text-ink-3 sm:col-span-4">{t('Применяются к новым запускам. Повторяются временные ошибки, тайм-ауты и занятые каналы; 0 повторов отключает их. Сервис может продлить паузу при блокировке. После тайм-аута возможна повторная оплата; ошибки ключа и баланса не повторяются.')}{provider.id === 'xmlriver' ? ` ${t('Если каналы заняты, уменьшите число потоков.')}` : ''}</p>
          </form>
          <div class="flex flex-wrap gap-2 border-t border-line-soft px-3 py-2">
            {#if provider.fields.some((f) => f.source === 'db')}
              <form method="POST" action="?/clearIndexCheck" use:enhance={() => async ({ update, result }) => { await update(); if (result.type === 'success') balances[provider.id] = {}; }}>
                <input type="hidden" name="provider" value={provider.id} /><button class="btn btn-ghost btn-sm">{t('Удалить API-данные')}</button>
              </form>
            {/if}
            <a class="btn btn-ghost btn-sm" href={INDEX_CHECK_SERVICE_LINKS[provider.id].homepage} target="_blank" rel={provider.id === 'dataforseo' ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}>{t('Открыть {name}', { name: INDEX_CHECK_PROVIDERS[provider.id] })}</a>
            <a class="btn btn-ghost btn-sm" href={INDEX_CHECK_SERVICE_LINKS[provider.id].docs} target="_blank" rel="noopener noreferrer">{t('API-документация')}</a>
          </div>
        </section>
      {/each}
    </div>
  </div>
</main>
