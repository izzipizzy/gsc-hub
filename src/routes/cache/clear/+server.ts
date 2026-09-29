import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/guard';
import { gscCacheInvalidate, gscCacheSize } from '$lib/server/gsc-cache';

// Manual cache drop for the Refresh buttons: they promise fresh numbers, so the
// click must reach Search Console, not the 60-minute memory cache.
export const POST: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  const dropped = gscCacheInvalidate();
  return json({ ok: true, dropped, remaining: gscCacheSize() });
};
