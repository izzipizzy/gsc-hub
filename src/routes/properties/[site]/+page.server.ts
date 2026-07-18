import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { getAccount } from '$lib/server/accounts';
import { fetchSiteDaily } from '$lib/server/google';
import { getBrandedTerms } from '$lib/server/branded';
import { requireAdmin } from '$lib/server/guard';

export const load: PageServerLoad = async ({ params, url, locals }) => {
  requireAdmin(locals);
  const accId = url.searchParams.get('acc');
  if (!accId) throw error(400, 'acc query param required');
  const acc = getAccount(db(), accId);
  if (!acc) throw error(404, 'account not found');

  const siteUrl = params.site;
  let daily = null;
  let dailyError: string | null = null;
  try {
    daily = await fetchSiteDaily(db(), acc, siteUrl);
  } catch (e) {
    dailyError = (e as Error).message.slice(0, 200);
  }

  return {
    siteUrl,
    accId,
    account: { email: acc.email, label: acc.label },
    daily,
    dailyError,
    brandedTerms: getBrandedTerms(db(), siteUrl)
  };
};

// No cache — always live.
export const prerender = false;
export const ssr = true;
