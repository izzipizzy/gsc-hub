import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getAccount } from '$lib/server/accounts';
import { bulkInspect } from '$lib/server/google';
import {
  hashUrls,
  getCachedInspection,
  setCachedInspection
} from '$lib/server/inspection_cache';

const TTL_SEC = 12 * 3600;

export const POST: RequestHandler = async ({ request, url }) => {
  const body = (await request.json()) as { account?: string; site?: string; urls?: string[] };
  if (!body.account || !body.site || !Array.isArray(body.urls) || body.urls.length === 0) {
    throw error(400, 'account, site, urls[] required');
  }
  if (body.urls.length > 25) throw error(400, 'max 25 urls per request');

  const acc = getAccount(db(), body.account);
  if (!acc) throw error(404, 'account not found');
  if (acc.status !== 'active') throw error(409, `account is ${acc.status}; reconnect`);

  const force = url.searchParams.get('force') === '1';
  const urlsHash = hashUrls(body.urls);

  if (!force) {
    const cached = getCachedInspection(db(), body.account, body.site, urlsHash, TTL_SEC);
    if (cached) {
      return json({
        ...JSON.parse(cached.payload),
        cached: true,
        fetchedAt: cached.fetchedAt
      });
    }
  }

  const results = await bulkInspect(db(), acc, body.site, body.urls);
  const payload = JSON.stringify({ results });
  setCachedInspection(db(), body.account, body.site, urlsHash, payload);

  return json({ results, cached: false, fetchedAt: Math.floor(Date.now() / 1000) });
};
