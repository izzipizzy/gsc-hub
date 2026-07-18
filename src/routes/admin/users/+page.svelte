<script lang="ts">
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Users · gsc-hub</title></svelte:head>

<main class="mx-auto max-w-2xl px-4 py-6">
  <h1 class="mb-4 text-lg font-semibold">Пользователи</h1>
  {#if form && 'error' in form && form.error}
    <p class="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{form.error}</p>
  {/if}

  <form method="POST" action="?/create" class="mb-6 flex flex-wrap items-end gap-2">
    <input name="email" type="email" required placeholder="email" class="rounded border px-2 py-1 text-sm" />
    <input name="password" type="text" required placeholder="пароль" class="rounded border px-2 py-1 text-sm" />
    <select name="role" class="rounded border px-2 py-1 text-sm"><option value="manager">manager</option><option value="admin">admin</option></select>
    <button class="rounded bg-blue-600 px-3 py-1 text-sm text-white">Создать</button>
  </form>

  <table class="w-full text-sm">
    <thead><tr class="text-left text-gray-500"><th>email</th><th>роль</th><th>действия</th></tr></thead>
    <tbody>
      {#each data.users as u (u.id)}
        <tr class="border-t">
          <td class="py-1">{u.email}</td>
          <td>{u.role}</td>
          <td class="flex flex-wrap gap-2 py-1">
            <form method="POST" action="?/setPassword" class="flex gap-1">
              <input type="hidden" name="id" value={u.id} />
              <input name="password" type="text" placeholder="новый пароль" class="w-28 rounded border px-1 text-xs" />
              <button class="text-blue-600">пароль</button>
            </form>
            <form method="POST" action="?/setRole" class="flex gap-1">
              <input type="hidden" name="id" value={u.id} />
              <select name="role" class="rounded border text-xs"><option value="manager" selected={u.role==='manager'}>manager</option><option value="admin" selected={u.role==='admin'}>admin</option></select>
              <button class="text-blue-600">роль</button>
            </form>
            <form method="POST" action="?/delete"><input type="hidden" name="id" value={u.id} /><button class="text-red-600">удалить</button></form>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</main>
