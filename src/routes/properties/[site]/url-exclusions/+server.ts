import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { listUrlExclusions, addUrlExclusion, removeUrlExclusion } from '$lib/server/site-url-exclusions';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  requireAdmin(locals);
  const body = await request.json().catch(() => null);
  if (typeof body?.pattern !== 'string' || !['exact', 'mask', 'not_contains'].includes(body?.kind)) {
    throw error(400, 'pattern and kind required');
  }
  try { addUrlExclusion(db(), params.site, body.pattern, body.kind); }
  catch (e) { throw error(400, (e as Error).message); }
  return json({ exclusions: listUrlExclusions(db(), params.site) });
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
  requireAdmin(locals);
  const body = await request.json().catch(() => null);
  if (!Number.isInteger(body?.id) || body.id < 1) throw error(400, 'id required');
  removeUrlExclusion(db(), params.site, body.id);
  return json({ exclusions: listUrlExclusions(db(), params.site) });
};
