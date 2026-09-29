<script lang="ts">
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let mode: 'local' | 'exposed' = $state('local');
  let copied = $state(false);
  function copyRedirect() {
    navigator.clipboard.writeText(data.redirectUri);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<svelte:head><title>Настройка · gsc-hub</title></svelte:head>

<main class="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-6">
  <div class="app-toolbar-left">
    <h1 class="app-pagetitle">Настройка gsc-hub</h1>
    <p class="text-[12.5px] text-ink-2">
      Заполни один раз здесь — редактировать <code class="font-mono text-[12px]">.env</code> руками не нужно.
    </p>
  </div>

  {#if form?.error}
    <div class="app-errors mb-0">{form.error}</div>
  {/if}

  <form method="POST" class="flex flex-col gap-3">
    <section class="pane">
      <div class="pane-head">1. Google OAuth</div>
      <div class="pane-body flex flex-col gap-3">
        <ol class="ml-5 list-decimal space-y-1 text-[12.5px] text-ink-2">
          <li>Google Cloud Console → APIs &amp; Services → Credentials.</li>
          <li>Create credentials → OAuth client ID → Application type <b class="text-ink">Web application</b>.</li>
          <li>Authorized redirect URI — вставь это:</li>
        </ol>
        <div class="flex items-center gap-2">
          <code class="flex-1 break-all rounded border border-line bg-sunk px-2 py-1 font-mono text-[12px] text-ink">{data.redirectUri}</code>
          <button type="button" class="btn btn-sec btn-sm" onclick={copyRedirect}>
            {copied ? 'скопировано' : 'копировать'}
          </button>
        </div>
        <p class="text-[11px] text-ink-3">
          Локально Google-аккаунты подключай через <code class="font-mono">http://localhost:5173</code> — Google не пускает redirect на <code class="font-mono">.local</code>.
        </p>

        <label class="flex flex-col gap-1 text-[11px] text-ink-3">
          <span>Client ID
            {#if data.clientIdSource === 'env'}<span class="badge badge-muted ml-1">из окружения</span>{/if}</span>
          <input name="client_id" class="input w-full"
            disabled={data.clientIdSource === 'env'}
            placeholder={data.clientIdSet ? '•••• уже задан' : ''} />
        </label>
        <label class="flex flex-col gap-1 text-[11px] text-ink-3">
          <span>Client Secret
            {#if data.clientSecretSource === 'env'}<span class="badge badge-muted ml-1">из окружения</span>{/if}</span>
          <input name="client_secret" type="password" class="input w-full"
            disabled={data.clientSecretSource === 'env'}
            placeholder={data.clientSecretSet ? '•••• уже задан' : ''} />
        </label>
      </div>
    </section>

    <section class="pane">
      <div class="pane-head">2. Режим доступа</div>
      <div class="pane-body flex flex-col gap-2 text-[12.5px] text-ink-2">
        <label class="flex items-start gap-2">
          <input type="radio" name="mode" value="local" bind:group={mode} class="mt-0.5" />
          <span><b class="text-ink">Только для меня</b> — апп на loopback, без логина.</span>
        </label>
        <label class="flex items-start gap-2">
          <input type="radio" name="mode" value="exposed" bind:group={mode} class="mt-0.5" />
          <span><b class="text-ink">Выставляю наружу</b> — включить логин и роли, создать админа.</span>
        </label>

        {#if mode === 'exposed'}
          <div class="flex flex-col gap-2 pl-6">
            <input name="admin_email" type="email" placeholder="admin email" aria-label="admin email"
              class="input w-full" />
            <input name="admin_password" type="password" placeholder="пароль (мин. 8)" aria-label="пароль"
              class="input w-full" />
            <input name="admin_password2" type="password" placeholder="пароль ещё раз" aria-label="пароль ещё раз"
              class="input w-full" />
            <p class="text-[11px] text-ink-3">
              Для HTTPS наружу за прокси задай <code class="font-mono">ORIGIN</code>/<code class="font-mono">AUTH_URL</code> в переменных деплоя.
            </p>
          </div>
        {/if}
      </div>
    </section>

    <div class="flex justify-end">
      <button class="btn btn-pri btn-lg">Сохранить и продолжить</button>
    </div>
  </form>
</main>
