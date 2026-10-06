import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { getConfigValue } from '$lib/server/config';
import { pageUrls, indexSitemapUrls, createIndexQuote, submitIndexQuote, indexHistory, indexToken, type IndexQueue } from '$lib/server/neuralindexer';
export const GET: RequestHandler = ({ locals, params }) => {
  requireAdmin(locals);
  return json({ configured: !!getConfigValue(db(), 'NEURALINDEXER_API_TOKEN'), history: indexHistory(db(), params.site) });
};
export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  if (Number(request.headers.get('content-length')) > 8_000_000) throw error(413, 'Слишком большой запрос');
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, 'Некорректный JSON-запрос');
  try {
    if (body.action === 'submit' && typeof body.id === 'string') return json({ result: await submitIndexQuote(db(), params.site, body.id) });
    if (body.action !== 'quote' || !['slow','fast','yandex'].includes(body.queue) || !['pages','sitemap'].includes(body.mode) || typeof body.input !== 'string' || body.input.length > 8_000_000) throw new Error('Некорректные параметры');
    indexToken(db());
    const urls = body.mode === 'sitemap' ? await indexSitemapUrls(body.input, params.site) : pageUrls(body.input, params.site);
    return json({ quote: await createIndexQuote(db(), params.site, urls, body.queue as IndexQueue) });
  } catch(e) { throw error(400, (e as Error).message); }
};
