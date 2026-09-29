<script lang="ts">
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Users · gsc-hub</title></svelte:head>

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs"><span>Admin</span><span aria-hidden="true">/</span><span class="text-ink-2">Users</span></nav>
      <h1 class="app-pagetitle">Пользователи</h1>
    </div>
  </header>
  {#if form && 'error' in form && form.error}
    <p class="app-errors">{form.error}</p>
  {/if}

  <div class="flex flex-col gap-3">
    <section class="pane">
      <div class="pane-head">Новый пользователь</div>
      <form method="POST" action="?/create" class="pane-body flex flex-wrap items-end gap-2">
        <input name="email" type="email" required placeholder="email" aria-label="email" class="input" />
        <input name="password" type="text" required placeholder="пароль" aria-label="пароль" class="input" />
        <select name="role" class="input" aria-label="роль"><option value="manager">manager</option><option value="admin">admin</option></select>
        <button class="btn btn-pri">Создать</button>
      </form>
    </section>

    <section class="pane">
      <div class="pane-head">Пользователи <span class="aside app-num">{data.users.length}</span></div>
      <div class="overflow-x-auto">
        <table class="app-table">
          <thead><tr><th>email</th><th>роль</th><th>действия</th></tr></thead>
          <tbody>
            {#each data.users as u (u.id)}
              <tr>
                <td class="font-medium text-ink">{u.email}</td>
                <td><span class="badge {u.role === 'admin' ? 'badge-acc' : 'badge-muted'}">{u.role}</span></td>
                <td>
                  <div class="flex flex-wrap items-center gap-2">
                    <form method="POST" action="?/setPassword" class="flex gap-1">
                      <input type="hidden" name="id" value={u.id} />
                      <input name="password" type="text" placeholder="новый пароль" aria-label="новый пароль" class="input h-6 w-28 text-xs" />
                      <button class="btn btn-sec btn-sm">пароль</button>
                    </form>
                    <form method="POST" action="?/setRole" class="flex gap-1">
                      <input type="hidden" name="id" value={u.id} />
                      <select name="role" aria-label="роль" class="input h-6 text-xs"><option value="manager" selected={u.role==='manager'}>manager</option><option value="admin" selected={u.role==='admin'}>admin</option></select>
                      <button class="btn btn-sec btn-sm">роль</button>
                    </form>
                    <span class="app-toolbar-divider" aria-hidden="true"></span>
                    <form method="POST" action="?/delete"><input type="hidden" name="id" value={u.id} /><button class="btn btn-danger btn-sm">удалить</button></form>
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
