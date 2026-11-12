import { it, expect, vi } from 'vitest';
import { collectCheckSitemap, parseCheckSitemap, readIndexDocument } from '../src/lib/server/index-check-sitemap';
const site = 'https://example.com/';
const map = (locs: string[]) => '<urlset>'+locs.map((loc) => `<url><loc>${loc}</loc></url>`).join('')+'</urlset>';
it('discovers robots declarations, recurses across all maps, skips cycles and deduplicates decoded page URLs', async () => {
  const docs: Record<string,string> = {
    [site+'robots.txt']: 'Sitemap: https://example.com/root.xml\nSitemap: https://example.com/root.xml',
    [site+'root.xml']: '<sitemapindex><sitemap><loc>/a.xml</loc></sitemap><sitemap><loc>/b.xml</loc></sitemap><sitemap><loc>/root.xml</loc></sitemap></sitemapindex>',
    [site+'a.xml']: map(['/a/?x=1&amp;y=2', '/shared/#fragment']),
    [site+'b.xml']: map(['/b/', '/shared/'])
  };
  const read = vi.fn(async (url: string) => docs[url]);
  const result = await collectCheckSitemap(site, '', read);
  expect(result.urls).toEqual([site+'a/?x=1&y=2',site+'shared/',site+'b/']);
  expect(result.sitemaps).toEqual([site+'root.xml']); expect(read).toHaveBeenCalledTimes(4);
});
it('supports XML namespace prefixes and ignores image URLs', async () => {
  const xml = '<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><sm:url><sm:loc>https://example.com/a/</sm:loc><image:image><image:loc>https://images.example/photo.jpg</image:loc></image:image></sm:url></sm:urlset>';
  expect(parseCheckSitemap(xml)).toEqual({ index: false, locs: [site+'a/'] });
  expect((await collectCheckSitemap(site, '/only.xml', async () => xml)).urls).toEqual([site+'a/']);
});
it('accepts self-closing language alternates in declared webparadox maps', async () => {
  const origin = 'https://webparadox.com/';
  const xml = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>https://webparadox.com/about/</loc><xhtml:link rel="alternate" hreflang="en-US" href="https://webparadox.com/about/"/><xhtml:link rel="alternate" hreflang="ru-RU" href="https://webparadox.com/ru/about/" /></url></urlset>';
  const result = await collectCheckSitemap(origin, '', async (url) => {
    if (url.endsWith('robots.txt')) return 'Sitemap: ' + origin + 'sitemap-index.xml';
    if (url.endsWith('sitemap-index.xml')) return '<sitemapindex><sitemap><loc>/sitemap-0.xml</loc></sitemap></sitemapindex>';
    return xml;
  }, async () => [origin + 'sitemap-index.xml']);
  expect(result.urls).toEqual([origin + 'about/']);
  expect(result.sitemaps).toEqual([origin + 'sitemap-index.xml']);
});
it('fails explicitly when robots is unavailable instead of inventing /sitemap.xml', async () => {
  const read = vi.fn(async (_url: string) => { throw new Error('HTTP 404'); });
  await expect(collectCheckSitemap(site,'',read)).rejects.toThrow('Укажи Sitemap URL вручную');
  expect(read).toHaveBeenCalledTimes(1);expect(read.mock.calls[0][0]).toBe(site+'robots.txt');
});
it.each(['<html>captcha</html>', '<urlset><url><loc>/a/</url></urlset>', '<urlset><url><loc>/a/</url/></urlset>', '<urlset><url><loc/></url></urlset>', '<urlset><url><loc>/a/</loc></url>', '<!DOCTYPE a [<!ENTITY e SYSTEM "file:///private">]><urlset></urlset>'])('rejects malformed maps %s', (xml) => {
  expect(() => parseCheckSitemap(xml)).toThrow();
});
it('does not silently accept a partial list when a child map or foreign URL fails', async () => {
  await expect(collectCheckSitemap(site,'/sitemap.xml',async () => map(['https://foreign.example/a/']))).rejects.toThrow();
  await expect(collectCheckSitemap(site,'/sitemap.xml',async (url) => {
    if (url.endsWith('child.xml')) throw new Error('HTTP 503');
    return '<sitemapindex><sitemap><loc>/child.xml</loc></sitemap></sitemapindex>';
  })).rejects.toThrow('HTTP 503');
});
it('refuses an empty map and explicit foreign/credential/port URLs before fetching', async () => {
  const read = vi.fn(async () => '<urlset></urlset>');
  await expect(collectCheckSitemap(site,'/empty.xml',read)).rejects.toThrow('нет URL');
  read.mockClear();
  for (const address of ['https://foreign.example/map.xml','https://u:p@example.com/map.xml','https://example.com:8080/map.xml']) {
    await expect(collectCheckSitemap(site,address,read)).rejects.toThrow();
  }
  expect(read).not.toHaveBeenCalled();
});
it('caps unique pages and pending child maps without truncating the result', async () => {
  await expect(collectCheckSitemap(site,'/sitemap.xml', async () => map(Array.from({length:5001},(_,i)=>'/'+i)))).rejects.toThrow('5000');
  const children='<sitemapindex>'+Array.from({length:201},(_,i)=>`<sitemap><loc>/${i}.xml</loc></sitemap>`).join('')+'</sitemapindex>';
  await expect(collectCheckSitemap(site,'/sitemap.xml',async () => children)).rejects.toThrow('200');
});
it('blocks loopback destinations through the real public-document loader', async () => {
  await expect(readIndexDocument('http://127.0.0.1/sitemap.xml','http://127.0.0.1/')).rejects.toThrow();
  await expect(readIndexDocument('http://[::1]/sitemap.xml','http://[::1]/')).rejects.toThrow();
});

it('does not replace an explicit foreign robots declaration with a misleading root-map fallback', async () => {
  const read = vi.fn(async () => 'Sitemap: https://foreign.example/map.xml');
  await expect(collectCheckSitemap(site,'',read)).rejects.toThrow();
  expect(read).toHaveBeenCalledTimes(1);
});

it('regression webparadox: combines all GSC and robots declarations without fetching guessed /sitemap.xml', async()=>{
 const origin='https://webparadox.com/';
 const read=vi.fn(async(url:string)=> url===origin+'robots.txt' ? 'Sitemap: '+origin+'sitemap-index.xml\nSitemap: '+origin+'extra.xml' : url===origin+'sitemap-index.xml' ? '<sitemapindex><sitemap><loc>/posts.xml</loc></sitemap></sitemapindex>' : map([url===origin+'posts.xml'?'/article/':url===origin+'registered.xml'?'/registered/':'/extra/']));
 const result=await collectCheckSitemap(origin,'',read,async()=>[origin+'registered.xml',origin+'sitemap-index.xml']);
 expect(result.sitemaps).toEqual([origin+'registered.xml',origin+'sitemap-index.xml',origin+'extra.xml']);
 expect(new Set(result.urls)).toEqual(new Set([origin+'registered/',origin+'extra/',origin+'article/']));
 expect(read.mock.calls.map(c=>c[0])).not.toContain(origin+'sitemap.xml');
});
it('uses GSC declarations when robots fails, and robots declarations when GSC fails',async()=>{
 const brokenRobots=vi.fn(async(url:string)=>{if(url.endsWith('robots.txt'))throw new Error('HTTP503');return map(['/gsc/']);});
 const fromGsc=await collectCheckSitemap(site,'',brokenRobots,async()=>[site+'registered.xml']);
 expect(fromGsc.urls).toEqual([site+'gsc/']);expect(fromGsc.warnings).toHaveLength(1);
 const read=vi.fn(async(url:string)=>url.endsWith('robots.txt')?'Sitemap: '+site+'announced.xml':map(['/robots/']));
 const fromRobots=await collectCheckSitemap(site,'',read,async()=>{throw new Error('private GSC error');});
 expect(fromRobots.urls).toEqual([site+'robots/']);expect(fromRobots.warnings.join()).not.toContain('private');
});
it('does not guess when neither source declares a map, and manual input bypasses both sources',async()=>{
 const read=vi.fn(async()=> 'User-agent: *\nAllow: /');
 await expect(collectCheckSitemap(site,'',read,async()=>[])).rejects.toThrow('не найдены адреса');
 expect(read).toHaveBeenCalledTimes(1);
 const gsc=vi.fn(),manual=vi.fn(async()=>map(['/manual/']));
 expect((await collectCheckSitemap(site,'/selected.xml',manual,gsc)).urls).toEqual([site+'manual/']);
 expect(gsc).not.toHaveBeenCalled();expect(manual).toHaveBeenCalledTimes(1);
});
it('bounds a stalled GSC lookup and still uses declared robots maps',async()=>{
 vi.useFakeTimers();
 try {
 const read=vi.fn(async(url:string)=>url.endsWith('robots.txt')?'Sitemap: '+site+'declared.xml':map(['/a/']));
 const result=collectCheckSitemap(site,'',read,()=>new Promise(()=>{}));
 await vi.advanceTimersByTimeAsync(10_000);expect((await result).urls).toEqual([site+'a/']);
 }finally{vi.useRealTimers();}
});
