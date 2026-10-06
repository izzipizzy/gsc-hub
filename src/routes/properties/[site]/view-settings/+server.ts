import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { saveSiteViewSettings } from '$lib/server/site-view-settings';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  requireAdmin(locals);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, 'settings object required');
  try { return json(saveSiteViewSettings(db(), params.site, body)); }
  catch (e) { throw error(400, (e as Error).message); }
};
