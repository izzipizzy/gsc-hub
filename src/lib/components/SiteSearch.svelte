<script lang="ts">
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';

  const query = $derived(page.state.siteSearchQuery ?? page.url.searchParams.get('q') ?? '');
  function update(value: string) {
    const url = new URL(page.url);
    if (value) url.searchParams.set('q', value);
    else url.searchParams.delete('q');
    replaceState(url, { ...page.state, siteSearchQuery: value });
  }
</script>

<div class="flex min-w-0 flex-wrap items-center gap-2">
  <label class="flex min-w-0 items-center gap-2">
    <span class="text-xs text-ink-3">Search sites</span>
    <input
      type="search"
      class="input pii w-48 max-w-full"
      placeholder="example.com"
      value={query}
      oninput={(event) => update(event.currentTarget.value)}
    />
  </label>
  {#if query}
    <button type="button" class="btn btn-ghost btn-sm" onclick={() => update('')}>Clear search</button>
  {/if}
</div>
