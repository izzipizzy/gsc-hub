<script lang="ts">
  import type { CheckRecord } from '$lib/server/backlink-monitor';
  let { check }: { check?: CheckRecord } = $props();
  const label = (r: NonNullable<CheckRecord['result']>) => r.status === 'found' ? 'ссылка найдена'
    : r.status === 'error' ? 'не удалось проверить'
    : r.status === 'wrong_url' ? (r.confirmed ? 'другой URL' : 'другой URL · перепроверка')
    : r.confirmed ? 'ссылка отсутствует' : 'не найдена · перепроверка';
  const color = (r: NonNullable<CheckRecord['result']>) => r.status === 'found' ? 'badge-ok' : r.confirmed ? 'badge-bad' : 'badge-warn';
  const date = (n: number) => new Date(n).toLocaleString('ru-RU');
</script>
{#if check?.result}
  {@const r = check.result}
  <div class="flex flex-col items-start gap-1 text-xs">
    <span class="badge {color(r)}">{label(r)}</span>
    {#if r.anchorChanged}<span class="badge badge-warn">анкор отличается</span>{/if}
    {#each [...new Set(r.links.map((l) => l.rel || 'dofollow'))] as rel}
      <span class="text-ink-3">{rel}</span>
    {/each}
    {#if check.checkedAt}<span class="app-num whitespace-nowrap text-ink-3">{date(check.checkedAt)}</span>{/if}
    <details>
      <summary class="cursor-pointer text-acc">Результат и история</summary>
      <div class="mt-1 flex max-w-sm flex-col gap-2 whitespace-normal">
        {#if r.error}<span class="text-warn">{r.error}</span>{/if}
        {#each r.links as link}
          <div class="pii break-all"><a class="text-acc hover:underline" href={link.url} target="_blank" rel="noopener noreferrer nofollow">{link.url}</a><br />Анкор: {link.anchor || 'пустой'} · rel: {link.rel || 'dofollow'}</div>
        {/each}
        {#each check.history as h}
          <div class="border-t border-line-soft pt-1"><span class="app-num text-ink-3">{date(h.checkedAt)}</span> · {label(h.result)}
            {#if h.result.error}<div class="text-warn">{h.result.error}</div>{/if}
            {#each h.result.links as link}<div class="pii break-all text-ink-2">{link.url} · {link.anchor || 'пустой анкор'} · {link.rel || 'dofollow'}</div>{/each}
          </div>
        {/each}
      </div>
    </details>
  </div>
{:else}<span class="text-xs text-ink-3">не проверено</span>{/if}
