import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { fetchTodayTotals } from '$lib/server/google';
import { requireAdmin } from '$lib/server/guard';

// Loaded after the page renders rather than with it: today costs one request
// per property, and the dashboard should not wait on a number that is still
// changing.
export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  return json(await fetchTodayTotals(db()));
};
