<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { t, tx } from '$lib/i18n/index.svelte';
  import type { Theme } from '$lib/i18n/locale';

  let { data, form } = $props();

  const LANGS = [
    { id: 'ru', label: 'Русский' },
    { id: 'en', label: 'English' }
  ] as const;
  const THEMES = [
    { id: 'system', label: 'Как в системе' },
    { id: 'light', label: 'Светлая' },
    { id: 'dark', label: 'Тёмная' }
  ] as const;

  // Apply the theme at once, before the server round trip finishes.
  function previewTheme(theme: Theme) {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }
  const submitOnChange = (e: Event) => (e.currentTarget as HTMLInputElement).form?.requestSubmit();
</script>

<svelte:head><title>{t('Профиль')} · gsc-hub</title></svelte:head>

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <h1 class="app-pagetitle">{t('Профиль')}</h1>
      <p class="pii text-xs text-ink-3">{data.user?.email} · {data.user?.role}</p>
    </div>
  </header>

  {#if form?.error}<p class="app-errors">{tx(form.error)}</p>{/if}

  <div class="desk md:grid-cols-[repeat(2,minmax(0,1fr))]">
    <!-- A language change reloads the page so every label, including ones computed once, switches. -->
    <form method="POST" use:enhance={() => async ({ result, update }) => { if (result.type === 'success') location.reload(); else await update({ reset: false }); }} class="pane">
      <fieldset>
        <legend class="pane-head w-full">{t('Язык интерфейса')}</legend>
        <div class="pane-body flex flex-col gap-2">
          {#each LANGS as l (l.id)}
            <label class="flex h-7 cursor-pointer items-center gap-2 text-[12.5px]">
              <input type="radio" name="locale" value={l.id} checked={data.locale === l.id} onchange={submitOnChange} />
              <span lang={l.id}>{l.label}</span>
            </label>
          {/each}
          <p class="text-xs text-ink-3">{t('Сохраняется в вашем профиле и действует на всех устройствах.')}</p>
        </div>
      </fieldset>
    </form>

    <form method="POST" use:enhance={() => async ({ update }) => { await update({ reset: false }); await invalidateAll(); }} class="pane">
      <fieldset>
        <legend class="pane-head w-full">{t('Тема')}</legend>
        <div class="pane-body flex flex-col gap-2">
          {#each THEMES as th (th.id)}
            <label class="flex h-7 cursor-pointer items-center gap-2 text-[12.5px]">
              <input type="radio" name="theme" value={th.id} checked={data.theme === th.id}
                onchange={(e) => { previewTheme(th.id); submitOnChange(e); }} />
              <span>{t(th.label)}</span>
            </label>
          {/each}
          <p class="text-xs text-ink-3">{t('«Как в системе» следует настройке macOS или Windows.')}</p>
        </div>
      </fieldset>
    </form>
  </div>
</main>
