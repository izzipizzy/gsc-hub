import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { submitSitemapBing, siteToHost } from '$lib/server/bing';
import { fetchRobotsSitemaps } from '$lib/server/sitemap';
import { requireAdmin } from '$lib/server/guard';

// Submit the site's sitemap to Bing Webmaster. Prefers the robots.txt-declared
// sitemap, falling back to /sitemap.xml.
export const POST: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);
  const { site } = (await request.json()) as { site?: string };
  if (!site) throw error(400, 'site required');

  let feeds: string[] = [];
  try {
    feeds = await fetchRobotsSitemaps(site);
  } catch {
    // ignore — fall back to the guess
  }
  const feed = feeds[0] ?? `https://${siteToHost(site)}/sitemap.xml`;

  // Don't 500 on Bing's own errors (e.g. ThrottleUser on a re-submit) — surface
  // the reason so the submit-all log shows it per site.
  try {
    await submitSitemapBing(site, feed);
  } catch (e) {
    const raw = (e as Error).message.replace(/^Bing SubmitFeed \d+:\s*/, '');
    // Bing returns {"ErrorCode":N,"Message":"ERROR!!! Foo"} — surface just the reason.
    let reason = raw;
    try {
      reason = (JSON.parse(raw).Message || raw).replace(/^ERROR!!!\s*/, '');
    } catch {
      // not JSON — keep raw
    }
    return json({ ok: false, feed, error: reason.slice(0, 160) });
  }
  return json({ ok: true, submitted: feed });
};
