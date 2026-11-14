<script lang="ts">
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, getLocale } from '$lib/i18n/index.svelte';
  import { onDestroy } from 'svelte';
  let { id, scope, count }: { id: string; scope: 'run' | 'batch'; count: number } = $props();
  let busy = $state(false), feedback = $state(''), failed = $state(false), manual = $state('');
  let textarea = $state<HTMLTextAreaElement>();
  let request = 0;
  let previousKey = '';
  $effect(() => {
    const key = `${scope}:${id}`;
    if (key === previousKey) return;
    previousKey = key; request++; busy = false; feedback = ''; failed = false; manual = '';
  });
  onDestroy(() => { request++; });
  async function copy() {
    const current = ++request;
    busy = true; feedback = ''; failed = false; manual = '';
    try {
      const query = new URLSearchParams({ action: 'exportNotFound', [scope]: id });
      const response = await fetch(`/index-check/api?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('text/plain')) throw new Error(t('Обнови страницу и попробуй ещё раз'));
      const text = await response.text();
      if (current !== request) return;
      if (!text) { feedback = t('Ненайденных URL пока нет'); return; }
      try {
        await navigator.clipboard.writeText(text);
        if (current === request) feedback = t('Скопировано URL: {n}. По одному адресу на строку.', { n: text.split('\n').length });
      } catch {
        if (current === request) { manual = text; feedback = t('Браузер не разрешил копирование. Выдели список ниже и скопируй вручную.'); }
      }
    } catch (e) {
      if (current === request) { feedback = t('Не удалось получить URL. {error}', { error: tx((e as Error).message) }); failed = true; }
    } finally { if (current === request) busy = false; }
  }
</script>
<div class="min-w-0 border-b border-line px-3 py-2">
  <div class="flex flex-wrap items-center gap-2">
    <button type="button" class="btn btn-sec btn-sm h-auto min-h-6 whitespace-normal text-left" disabled={busy || count === 0} onclick={copy}>
      {busy ? t('Получаем URL…') : scope === 'batch' ? t('Скопировать ненайденные URL всех сайтов') : t('Скопировать ненайденные URL сайта')}
      <span class="app-num">· {count}</span>
    </button>
    <span class="text-[11px] text-ink-3">{t('Все результаты «Не найдено», включая другие страницы таблицы. Ошибки и непроверенные URL исключены.')}</span>
  </div>
  {#if feedback}<p class="mt-2 text-xs {failed ? 'text-dn' : 'text-ink-2'}" role={failed ? 'alert' : 'status'}>{tx(feedback)}</p>{/if}
  {#if manual}
    <textarea class="input pii mt-2 h-auto min-h-28 w-full resize-y py-2 text-xs" bind:this={textarea} readonly value={manual} aria-label={t('Ненайденные URL для ручного копирования')} onfocus={(event) => event.currentTarget.select()}></textarea>
    <button type="button" class="btn btn-ghost btn-sm mt-1" onclick={() => { textarea?.focus(); textarea?.select(); }}>{t('Выделить список')}</button>
  {/if}
</div>
