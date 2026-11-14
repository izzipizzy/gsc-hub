import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/guard';
import { gscCacheInvalidate, gscCacheSize } from '$lib/server/gsc-cache';
import { portfolio } from '$lib/server/portfolio';
import { invalidateTop } from '$lib/server/portfolio-top';

// Manual cache drop for the Refresh buttons: they promise fresh numbers, so the
// click must reach Search Console, not the 60-minute memory cache.
export const POST: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  const dropped = gscCacheInvalidate();
  // The snapshot keeps serving its numbers while one fresh pass runs behind
  // them; the page shows that pass's progress instead of waiting on it.
  portfolio.invalidate();
  invalidateTop();
  return json({ ok: true, dropped, remaining: gscCacheSize() });
};
