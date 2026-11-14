<script lang="ts">
  import { t, tx, plural, fmtNum, fmtPct, fmtDec, fmtDay, getLocale } from '$lib/i18n/index.svelte';
  import { onMount, tick } from 'svelte';
  import { displaySite } from '$lib/utils/site';
  type Site = { key: string; site: string; account: string };
  let { sites, value = $bindable<string[]>([]), disabled = false, onchange }: {
    sites: Site[]; value?: string[]; disabled?: boolean; onchange?: () => void;
  } = $props();
  const uid = $props.id();
  let query = $state(''), open = $state(false), active = $state(0), limitMessage = $state('');
  let root: HTMLDivElement, input: HTMLInputElement, popup: HTMLDivElement;
  let placement = $state('');
  const filtered = $derived(sites.filter((s) => displaySite(s.site).toLowerCase().includes(query.trim().toLowerCase())));
  const picked = $derived(sites.filter((s) => value.includes(s.key)));
  function position() {
    if (!input || !open) return;
    const rect = input.getBoundingClientRect(), height = window.visualViewport?.height ?? innerHeight;
    const width = Math.min(Math.max(rect.width, 280), innerWidth - 16);
    const below = height - rect.bottom - 12, above = rect.top - 12;
    const desired = Math.min(320, Math.max(100, filtered.length * 40 + 72));
    const flip = below < Math.min(desired, 180) && above > below;
    const max = Math.max(80, Math.min(desired, flip ? above : below));
    placement = `position:fixed;inset:auto;margin:0;left:${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px;top:${flip ? rect.top - max - 4 : rect.bottom + 4}px;width:${width}px;max-height:${max}px`;
  }
  async function reveal() { open = true; active = 0; await tick(); if (!open || disabled) return; position(); if (popup?.isConnected && !popup.matches(':popover-open')) popup.showPopover(); }
  function close() { open = false; if (popup?.matches(':popover-open')) popup.hidePopover(); }
  function toggle(key: string) {
    limitMessage = '';
    if (value.includes(key)) value = value.filter((v) => v !== key);
    else if (value.length < 20) value = [...value, key];
    else { limitMessage = t('За один запуск можно выбрать до 20 сайтов'); return; }
    onchange?.(); input?.focus();
  }
  async function keydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) await reveal();
      else active = filtered.length ? (active + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length : 0;
      await tick(); document.getElementById(`${uid}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!open) await reveal(); else if (filtered[active]) toggle(filtered[active].key);
    } else if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'Tab') close();
  }
  $effect(() => { if (disabled) close(); });
  onMount(() => {
    const outside = (event: PointerEvent) => { if (!root?.contains(event.target as Node)) close(); };
    const resize = () => position();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', resize); window.addEventListener('scroll', resize, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize); window.removeEventListener('scroll', resize, true); };
  });
</script>
<div class="grid min-w-0 gap-1" bind:this={root}>
  <label class="text-xs text-ink-2" for={uid + '-search'}>{t('Сайты')} <span class="text-ink-3">· {value.length} {t('из 20')}</span></label>
  <div class="flex min-w-0 gap-1">
    <input id={uid + '-search'} class="input pii min-w-0 w-full" bind:this={input} bind:value={query} role="combobox" aria-autocomplete="list"
      aria-expanded={open} aria-controls={uid + '-list'} aria-activedescendant={open && filtered[active] ? `${uid}-option-${active}` : undefined}
      aria-describedby={uid + '-hint'} placeholder={t('Найти сайт по адресу')} autocomplete="off" {disabled}
      onfocus={reveal} oninput={() => { active = 0; reveal(); }} onkeydown={keydown} />
    {#if query}<button class="btn btn-ghost btn-icon shrink-0" type="button" aria-label={t('Очистить поиск сайтов')} {disabled} onclick={() => { query = ''; input.focus(); reveal(); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>{/if}
  </div>
  <p id={uid + '-hint'} class="text-[11px] text-ink-3">{t('Можно выбрать несколько сайтов. Стрелки — список, Enter — выбор, Esc — закрыть.')}</p>
  {#if picked.length}
    <div class="flex max-h-28 flex-wrap gap-1 overflow-y-auto" aria-label={t('Выбранные сайты')}>
      {#each picked as site (site.key)}
        <button type="button" class="btn btn-sec btn-sm max-w-full gap-1 pii" {disabled} title={site.site + ' · ' + site.account} aria-label={t('Убрать ') + displaySite(site.site) + ' · ' + site.account} onclick={() => toggle(site.key)}>
          <span class="truncate">{displaySite(site.site)} · {site.account}</span><svg class="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
        </button>
      {/each}
    </div>
    <button class="btn btn-ghost btn-sm justify-self-start" type="button" {disabled} onclick={() => { value = []; onchange?.(); }}>{t('Снять выбор со всех')}</button>
  {/if}
  <div bind:this={popup} popover="manual" style={placement} class="overflow-y-auto rounded-sm border border-line bg-pane p-1 text-xs text-ink shadow-pop">
    <div class="border-b border-line px-2 py-2 text-ink-3" role="status">{t('Найдено сайтов:')} {filtered.length} {t('· выбрано:')} {value.length}</div>
    <div role="listbox" id={uid + '-list'} aria-label={t('Доступные сайты')} aria-multiselectable="true">
      {#each filtered as site, index (site.key)}
        <button type="button" role="option" aria-selected={value.includes(site.key)} tabindex="-1" id={`${uid}-option-${index}`}
          class="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left hover:bg-bg {active === index ? 'bg-acc-t' : ''}" onpointerdown={(e) => e.preventDefault()} onclick={() => { active = index; toggle(site.key); }}>
          <svg class="mt-0.5 h-4 w-4 shrink-0 {value.includes(site.key) ? 'text-acc' : 'text-ink-3'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" />{#if value.includes(site.key)}<path d="m7 12 3 3 7-7" />{/if}</svg>
          <span class="min-w-0 pii"><span class="block break-all">{displaySite(site.site)}</span><span class="block text-[11px] text-ink-3">{site.account}</span></span>
        </button>
      {:else}<p class="px-2 py-4 text-ink-2" role="status">{t('Сайты не найдены. Измени запрос или очисти поиск.')}</p>{/each}
    </div>
  </div>
  {#if limitMessage}<p class="text-xs text-dn" role="status">{tx(limitMessage)}</p>{/if}
</div>
