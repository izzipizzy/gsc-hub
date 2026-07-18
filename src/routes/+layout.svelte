<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import favicon from '$lib/assets/favicon.svg';
  let { children, data } = $props();
  const user = $derived(data?.user ?? null);
  const isAdmin = $derived(user?.role === 'admin');

  // Privacy Blur — one-click blur of PII (emails, domains, metrics) for screenshots/screen-share.
  let blur = $state(false);
  onMount(() => {
    blur = localStorage.getItem('gsc-hub:blur') === '1';
  });
  $effect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('privacy-blur', blur);
    localStorage.setItem('gsc-hub:blur', blur ? '1' : '0');
  });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{#if user}
  <header class="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2 text-sm">
    <a href="/" class="font-semibold text-gray-900">gsc-hub</a>
    {#if isAdmin}
      <nav class="flex gap-3 text-gray-600">
        <a href="/dashboard" class="hover:underline">Dashboard</a>
        <a href="/properties" class="hover:underline">Sites</a>
        <a href="/admin/users" class="hover:underline">Users</a>
      </nav>
    {/if}
    <button
      type="button"
      class="ml-auto rounded px-2 py-0.5 text-xs {blur ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'} hover:opacity-80"
      title="Blur emails, domains and metrics for screenshots"
      onclick={() => (blur = !blur)}
    >{blur ? '🙈 Blurred' : '👁 Blur'}</button>
    <span class="pii text-gray-500">{user.email} · {user.role}</span>
    <form method="POST" action="/logout"><button class="text-blue-600 hover:underline">Выйти</button></form>
  </header>
{/if}

{@render children()}

<footer class="app-footer">
  <span>© 2026 gsc-hub</span>
  <span aria-hidden="true">·</span>
  <a href="https://github.com/izzipizzy/gsc-hub" target="_blank" rel="noopener noreferrer">GitHub</a>
  <span aria-hidden="true">·</span>
  <a href="https://t.me/izzyplzzy" target="_blank" rel="noopener noreferrer">Telegram</a>
</footer>
