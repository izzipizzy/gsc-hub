import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireApiToken, scopeRows } from '$lib/server/api-token';
import { sitesByCountry } from '$lib/server/serp-api';
import { bingSitesByPeriod } from '$lib/server/bing';
import { alpha2ToAlpha3 } from '$lib/utils/country';

export const GET: RequestHandler = async ({ request, url }) => {
  const caller = requireApiToken(request);
  const country = (url.searchParams.get('country') ?? '').toLowerCase();
  const days = Math.floor(Number(url.searchParams.get('days') ?? '28'));
  const source = (url.searchParams.get('source') ?? 'gsc') as 'gsc' | 'bing';
  if (source !== 'gsc' && source !== 'bing') throw error(400, 'source gsc|bing');
  if (!Number.isFinite(days) || days < 1 || days > 480) throw error(400, 'days 1..480');
  // Bing идёт своим путём: у него другой API, другой список сайтов и нет
  // разреза по странам. Гнать его через Google-веер и метить результат как
  // bing — это выдавать чужие цифры за его.
  if (source === 'bing') {
    const payload = await bingSitesByPeriod(days);
    return json({ ...payload, sites: scopeRows(caller, payload.sites, (s) => s.site) });
  }
  if (!alpha2ToAlpha3(country)) throw error(400, 'unknown country');
  const payload = await sitesByCountry(db(), { country, days, source });
  // Ключ с областью видит только свои property, и в списке тоже.
  return json({ ...payload, sites: scopeRows(caller, payload.sites, (s) => s.site) });
};
