import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireApiToken, requireSite } from '$lib/server/api-token';
import { siteCountries } from '$lib/server/serp-api';

/** Гео одного property, в которых у него есть показы за период. */
export const GET: RequestHandler = async ({ request, url }) => {
  const caller = requireApiToken(request);
  const site = url.searchParams.get('site') ?? '';
  if (site) requireSite(caller, site);
  const days = Math.floor(Number(url.searchParams.get('days') ?? '28'));
  if (!site) throw error(400, 'site required');
  if (!Number.isFinite(days) || days < 1 || days > 480) throw error(400, 'days 1..480');
  return json(await siteCountries(db(), { site, days }));
};
