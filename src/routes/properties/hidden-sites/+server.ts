import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { listHiddenSites, addHiddenSite, removeHiddenSite } from '$lib/server/hidden';
import { requireAdmin } from '$lib/server/guard';

export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  return json({ hidden: listHiddenSites(db()) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);
  const { account, site } = (await request.json()) as { account?: string; site?: string };
  if (!account || !site) throw error(400, 'account and site required');
  addHiddenSite(db(), account, site);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);
  const { account, site } = (await request.json()) as { account?: string; site?: string };
  if (!account || !site) throw error(400, 'account and site required');
  removeHiddenSite(db(), account, site);
  return json({ ok: true });
};
