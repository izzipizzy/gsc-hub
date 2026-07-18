import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getIndexNowKey, submitIndexNow } from '$lib/server/indexnow';
import { siteToHost } from '$lib/server/bing';
import { fetchRobotsSitemaps, fetchSitemapUrls } from '$lib/server/sitemap';
import { requireAdmin } from '$lib/server/guard';

// Push the site's URLs (from its sitemap) to IndexNow using that site's key.
export const POST: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);
  const { site } = (await request.json()) as { site?: string };
  if (!site) throw error(400, 'site required');

  const host = siteToHost(site);
  const key = getIndexNowKey(db(), host);
  if (!key) throw error(404, `no IndexNow key for ${host} — run scripts/import-indexnow-keys.py`);

  let sitemaps: string[] = [];
  try {
    sitemaps = await fetchRobotsSitemaps(site);
  } catch {
    // ignore
  }
  if (sitemaps.length === 0) sitemaps = [`https://${host}/sitemap.xml`];

  const urls: string[] = [];
  for (const sm of sitemaps) {
    try {
      urls.push(...(await fetchSitemapUrls(sm, 10000)));
    } catch {
      // skip unreachable sitemap
    }
    if (urls.length >= 10000) break;
  }
  if (urls.length === 0) urls.push(`https://${host}/`);

  const result = await submitIndexNow(host, key, urls);
  if (!result.ok) throw error(502, `IndexNow returned ${result.status} for ${host}`);
  return json(result);
};
