<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const isAdmin = $derived(data.user?.role === 'admin');

  function fmtDate(unix: number) {
    return new Date(unix * 1000).toISOString().slice(0, 10);
  }
</script>

<svelte:head><title>Accounts — gsc-hub</title></svelte:head>

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs">
        <span>gsc-hub</span>
        <span aria-hidden="true">/</span>
        <span class="text-ink-2">Accounts</span>
      </nav>
      <h1 class="app-pagetitle">Connected Google accounts</h1>
    </div>
    <div class="app-toolbar-right">
      {#if isAdmin}
        <a href="/properties" class="btn btn-sec">Sites</a>
        <a href="/dashboard" class="btn btn-sec">Dashboard</a>
      {/if}
      <span class="app-toolbar-divider" aria-hidden="true"></span>
      <form method="POST" action="?/connect">
        <input type="hidden" name="providerId" value="google" />
        <button type="submit" class="btn btn-pri">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v8M3 7h8" /></svg>
          Connect Google account
        </button>
      </form>
    </div>
  </header>

  {#if data.accounts.length === 0}
    <div class="app-empty">
      <div class="app-empty-title">No connected accounts yet</div>
      <p class="app-empty-sub">Click <span class="font-medium text-ink-2">Connect Google account</span> above to authorize one or more accounts. OAuth tokens stay local in <code class="rounded bg-sunk px-1 py-0.5 font-mono text-[11px] text-ink-2">data/gsc-hub.db</code>.</p>
    </div>
  {:else}
    <section class="pane">
      <div class="pane-head">Accounts <span class="aside app-num">{data.accounts.length}</span></div>
      <div class="overflow-x-auto">
      <table class="app-table">
        <thead>
          <tr>
            <th>Email</th>
            {#if isAdmin}<th class="hidden sm:table-cell">Label</th>{/if}
            <th>Status</th>
            <th class="hidden md:table-cell">Added</th>
            {#if isAdmin}<th class="hidden lg:table-cell">Owner</th>{/if}
            {#if isAdmin}<th class="w-px text-right">Actions</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each data.accounts as a (a.id)}
            <tr>
              <td class="break-all font-medium text-ink">{a.email}</td>
              {#if isAdmin}
              <td class="hidden sm:table-cell">
                <form method="POST" action="/accounts/{a.id}/relabel" class="flex items-center gap-1">
                  <input
                    name="label"
                    value={a.label ?? ''}
                    class="input h-6 w-32 text-xs"
                    placeholder="—"
                  />
                  <button type="submit" class="btn btn-sec btn-sm">Save</button>
                </form>
              </td>
              {/if}
              <td>
                <span class="badge {a.status === 'active' ? 'badge-ok' : a.status === 'revoked' ? 'badge-bad' : 'badge-warn'}" title={a.last_error ?? ''}>
                  {a.status}
                </span>
              </td>
              <td class="app-num hidden text-ink-3 md:table-cell">{fmtDate(a.added_at)}</td>
              {#if isAdmin}
              <td class="app-num hidden text-ink-3 lg:table-cell">{a.owner_id ?? '—'}</td>
              <td class="text-right">
                <form method="POST" action="/accounts/{a.id}/delete" class="inline-block">
                  <button
                    type="submit"
                    class="btn btn-danger btn-sm"
                    onclick={(e) => {
                      if (!confirm('Delete this account connection?')) e.preventDefault();
                    }}
                  >Delete</button>
                </form>
              </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
      </div>
    </section>
  {/if}
</main>
