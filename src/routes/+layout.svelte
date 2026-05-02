<script lang="ts">
  import '../app.css';
  import favicon from '$lib/assets/favicon.svg';

  let { children } = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<footer class="app-footer">
  <span>© 2026 gsc-hub</span>
  <span aria-hidden="true">·</span>
  <a href="https://github.com/izzipizzy/gsc-hub" target="_blank" rel="noopener noreferrer">GitHub</a>
  <span aria-hidden="true">·</span>
  <a href="https://t.me/izzyplzzy" target="_blank" rel="noopener noreferrer">Telegram</a>
</footer>
