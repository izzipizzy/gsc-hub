import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { listQueryFilters, addQueryFilter, removeQueryFilter } from '$lib/server/filters';
import { requireAdmin } from '$lib/server/guard';

export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  return json({ filters: listQueryFilters(db()) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);
  const { pattern } = (await request.json()) as { pattern?: string };
  if (!pattern || !pattern.trim()) throw error(400, 'pattern required');
  return json(addQueryFilter(db(), pattern));
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);
  const { id } = (await request.json()) as { id?: number };
  if (typeof id !== 'number') throw error(400, 'id required');
  removeQueryFilter(db(), id);
  return json({ ok: true });
};
