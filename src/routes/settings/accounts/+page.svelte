<script lang="ts">
  import type { PageData } from './$types';
  import SettingsNav from '$lib/components/SettingsNav.svelte';
  import { t } from '$lib/i18n/index.svelte';
  import { isoDate } from '$lib/utils/time';
  let { data }: { data: PageData } = $props();
  const isAdmin = $derived(data.user?.role === 'admin');
  const STATUS: Record<string, 'активен' | 'отозван' | 'ошибка'> = { active: 'активен', revoked: 'отозван', error: 'ошибка' };
</script>

<svelte:head><title>{t('Google-аккаунты')} · gsc-hub</title></svelte:head>

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs"><span>{t('Настройки')}</span><span aria-hidden="true">/</span><span class="text-ink-2">{t('Google-аккаунты')}</span></nav>
      <h1 class="app-pagetitle">{t('Подключённые Google-аккаунты')}</h1>
    </div>
    <div class="app-toolbar-right">
      <form method="POST" action="?/connect">
        <input type="hidden" name="providerId" value="google" />
        <button type="submit" class="btn btn-pri">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v8M3 7h8" /></svg>
          {t('Подключить Google-аккаунт')}
        </button>
      </form>
    </div>
  </header>

  <div class="desk md:grid-cols-[220px_minmax(0,1fr)]">
    <SettingsNav {isAdmin} />
    <div class="desk-col">
      {#if data.accounts.length === 0}
        <section class="pane pane-body">
          <div class="app-empty">
            <div class="app-empty-title">{t('Аккаунтов пока нет')}</div>
            <p class="app-empty-sub">{t('Нажмите «Подключить Google-аккаунт», чтобы авторизовать один или несколько аккаунтов. OAuth-токены хранятся локально в базе хаба.')}</p>
          </div>
        </section>
      {:else}
        <section class="pane">
          <div class="pane-head">{t('Аккаунты')} <span class="aside app-num">{data.accounts.length}</span></div>
          <div class="overflow-x-auto">
          <table class="app-table">
            <thead>
              <tr>
                <th>Email</th>
                {#if isAdmin}<th class="hidden sm:table-cell">{t('Подпись')}</th>{/if}
                <th>{t('Статус')}</th>
                <th class="hidden md:table-cell">{t('Добавлен')}</th>
                {#if isAdmin}<th class="w-0 p-0"><span class="sr-only">{t('Действия')}</span></th>{/if}
              </tr>
            </thead>
            <tbody>
              {#each data.accounts as a (a.id)}
                <tr class:has-status={a.status !== 'active'}>
                  <td class="break-all font-medium text-ink pii">{a.email}</td>
                  {#if isAdmin}
                  <td class="hidden sm:table-cell">
                    <!-- Saved on Enter or when the field loses focus with a changed value. -->
                    <form method="POST" action="/accounts/{a.id}/relabel">
                      <input
                        name="label"
                        value={a.label ?? ''}
                        class="input h-6 w-40 text-xs"
                        placeholder={t('добавить подпись')}
                        aria-label={t('Подпись для {email}', { email: a.email })}
                        onchange={(e) => e.currentTarget.form?.requestSubmit()}
                      />
                    </form>
                  </td>
                  {/if}
                  <td>
                    <span class="badge {a.status === 'active' ? 'badge-ok' : a.status === 'revoked' ? 'badge-bad' : 'badge-warn'}" title={a.last_error ?? ''}>
                      {STATUS[a.status] ? t(STATUS[a.status]) : a.status}
                    </span>
                  </td>
                  <td class="app-num hidden text-ink-3 md:table-cell">{isoDate(a.added_at * 1000)}</td>
                  {#if isAdmin}
                  <!-- Row tray: actions slide over the row end on hover/focus; a revoked
                       account keeps it open with Reconnect (re-running OAuth upserts the token). -->
                  <td class="row-tray">
                    <div class="row-tray-body">
                      {#if a.status !== 'active'}
                        <form method="POST" action="?/connect" class="inline-block">
                          <input type="hidden" name="providerId" value="google" />
                          <button type="submit" class="btn btn-sec btn-sm" title={t('Войти в Google заново под {email}', { email: a.email })}>{t('Переподключить')}</button>
                        </form>
                      {/if}
                      <form method="POST" action="/accounts/{a.id}/delete" class="inline-block">
                        <button
                          type="submit"
                          class="btn btn-danger btn-sm"
                          onclick={(e) => {
                            if (!confirm(t('Удалить подключение этого аккаунта?'))) e.preventDefault();
                          }}
                        >{t('Удалить')}</button>
                      </form>
                    </div>
                  </td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
          </div>
        </section>
      {/if}
    </div>
  </div>
</main>
