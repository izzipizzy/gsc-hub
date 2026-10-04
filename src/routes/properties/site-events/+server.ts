import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { addSiteEvent, deleteSiteEvent, type SiteEventType } from '$lib/server/site-events';
import { requireAdmin } from '$lib/server/guard';

// Writes for custom chart events (domain merges etc.). Reads happen in page loads;
// this endpoint only adds and removes.

export const POST: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);
  const body = (await request.json().catch(() => null)) as {
    site?: string;
    date?: string;
    note?: string;
    type?: string;
  } | null;
  const site = body?.site?.trim() ?? '';
  const date = body?.date?.trim() ?? '';
  const note = body?.note?.trim() ?? '';
  const type = (body?.type?.trim() || 'merge') as SiteEventType;
  if (type !== 'merge') throw error(400, 'only merge events can be added manually');
  if (!site) throw error(400, 'site required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw error(400, 'date must be YYYY-MM-DD');
  if (!note) throw error(400, 'note required');

  const ev = addSiteEvent(db(), { siteHost: site, date, note, type });
  if (!ev) throw error(409, 'identical event already exists');
  return json(ev);
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);
  const body = (await request.json().catch(() => null)) as { id?: number } | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id < 1) throw error(400, 'id required');
  deleteSiteEvent(db(), id);
  return json({ ok: true });
};
