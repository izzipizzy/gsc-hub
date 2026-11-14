import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { getUiPrefs, setUiPrefs } from '$lib/server/ui-prefs';
import { isLocale, isTheme } from '$lib/i18n/locale';
import { tr } from '$lib/i18n/index.svelte';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw error(401, 'unauthorized');
  const saved = getUiPrefs(db(), locals.user.id);
  return { savedLocale: saved.locale, theme: locals.theme };
};

export const actions: Actions = {
  // Saved per user in the database, so the choice follows the account to any
  // browser and survives new sessions.
  default: async ({ request, locals }) => {
    if (!locals.user) throw error(401, 'unauthorized');
    const form = await request.formData();
    const locale = form.get('locale');
    const theme = form.get('theme');
    if (locale !== null && !isLocale(locale)) return fail(400, { error: tr(locals.locale, 'Неизвестный язык') });
    if (theme !== null && !isTheme(theme)) return fail(400, { error: tr(locals.locale, 'Неизвестная тема') });
    setUiPrefs(db(), locals.user.id, { locale: locale ?? undefined, theme: theme ?? undefined });
    return { saved: true };
  }
};
