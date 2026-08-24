<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import favicon from '$lib/assets/favicon.svg';
  import { RELEASES_LATEST_URL, isNewer, releaseUrl, shouldCheck } from '$lib/version';
  let { children, data } = $props();
  const user = $derived(data?.user ?? null);
  const isAdmin = $derived(user?.role === 'admin');

  const version = $derived(data?.version ?? null);
  const updateCheck = $derived(data?.updateCheck ?? false);

  // Update ticker. The whole check lives in the browser: the server never calls
  // out and never stores anything for it.
  type UpdateState = { checkedAt: number; latest: string | null };

  const UPDATE_KEY = 'gsc-hub:update';
  const DISMISSED_KEY = 'gsc-hub:update-dismissed';

  let update = $state<UpdateState | null>(null);
  let dismissed = $state<string | null>(null);

  const newRelease = $derived(
    // user/updateCheck belong here, not only around the fetch: a cached answer
    // from an earlier session would otherwise surface the banner on the login
    // page and survive UPDATE_CHECK=off.
    user &&
    updateCheck &&
    update?.latest &&
    isNewer(update.latest, version?.release) &&
    dismissed !== update.latest
      ? update.latest
      : null
  );

  function readUpdate(): UpdateState | null {
    try {
      const raw = localStorage.getItem(UPDATE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<UpdateState>;
      if (typeof parsed?.checkedAt !== 'number') return null;
      return {
        checkedAt: parsed.checkedAt,
        latest: typeof parsed.latest === 'string' ? parsed.latest : null
      };
    } catch {
      // Hand-edited or half-written value — treat it as "never checked".
      return null;
    }
  }

  async function checkForUpdate() {
    const previous = update;
    // A failed check still moves the stamp: otherwise every navigation while
    // offline fires another doomed request.
    let next: UpdateState = {
      checkedAt: Date.now(),
      latest: previous?.latest ?? null
    };
    try {
      const res = await fetch(RELEASES_LATEST_URL, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        // Only the tag is kept. The link is built from it and the fixed repo,
        // so nothing the API (or a tampered cache) says can redirect the user.
        const body = (await res.json()) as { tag_name?: unknown };
        next = {
          checkedAt: Date.now(),
          latest: typeof body.tag_name === 'string' ? body.tag_name : null
        };
      }
    } catch {
      // Offline, rate-limited or timed out — keep showing the last known answer.
    }
    update = next;
    try {
      localStorage.setItem(UPDATE_KEY, JSON.stringify(next));
    } catch {
      // Storage full or blocked; the check simply repeats next load.
    }
  }

  function dismissUpdate() {
    // Read the tag before touching `dismissed`: newRelease is derived from it,
    // so the assignment below makes newRelease null on the very next read.
    const tag = newRelease;
    if (!tag) return;
    dismissed = tag;
    try {
      localStorage.setItem(DISMISSED_KEY, tag);
    } catch {
      // Nothing to do — the banner returns on the next load.
    }
  }

  // Privacy Blur — one-click blur of PII (emails, domains, metrics) for screenshots/screen-share.
  let blur = $state(false);
  onMount(() => {
    blur = localStorage.getItem('gsc-hub:blur') === '1';
    dismissed = localStorage.getItem(DISMISSED_KEY);
    update = readUpdate();
    // The banner is for signed-in operators only, so an anonymous login page
    // has no reason to reach out to github.com on the visitor's behalf.
    if (!updateCheck || !user || !version) return;
    if (!shouldCheck(update?.checkedAt ?? null, Date.now())) return;
    void checkForUpdate();
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

{#if newRelease}
  <div class="update-banner">
    <a href={releaseUrl(newRelease)} target="_blank" rel="noopener noreferrer">
      Доступна {newRelease} — что нового
    </a>
    <button type="button" aria-label="Скрыть уведомление" onclick={dismissUpdate}>×</button>
  </div>
{/if}

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
  {#if version}
    <span aria-hidden="true">·</span>
    <a
      href={releaseUrl(version.release)}
      target="_blank"
      rel="noopener noreferrer"
      title="Что изменилось в этой версии"
    >{version.release}</a>
    {#if version.commit}
      <!-- Dev host: the commit is the working tree's, not the release's. -->
      <span title="Коммит рабочего дерева">· {version.commit}</span>
    {/if}
  {/if}
  <span aria-hidden="true">·</span>
  <a href="https://github.com/izzipizzy/gsc-hub" target="_blank" rel="noopener noreferrer">GitHub</a>
  <span aria-hidden="true">·</span>
  <a href="https://t.me/izzypizzy_seo" target="_blank" rel="noopener noreferrer">Telegram</a>
  <span aria-hidden="true">·</span>
  <a href="https://izzyypizzy.com/" target="_blank" rel="noopener noreferrer">Сайт</a>
</footer>
