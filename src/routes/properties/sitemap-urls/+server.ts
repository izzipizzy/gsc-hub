import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getAccount } from '$lib/server/accounts';
import { listSitemaps } from '$lib/server/google';
import { fetchSitemapUrls } from '$lib/server/sitemap';

function siteHomepage(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) return `https://${siteUrl.slice('sc-domain:'.length)}/`;
  return siteUrl;
}

function defaultSitemapGuess(siteUrl: string): string {
  return new URL('/sitemap.xml', siteHomepage(siteUrl)).toString();
}

export const GET: RequestHandler = async ({ url }) => {
  const accountId = url.searchParams.get('account');
  const siteUrl = url.searchParams.get('site');
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? '50')));
  if (!accountId || !siteUrl) throw error(400, 'account and site required');

  const acc = getAccount(db(), accountId);
  if (!acc) throw error(404, 'account not found');
  if (acc.status !== 'active') throw error(409, `account is ${acc.status}; reconnect`);

  // Try GSC submitted sitemaps first.
  try {
    const sitemaps = await listSitemaps(db(), acc, siteUrl);
    const ok = sitemaps.find((s) => !s.errors || s.errors === '0');
    const target = (ok ?? sitemaps[0])?.path;
    if (target) {
      try {
        const urls = await fetchSitemapUrls(target, limit);
        return json({ urls, source: 'gsc-list' });
      } catch (e) {
        // fall through to guess
      }
    }
  } catch (e) {
    // sitemap.list failed — try the guess.
  }

  // Fallback: guess /sitemap.xml at the site root.
  try {
    const guessUrl = defaultSitemapGuess(siteUrl);
    const urls = await fetchSitemapUrls(guessUrl, limit);
    if (urls.length > 0) {
      return json({ urls, source: 'guess-root' });
    }
    return json({ urls: [], source: 'none', error: 'sitemap.xml at site root returned no <loc> entries' });
  } catch (e) {
    return json({
      urls: [],
      source: 'none',
      error: `Could not fetch sitemap: ${(e as Error).message.slice(0, 200)}`
    });
  }
};
