<script lang="ts">
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, getLocale } from '$lib/i18n/index.svelte';
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>{t('Пользователи')} · gsc-hub</title></svelte:head>

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs"><span>{t('Настройки')}</span><span aria-hidden="true">/</span><span class="text-ink-2">{t('Пользователи')}</span></nav>
      <h1 class="app-pagetitle">{t('Пользователи')}</h1>
    </div>
  </header>
  {#if form && 'error' in form && form.error}
    <p class="app-errors">{tx(form.error)}</p>
  {/if}

  <div class="flex flex-col gap-3">
    <section class="pane">
      <div class="pane-head">{t('Новый пользователь')}</div>
      <form method="POST" action="?/create" class="pane-body flex flex-wrap items-end gap-2">
        <input name="email" type="email" required placeholder={t('email')} aria-label={t('email')} class="input" />
        <input name="password" type="text" required placeholder={t('пароль')} aria-label={t('пароль')} class="input" />
        <select name="role" class="input" aria-label={t('роль')}><option value="manager">{t('менеджер')}</option><option value="admin">{t('администратор')}</option></select>
        <button class="btn btn-pri">{t('Создать')}</button>
      </form>
    </section>

    <section class="pane">
      <div class="pane-head">{t('Пользователи')} <span class="aside app-num">{data.users.length}</span></div>
      <div class="overflow-x-auto">
        <table class="app-table">
          <thead><tr><th>email</th><th>{t('роль')}</th><th>{t('действия')}</th></tr></thead>
          <tbody>
            {#each data.users as u (u.id)}
              <tr>
                <td class="font-medium text-ink">{u.email}</td>
                <td><span class="badge {u.role === 'admin' ? 'badge-acc' : 'badge-muted'}">{u.role}</span></td>
                <td>
                  <div class="flex flex-wrap items-center gap-2">
                    <form method="POST" action="?/setPassword" class="flex gap-1">
                      <input type="hidden" name="id" value={u.id} />
                      <input name="password" type="text" placeholder={t('новый пароль')} aria-label={t('новый пароль')} class="input h-6 w-28 text-xs" />
                      <button class="btn btn-sec btn-sm">{t('пароль')}</button>
                    </form>
                    <form method="POST" action="?/setRole" class="flex gap-1">
                      <input type="hidden" name="id" value={u.id} />
                      <select name="role" aria-label={t('роль')} class="input h-6 text-xs"><option value="manager" selected={u.role==='manager'}>{t('менеджер')}</option><option value="admin" selected={u.role==='admin'}>{t('администратор')}</option></select>
                      <button class="btn btn-sec btn-sm">{t('роль')}</button>
                    </form>
                    <span class="app-toolbar-divider" aria-hidden="true"></span>
                    <form method="POST" action="?/delete"><input type="hidden" name="id" value={u.id} /><button class="btn btn-danger btn-sm">{t('удалить')}</button></form>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  </div>
</main>
