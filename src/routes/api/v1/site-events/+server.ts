import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireApiToken, requireSite } from '$lib/server/api-token';
import { addGluedDomain, GluedError } from '$lib/server/site-events';

// Подклейка донора к сайту из API. Пишет то же событие `merge`, что и форма на
// странице сайта («← донор»), поэтому оно сразу видно на графике, на дашборде и в
// portfolio pulse. Повтор возвращает существующую запись со статусом 200: агент
// вправе переслать запрос, не проверяя, дошёл ли первый.
export const POST: RequestHandler = async ({ request }) => {
  const caller = requireApiToken(request);
  const body = (await request.json().catch(() => null)) as {
    site?: unknown;
    donor?: unknown;
    date?: unknown;
  } | null;
  if (!body || typeof body !== 'object') throw error(400, 'body must be JSON: {"site", "donor", "date"?}');
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  if (str(body.site)) requireSite(caller, str(body.site));
  try {
    const res = addGluedDomain(db(), { site: str(body.site), donor: str(body.donor), date: str(body.date) });
    return json(res, { status: res.created ? 201 : 200 });
  } catch (e) {
    if (e instanceof GluedError) throw error(400, e.message);
    throw e;
  }
};
