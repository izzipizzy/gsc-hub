import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getAccount } from '$lib/server/accounts';
import { listSitemaps, resyncSitemapsFromRobots } from '$lib/server/google';
import { fetchRobotsSitemaps } from '$lib/server/sitemap';
import { requireAdmin } from '$lib/server/guard';

function resolveAccount(accountId: string | null, site: string | null) {
  if (!accountId || !site) throw error(400, 'account and site required');
  const acc = getAccount(db(), accountId);
  if (!acc) throw error(404, 'account not found');
  if (acc.status !== 'active') throw error(409, `account is ${acc.status}; reconnect`);
  return acc;
}

// Popup data: sitemaps GSC currently knows + what robots.txt declares.
export const GET: RequestHandler = async ({ url, locals }) => {
  requireAdmin(locals);
  const acc = resolveAccount(url.searchParams.get('account'), url.searchParams.get('site'));
  const site = url.searchParams.get('site')!;

  const current = await listSitemaps(db(), acc, site);
  let robots: string[] = [];
  let robotsError: string | null = null;
  try {
    robots = await fetchRobotsSitemaps(site);
  } catch (e) {
    robotsError = (e as Error).message.slice(0, 200);
  }
  return json({ current, robots, robotsError });
};

// Resync: delete all known sitemaps, then submit the ones from robots.txt.
// The client passes the robots list it already loaded (avoids a flaky re-fetch);
// fall back to fetching only if it didn't.
export const POST: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);
  const { account, site, robots } = (await request.json()) as {
    account?: string;
    site?: string;
    robots?: string[];
  };
  const acc = resolveAccount(account ?? null, site ?? null);

  let feeds = Array.isArray(robots) ? robots : null;
  if (!feeds) {
    try {
      feeds = await fetchRobotsSitemaps(site!);
    } catch (e) {
      throw error(502, `robots.txt fetch failed: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  const result = await resyncSitemapsFromRobots(db(), acc, site!, feeds);
  return json(result);
};
