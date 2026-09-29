import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { createApiKey, listApiKeys, revokeApiKey } from '$lib/server/api-keys';
import { propertiesForImport } from '$lib/server/serp-api';

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals);
  // Список property для выбора области ключа. Google может не ответить — тогда
  // ключ всё равно создаётся, просто без ограничения по сайтам.
  let sites: { site: string; account: string }[] = [];
  let sitesError: string | null = null;
  try {
    const payload = await propertiesForImport(db());
    sites = payload.sites.map((s) => ({ site: s.site, account: s.account }));
  } catch (e) {
    sitesError = (e as Error).message.slice(0, 160);
  }

  return {
    keys: listApiKeys(db()),
    sites,
    sitesError,
    origin: url.origin,
    // Токен серпмонитора живёт в окружении, а не в базе: показываем только то, что он есть.
    envTokenSet: (process.env.SERP_API_TOKEN ?? '').trim() !== ''
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const name = String(form.get('name') ?? '').trim();
    if (!name) return fail(400, { error: 'Назови ключ: кому или для чего он' });
    // Пустой список — ключ на все сайты, как было до появления области.
    const scope = form.getAll('site').map(String).filter(Boolean);
    const created = createApiKey(db(), name, scope);
    // Ключ уходит в ответ формы ровно один раз; в базе остаётся только хеш.
    return { created: { name: created.name, key: created.key, sites: created.sites } };
  },
  revoke: async ({ request, locals }) => {
    requireAdmin(locals);
    const id = Number((await request.formData()).get('id'));
    if (!Number.isInteger(id) || id < 1) return fail(400, { error: 'id ключа не распознан' });
    revokeApiKey(db(), id);
    return { revoked: id };
  }
};
