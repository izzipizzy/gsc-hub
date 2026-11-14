import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { portfolio, todayOf } from '$lib/server/portfolio';
import { requireAdmin } from '$lib/server/guard';

// Today's row is part of each site's series in the portfolio snapshot, so this
// costs no request of its own. It is as fresh as the snapshot — the page shows
// the snapshot's age next to it.
export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  const { slots, accountErrors, status } = await portfolio.get(db(), { wait: false });
  return json(todayOf(slots, accountErrors, status));
};
