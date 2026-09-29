import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireApiToken, scopeRows } from '$lib/server/api-token';
import { propertiesForImport } from '$lib/server/serp-api';

/**
 * Все property со всех аккаунтов, включая скрытые в хабе (с флагом `hidden`).
 * Нужна экрану «один сайт → несколько гео»: сайт там выбирают руками, и
 * скрытый должен быть доступен, — /api/v1/sites его не отдаст.
 */
export const GET: RequestHandler = async ({ request }) => {
  const caller = requireApiToken(request);
  const payload = await propertiesForImport(db());
  return json({ ...payload, sites: scopeRows(caller, payload.sites, (s) => s.site) });
};
