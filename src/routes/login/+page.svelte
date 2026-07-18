<script lang="ts">
  import type { ActionData } from './$types';
  let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>Вход · gsc-hub</title></svelte:head>

<main class="mx-auto mt-24 max-w-sm px-4">
  <h1 class="mb-6 text-lg font-semibold text-gray-900">gsc-hub — вход</h1>
  {#if form?.error}
    <p class="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{form.error}</p>
  {/if}
  <form method="POST" class="space-y-3">
    <input name="email" type="email" required placeholder="email" value={form && 'email' in form ? form.email : ''}
      class="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
    <input name="password" type="password" required placeholder="пароль"
      class="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
    <button type="submit" class="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white">Войти</button>
  </form>
</main>
