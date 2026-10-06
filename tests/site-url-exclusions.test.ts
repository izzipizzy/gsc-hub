import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { listUrlExclusions, addUrlExclusion, removeUrlExclusion } from '../src/lib/server/site-url-exclusions';
import { urlMatchesMask, urlExcluded, customPurchaseUrl } from '../src/lib/utils/url-filters';
import { recordPurchases } from '../src/lib/server/magiclinks-purchases';
import { listSiteEventsForSite } from '../src/lib/server/site-events';

let db: Db;
beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => { db.close(); });

it('shares saved exclusions across property formats, but isolates domains and scoped deletion', () => {
  addUrlExclusion(db, 'https://www.hatamatata.com/', '/b/', 'mask');
  addUrlExclusion(db, 'sc-domain:hatamatata.com', '/n/', 'mask');
  addUrlExclusion(db, 'sc-domain:hatamatata.com', '/b/', 'mask');
  const rules = listUrlExclusions(db, 'https://hatamatata.com/');
  expect(rules).toHaveLength(2);
  expect(listUrlExclusions(db, 'https://other.com/')).toEqual([]);
  removeUrlExclusion(db, 'https://other.com/', rules[0].id);
  expect(listUrlExclusions(db, 'https://hatamatata.com/')).toHaveLength(2);
  removeUrlExclusion(db, 'sc-domain:hatamatata.com', rules[0].id);
  expect(listUrlExclusions(db, 'https://www.hatamatata.com/')).toHaveLength(1);
});

it('uses literal substrings and bounded wildcard syntax, including punctuation', () => {
  expect(urlMatchesMask('https://x.com/b/a', '/b/')).toBe(true);
  expect(urlMatchesMask('https://x.com/B/a', '/b/')).toBe(true);
  expect(urlMatchesMask('https://x.com/blog/a', '/b/')).toBe(false);
  expect(urlMatchesMask('https://x.com/n/a', '*/n/*')).toBe(true);
  expect(urlMatchesMask('https://x.com/n/a', '/n/?')).toBe(true);
  expect(urlMatchesMask('https://x.com/a+b[1]/', '/a+b[1]/*')).toBe(true);
  expect(urlMatchesMask('https://x.com/ab1/', '/a+b[1]/*')).toBe(false);
  expect(urlMatchesMask('https://x.com/', '')).toBe(true);
});

it('supports exact exclusions and does not hide descendants of an exact URL', () => {
  const rules = [{ id: 1, kind: 'exact' as const, pattern: 'https://x.com/page' }];
  expect(urlExcluded('https://x.com/page', rules)).toBe(true);
  expect(urlExcluded('https://x.com/page2', rules)).toBe(false);
  const masks = [{ id: 2, kind: 'mask' as const, pattern: '/b/' }, { id: 3, kind: 'mask' as const, pattern: '/n/' }];
  expect(urlExcluded('https://x.com/b/one', masks)).toBe(true);
  expect(urlExcluded('https://x.com/n/two', masks)).toBe(true);
  expect(urlExcluded('https://x.com/sale/two', masks)).toBe(false);
  expect(urlExcluded('https://x.com/sale/two', [{ id: 4, kind: 'not_contains', pattern: '/sale/' }])).toBe(false);
  expect(urlExcluded('https://x.com/n/two', [{ id: 4, kind: 'not_contains', pattern: '/sale/' }])).toBe(true);
});

it('rejects blank and excessively long saved masks', () => {
  expect(() => addUrlExclusion(db, 'https://x.com/', ' ', 'mask')).toThrow();
  expect(() => addUrlExclusion(db, 'https://x.com/', 'a'.repeat(2001), 'mask')).toThrow();
});

describe('custom purchases', () => {
  it('accepts paths on the fixed property origin and drops fragments', () => {
    expect(customPurchaseUrl('/sale/?lang=en#part', 'sc-domain:hatamatata.com')).toBe('https://hatamatata.com/sale/?lang=en');
    expect(customPurchaseUrl('/new/', 'https://www.hatamatata.com/')).toBe('https://www.hatamatata.com/new/');
  });
  it('refuses another domain, lookalikes, credentials and unsupported schemes', () => {
    for (const raw of ['', 'page/', 'https://hatamatata.com/new/', '//hatamatata.com/a', '/\\other.com/a', '/\n/other.com/a', '//other.com/a', 'https://hatamatata.com.other.com/', 'javascript:alert(1)', 'https://u:p@hatamatata.com/', 'https://hatamatata.com:8080/a']) {
      expect(() => customPurchaseUrl(raw, 'https://hatamatata.com/')).toThrow();
    }
  });
  it('records a chart event for a URL and text absent from GSC without requiring striking rows', () => {
    recordPurchases(db, [{ siteHost: 'hatamatata.com', targetUrl: customPurchaseUrl('/new/', 'https://hatamatata.com/'), query: 'Мой анкор', language: 'ru', quantity: 5, orderId: 'custom-order', taskId: 'custom-task' }], Date.parse('2026-10-04T12:00:00Z'));
    expect(listSiteEventsForSite(db, 'sc-domain:hatamatata.com')).toEqual([expect.objectContaining({ type: 'link_purchase', note: 'Покупка ссылок: 5 · FieldLink', orderHref: '/magiclinks/custom-order' })]);
  });
});

it('handles adversarial wildcard masks without regex backtracking', () => {
  const url = 'https://x.com/' + 'a'.repeat(2000);
  expect(urlMatchesMask(url, '*a'.repeat(30) + 'b')).toBe(false);
  expect(urlMatchesMask(url + 'b', '*a'.repeat(30) + 'b')).toBe(true);
  expect(urlMatchesMask('https://x.com/aXYZb/end', 'a?*b')).toBe(true);
  expect(urlMatchesMask('https://x.com/ab', 'a?b')).toBe(false);
  expect(urlMatchesMask('https://x.com/a/end', 'a**?')).toBe(true);
});
