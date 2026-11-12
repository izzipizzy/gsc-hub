import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { getAccount } from '$lib/server/accounts';
import { listSitesForAllAccounts, listSitemaps } from '$lib/server/google';
import { collectCheckSitemap } from '$lib/server/index-check-sitemap';
import { indexCheckOptions } from '$lib/server/index-check-options';
import { indexCheckJobs } from '$lib/server/index-check-jobs';
import { getIndexCheckNotFoundUrls } from '$lib/server/index-check-history';
import { isIndexCheckProvider } from '$lib/utils/index-check';
export const GET: RequestHandler = ({ locals, url }) => {
  requireAdmin(locals);
  if (url.searchParams.get('action') === 'exportNotFound') {
    const run = url.searchParams.get('run'), batch = url.searchParams.get('batch');
    if ((run !== null) === (batch !== null) || !(run ?? batch)) throw error(400, 'Выбери одну проверку или очередь');
    const urls = getIndexCheckNotFoundUrls(db(), (run ?? batch)!, batch !== null ? 'batch' : 'run');
    if (urls === null) throw error(404, 'Проверка или очередь не найдена');
    return new Response(urls.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (url.searchParams.get('action') === 'batch') {
    const database = db(), batch = indexCheckJobs.getBatch(url.searchParams.get('id') ?? '', database);
    if (!batch) throw error(404, 'Очередь не найдена');
    const view = url.searchParams.get('run');
    if (view && !batch.runs.some((r) => r.id === view)) throw error(400, 'Проверка не относится к этой очереди');
    const run = indexCheckJobs.get(view ?? batch.activeRunId ?? batch.runs.at(-1)!.id, database);
    return json({ batch, run }, { headers: { 'cache-control': 'no-store' } });
  }
  if (url.searchParams.get('action') === 'history') {
    const offset = Number(url.searchParams.get('offset') ?? '0');
    if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw error(400, 'Некорректная страница истории');
    return json({ history: indexCheckJobs.history(db(), {
      site: url.searchParams.get('site') || undefined, accountId: url.searchParams.get('account') || undefined, offset
    }) }, { headers: { 'cache-control': 'no-store' } });
  }
  const run = indexCheckJobs.get(url.searchParams.get('id') ?? '', db());
  if (!run) throw error(404, 'Проверка не найдена');
  return json({ run }, { headers: { 'cache-control': 'no-store' } });
};
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  if (Number(request.headers.get('content-length')) > 8192) throw error(413, 'Слишком большой запрос');
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.length;
        if (bytes > 8192) throw error(413, 'Слишком большой запрос');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let body: any;
  try { body = JSON.parse(raw); } catch { throw error(400, 'Некорректный JSON'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') throw error(400, 'Некорректный запрос');
  if (body.action === 'prepare') {
    if (typeof body.site !== 'string' || typeof body.accountId !== 'string' ||
      (body.sitemap !== undefined && typeof body.sitemap !== 'string')) throw error(400, 'Выбери сайт и укажи sitemap');
    const database = db(), account = getAccount(database, body.accountId);
    if (!account || account.status !== 'active') throw error(400, 'Аккаунт недоступен; переподключи его');
    const { sites } = await listSitesForAllAccounts(database);
    if (!sites.some((s) => s.accountId === body.accountId && s.siteUrl === body.site)) throw error(400, 'Сайт не найден в выбранном аккаунте');
    try {
      const pages = await collectCheckSitemap(body.site, body.sitemap ?? '', undefined, async (signal) => (await listSitemaps(database, account, body.site, signal)).map((item) => item.path));
      return json({ draft: indexCheckJobs.addDraft({ site: body.site, accountId: body.accountId, ...pages }) });
    } catch (e) { throw error(400, `Не удалось получить страницы: ${(e as Error).message.slice(0, 240)}`); }
  }
  if (body.action === 'start' || body.action === 'startBatch') {
    if ((body.action === 'start' ? typeof body.draftId !== 'string' : !Array.isArray(body.draftIds) || body.draftIds.length < 2 || body.draftIds.length > 20 || body.draftIds.some((id: unknown) => typeof id !== 'string')) || !isIndexCheckProvider(body.provider) || body.confirmed !== true) throw error(400, 'Подтверди запуск проверки выбранным сервисом');
    const options = indexCheckOptions(db(), body.provider);
    if (!body.expectedOptions || Object.entries(options).some(([key, value]) => body.expectedOptions[key] !== value)) throw error(400, 'Параметры проверки изменились. Обнови страницу и подтверди запуск с актуальным числом повторов');
    try {
      if (body.action === 'startBatch') {
        const database = db(), batch = indexCheckJobs.startBatch(database, body.draftIds, body.provider);
        return json({ batch, run: indexCheckJobs.get(batch.activeRunId ?? batch.runs[0].id, database) });
      }
      return json({ run: indexCheckJobs.start(db(), body.draftId, body.provider) });
    }
    catch (e) { throw error(400, (e as Error).message); }
  }
  if (body.action === 'cancelBatch' && typeof body.id === 'string') {
    const database = db(), batch = indexCheckJobs.cancelBatch(body.id, database);
    if (!batch) throw error(404, 'Очередь не найдена');
    return json({ batch }, { headers: { 'cache-control': 'no-store' } });
  }
  if (body.action === 'cancel' && typeof body.id === 'string') {
    const run = indexCheckJobs.cancel(body.id, db());
    if (!run) throw error(404, 'Проверка не найдена');
    return json({ run }, { headers: { 'cache-control': 'no-store' } });
  }
  throw error(400, 'Неизвестное действие');
};
