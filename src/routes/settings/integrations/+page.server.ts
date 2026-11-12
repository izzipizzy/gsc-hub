import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { getConfigValue, configSource, setConfigValue, clearConfigValue } from '$lib/server/config';
import { indexCheckSettings, saveIndexCheckSettings, clearIndexCheckSettings } from '$lib/server/index-check-providers';
import { isIndexCheckProvider } from '$lib/utils/index-check';
import { saveIndexCheckOptions } from '$lib/server/index-check-options';
import { indexBalance } from '$lib/server/neuralindexer';
export const load: PageServerLoad = ({ locals }) => {
  requireAdmin(locals);
  return { indexCheck: indexCheckSettings(db()), configured: !!getConfigValue(db(), 'NEURALINDEXER_API_TOKEN'), source: configSource(db(), 'NEURALINDEXER_API_TOKEN') };
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
  },
  save: async ({ locals, request }) => {
    requireAdmin(locals);
    if (configSource(db(), 'NEURALINDEXER_API_TOKEN') === 'env') return fail(400, { error: 'Ключ задан в окружении сервера' });
    const form = await request.formData();
    const token = String(form.get('token') ?? '').trim();
    if (!token || token.length > 512 || /\s/.test(token)) return fail(400, { error: 'Укажи API-ключ без пробелов' });
    setConfigValue(db(), 'NEURALINDEXER_API_TOKEN', token);
    return { saved: true };
  },
  clear: ({ locals }) => {
    requireAdmin(locals);
    if (configSource(db(), 'NEURALINDEXER_API_TOKEN') === 'env') return fail(400, { error: 'Ключ задан в окружении сервера' });
    clearConfigValue(db(), 'NEURALINDEXER_API_TOKEN');
    return { saved: true };
  },
  test: async ({ locals }) => {
    requireAdmin(locals);
    try { const b = await indexBalance(db(), true); return { balance: b.balance_usd }; }
    catch(e) { return fail(400, { error: (e as Error).message }); }
  }
};
