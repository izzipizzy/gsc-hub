import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireApiToken, requireSite } from '$lib/server/api-token';
import { queryPagesForSite } from '$lib/server/serp-api';
import { alpha2ToAlpha3 } from '$lib/utils/country';

/** Запрос → его главная посадочная страница за период, в разрезе страны. */
export const GET: RequestHandler = async ({ request, url }) => {
  const caller = requireApiToken(request);
  const site = url.searchParams.get('site') ?? '';
  if (site) requireSite(caller, site);
  const country = (url.searchParams.get('country') ?? '').toLowerCase();
  const days = Math.floor(Number(url.searchParams.get('days') ?? '28'));
  if (!site) throw error(400, 'site required');
  if (!Number.isFinite(days) || days < 1 || days > 480) throw error(400, 'days 1..480');
  if (!alpha2ToAlpha3(country)) throw error(400, 'unknown country');
  return json(await queryPagesForSite(db(), { site, country, days }));
};
