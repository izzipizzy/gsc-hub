import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { getCachedHealth, runHealth, saveHealth } from '$lib/server/health';

// GET → cached result (or null). POST → run the checks now, cache, return fresh.
export const GET: RequestHandler = async ({ params, locals }) => {
  requireAdmin(locals);
  const cached = getCachedHealth(db(), params.site);
  return json(cached ?? { data: null, checkedAt: null });
};

export const POST: RequestHandler = async ({ params, locals }) => {
  requireAdmin(locals);
  const data = await runHealth(params.site);
  const checkedAt = saveHealth(db(), params.site, data);
  return json({ data, checkedAt });
};
