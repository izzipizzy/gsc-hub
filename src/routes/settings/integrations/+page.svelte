<script lang="ts">
  import { enhance } from '$app/forms';
  let { data, form } = $props();
</script>
<svelte:head><title>Индексаторы · GSC Hub</title></svelte:head>
<div class="mx-auto max-w-2xl p-6">
  <h1 class="mb-4 text-xl font-semibold">Индексаторы</h1>
  <p class="mb-4 text-ink-2">Сервисы индексации и их API-ключи. Ключ каждого сервиса используется для всех доменов.</p>
  <div class="rounded border border-line bg-pane p-5">
    <h2 class="mb-2 font-semibold">NeuralIndexer · Inderixing</h2>
    <p class="mb-4 text-ink-2">Один API-ключ для всех доменов. Отправка страниц и карт сайта — кнопка «Индексация» на странице домена.</p>
    <p class="mb-3">{data.configured ? 'Ключ настроен' : 'Ключ не настроен'}{data.source === 'env' ? ' · задан в окружении' : ''}</p>
    {#if form?.error}<p class="mb-3 text-red-600">{form.error}</p>{/if}
    {#if form?.saved}<p class="mb-3 text-emerald-600">Настройки сохранены</p>{/if}
    {#if form?.balance !== undefined}<p class="mb-3">Баланс: ${Number(form.balance).toFixed(4)}</p>{/if}
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
</div>
