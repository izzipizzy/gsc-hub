import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { indexCheckSettings, saveIndexCheckSettings, clearIndexCheckSettings } from '$lib/server/index-check-providers';
import { isIndexCheckProvider } from '$lib/utils/index-check';
import { saveIndexCheckOptions } from '$lib/server/index-check-options';
export const load: PageServerLoad = ({ locals }) => {
  requireAdmin(locals);
  return { indexCheck: indexCheckSettings(db()) };
};
export const actions: Actions = {
  saveCheckOptions: async ({ locals, request }) => {
    requireAdmin(locals);
    const form = await request.formData(), provider = form.get('provider');
    if (!isIndexCheckProvider(provider)) return fail(400, { error: 'Неизвестный сервис' });
    try { saveIndexCheckOptions(db(), provider, Object.fromEntries(form)); return { saved: true, provider }; }
    catch (e) { return fail(400, { error: (e as Error).message, provider }); }
  },
  saveIndexCheck: async ({ locals, request }) => {
    requireAdmin(locals);
    const form = await request.formData(), provider = form.get('provider');
    if (!isIndexCheckProvider(provider)) return fail(400, { error: 'Неизвестный сервис' });
    try {
      saveIndexCheckSettings(db(), provider, Object.fromEntries(form));
      return { saved: true, provider };
    } catch (e) { return fail(400, { error: (e as Error).message, provider }); }
  },
  clearIndexCheck: async ({ locals, request }) => {
    requireAdmin(locals);
    const form = await request.formData(), provider = form.get('provider');
    if (!isIndexCheckProvider(provider)) return fail(400, { error: 'Неизвестный сервис' });
    clearIndexCheckSettings(db(), provider);
    return { saved: true, provider };
  }
};
