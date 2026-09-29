import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireApiToken, requireSite } from '$lib/server/api-token';
import { queriesForSite } from '$lib/server/serp-api';
import { bingQueriesForSite } from '$lib/server/bing';
import { alpha2ToAlpha3 } from '$lib/utils/country';

export const GET: RequestHandler = async ({ request, url }) => {
  const caller = requireApiToken(request);
  const site = url.searchParams.get('site') ?? '';
  if (site) requireSite(caller, site);
  const country = (url.searchParams.get('country') ?? '').toLowerCase();
  const days = Math.floor(Number(url.searchParams.get('days') ?? '28'));
  const source = (url.searchParams.get('source') ?? 'gsc') as 'gsc' | 'bing';
  // Без этой проверки любое значение, кроме 'bing', молча уезжает в Google —
  // включая опечатку и отменённое 'both'.
  if (source !== 'gsc' && source !== 'bing') throw error(400, 'source gsc|bing');
  if (!site) throw error(400, 'site required');
  if (!Number.isFinite(days) || days < 1 || days > 480) throw error(400, 'days 1..480');
  if (source === 'bing') return json(await bingQueriesForSite(site, days));
  if (!alpha2ToAlpha3(country)) throw error(400, 'unknown country');
  return json(await queriesForSite(db(), { site, country, days }));
};
