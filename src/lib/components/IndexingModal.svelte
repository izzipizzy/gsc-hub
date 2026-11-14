<script lang="ts">
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, getLocale } from '$lib/i18n/index.svelte';
  import { isoDate, dateTime, clock } from '$lib/utils/time';
  import { onMount } from 'svelte';
  let { site, onclose }: { site: string; onclose: () => void } = $props();
  const endpoint = $derived(`/properties/${encodeURIComponent(site)}/indexing`);
  let mode = $state('pages'), input = $state(''), queue = $state('slow'), busy = $state(false), message = $state('');
  let configured = $state(false), history = $state<any[]>([]), quote = $state<any>(null), result = $state<any>(null);
  async function load() {
    try { const res = await fetch(endpoint); if (!res.ok) throw new Error(`HTTP ${res.status}`); const d = await res.json(); configured = d.configured; history = d.history; }
    catch(e) { message = (e as Error).message; }
  }
  onMount(load);
  async function act(action: string, id?: string) {
    busy = true; message = ''; result = null;
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'submit' ? { action, id: id ?? quote.id } : { action, mode, input, queue }) });
      const d = await res.json(); if (!res.ok) throw new Error(d.message ?? `HTTP ${res.status}`);
      if (action === 'quote') quote = d.quote;
      else { result = d.result; quote = null; await load(); }
    } catch(e) { message = (e as Error).message; if (action === 'submit') { quote = null; await load(); } }
    finally { busy = false; }
  }
  function reset() { quote = null; result = null; }
  const money = (n: number) => Number(n).toFixed(4);
</script>
<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !busy) onclose(); }} />
<div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4" role="presentation" onclick={(e) => { if (e.target === e.currentTarget && !busy) onclose(); }}>
  <div class="mt-10 w-full max-w-2xl rounded-sm border border-line bg-pane text-[12.5px] shadow-modal" role="dialog" aria-modal="true" aria-labelledby="indexing-title" tabindex="-1">
    <div class="pane-head"><h2 id="indexing-title">{t('Индексация')}</h2><button class="btn btn-ghost" disabled={busy} onclick={onclose}>{t('Закрыть')}</button></div>
    <div class="space-y-3 p-4">
      <p class="text-ink-2">{t('Сервис:')} <b class="text-ink">NeuralIndexer · Inderixing</b></p>
      {#if !configured}<p>{t('Укажи ключ в')} <a class="text-acc underline" href="/settings/indexers">{t('разделе «Индексаторы»')}</a>.</p>{/if}
      <label class="block">{t('Источник')}<select class="input mt-1 w-full" bind:value={mode} onchange={reset} disabled={busy}><option value="pages">{t('Отдельные страницы')}</option><option value="sitemap">{t('Карта сайта (включая дочерние карты)')}</option></select></label>
      <label class="block">{mode === 'sitemap' ? t('URL карты сайта или /sitemap.xml') : t('URL или пути страниц — по одному на строку')}
        <textarea class="input mt-1 w-full h-auto! py-2" rows={mode === 'sitemap' ? 2 : 6} bind:value={input} oninput={reset} disabled={busy} placeholder={mode === 'sitemap' ? '/sitemap.xml' : '/page-1/\n/page-2/'}></textarea>
      </label>
      <label class="block">{t('Очередь')}<select class="input mt-1 w-full" bind:value={queue} onchange={reset} disabled={busy}><option value="slow">{t('Обычная · Google + Bing')}</option><option value="fast">{t('Быстрая · Google')}</option><option value="yandex">{t('Яндекс')}</option></select></label>
      <p class="text-ink-2">{t('Только URL текущего домена. Дубли удаляются. Расчёт не отправляет страницы на индексацию.')}</p>
      {#if message}<p class="text-dn">{tx(message)}</p>{/if}
      {#if result}<p class="text-up">{t('Отправка #')}{result.submissionId} {t('принята. URL:')} {result.accepted ?? '—'}{t('. Списано:')} {result.charged === null ? '—' : `$${money(result.charged)}`}.</p>{/if}
      {#if quote}
        <div class="rounded-sm border border-line p-3 space-y-2">
          <p><b>{quote.count}</b> {t('уникальных URL × $')}{money(quote.price)} = <b>${money(quote.total)}</b></p>
          <p>{t('Баланс: $')}{money(quote.balance)}{t('. Расчёт действует 30 минут.')}</p>
          <p class="text-ink-2">{t('Предварительная стоимость. Фактическое списание определяет сервис после фильтрации URL.')}</p>
          <details><summary>{t('Посмотреть URL')}</summary><div class="max-h-48 overflow-auto break-all">{#each quote.urls as url}<div>{url}</div>{/each}</div></details>
          <button class="btn btn-pri" disabled={busy || quote.total > quote.balance} onclick={() => act('submit')}>{busy ? t('Отправка…') : t('Отправить за ≈ ${sum}', { sum: money(quote.total) })}</button>
          {#if quote.total > quote.balance}<p class="text-dn">{t('Недостаточно средств')}</p>{/if}
        </div>
      {:else}<button class="btn btn-pri" disabled={busy || !configured || !input.trim()} onclick={() => act('quote')}>{busy ? t('Подсчёт…') : t('Посчитать URL и стоимость')}</button>{/if}
      <div class="border-t border-line pt-3">
        <div class="flex justify-between items-center"><h3 class="font-semibold">{t('История отправок домена')}</h3><button class="btn btn-ghost" disabled={busy} onclick={load}>{t('Обновить')}</button></div>
        <p class="text-ink-2 mb-2">{t('Принято сервисом — ещё не подтверждение индексации в Google.')}</p>
        {#each history as h}<div class="border-t border-line py-2">
          <p>{dateTime(h.createdAt)} · {h.queue} · {h.count} URL · {h.status === 'submitted' ? t('Принято #{id}', { id: String(h.result?.submissionId ?? '') }) : h.status === 'sending' ? t('Отправляется') : t('Результат отправки уточняется')}</p>
          {#if h.result?.charged !== null && h.result?.charged !== undefined}<p>{t('Списано $')}{money(h.result.charged)}</p>{/if}
          {#if h.status === 'uncertain'}<p class="text-ink-2">{h.result?.error ?? t('Отправка была прервана')}</p><button class="btn btn-sec" disabled={busy} onclick={() => act('submit', h.id)}>{t('Повторить с тем же ID')}</button>{/if}
        </div>{:else}<p class="text-ink-2">{t('Отправок пока нет')}</p>{/each}
      </div>
    </div>
  </div>
</div>
