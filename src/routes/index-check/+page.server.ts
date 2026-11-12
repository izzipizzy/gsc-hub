import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { listSitesForAllAccounts } from '$lib/server/google';
import { indexCheckJobs } from '$lib/server/index-check-jobs';
import { indexCheckSettings } from '$lib/server/index-check-providers';
export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals);
  const database = db();
  const result = await listSitesForAllAccounts(database);
  const sites = result.sites.map((s) => ({ site: s.siteUrl, accountId: s.accountId,
    account: s.accountLabel ?? s.accountEmail, key: JSON.stringify([s.accountId, s.siteUrl]) }));
  const selected = sites.find((s) => s.site === url.searchParams.get('site') && s.accountId === url.searchParams.get('account'));
  return { history: indexCheckJobs.history(database, { site: selected?.site, accountId: selected?.accountId }), sites, errors: result.errors, providers: indexCheckSettings(database), initialSelection: selected?.key ?? '' };
};
