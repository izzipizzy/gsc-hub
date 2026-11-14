<script lang="ts">
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, getLocale } from '$lib/i18n/index.svelte';
  import { isoDate, dateTime, clock } from '$lib/utils/time';
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();

  const docUrl = $derived(`${data.origin}/api/v1/doc.md`);
  const fresh = $derived(form && 'created' in form ? form.created : null);

  // Задание агенту: где дока и чем в неё войти. Свежий ключ подставляется сам — его
  // больше нигде не увидеть; без свежего ключа стоит заглушка.
  function agentBrief(key: string | null): string {
    return [
      t('У тебя есть API хаба Search Console: {url}.', { url: `${data.origin}/api/v1` }),
      t('Ключ: {key}', { key: key ?? t('<вставь ключ со страницы /api>') }),
      t('Прочитай документацию: curl -H "Authorization: Bearer <ключ>" {url}', { url: docUrl }),
      t('Работай строго по ней. Каждый запрос — с заголовком Authorization: Bearer <ключ>.')
    ].join('\n');
  }

  const mcpUrl = $derived(`${data.origin}/api/v1/mcp`);
  const mcpCommand = (key: string | null) =>
    `claude mcp add --transport http gsc-hub ${data.origin}/api/v1/mcp \\\n  --header "Authorization: Bearer ${key ?? t('<ключ>')}"`;

  // Область ключа: пустой выбор — все сайты.
  let scope = $state<Set<string>>(new Set());
  let siteFilter = $state('');
  const shownSites = $derived(
    siteFilter.trim()
      ? data.sites.filter((s) => s.site.toLowerCase().includes(siteFilter.trim().toLowerCase()))
      : data.sites
  );
  function toggleSite(site: string) {
    const next = new Set(scope);
    next.has(site) ? next.delete(site) : next.add(site);
    scope = next;
  }

  let copied = $state('');
  async function copy(text: string, what: string) {
    await navigator.clipboard.writeText(text);
    copied = what;
    setTimeout(() => (copied = ''), 1600);
  }

  const fmt = (ms: number | null) =>
    ms ? dateTime(ms) : '—';
</script>

<svelte:head><title>{t('API и MCP')} · gsc-hub</title></svelte:head>

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs"><span>{t('Настройки')}</span><span aria-hidden="true">/</span><span class="text-ink-2">{t('API и MCP')}</span></nav>
      <h1 class="app-pagetitle">API</h1>
      <p class="text-xs text-ink-3">
        {t('Ключи для агентов и скриптов. Каждый запрос к')} <code class="font-mono text-ink-2">{data.origin}/api/v1</code> {t('несёт заголовок')} <code class="font-mono text-ink-2">{t('Authorization: Bearer <ключ>')}</code>.
      </p>
    </div>
  </header>

  {#if form && 'error' in form && form.error}
    <p class="app-errors">{tx(form.error)}</p>
  {/if}

  <div class="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
    <div class="flex min-w-0 flex-col gap-3">
      {#if fresh}
        <section class="pane overflow-hidden border-warn/40">
          <div class="pane-head bg-warn-t text-warn">{t('Новый ключ')} <span class="aside">{t('показывается один раз')}</span></div>
          <div class="pane-body flex flex-col gap-2 text-[12.5px]">
            <p class="font-medium text-ink">{t('Ключ «')}{fresh.name}{t('» создан. Скопируй его сейчас — второй раз он не покажется.')}</p>
            <div class="flex flex-wrap items-center gap-2">
              <code class="break-all rounded-sm border border-line bg-sunk px-2 py-1 font-mono text-[12px] text-ink">{fresh.key}</code>
              <button type="button" class="btn btn-pri" onclick={() => copy(fresh.key, 'key')}>
                {copied === 'key' ? t('Скопировано') : t('Скопировать ключ')}
              </button>
            </div>
            <p class="text-ink-2">
              {t('Сайты ключа:')} {fresh.sites.length === 0 ? t('все') : ''}
              {#each fresh.sites as s (s)}<span class="pii mr-1">{s}</span>{/each}
            </p>
            <p class="text-ink-2">{t('Подключить как MCP-сервер:')}</p>
            <!-- a horizontally scrolling block must be reachable by keyboard (WCAG 2.1.1) -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <pre tabindex="0" aria-label={t('Команда подключения MCP')} class="overflow-x-auto rounded-sm border border-line bg-sunk p-2 font-mono text-[11.5px] text-ink"><code class="pii">{mcpCommand(fresh.key)}</code></pre>
            <div>
              <button type="button" class="btn btn-sec" onclick={() => copy(mcpCommand(fresh.key), 'mcp')}>
                {copied === 'mcp' ? t('Скопировано') : t('Скопировать команду')}
              </button>
            </div>
          </div>
        </section>
      {/if}

      <section class="pane">
        <div class="pane-head">{t('Новый ключ')}</div>
        <form method="POST" action="?/create" class="pane-body flex flex-col gap-2 text-[12.5px]">
          <div class="flex flex-wrap items-end gap-2">
            <input name="name" required maxlength="80" placeholder={t('кому ключ: агент склеек, скрипт…')} aria-label={t('имя ключа')} class="input w-72" />
            <button class="btn btn-pri">{t('Создать ключ')}</button>
          </div>

          <p class="text-ink-2">
            {t('Сайты ключа: выбрано')} <b class="app-num text-ink">{scope.size || t('все')}</b>{t('. Ключ не увидит ничего, кроме выбранного — ни в API, ни в MCP.')}
            {#if data.sitesError}<span class="text-warn">{t('Список сайтов не загрузился (')}{data.sitesError}{t('), ключ получится на все сайты.')}</span>{/if}
          </p>

          {#if data.sites.length > 0}
            <input
              placeholder={t('фильтр по домену')}
              aria-label={t('фильтр по домену')}
              bind:value={siteFilter}
              class="input w-64"
            />
            <div class="max-h-56 overflow-y-auto rounded-sm border border-line">
              {#each shownSites as s (s.site)}
                <label class="flex items-center gap-2 border-b border-line-soft px-2 py-1 last:border-b-0 hover:bg-sunk">
                  <input type="checkbox" name="site" value={s.site} checked={scope.has(s.site)} onchange={() => toggleSite(s.site)} />
                  <span class="pii text-ink">{s.site}</span>
                  <span class="pii text-xs text-ink-3">{s.account}</span>
                </label>
              {:else}
                <p class="px-2 py-1.5 text-ink-3">{t('Ничего не нашлось.')}</p>
              {/each}
            </div>
            {#if scope.size > 0}
              <div>
                <button type="button" class="btn btn-ghost btn-sm" onclick={() => (scope = new Set())}>
                  {t('снять выбор (ключ на все сайты)')}
                </button>
              </div>
            {/if}
          {/if}
        </form>
      </section>

      <section class="pane">
        <div class="pane-head">{t('Ключи')} <span class="aside app-num">{data.keys.length}</span></div>
        <div class="overflow-x-auto">
          <table class="app-table">
            <thead>
              <tr>
                <th>{t('имя')}</th><th>{t('ключ')}</th><th>{t('сайты')}</th><th>{t('создан')}</th><th>{t('последний вызов')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {#each data.keys as k (k.id)}
                <tr class={k.revokedAt ? 'text-ink-4' : ''}>
                  <td class={k.revokedAt ? '' : 'font-medium text-ink'}>{k.name}</td>
                  <td class="app-num">{k.prefix}…</td>
                  <td class="max-w-xs">
                    {#if k.sites.length === 0}
                      <span class="badge badge-muted">{t('все')}</span>
                    {:else}
                      <span class="pii" title={k.sites.join('\n')}>{k.sites.length} {t('шт:')} {k.sites.slice(0, 2).join(', ')}{k.sites.length > 2 ? '…' : ''}</span>
                    {/if}
                  </td>
                  <td class="app-num {k.revokedAt ? '' : 'text-ink-3'}">{fmt(k.createdAt)}</td>
                  <td class="app-num {k.revokedAt ? '' : 'text-ink-3'}">{fmt(k.lastUsedAt)}</td>
                  <td class="text-right">
                    {#if k.revokedAt}
                      <span class="badge badge-muted">{t('отозван')} <span class="app-num">{fmt(k.revokedAt)}</span></span>
                    {:else}
                      <form method="POST" action="?/revoke" onsubmit={(e) => { if (!confirm(t('Отозвать ключ «{name}»? Всё, что им ходит, получит 401.', { name: k.name }))) e.preventDefault(); }}>
                        <input type="hidden" name="id" value={k.id} />
                        <button class="btn btn-danger btn-sm">{t('отозвать')}</button>
                      </form>
                    {/if}
                  </td>
                </tr>
              {:else}
                <tr><td colspan="6" class="py-3 text-ink-3">{t('Ключей пока нет.')}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <p class="text-xs text-ink-3">
        {data.envTokenSet
          ? t('Токен серпмонитора (SERP_API_TOKEN) задан в окружении и работает рядом с ключами — здесь он не показывается и не отзывается.')
          : t('Токен серпмонитора (SERP_API_TOKEN) в окружении не задан.')}
      </p>
    </div>

    <aside class="flex min-w-0 flex-col gap-3">
      <section class="pane">
        <div class="pane-head">{t('Документация для ИИ')}</div>
        <div class="pane-body flex flex-col gap-3 text-[12.5px] text-ink-2">
          <p>
            {t('Markdown по адресу')} <a class="link break-all font-mono text-[12px]" href={docUrl} target="_blank" rel="noopener">{docUrl}</a>{t('. Агент читает её тем же ключом; без ключа она не отдаётся.')}
          </p>
          <div>
            <button type="button" class="btn btn-sec" onclick={() => copy(agentBrief(fresh?.key ?? null), 'brief')}>
              {copied === 'brief' ? t('Скопировано') : t('Скопировать задание агенту')}
            </button>
          </div>
        </div>
      </section>

      <section class="pane">
        <div class="pane-head">{t('MCP-сервер')}</div>
        <div class="pane-body flex flex-col gap-2 text-[12.5px] text-ink-2">
          <p>
            {t('Тем же ключом агент подключается по MCP и читает статистику Search Console - только свои сайты и только на чтение. Адрес:')}
            <code class="pii break-all font-mono text-[12px] text-ink">{mcpUrl}</code>
          </p>
          <!-- a horizontally scrolling block must be reachable by keyboard (WCAG 2.1.1) -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <pre tabindex="0" aria-label={t('Команда подключения MCP')} class="overflow-x-auto rounded-sm border border-line bg-sunk p-2 font-mono text-[11.5px] text-ink"><code class="pii">{mcpCommand(null)}</code></pre>
          <p>
            {t('Скилы отдаются этим же сервером как промпты, а файлами - на')}
            <code class="pii break-all font-mono text-[12px] text-ink">{data.origin}/api/v1/skills</code>{t('. Подробности:')}
            <a class="link" href="/api/v1/doc.md" target="_blank" rel="noopener">doc.md</a>.
          </p>
        </div>
      </section>
    </aside>
  </div>
</main>
