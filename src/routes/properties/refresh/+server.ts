import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/guard';
import { gscCacheInvalidate } from '$lib/server/gsc-cache';
import { portfolio } from '$lib/server/portfolio';
import { invalidateTop } from '$lib/server/portfolio-top';

export const POST: RequestHandler = ({ locals }) => {
  requireAdmin(locals);
  // Refresh = реально заново: сбрасываем кеш GSC-ответов, затем load() стартует
  // с чистого листа.
  gscCacheInvalidate();
  portfolio.invalidate();
  invalidateTop();
  throw redirect(303, '/properties');
};
