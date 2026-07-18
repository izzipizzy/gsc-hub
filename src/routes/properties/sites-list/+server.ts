import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { listSitesForAllAccounts } from '$lib/server/google';
import { listHiddenSites } from '$lib/server/hidden';
import { requireAdmin } from '$lib/server/guard';

// All GSC sites across active accounts — for the AI-all / submit-all log pages.
// Returns {account, site, domain} (account needed for the per-account Google
// sitemap submit; site is the sc-domain: id; domain is the bare host).
// Excludes sites the user hid in the panel so bulk actions skip them too.
export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  const { sites } = await listSitesForAllAccounts(db());
  const hidden = new Set(listHiddenSites(db()));
  const hiddenUrls = new Set([...hidden].map((k) => k.slice(k.indexOf('|') + 1)));
  const seen = new Set<string>();
  const entries = [];
  for (const s of sites) {
    if (hidden.has(`${s.accountId}|${s.siteUrl}`) || hiddenUrls.has(s.siteUrl)) continue;
    if (seen.has(s.siteUrl)) continue;
    seen.add(s.siteUrl);
    const domain = s.siteUrl.startsWith('sc-domain:')
      ? s.siteUrl.slice('sc-domain:'.length)
      : new URL(s.siteUrl).host;
    entries.push({ account: s.accountId, site: s.siteUrl, domain });
  }
  entries.sort((a, b) => a.domain.localeCompare(b.domain));
  return json({ sites: entries });
};
