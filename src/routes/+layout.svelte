<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import favicon from '$lib/assets/favicon.svg';
  import { page } from '$app/state';
  import { RELEASES_LATEST_URL, isNewer, releaseUrl, shouldCheck } from '$lib/version';
  import { setLocale, t } from '$lib/i18n/index.svelte';
  import type { MessageKey } from '$lib/i18n/messages';

  // Top menu: what you look at (overview) and what you do (work). Settings,
  // keys, API and users live behind the profile icon, not in the bar.
  const NAV_GROUPS = [
    {
      label: 'Обзор',
      items: [
        { href: '/dashboard', label: 'Дашборд' },
        { href: '/properties', label: 'Сайты' },
        { href: '/properties/striking', label: 'Портфель', title: 'Аналитика по всем сайтам: striking distance, каннибализация, CTR, branded, decay' }
      ]
    },
    {
      label: 'Работа',
      items: [
        { href: '/events', label: 'События', title: 'Склейки доменов и покупки ссылок с датами' },
        { href: '/magiclinks', label: 'Меджики', title: 'Покупка ссылок и постов: заказы, статусы, проверка ссылок' },
        { href: '/index-check', label: 'Проверка индексации', title: 'Проверка URL из sitemap через XML River и DataForSEO' }
      ]
    }
  ] as const;
  type NavItem = { href: string; label: MessageKey; title?: MessageKey };
  const NAV: NavItem[] = NAV_GROUPS.flatMap((g): NavItem[] => [...g.items]);
  // Longest matching prefix wins, so /properties/striking lights Portfolio, not Sites.
  const activeHref = $derived.by(() => {
    const path = page.url.pathname;
    let best = '';
    for (const { href } of NAV) {
      if ((path === href || path.startsWith(href + '/')) && href.length > best.length) best = href;
    }
    return best;
  });
  const isActive = (href: string) => activeHref === href;
  const activeItem = $derived(NAV.find((i) => i.href === activeHref) ?? null);
  const inSettings = $derived(page.url.pathname.startsWith('/settings') || page.url.pathname === '/api' || page.url.pathname.startsWith('/admin'));

  let menuOpen = $state(false);
  let profileOpen = $state(false);
  // Any navigation closes both menus.
  $effect(() => {
    void page.url.pathname;
    menuOpen = false;
    profileOpen = false;
  });
  function closeOnOutside(e: MouseEvent) {
    const el = e.target as Element | null;
    if (menuOpen && !el?.closest('[data-nav-menu]')) menuOpen = false;
    if (profileOpen && !el?.closest('[data-profile-menu]')) profileOpen = false;
  }
  function closeOnEscape(e: KeyboardEvent) {
    if (e.key === 'Escape') { menuOpen = false; profileOpen = false; }
  }
  let { children, data } = $props();
  // Language for this render (SSR and browser) and after a change in the profile.
  setLocale(data?.locale ?? 'ru');
  $effect.pre(() => setLocale(data?.locale ?? 'ru'));
  $effect(() => {
    document.documentElement.lang = data?.locale ?? 'ru';
    const theme = data?.theme ?? 'system';
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  });
  const initial = $derived((data?.user?.email ?? '?').slice(0, 1).toUpperCase());
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
      {t('Доступна {v} — что нового', { v: newRelease })}
    </a>
    <button type="button" aria-label={t("Скрыть уведомление")} onclick={dismissUpdate}><svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
  </div>
{/if}

<svelte:window onclick={closeOnOutside} onkeydown={closeOnEscape} />
{#if user}
  <header class="app-nav sticky top-0 z-30 flex h-10 items-center gap-1 border-b border-line bg-pane px-3">
    <a href="/" class="mr-2 flex shrink-0 items-center gap-2 whitespace-nowrap text-[13px] font-bold text-ink sm:mr-3">
      <!-- Same mark as the favicon (a stack of terminals), drawn with theme tokens. -->
      <svg viewBox="2 2.5 28 28" class="h-5 w-5" aria-hidden="true"><path d="M9 12 10.5 9a2 2 0 0 1 1.8-1H27a2 2 0 0 1 1.9 2.7l-3.5 9.6A4 4 0 0 1 22 23h-.5l1.8-4.8a2 2 0 0 0-1.9-2.7H18a2 2 0 0 1-1.5-.7l-1.6-2A2 2 0 0 0 13.4 12Z" fill="rgb(var(--ink))"/><path d="M3.2 23.2 6.5 16A3 3 0 0 1 9.2 14h4a2 2 0 0 1 1.5.7l2.1 2.6a2 2 0 0 0 1.5.7H21l-2.4 6.2a3 3 0 0 1-2.8 1.8H5a2 2 0 0 1-1.8-2.8Z" fill="rgb(var(--acc))"/></svg>
      gsc-hub
    </a>
    {#if isAdmin}
      <!-- Wide screens: both groups inline, split by a rule. -->
      <nav class="hidden min-w-0 items-center gap-0.5 lg:flex" aria-label={t('Основное меню')}>
        {#each NAV_GROUPS as group, gi (group.label)}
          {#if gi > 0}<span class="mx-2 h-4 w-px bg-line" aria-hidden="true"></span>{/if}
          <span class="sr-only">{t(group.label)}</span>
          {#each group.items as item (item.href)}
            <a href={item.href} title={'title' in item ? t(item.title) : undefined} class="nav-link" class:is-active={isActive(item.href)}
              aria-current={isActive(item.href) ? 'page' : undefined}>{t(item.label)}</a>
          {/each}
        {/each}
      </nav>
      <!-- Narrow screens: one button with the current page, groups in a panel. -->
      <div class="relative lg:hidden" data-nav-menu>
        <button type="button" class="btn btn-ghost btn-sm" aria-haspopup="true" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/></svg>
          {activeItem ? t(activeItem.label) : inSettings ? t('Настройки') : t('Меню')}
        </button>
        {#if menuOpen}
          <div class="absolute left-0 top-9 z-40 flex w-64 flex-col rounded-sm border border-line bg-pane p-1.5 shadow-pop">
            {#each NAV_GROUPS as group (group.label)}
              <div class="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">{t(group.label)}</div>
              {#each group.items as item (item.href)}
                <a href={item.href} class="nav-link w-full" class:is-active={isActive(item.href)} aria-current={isActive(item.href) ? 'page' : undefined}>{t(item.label)}</a>
              {/each}
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    <div class="ml-auto flex shrink-0 items-center gap-1">
      <button
        type="button"
        class="btn btn-sm btn-icon {blur ? 'bg-ink text-pane hover:bg-ink-2' : 'btn-ghost'}"
        title={t('Скрыть email, домены и цифры для скриншотов')}
        aria-label={t('Скрыть личные данные')}
        aria-pressed={blur}
        onclick={() => (blur = !blur)}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          {#if blur}<path d="M2 2l12 12M6.6 6.6a2 2 0 0 0 2.8 2.8M4.3 4.4C2.8 5.4 1.8 7 1.5 8c.8 2.2 3.3 4.5 6.5 4.5 1.3 0 2.5-.4 3.5-1M7 3.6c.3 0 .7-.1 1-.1 3.2 0 5.7 2.3 6.5 4.5-.3.8-.8 1.6-1.4 2.3"/>
          {:else}<path d="M1.5 8C2.3 5.8 4.8 3.5 8 3.5s5.7 2.3 6.5 4.5c-.8 2.2-3.3 4.5-6.5 4.5S2.3 10.2 1.5 8z"/><circle cx="8" cy="8" r="2"/>{/if}
        </svg>
      </button>
      <!-- Profile: language, theme, settings, sign out. -->
      <div class="relative" data-profile-menu>
        <button
          type="button"
          class="profile-btn"
          class:is-active={profileOpen || inSettings || page.url.pathname === '/profile'}
          aria-haspopup="true"
          aria-expanded={profileOpen}
          aria-label={t('Профиль и настройки')}
          title={user.email}
          onclick={() => (profileOpen = !profileOpen)}
        >{initial}</button>
        {#if profileOpen}
          <div class="absolute right-0 top-9 z-40 flex w-64 flex-col rounded-sm border border-line bg-pane p-1.5 shadow-pop">
            <div class="px-2 pb-2 pt-1">
              <div class="pii truncate text-[12.5px] font-semibold text-ink">{user.email}</div>
              <div class="text-[11px] text-ink-3">{user.role === 'admin' ? t('администратор') : t('менеджер')}</div>
            </div>
            <div class="mb-1 h-px bg-line-soft" aria-hidden="true"></div>
            <a href="/profile" class="nav-link w-full justify-between">{t('Профиль')} <span class="text-[11px] font-normal text-ink-3">{t('язык, тема')}</span></a>
            {#if isAdmin}<a href="/settings/accounts" class="nav-link w-full justify-between">{t('Настройки')} <span class="text-[11px] font-normal text-ink-3">{t('аккаунты, ключи, API')}</span></a>
            {:else}<a href="/settings/accounts" class="nav-link w-full">{t('Google-аккаунты')}</a>{/if}
            <div class="my-1 h-px bg-line-soft" aria-hidden="true"></div>
            <form method="POST" action="/logout"><button class="nav-link w-full">{t('Выйти')}</button></form>
          </div>
        {/if}
      </div>
    </div>
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
      title={t("Что изменилось в этой версии")}
    >{version.release}</a>
    {#if version.commit}
      <!-- Dev host: the commit is the working tree's, not the release's. -->
      <span title={t("Коммит рабочего дерева")}>· {version.commit}</span>
    {/if}
  {/if}
  <span aria-hidden="true">·</span>
  <a href="https://github.com/izzipizzy/gsc-hub" target="_blank" rel="noopener noreferrer">GitHub</a>
  <span aria-hidden="true">·</span>
  <a href="https://t.me/izzypizzy_seo" target="_blank" rel="noopener noreferrer">Telegram</a>
  <span aria-hidden="true">·</span>
  <a href="https://izzyypizzy.com/" target="_blank" rel="noopener noreferrer">{t("Сайт")}</a>
</footer>

<style>
  .nav-link {
    display: inline-flex;
    align-items: center;
    height: 28px;
    padding: 0 10px;
    border-radius: 4px;
    font-size: 12.5px;
    white-space: nowrap;
    color: rgb(var(--ink-2));
    transition: background-color 150ms, color 150ms;
  }
  button.nav-link {
    border: 0;
    background: none;
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
  }
  .nav-link:hover {
    color: rgb(var(--ink));
    background: rgb(var(--bg));
  }
  .profile-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid rgb(var(--line));
    background: rgb(var(--sunk));
    color: rgb(var(--ink-2));
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: border-color 150ms, color 150ms, background-color 150ms;
  }
  .profile-btn:hover,
  .profile-btn.is-active {
    border-color: rgb(var(--acc));
    color: rgb(var(--acc-deep));
    background: rgb(var(--acc-t));
  }
  .nav-link.is-active {
    color: rgb(var(--ink));
    font-weight: 600;
    background: rgb(var(--bg));
  }
</style>
