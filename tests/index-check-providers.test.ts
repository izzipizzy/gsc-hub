import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { getConfigValue, setConfigValue } from '../src/lib/server/config';
import { indexCheckSettings, saveIndexCheckSettings, clearIndexCheckSettings, indexCheckCredentials,
  checkIndexUrl, parseXmlRiver, parseDataForSeo } from '../src/lib/server/index-check-providers';
import { INDEX_CHECK_SERVICE_LINKS } from '../src/lib/utils/index-check';
let db: Db;
const target = 'https://example.com/Article?a=1&b=2';
const xml = (inside: string) => `<yandexsearch><response>${inside}</response></yandexsearch>`;
const doc = (url: string) => `<results><grouping><group><doc><url><![CDATA[${url}]]></url></doc></group></grouping></results>`;
const dfs = (items: unknown[], code = 20000) => ({ status_code: 20000, tasks: [{ status_code: code, result: [{ items, items_count: items.length }] }] });
beforeEach(() => {
  db = openDb(':memory:');
  for (const key of ['XMLRIVER_USER', 'XMLRIVER_KEY', 'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD']) vi.stubEnv(key, '');
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('saves providers independently, preserves blank values and exposes only configuration metadata', () => {
  saveIndexCheckSettings(db, 'xmlriver', { XMLRIVER_USER: '123', XMLRIVER_KEY: 'xml-secret' });
  saveIndexCheckSettings(db, 'dataforseo', { DATAFORSEO_LOGIN: 'api@example.com', DATAFORSEO_PASSWORD: 'dfs-secret' });
  saveIndexCheckSettings(db, 'xmlriver', { XMLRIVER_USER: '', XMLRIVER_KEY: 'changed' });
  expect(indexCheckCredentials(db, 'xmlriver')).toEqual({ provider: 'xmlriver', login: '123', secret: 'changed' });
  expect(indexCheckSettings(db).every((p) => p.configured)).toBe(true);
  const publicData = JSON.stringify(indexCheckSettings(db));
  expect(publicData).not.toContain('api@example.com'); expect(publicData).not.toContain('dfs-secret');
  clearIndexCheckSettings(db, 'xmlriver');
  expect(indexCheckSettings(db).find((p) => p.id === 'xmlriver')?.configured).toBe(false);
  expect(indexCheckCredentials(db, 'dataforseo').secret).toBe('dfs-secret');
});
it('honors environment precedence, refuses overwrites and validates a pair before saving anything', () => {
  expect(() => saveIndexCheckSettings(db, 'xmlriver', { XMLRIVER_USER: '123' })).toThrow();
  expect(getConfigValue(db, 'XMLRIVER_USER')).toBeUndefined();
  vi.stubEnv('XMLRIVER_USER', '999');
  saveIndexCheckSettings(db, 'xmlriver', { XMLRIVER_KEY: 'key' });
  expect(indexCheckCredentials(db, 'xmlriver').login).toBe('999');
  expect(() => saveIndexCheckSettings(db, 'xmlriver', { XMLRIVER_USER: '456' })).toThrow('окружении');
  clearIndexCheckSettings(db, 'xmlriver'); expect(getConfigValue(db, 'XMLRIVER_USER')).toBe('999');
  expect(() => saveIndexCheckSettings(db, 'dataforseo', { DATAFORSEO_LOGIN: 'invalid:login', DATAFORSEO_PASSWORD: 'x' })).toThrow();
});
it('uses the exact supplied referral only for the DataForSEO homepage', () => {
  expect(INDEX_CHECK_SERVICE_LINKS.dataforseo.homepage).toBe('https://dataforseo.com/?aff=59fe7533-1014-4ec3-8a94-86f64d49cd8f');
  expect(INDEX_CHECK_SERVICE_LINKS.dataforseo.docs).not.toContain('aff=');
  expect(INDEX_CHECK_SERVICE_LINKS.xmlriver.homepage).toBe('https://xmlriver.com/');
});
it('uses XML River Google indexing mode and preserves URL query/case without exposing credentials', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(xml(doc(target)))); vi.stubGlobal('fetch', fetcher);
  expect(await checkIndexUrl({ provider: 'xmlriver', login: '123', secret: 'secret&key' }, target)).toEqual({ status: 'found', matchedUrl: target });
  const [endpoint, options] = fetcher.mock.calls[0], u = new URL(endpoint);
  expect(u.pathname).toBe('/search/xml');
  expect(u.searchParams.get('query')).toBe(target);
  expect(u.searchParams.get('key')).toBe('secret&key');
  expect(u.searchParams.get('inindex')).toBe('1'); expect(u.searchParams.get('strict')).toBe('1');
  expect(options.redirect).toBe('error');
});
it('compares only exact organic URLs, ignoring XML sitelinks, found estimates, URL case and scheme alternatives', () => {
  expect(parseXmlRiver(xml(doc(target.toLowerCase())), target)).toEqual({ status: 'not_found' });
  expect(parseXmlRiver(xml(doc(target.replace('https:', 'http:'))), target)).toEqual({ status: 'not_found' });
  expect(parseXmlRiver(xml(`<found>100</found><results><grouping><group><doc><url>https://elsewhere.com/</url><sitelinks><sitelink><url><![CDATA[${target}]]></url></sitelink></sitelinks></doc></group></grouping></results>`), target)).toEqual({ status: 'not_found' });
  expect(parseXmlRiver(xml('<error code="15">no results</error>'), target)).toEqual({ status: 'not_found' });
});
it.each([['31', 'auth'], ['42', 'auth'], ['45', 'auth'], ['200', 'quota'], ['110', 'rate_limit'], ['115', 'rate_limit'], ['500', 'provider']])('maps XML River error %s without treating it as absent', (code, kind) => {
  expect(() => parseXmlRiver(xml(`<error code="${code}">secret-key echoed by provider</error>`), target)).toThrow();
  try { parseXmlRiver(xml(`<error code="${code}">secret-key</error>`), target); } catch (e: any) {
    expect(e.code).toBe(kind); expect(e.message).not.toContain('secret-key');
  }
});
it.each(['<html>captcha</html>', '<yandexsearch><response><found>100</found></response></yandexsearch>', '<yandexsearch><response><results>', '<!DOCTYPE x><yandexsearch><response/></yandexsearch>'])('rejects unknown/incomplete XML rather than producing a negative result', (body) => {
  expect(() => parseXmlRiver(body, target)).toThrow();
});
it('sends exactly one DataForSEO Google task with API Basic auth and documented operator encoding', async () => {
  const url = 'https://example.com/a%20b?q=a+b';
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(dfs([{ type: 'organic', url }])))); vi.stubGlobal('fetch', fetcher);
  expect(await checkIndexUrl({ provider: 'dataforseo', login: 'api-user', secret: 'api-secret' }, url)).toMatchObject({ status: 'found' });
  const [endpoint, options] = fetcher.mock.calls[0];
  expect(endpoint).toBe('https://api.dataforseo.com/v3/serp/google/organic/live/advanced');
  expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('api-user:api-secret').toString('base64')}`);
  expect(JSON.parse(options.body)).toEqual([{ keyword: 'site:https://example.com/a%2520b?q=a%2Bb', location_code: 2840, language_code: 'en', device: 'desktop', depth: 10 }]);
});
it('treats partial/malformed DataForSEO results conservatively and ignores paid results', () => {
  expect(parseDataForSeo(dfs([{ type: 'paid', url: target }]), target).status).toBe('not_found');
  expect(() => parseDataForSeo(dfs([], 40106), target)).toThrow('неполная');
  expect(parseDataForSeo(dfs([{ type: 'organic', url: target }], 40106), target).status).toBe('found');
  expect(parseDataForSeo({ status_code: 20000, tasks: [{ status_code: 40102 }] }, target).status).toBe('not_found');
  expect(() => parseDataForSeo({ status_code: 20000, tasks: [{ status_code: 20000, result: null }] }, target)).toThrow();
  const corrected = dfs([]); (corrected.tasks[0].result[0] as any).spell = { type: 'showing_results_for' };
  expect(() => parseDataForSeo(corrected, target)).toThrow();
});
it.each([[40100, 'auth'], [40207, 'auth'], [40200, 'quota'], [40203, 'quota'], [40210, 'quota'], [40202, 'rate_limit'], [40209, 'rate_limit'], [50000, 'provider']])('maps DataForSEO task error %i', (code, kind) => {
  try { parseDataForSeo({ status_code: 20000, tasks: [{ status_code: code, status_message: 'secret' }] }, target); throw new Error('missing error'); }
  catch (e: any) { expect(e.code).toBe(kind); expect(e.message).not.toContain('secret'); }
});
it.each([[401, 'auth'], [402, 'quota'], [429, 'rate_limit'], [503, 'provider']])('classifies HTTP %i without parsing it as a search result', async (status, code) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private response', { status })));
  await expect(checkIndexUrl({ provider: 'xmlriver', login: '123', secret: 'private-key' }, target)).rejects.toMatchObject({ code });
});
it('redacts transport exceptions, distinguishes cancellation and never retries automatically', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('https://xmlriver.com/search/xml?key=private-key')); vi.stubGlobal('fetch', fetcher);
  await expect(checkIndexUrl({ provider: 'xmlriver', login: '123', secret: 'private-key' }, target)).rejects.toMatchObject({ code: 'network' });
  try { await checkIndexUrl({ provider: 'xmlriver', login: '123', secret: 'private-key' }, target); } catch (e: any) { expect(e.message).not.toContain('private-key'); }
  const controller = new AbortController(); controller.abort();
  await expect(checkIndexUrl({ provider: 'xmlriver', login: '123', secret: 'private-key' }, target, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('rejects provider URL limits before spending and bounds response bytes', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(checkIndexUrl({ provider: 'xmlriver', login: '123', secret: 'key' }, 'https://example.com/'+'a'.repeat(1400))).rejects.toMatchObject({ code: 'invalid_url' });
  await expect(checkIndexUrl({ provider: 'dataforseo', login: 'user', secret: 'key' }, 'https://example.com/'+'a'.repeat(700))).rejects.toMatchObject({ code: 'invalid_url' });
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(new Response('a'.repeat(2*1024*1024+1)));
  await expect(checkIndexUrl({ provider: 'xmlriver', login: '123', secret: 'key' }, target)).rejects.toMatchObject({ code: 'provider' });
});
