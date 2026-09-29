import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/guard';
import { gscCacheInvalidate } from '$lib/server/gsc-cache';

export const POST: RequestHandler = ({ locals }) => {
  requireAdmin(locals);
  // Refresh = реально заново: сбрасываем кеш GSC-ответов, затем load() стартует
  // с чистого листа.
  gscCacheInvalidate();
  throw redirect(303, '/properties');
};
