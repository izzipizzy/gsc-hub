<script lang="ts">
  import SortCaret from '$lib/components/SortCaret.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  type Key = 'site' | 'donor' | 'typeLabel' | 'date' | 'addedAt';
  let sortKey = $state<Key>('date');
  let dir = $state<'asc' | 'desc'>('desc');
  let q = $state('');
  let eventType = $state('');

  function sortBy(k: Key) {
    if (sortKey === k) dir = dir === 'asc' ? 'desc' : 'asc';
    else { sortKey = k; dir = k === 'date' || k === 'addedAt' ? 'desc' : 'asc'; }
  }

  const rows = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    const list = data.rows.filter((r) =>
      (!eventType || r.type === eventType) &&
      (!needle || r.site.includes(needle) || r.donor.includes(needle) || r.note.toLowerCase().includes(needle))
    );
    const sign = dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = sortKey === 'donor' ? a.donor || a.note : a[sortKey];
      const y = sortKey === 'donor' ? b.donor || b.note : b[sortKey];
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      // Внутри одного значения — свежие даты выше: так читается хронология сайта.
      return c !== 0 ? sign * c : b.date.localeCompare(a.date) || a.site.localeCompare(b.site);
    });
  });

  const sites = $derived(new Set(data.rows.map((r) => r.site)).size);
  const arrow = (k: Key): 'asc' | 'desc' | '' => (sortKey === k ? dir : '');
  const fmt = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
  const ext = (host: string) => `https://${host}/`;
</script>

<svelte:head><title>Events · gsc-hub</title></svelte:head>

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs"><a href="/properties">Properties</a><span aria-hidden="true">/</span><span class="text-ink-2">Events</span></nav>
      <h1 class="app-pagetitle">Склейки и события</h1>
      <p class="text-xs text-ink-3">
        <span class="app-num">{data.rows.length}</span> событий на <span class="app-num">{sites}</span> сайтах. Те же маркеры, что на графиках сайтов, на дашборде и в portfolio pulse.
        Склейки добавляются на странице сайта или через <a class="text-acc hover:underline" href="/api">API</a>; покупки — автоматически из <a class="text-acc hover:underline" href="/magiclinks">Magiclinks</a>, по дате заказа.
      </p>
    </div>
    <div class="app-toolbar-right">
      <select bind:value={eventType} class="input" aria-label="Тип события">
        <option value="">Все события</option>
        <option value="merge">Склейки</option>
        <option value="link_purchase">Покупки ссылок</option>
      </select>
      <input bind:value={q} placeholder="сайт, донор или описание" aria-label="Фильтр событий" class="input w-72" />
    </div>
  </header>

  <section class="pane">
    <div class="overflow-x-auto">
      <table class="app-table">
        <thead>
          <tr>
            <th class="sort-th"><button type="button" class="hover:text-ink" onclick={() => sortBy('site')}>сайт<SortCaret dir={arrow('site')} /></button></th>
            <th class="sort-th"><button type="button" class="hover:text-ink" onclick={() => sortBy('typeLabel')}>событие<SortCaret dir={arrow('typeLabel')} /></button></th>
            <th class="sort-th"><button type="button" class="hover:text-ink" onclick={() => sortBy('donor')}>описание<SortCaret dir={arrow('donor')} /></button></th>
            <th class="sort-th"><button type="button" class="hover:text-ink" onclick={() => sortBy('date')}>дата<SortCaret dir={arrow('date')} /></button></th>
            <th class="sort-th"><button type="button" class="hover:text-ink" onclick={() => sortBy('addedAt')}>внесено<SortCaret dir={arrow('addedAt')} /></button></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.id)}
            <tr>
              <td>
                {#if r.href}<a class="font-medium text-ink hover:text-acc hover:underline" href={r.href}>{r.site}</a>{:else}<span class="font-medium text-ink">{r.site}</span>{/if}
                <a class="ml-1 text-ink-4 hover:text-acc" href={ext(r.site)} target="_blank" rel="noopener noreferrer" title="Открыть {r.site}" aria-label="Открыть {r.site}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" class="inline h-3 w-3 align-[-1px]" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7 9"/></svg></a>
              </td>
              <td><span class="inline-block mr-1.5 h-2 w-2 rounded-sm" style:background={r.color}></span>{r.typeLabel}</td>
              <td>
                {#if r.donor}
                  ← {r.donor}
                  <a class="ml-1 text-ink-4 hover:text-acc" href={ext(r.donor)} target="_blank" rel="noopener noreferrer" title="Открыть {r.donor}" aria-label="Открыть {r.donor}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" class="inline h-3 w-3 align-[-1px]" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7 9"/></svg></a>
                {:else if r.orderHref}
                  <a href={r.orderHref} class="font-medium hover:underline" style:color={r.color}>{r.note} →</a>
                {:else}
                  <span class="text-ink-3">{r.note || r.type}</span>
                {/if}
              </td>
              <td class="app-num">{r.date}</td>
              <td class="app-num text-ink-3">{fmt(r.addedAt)}</td>
            </tr>
          {:else}
            <tr><td colspan="5" class="py-3 text-ink-3">{q || eventType ? 'Ничего не нашлось.' : 'Событий пока нет.'}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</main>
