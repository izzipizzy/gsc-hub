<script lang="ts">
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, getLocale } from '$lib/i18n/index.svelte';
  import { enhance } from '$app/forms';
  import SettingsNav from '$lib/components/SettingsNav.svelte';
  let { data, form } = $props();
</script>

<svelte:head><title>{t('Портфель')} · {t('Настройки')} · gsc-hub</title></svelte:head>
<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs"><span>{t('Настройки')}</span><span aria-hidden="true">/</span><span class="text-ink-2">{t('Портфель')}</span></nav>
      <h1 class="app-pagetitle">{t('Портфель')}</h1>
    </div>
  </header>

  <div class="desk md:grid-cols-[220px_minmax(0,1fr)]">
    <SettingsNav />
    <div class="desk-col">
      <section class="pane" aria-labelledby="top-rows">
        <div class="pane-head"><span id="top-rows">{t('Top queries и Top pages на странице Сайты')}</span><span class="aside">{t('сайтов в портфеле')} <span class="app-num text-ink-2">{fmtNum(data.sites)}</span></span></div>
        <div class="pane-body grid gap-3">
          <p class="max-w-[75ch] text-[12.5px] text-ink-2">
            {t('Сколько строк хаб берёт из Search Console с каждого сайта. Больше строк — в таблицу и фильтры попадают редкие запросы, но больше квоты и памяти: все строки всех сайтов держатся в памяти между обновлениями.')}
          </p>
          <p class="max-w-[75ch] text-xs text-ink-3">
            {t('Пустое поле — авто. Для запросов авто = {budget} строк на весь портфель, делённые на число сайтов, но от {min} до {max}. Внутри сайта и в CSV-экспорте эти лимиты не действуют.', { budget: fmtNum(data.budget), min: data.autoRange.min, max: data.autoRange.max })}
          </p>
          {#if form?.error}<p class="text-err" role="alert">{tx(form.error)}</p>{/if}
          {#if form?.saved}<p class="text-[12.5px] text-up" role="status">{t('Сохранено. Строки соберутся заново при следующем открытии Top-блоков.')}</p>{/if}
          <form method="POST" action="?/save" use:enhance class="grid gap-3 sm:grid-cols-[repeat(2,minmax(0,16rem))_auto] sm:items-start">
            {#each [data.queries, data.pages] as s (s.kind)}
              <label class="grid gap-1 text-xs text-ink-2">
                <span>{s.kind === 'queries' ? t('Строк запросов с сайта') : t('Строк страниц с сайта')}</span>
                <input class="input app-num w-full" type="number" name={s.kind} min="1" max={data.max} step="1"
                  value={s.pinned ?? ''} placeholder={t('авто: {n}', { n: s.auto })} disabled={s.source === 'env'} />
                <span class="text-ink-3">
                  {t('Сейчас')} <span class="app-num">{s.effective}</span>{s.pinned === null ? ` (${t('авто')})` : ''}{s.source === 'env' ? ` · ${t('задано в окружении')}` : ''}
                </span>
              </label>
            {/each}
            <button class="btn btn-pri sm:mt-[18px]">{t('Сохранить')}</button>
          </form>
        </div>
      </section>
    </div>
  </div>
</main>
