import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/guard';
import { fetchBindings, fetchPositions, requestCheck } from '$lib/server/serp-monitor';

/**
 * Связки и позиции сайта из серпмонитора. Гео берём у него же, не гадаем.
 *
 * Состояние отдаём как есть: страница обязана отличать «сайт не заведён» от
 * «спросить не удалось», иначе при неверном токене она врёт про мониторинг.
 */
export const GET: RequestHandler = async ({ params, url, locals }) => {
  requireAdmin(locals);
  const site = params.site;
  const b = await fetchBindings(site);
  const geo = url.searchParams.get('geo') || b.bindings[0]?.geo || '';
  // Спрашиваем позиции только для запросов, которые показаны на экране.
  const queries = url.searchParams.getAll('q');
  const p = geo
    ? await fetchPositions(site, geo, queries)
    : { state: b.state, positions: null };
  return json({
    state: p.state === 'ok' ? b.state : p.state,
    reason: b.reason ?? p.reason ?? null,
    bindings: b.bindings,
    geo,
    positions: p.positions
  });
};

/** Заказать проверку. Ответ серпмонитора отдаём как есть: queued либо
 *  already_active — врать про постановку нельзя. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
  requireAdmin(locals);
  const { geo, source } = (await request.json()) as { geo?: string; source?: string };
  if (!geo) return json({ status: 'no_geo' });
  const result = await requestCheck(params.site, geo, source || 'gsc');
  return json(result ?? { status: 'unavailable' });
};
