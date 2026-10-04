import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { listSiteEvents, hostOfSite, donorOf, SITE_EVENT_TYPES } from '$lib/server/site-events';
import { hostToUnicode } from '$lib/server/idn';
import { listSitesForAllAccounts } from '$lib/server/google';

// Все события сайтов одной таблицей: куда подклеен какой домен и когда.
export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  const events = listSiteEvents(db());

  // Страница сайта в хабе требует аккаунт (?acc=), а событие знает только хост.
  // Список property берётся из того же часового кеша, что и /properties; если Google
  // недоступен — строки просто без ссылки внутрь, таблица всё равно открывается.
  const props = new Map<string, { siteUrl: string; accountId: string }>();
  try {
    const { sites } = await listSitesForAllAccounts(db());
    for (const s of sites) {
      const host = hostOfSite(s.siteUrl);
      const prev = props.get(host);
      // Доменное property покрывает весь сайт — оно предпочтительнее URL-префикса.
      if (!prev || (s.siteUrl.startsWith('sc-domain:') && !prev.siteUrl.startsWith('sc-domain:'))) {
        props.set(host, { siteUrl: s.siteUrl, accountId: s.accountId });
      }
    }
  } catch {
    /* без ссылок внутрь */
  }

  return {
    rows: events.map((e) => {
      // Подпись с формы сайта — голый домен, с сида и API — «← домен»: донор один.
      const donor = e.type === 'merge' ? donorOf(e.note) : null;
      const glued = donor ? hostToUnicode(donor) : '';
      const p = props.get(e.siteHost);
      return {
        id: e.id,
        site: e.siteHost,
        donor: glued,
        note: glued ? '' : e.note,
        type: e.type,
        color: SITE_EVENT_TYPES[e.type]?.color,
        typeLabel: SITE_EVENT_TYPES[e.type]?.label ?? e.type,
        orderHref: e.orderHref ?? null,
        date: e.date,
        addedAt: e.addedAt,
        href: p ? `/properties/${encodeURIComponent(p.siteUrl)}?acc=${encodeURIComponent(p.accountId)}` : null
      };
    })
  };
};
