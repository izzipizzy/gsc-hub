import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { indexCheckBalance } from '$lib/server/index-check-balance';
import { isIndexCheckProvider } from '$lib/utils/index-check';
export const GET: RequestHandler = async ({ locals, url }) => {
  requireAdmin(locals);
  const provider = url.searchParams.get('provider');
  if (!isIndexCheckProvider(provider)) throw error(400, 'Неизвестный сервис');
  try { return json({ balance: await indexCheckBalance(db(), provider) }, { headers: { 'cache-control': 'no-store' } }); }
  catch (e) { return json({ message: (e as Error).message }, { status: 502, headers: { 'cache-control': 'no-store' } }); }
};
