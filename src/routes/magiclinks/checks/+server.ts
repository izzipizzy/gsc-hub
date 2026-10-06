import { isMagicProviderId, type MagicProviderId } from '$lib/server/magiclinks-providers';
import { readBacklinkDashboard } from '$lib/server/backlink-snapshots';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/guard';
import { db } from '$lib/server/db';
import { enqueueCheck, CheckBusyError, latestJob, readChecks, checkSummary, startBacklinkMonitor, providerCheckTotals } from '$lib/server/backlink-monitor';

export const GET: RequestHandler = ({ locals, url }) => {
  requireAdmin(locals);
  const provider = url.searchParams.get('provider');
  const orderId = url.searchParams.get('orderId');
  if (provider && !isMagicProviderId(provider)) throw error(400, 'Неизвестный провайдер');
  const rows = readChecks(db(), (provider || undefined) as MagicProviderId | undefined, orderId || undefined);
  return json({ job: latestJob(db()), summary: checkSummary(rows), dashboard: readBacklinkDashboard(db(), providerCheckTotals(readChecks(db()))) });
};
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Нужны параметры проверки');
  if (body.provider !== undefined && !isMagicProviderId(body.provider)) throw error(400, 'Неизвестный провайдер');
  if (body.orderId !== undefined && (typeof body.orderId !== 'string' || !body.orderId || body.orderId.length > 200 || !body.provider)) throw error(400, 'Нужен заказ и провайдер');
  if (body.placementId !== undefined && (typeof body.placementId !== 'string' || !body.placementId || body.placementId.length > 200 || !body.orderId)) throw error(400, 'Нужно размещение и заказ');
  try {
    const job = enqueueCheck(db(), { provider: body.provider, orderId: body.orderId, placementId: body.placementId });
    startBacklinkMonitor();
    return json({ job }, { status: 202 });
  } catch (e) { if (e instanceof CheckBusyError) throw error(409, e.message); throw e; }
};
