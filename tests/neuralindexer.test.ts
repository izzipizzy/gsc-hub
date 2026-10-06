import pkg from '../package.json';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { setConfigValue } from '../src/lib/server/config';
import { pageUrls, parseIndexSitemap, indexSitemapUrls, createIndexQuote, submitIndexQuote, indexHistory, priceForQueue } from '../src/lib/server/neuralindexer';
let database: Db;
beforeEach(() => { database = openDb(':memory:'); setConfigValue(database, 'NEURALINDEXER_API_TOKEN', 'test-secret'); });
afterEach(() => { database.close(); vi.unstubAllGlobals(); });
const site = 'https://mysite.example/';
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
it('resolves domain paths, deduplicates anchors and rejects foreign or credential URLs', () => {
  expect(pageUrls('/a/\nhttps://mysite.example/a/#x\n/b/', site)).toEqual(['https://mysite.example/a/', 'https://mysite.example/b/']);
  for (const raw of ['https://evil.example/a', '//evil.example/a', 'https://a:b@mysite.example/a', 'file:///x']) expect(() => pageUrls(raw, site)).toThrow();
});
it('reads every nested child, handles XML entities, and does not count sitemap URLs as pages', async () => {
  const docs: Record<string,string> = {
    [site+'sitemap.xml']: '<sitemapindex><sitemap><loc>/one.xml</loc></sitemap><sitemap><loc>/nested.xml</loc></sitemap></sitemapindex>',
    [site+'one.xml']: '<urlset><url><loc>/a/?x=1&amp;y=2</loc></url><url><loc>/b/</loc></url></urlset>',
    [site+'nested.xml']: '<sitemapindex><sitemap><loc>/two.xml</loc></sitemap><sitemap><loc>/sitemap.xml</loc></sitemap></sitemapindex>',
    [site+'two.xml']: '<urlset><url><loc>/b/</loc></url><url><loc>/c/</loc></url></urlset>'
  };
  const read = vi.fn(async (url: string) => docs[url]);
  expect(await indexSitemapUrls('/sitemap.xml',site,read)).toEqual([site+'a/?x=1&y=2',site+'b/',site+'c/']);
  expect(read).toHaveBeenCalledTimes(4);
});
it('fails the entire sitemap estimate on child errors or foreign URLs instead of silently omitting pages', async () => {
  await expect(indexSitemapUrls('/sitemap.xml',site,async () => '<urlset><url><loc>https://elsewhere.example/</loc></url></urlset>')).rejects.toThrow();
  expect(() => parseIndexSitemap('<html>challenge</html>')).toThrow();
  await expect(indexSitemapUrls('/sitemap.xml',site,async url => { if (url.endsWith('child.xml')) throw new Error('HTTP 503'); return '<sitemapindex><sitemap><loc>/child.xml</loc></sitemap></sitemapindex>'; })).rejects.toThrow('HTTP 503');
});
it('uses account price for regular queue and a separate fast price', () => {
  expect(priceForQueue({price_per_link:0.009},'slow')).toBe(0.009);
  expect(priceForQueue({price_per_link:0.009},'fast')).toBe(0.5);
});
it('quotes without spending and submits the stored snapshot once with idempotency', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({status:'success',balance_usd:10,price_per_link:0.0122}))
    .mockResolvedValueOnce(response({status:'ok',submission_id:1,total_links_accepted:2,charged_amount:0.0244,balance_usd:9.9756}));
  vi.stubGlobal('fetch',fetcher);
  const quote = await createIndexQuote(database,site,[site+'a/',site+'b/'],'slow');
  expect(quote).toMatchObject({count:2,total:0.0244});
  expect(fetcher.mock.calls[0][0]).toContain('balance.php');
  expect(fetcher.mock.calls[0][1].headers['User-Agent']).toBe(`Mozilla/5.0 GSC-Hub/${pkg.version}`);
  const result = await submitIndexQuote(database,site,quote.id);
  expect(result.charged).toBe(0.0244);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({links:quote.urls,client_batch_id:quote.id,external_id:quote.id});
  expect(await submitIndexQuote(database,site,quote.id)).toEqual(result);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(indexHistory(database,site)[0].status).toBe('submitted');
});
it('retries an ambiguous send with the same provider key, preserves history and rejects changed credentials', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({status:'success',balance_usd:10,price_per_link:0.01}))
    .mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(response({status:'ok',submission_id:9,total_links_accepted:1,charged_amount:0.01}));
  vi.stubGlobal('fetch',fetcher);
  const q = await createIndexQuote(database,site,[site+'a/'],'slow');
  await expect(submitIndexQuote(database,site,q.id)).rejects.toThrow();
  expect(indexHistory(database,site)[0].status).toBe('uncertain');
  await submitIndexQuote(database,site,q.id);
  expect(JSON.parse(fetcher.mock.calls[1][1].body).client_batch_id).toBe(JSON.parse(fetcher.mock.calls[2][1].body).client_batch_id);
  setConfigValue(database,'NEURALINDEXER_API_TOKEN','changed');
  await expect(submitIndexQuote(database,site,q.id)).rejects.toThrow('Ключ изменился');
});
it('rejects stale calculations and another domain before spending', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({status:'success',balance_usd:10,price_per_link:0.01})));
  const q = await createIndexQuote(database,site,[site+'a/'],'slow');
  await expect(submitIndexQuote(database,'https://other.example/',q.id)).rejects.toThrow('Расчёт не найден');
  database.prepare('UPDATE indexing_requests SET created_at=? WHERE id=?').run(Date.now()-31*60_000,q.id);
  await expect(submitIndexQuote(database,site,q.id)).rejects.toThrow('устарел');
});
