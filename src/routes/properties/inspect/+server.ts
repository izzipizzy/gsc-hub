import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getAccount } from '$lib/server/accounts';
import { bulkInspect } from '$lib/server/google';

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { account?: string; site?: string; urls?: string[] };
  if (!body.account || !body.site || !Array.isArray(body.urls) || body.urls.length === 0) {
    throw error(400, 'account, site, urls[] required');
  }
  if (body.urls.length > 25) throw error(400, 'max 25 urls per request');

  const acc = getAccount(db(), body.account);
  if (!acc) throw error(404, 'account not found');
  if (acc.status !== 'active') throw error(409, `account is ${acc.status}; reconnect`);

  const results = await bulkInspect(db(), acc, body.site, body.urls);
  return json({ results });
};
