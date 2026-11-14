<script lang="ts">
  // Settings, grouped by meaning. Forced indexing (indexers) and checking
  // indexation (XML River, DataForSEO) are different services and stay apart.
  import { page } from '$app/state';
  import { t } from '$lib/i18n/index.svelte';

  const GROUPS = [
    {
      label: 'Доступ',
      items: [
        { href: '/settings/accounts', label: 'Google-аккаунты' },
        { href: '/admin/users', label: 'Пользователи', admin: true },
        { href: '/api', label: 'API и MCP', admin: true }
      ]
    },
    {
      label: 'Сервисы',
      items: [
        { href: '/settings/indexers', label: 'Индексаторы', hint: 'отправка в индекс', admin: true },
        { href: '/settings/index-check', label: 'Проверка индексации', hint: 'XML River, DataForSEO', admin: true },
        { href: '/magiclinks', label: 'Меджики', hint: 'ключи, прокси', admin: true }
      ]
    },
    {
      label: 'Данные',
      items: [{ href: '/settings/portfolio', label: 'Портфель', hint: 'строки Top', admin: true }]
    }
  ] as const;

  let { isAdmin = true }: { isAdmin?: boolean } = $props();
</script>

<nav class="pane flex flex-col gap-px p-1.5" aria-label={t('Разделы настроек')}>
  {#each GROUPS as group (group.label)}
    {@const items = group.items.filter((i) => isAdmin || !('admin' in i && i.admin))}
    {#if items.length}
      <div class="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-3 first:pt-1">{t(group.label)}</div>
      {#each items as item (item.href)}
        {@const active = page.url.pathname === item.href}
        <a
          href={item.href}
          class="flex min-h-7 flex-col justify-center rounded-sm px-2.5 py-1 text-[12.5px] leading-tight transition-colors {active ? 'bg-bg font-semibold text-ink' : 'text-ink-2 hover:bg-bg hover:text-ink'}"
          aria-current={active ? 'page' : undefined}
        >
          {t(item.label)}
          {#if 'hint' in item}<span class="mt-0.5 text-[11px] font-normal text-ink-3">{t(item.hint)}</span>{/if}
        </a>
      {/each}
    {/if}
  {/each}
</nav>
