import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getAccount } from '$lib/server/accounts';
import { resubmitSitemapsForSite } from '$lib/server/google';

export const POST: RequestHandler = async ({ request }) => {
  const { account, site } = (await request.json()) as { account?: string; site?: string };
  if (!account || !site) throw error(400, 'account and site required');

  const acc = getAccount(db(), account);
  if (!acc) throw error(404, 'account not found');
  if (acc.status !== 'active') throw error(409, `account is ${acc.status}; reconnect`);

  const result = await resubmitSitemapsForSite(db(), acc, site);
  return json(result);
};
