<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  function fmtDate(unix: number) {
    return new Date(unix * 1000).toISOString().slice(0, 10);
  }
</script>

<svelte:head><title>Accounts — gsc-hub</title></svelte:head>

<main class="w-full p-6">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs">
        <span>gsc-hub</span>
        <span aria-hidden="true">/</span>
        <span class="text-gray-800">Accounts</span>
      </nav>
      <h1 class="app-pagetitle">Connected Google accounts</h1>
    </div>
    <div class="app-toolbar-right">
      <a href="/properties" class="app-pill app-pill-secondary">Sites</a>
      <a href="/dashboard" class="app-pill app-pill-secondary">Dashboard</a>
      <span class="app-toolbar-divider" aria-hidden="true"></span>
      <form method="POST" action="?/connect">
        <input type="hidden" name="providerId" value="google" />
        <button type="submit" class="app-pill app-pill-primary">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v8M3 7h8" /></svg>
          Connect Google account
        </button>
      </form>
    </div>
  </header>

  {#if data.accounts.length === 0}
    <div class="app-empty">
      <div class="app-empty-title">No connected accounts yet</div>
      <p class="app-empty-sub">Click <span class="font-medium text-gray-700">Connect Google account</span> above to authorize one or more accounts. OAuth tokens stay local in <code class="rounded bg-gray-100 px-1 py-0.5 text-[11px] text-gray-700">data/gsc-hub.db</code>.</p>
    </div>
  {:else}
    <table class="app-table">
      <thead>
        <tr>
          <th>Email</th>
          <th>Label</th>
          <th>Status</th>
          <th>Added</th>
          <th class="w-px text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each data.accounts as a (a.id)}
          <tr>
            <td class="font-medium text-gray-900">{a.email}</td>
            <td>
              <form method="POST" action="/accounts/{a.id}/relabel" class="flex items-center gap-1">
                <input
                  name="label"
                  value={a.label ?? ''}
                  class="w-32 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="—"
                />
                <button type="submit" class="app-pill app-pill-secondary !px-2 !py-1">Save</button>
              </form>
            </td>
            <td>
              <span class="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium {a.status === 'active' ? 'bg-green-50 text-green-800' : a.status === 'revoked' ? 'bg-red-50 text-red-800' : 'bg-yellow-50 text-yellow-800'}" title={a.last_error ?? ''}>
                <span class="app-status-dot {a.status === 'active' ? 'bg-green-500' : a.status === 'revoked' ? 'bg-red-500' : 'bg-yellow-500'}"></span>
                {a.status}
              </span>
            </td>
            <td class="app-num text-xs text-gray-500">{fmtDate(a.added_at)}</td>
            <td class="text-right">
              <form method="POST" action="/accounts/{a.id}/delete" class="inline-block">
                <button
                  type="submit"
                  class="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  onclick={(e) => {
                    if (!confirm('Delete this account connection?')) e.preventDefault();
                  }}
                >Delete</button>
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</main>
