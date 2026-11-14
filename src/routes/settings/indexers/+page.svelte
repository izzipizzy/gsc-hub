<script lang="ts">
  import { enhance } from '$app/forms';
  import SettingsNav from '$lib/components/SettingsNav.svelte';
  import { t, tx, fmtDec } from '$lib/i18n/index.svelte';
  let { data, form } = $props();
</script>

<svelte:head><title>{t('Индексаторы')} · {t('Настройки')} · gsc-hub</title></svelte:head>
<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs"><span>{t('Настройки')}</span><span aria-hidden="true">/</span><span class="text-ink-2">{t('Индексаторы')}</span></nav>
      <h1 class="app-pagetitle">{t('Индексаторы')}</h1>
      <p class="text-xs text-ink-3">{t('Принудительная отправка страниц и карт сайта в индекс Google. Проверка, попали ли страницы в индекс, — отдельный раздел.')}</p>
    </div>
    <div class="app-toolbar-right">
      <a href="/settings/index-check" class="btn btn-ghost">{t('Сервисы проверки индексации')}</a>
    </div>
  </header>

  <div class="desk md:grid-cols-[220px_minmax(0,1fr)]">
    <SettingsNav />
    <div class="desk-col">
      <section class="pane" aria-labelledby="neuralindexer">
        <div class="pane-head">
          <span id="neuralindexer">NeuralIndexer · Inderixing</span>
          <span class="aside"><span class="badge {data.configured ? 'badge-ok' : 'badge-muted'}">{data.configured ? t('ключ настроен') : t('ключ не задан')}{data.source === 'env' ? ` · ${t('в окружении')}` : ''}</span></span>
        </div>
        <div class="pane-body grid gap-3">
          <p class="text-xs text-ink-3">{t('Один API-ключ для всех доменов. Отправка страниц и карт сайта — меню «Индексация» на странице сайта.')}</p>
          {#if form?.error}<p class="text-err" role="alert">{tx(form.error)}</p>{/if}
          {#if form?.saved}<p class="text-[12.5px] text-up" role="status">{t('Настройки сохранены')}</p>{/if}
          {#if form?.balance !== undefined}<p class="text-[12.5px]">{t('Баланс')}: <span class="app-num">${fmtDec(Number(form.balance), 4)}</span></p>{/if}
          {#if data.source !== 'env'}
            <form method="POST" action="?/save" use:enhance class="flex flex-wrap items-end gap-2">
              <label class="grid min-w-0 flex-1 gap-1 text-xs text-ink-2">
                <span>{t('API-ключ')}</span>
                <input class="input w-full" type="password" name="token" autocomplete="new-password" placeholder={data.configured ? t('Сохранён; введите новый, чтобы заменить') : t('вставьте ключ')} required />
              </label>
              <button class="btn {data.configured ? 'btn-sec' : 'btn-pri'}">{t('Сохранить')}</button>
            </form>
          {/if}
          <div class="flex flex-wrap gap-2">
            {#if data.configured && data.source !== 'env'}<form method="POST" action="?/clear" use:enhance><button class="btn btn-ghost">{t('Удалить ключ')}</button></form>{/if}
            <a class="btn btn-ghost" href="https://inderixingbot.com/docs" target="_blank" rel="noopener noreferrer">{t('Документация')}</a>
            {#if data.configured}<form method="POST" action="?/test" use:enhance><button class="btn btn-sec">{t('Проверить доступ и баланс')}</button></form>{/if}
          </div>
        </div>
      </section>
    </div>
  </div>
</main>
