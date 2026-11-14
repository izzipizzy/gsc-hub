import { building } from '$app/environment';
import { startBacklinkMonitor } from '$lib/server/backlink-monitor';
import { sequence } from '@sveltejs/kit/hooks';
import { handle as authHandle } from './auth';
import { authGuard } from '$lib/server/guard';
import type { Handle } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { getUiPrefs } from '$lib/server/ui-prefs';
import { localeFromAcceptLanguage } from '$lib/i18n/locale';

// Language and theme for this request: the user's saved choice, otherwise the
// browser's Accept-Language and the system theme. Written into <html> before
// the first paint, so a dark theme never flashes light.
const uiPrefs: Handle = async ({ event, resolve }) => {
  const saved = event.locals.user ? getUiPrefs(db(), event.locals.user.id) : null;
  event.locals.locale = saved?.locale ?? localeFromAcceptLanguage(event.request.headers.get('accept-language'));
  event.locals.theme = saved?.theme ?? 'system';
  const themeAttr = event.locals.theme === 'system' ? '' : ` data-theme="${event.locals.theme}"`;
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%gsc.lang%', event.locals.locale).replace('%gsc.theme%', themeAttr)
  });
};

export const handle = sequence(authGuard, uiPrefs, authHandle);

export const init = () => { if (!building) startBacklinkMonitor(); };
