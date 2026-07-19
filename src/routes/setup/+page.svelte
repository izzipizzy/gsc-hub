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

<div class="mx-auto max-w-3xl p-6 space-y-6">
  <h1 class="text-2xl font-bold">Настройка gsc-hub</h1>
  <p class="text-gray-600">
    Заполни один раз здесь — редактировать <code>.env</code> руками не нужно.
  </p>

  {#if form?.error}
    <div class="rounded bg-red-100 text-red-800 px-4 py-2">{form.error}</div>
  {/if}

  <form method="POST" class="space-y-6">
    <section class="space-y-3 rounded border p-4">
      <h2 class="font-semibold">1. Google OAuth</h2>
      <ol class="list-decimal ml-5 text-sm text-gray-600 space-y-1">
        <li>Google Cloud Console → APIs &amp; Services → Credentials.</li>
        <li>Create credentials → OAuth client ID → Application type <b>Web application</b>.</li>
        <li>Authorized redirect URI — вставь это:</li>
      </ol>
      <div class="flex items-center gap-2">
        <code class="flex-1 bg-gray-100 px-2 py-1 rounded text-sm break-all">{data.redirectUri}</code>
        <button type="button" class="text-sm underline" onclick={copyRedirect}>
          {copied ? 'скопировано' : 'копировать'}
        </button>
      </div>
      <p class="text-xs text-gray-500">
        Локально Google-аккаунты подключай через <code>http://localhost:5173</code> — Google не пускает redirect на <code>.local</code>.
      </p>

      <label class="block text-sm font-medium">Client ID
        {#if data.clientIdSource === 'env'}<span class="ml-2 text-xs bg-gray-200 px-1 rounded">из окружения</span>{/if}
        <input name="client_id" class="mt-1 w-full border rounded px-2 py-1"
          disabled={data.clientIdSource === 'env'}
          placeholder={data.clientIdSet ? '•••• уже задан' : ''} />
      </label>
      <label class="block text-sm font-medium">Client Secret
        {#if data.clientSecretSource === 'env'}<span class="ml-2 text-xs bg-gray-200 px-1 rounded">из окружения</span>{/if}
        <input name="client_secret" type="password" class="mt-1 w-full border rounded px-2 py-1"
          disabled={data.clientSecretSource === 'env'}
          placeholder={data.clientSecretSet ? '•••• уже задан' : ''} />
      </label>
    </section>

    <section class="space-y-3 rounded border p-4">
      <h2 class="font-semibold">2. Режим доступа</h2>
      <label class="flex items-start gap-2">
        <input type="radio" name="mode" value="local" bind:group={mode} />
        <span><b>Только для меня</b> — апп на loopback, без логина.</span>
      </label>
      <label class="flex items-start gap-2">
        <input type="radio" name="mode" value="exposed" bind:group={mode} />
        <span><b>Выставляю наружу</b> — включить логин и роли, создать админа.</span>
      </label>

      {#if mode === 'exposed'}
        <div class="space-y-2 pl-6">
          <input name="admin_email" type="email" placeholder="admin email"
            class="w-full border rounded px-2 py-1" />
          <input name="admin_password" type="password" placeholder="пароль (мин. 8)"
            class="w-full border rounded px-2 py-1" />
          <input name="admin_password2" type="password" placeholder="пароль ещё раз"
            class="w-full border rounded px-2 py-1" />
          <p class="text-xs text-gray-500">
            Для HTTPS наружу за прокси задай <code>ORIGIN</code>/<code>AUTH_URL</code> в переменных деплоя.
          </p>
        </div>
      {/if}
    </section>

    <button class="rounded bg-black text-white px-4 py-2">Сохранить и продолжить</button>
  </form>
</div>
