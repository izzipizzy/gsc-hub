import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireApiToken } from '$lib/server/api-token';
import { countriesByPeriod } from '$lib/server/serp-api';

/** Гео, в которых у сайтов реально есть показы за период. */
export const GET: RequestHandler = async ({ request, url }) => {
  requireApiToken(request);
  const days = Math.floor(Number(url.searchParams.get('days') ?? '28'));
  if (!Number.isFinite(days) || days < 1 || days > 480) throw error(400, 'days 1..480');
  return json(await countriesByPeriod(db(), days));
};
