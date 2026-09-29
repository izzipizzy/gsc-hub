<script lang="ts">
  import type { ActionData } from './$types';
  let { form }: { form: ActionData } = $props();
</script>

<svelte:head><title>Вход · gsc-hub</title></svelte:head>

<main class="mx-auto mt-24 w-full max-w-md px-4">
  <section class="pane">
    <div class="pane-head">gsc-hub — вход</div>
    <div class="pane-body">
      {#if form?.error}
        <p class="app-errors">{form.error}</p>
      {/if}
      <form method="POST" class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-[11px] text-ink-3">Email
          <input name="email" type="email" required placeholder="email" value={form && 'email' in form ? form.email : ''}
            class="input h-8 w-full text-[13px]" />
        </label>
        <label class="flex flex-col gap-1 text-[11px] text-ink-3">Пароль
          <input name="password" type="password" required placeholder="пароль"
            class="input h-8 w-full text-[13px]" />
        </label>
        <button type="submit" class="btn btn-pri btn-lg mt-1 w-full">Войти</button>
      </form>
    </div>
  </section>
</main>
