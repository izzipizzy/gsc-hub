import { describe, it, expect } from 'vitest';
import { inspectHtml, decodePage, validateSourceUrl, isPublicAddress } from '../src/lib/server/backlink-checker';
import { validateProxy, backlinkSettings, BACKLINK_UA, checkBacklink } from '../src/lib/server/backlink-fetch';
import { openDb } from '../src/lib/server/db';
import { setConfigValue } from '../src/lib/server/config';
const donor = 'https://donor.example/article/';
const target = 'https://mysite.com/page/?a=1&b=2';
it('extracts the purchased page with entities, image anchors and rel', () => {
  const r = inspectHtml(`<a href="${target.replace('&', '&amp;')}#part" rel="NOFOLLOW sponsored"><img alt="My &amp; link"/> <b>anchor</b></a>`, donor, target);
  expect(r.status).toBe('found');
  expect(r.links).toEqual([{ url: target+'#part', anchor: 'My & link anchor', rel: 'nofollow sponsored' }]);
});
it('resolves base and relative hrefs against the final page', () => {
  expect(inspectHtml('<base href="https://mysite.com/"><a href="page/">A</a>', donor, 'https://mysite.com/page/').status).toBe('found');
  expect(inspectHtml('<a href="../page/">A</a>', 'https://mysite.com/redirected/', 'https://mysite.com/page/').status).toBe('found');
});
it('distinguishes other pages and subdomains from the exact purchased URL', () => {
  expect(inspectHtml('<a href="https://mysite.com/other/">A</a>', donor, target).status).toBe('wrong_url');
  expect(inspectHtml('<a href="https://blog.mysite.com/page/">A</a>', donor, target).status).toBe('wrong_url');
  expect(inspectHtml('<a href="https://mysite.com.evil.test/">A</a>', donor, target).status).toBe('missing');
  expect(inspectHtml('<a href="https://www.mysite.com/page/">A</a>', donor, 'https://mysite.com/page/').status).toBe('wrong_url');
});
it('ignores scripts, comments and fragment-only links and closes nested anchors', () => {
  const html = '<script><a href="https://mysite.com/page/">fake</a></script><!-- <a href="https://mysite.com/page/">fake</a> --><a href="https://mysite.com/page/">One<a href="https://mysite.com/other/">Two</a>';
  expect(inspectHtml(html, donor, 'https://mysite.com/page/').links[0].anchor).toBe('One');
  expect(inspectHtml('<a href="#part">A</a>', 'https://mysite.com/page/', 'https://mysite.com/page/').status).toBe('missing');
});
it('marks bot challenges as unverified instead of a missing link', () => {
  expect(inspectHtml('<title>Just a moment...</title><div id="cf-chl-test">', donor, target).status).toBe('error');
});
it('decodes declared encodings and BOM', () => {
  expect(decodePage(Buffer.from([0xff,0xfe,0x10,0x04]), 'text/html; charset=utf-8')).toBe('А');
  expect(decodePage(Buffer.from([0xcf,0xf0,0xe8,0xe2,0xe5,0xf2]), 'text/html; charset=windows-1251')).toBe('Привет');
});
it('rejects non-public literals, credentials and non-web protocols', () => {
  for (const u of ['http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/', 'http://192.168.1.2/', 'http://x.local/', 'file:///tmp/a', 'https://u:p@donor.example/']) expect(() => validateSourceUrl(u)).toThrow();
  for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '224.0.0.1']) expect(isPublicAddress(ip)).toBe(false);
  expect(isPublicAddress('93.184.216.34')).toBe(true);
});
describe('optional SOCKS settings', () => {
  it('accepts SOCKS5 login/password and SOCKS4 User ID only', () => {
    expect(validateProxy('socks5://user:pass@127.0.0.1:1080').protocol).toBe('socks5:');
    expect(validateProxy('socks4://user@proxy.example:1080').username).toBe('user');
    for (const u of ['http://proxy.example:1080', 'socks5://proxy.example', 'socks4://user:pass@proxy.example:1080', 'socks5://proxy.example:1080/path']) expect(() => validateProxy(u)).toThrow();
  });
  it('defaults to weekly automation and Googlebot, never exposes proxy credentials', () => {
    const db = openDb(':memory:');
    expect(backlinkSettings(db)).toMatchObject({ automatic: true, proxyConfigured: false, userAgent: BACKLINK_UA });
    setConfigValue(db, 'BACKLINK_PROXY_URL', 'socks5://secretUser:secretPass@proxy.example:1080');
    expect(JSON.stringify(backlinkSettings(db))).not.toContain('secret');
    setConfigValue(db, 'BACKLINK_AUTO_ENABLED', '0');
    expect(backlinkSettings(db).automatic).toBe(false);
    db.close();
  });
  it('fails an invalid configured proxy without contacting the donor directly', async () => {
    const db = openDb(':memory:');
    setConfigValue(db, 'BACKLINK_PROXY_URL', 'not-a-proxy');
    expect(await checkBacklink(db, donor, target)).toMatchObject({ status: 'error' });
    db.close();
  });
});
