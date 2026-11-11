import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { addGluedDomain, normalizeDomain, listSiteEvents, GluedError, addSiteEvent, donorOf, listSiteEventsForSite, toChartEvents, SITE_EVENT_TYPES } from '../src/lib/server/site-events';

import { recordPurchases } from '../src/lib/server/magiclinks-purchases';

let db: Db;
vi.mock('../src/lib/server/db', async (original) => ({ ...await original<typeof import('../src/lib/server/db')>(), db: () => db }));
const { portfolio } = vi.hoisted(() => ({ portfolio: vi.fn() }));
vi.mock('../src/lib/server/google', () => ({ fetchPortfolioDaily: portfolio }));
vi.mock('../src/lib/server/algo-updates', () => ({ getAlgoUpdates: async () => ({ updates: [] }), updatesForChart: () => [] }));
import { POST, DELETE } from '../src/routes/properties/site-events/+server';
import { GET as pulse } from '../src/routes/properties/pulse/+server';
import { eventPosition } from '../src/lib/chart-theme';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => { db.close(); });

describe('normalizeDomain', () => {
  it('strips scheme, www, path, port and case', () => {
    expect(normalizeDomain('https://WWW.Donor.com/path?x=1')).toBe('donor.com');
    expect(normalizeDomain('donor.com:8080')).toBe('donor.com');
    expect(normalizeDomain('  sc-domain:Donor.com ')).toBe('donor.com');
  });

  it('turns a Cyrillic domain into punycode', () => {
    expect(normalizeDomain('пример.рф')).toBe('xn--e1afmkfd.xn--p1ai');
  });

  it('refuses what is not a domain', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain('not a domain')).toBeNull();
  });
});

describe('addGluedDomain', () => {
  it('writes a merge event labelled the way the UI writes it', () => {
    const res = addGluedDomain(db, { site: 'sc-domain:casino.com', donor: 'https://donor.com/', date: '2026-09-18' });
    expect(res.created).toBe(true);
    expect(res.event).toMatchObject({ siteHost: 'casino.com', date: '2026-09-18', type: 'merge', note: '← donor.com' });
  });

  it('labels a Cyrillic donor readably and still recognises it in punycode', () => {
    const first = addGluedDomain(db, { site: 'casino.com', donor: 'Пример.РФ', date: '2026-09-18' });
    expect(first.event.note).toBe('← пример.рф');
    const again = addGluedDomain(db, { site: 'casino.com', donor: 'xn--e1afmkfd.xn--p1ai', date: '2026-09-18' });
    expect(again.created).toBe(false);
    expect(again.event.id).toBe(first.event.id);
  });

  it('returns the existing event on a repeat instead of failing', () => {
    const first = addGluedDomain(db, { site: 'casino.com', donor: 'donor.com', date: '2026-09-18' });
    const again = addGluedDomain(db, { site: 'www.casino.com', donor: 'DONOR.com', date: '2026-09-18' });
    expect(again.created).toBe(false);
    expect(again.event.id).toBe(first.event.id);
    expect(listSiteEvents(db).filter((e) => e.siteHost === 'casino.com')).toHaveLength(1);
  });

  it('defaults the date to today (UTC)', () => {
    const res = addGluedDomain(db, { site: 'casino.com', donor: 'donor.com' });
    expect(res.event.date).toBe(new Date().toISOString().slice(0, 10));
  });

  it('refuses a donor that is the site itself, a bad domain or a bad date', () => {
    expect(() => addGluedDomain(db, { site: 'casino.com', donor: 'www.casino.com' })).toThrow(GluedError);
    expect(() => addGluedDomain(db, { site: 'casino.com', donor: 'nope' })).toThrow(GluedError);
    expect(() => addGluedDomain(db, { site: '', donor: 'donor.com' })).toThrow(GluedError);
    expect(() => addGluedDomain(db, { site: 'casino.com', donor: 'donor.com', date: '2026-13-40' })).toThrow(GluedError);
  });

  it('keeps when the row was entered', () => {
    const res = addGluedDomain(db, { site: 'casino.com', donor: 'donor.com', date: '2026-09-18' });
    expect(res.event.addedAt).toBeGreaterThan(0);
  });
});


describe('donorOf', () => {
  it('reads the donor with or without the arrow', () => {
    expect(donorOf('← donor.com')).toBe('donor.com');
    expect(donorOf('donor.com')).toBe('donor.com');
    expect(donorOf('<- www.Donor.com')).toBe('donor.com');
  });

  it('leaves free text alone', () => {
    expect(donorOf('миграция на https')).toBeNull();
    expect(donorOf('')).toBeNull();
  });
});

describe('addGluedDomain and events entered by the site form', () => {
  it('recognises a merge the form stored without the arrow', () => {
    // Форма на странице сайта кладёт голый домен — так на проде внесены 8 склеек.
    const fromForm = addSiteEvent(db, { siteHost: 'casino.com', date: '2026-09-18', type: 'merge', note: 'donor.com' });
    const res = addGluedDomain(db, { site: 'casino.com', donor: 'https://donor.com/', date: '2026-09-18' });
    expect(res.created).toBe(false);
    expect(res.event.id).toBe(fromForm!.id);
  });
});


describe('purchase timeline events', () => {
  const purchase = {
    siteHost: 'www.casino.com', targetUrl: 'https://casino.com/a', query: 'casino',
    language: 'en', quantity: 3, taskId: 'task', orderId: 'order/1'
  };
  const at = Date.parse('2026-09-18T23:45:00Z');

  it('aggregates an order per normalized site and keeps orders/providers distinct', () => {
    recordPurchases(db, [purchase, { ...purchase, siteHost: 'casino.com', query: 'bonus', quantity: 2 },
      { ...purchase, siteHost: 'other.com', targetUrl: 'https://other.com/', quantity: 4 }], at);
    recordPurchases(db, [{ ...purchase, orderId: 'order2', provider: 'magic369' }], at);
    const events = listSiteEventsForSite(db, 'sc-domain:casino.com');
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.note.includes('FieldLink'))).toMatchObject({
      siteHost: 'casino.com', type: 'link_purchase', date: '2026-09-18',
      addedAt: at, note: 'Покупка ссылок: 5 · FieldLink', orderHref: '/magiclinks/order%2F1'
    });
    expect(events.some((e) => e.note === 'Покупка ссылок: 3 · 369Team')).toBe(true);
    expect(listSiteEventsForSite(db, 'https://www.other.com/')).toHaveLength(1);
    expect(new Set(listSiteEvents(db).map((e) => e.id)).size).toBe(3);
  });

  it('shows historical purchases without a backfill and does not duplicate on retry/refresh', () => {
    recordPurchases(db, [purchase], at);
    const before = listSiteEvents(db);
    recordPurchases(db, [purchase], at + 86400000);
    expect(listSiteEvents(db)).toEqual(before);
    expect(listSiteEvents(db)).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) n FROM site_events').get()).toEqual({ n: 0 });
  });

  it('keeps merges and purchases on the same day with distinct chart colors', () => {
    recordPurchases(db, [purchase], at);
    addGluedDomain(db, { site: 'casino.com', donor: 'donor.com', date: '2026-09-18' });
    const events = listSiteEventsForSite(db, 'casino.com');
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.type === 'merge')?.id).toBeGreaterThan(0);
    expect(events.find((e) => e.type === 'link_purchase')?.id).toBeLessThan(0);
    const markers = toChartEvents(events);
    expect(new Set(markers.map((e) => e.color)).size).toBe(2);
    expect(markers.find((e) => e.typeLabel === 'Покупка ссылок')?.color)
      .toBe(SITE_EVENT_TYPES.link_purchase.color);
    expect(listSiteEventsForSite(db, 'unrelated.com')).toEqual([]);
  });
});

const eventRequest = (body: unknown, role = 'admin') => ({
  locals: { user: { role } },
  request: new Request('http://localhost/properties/site-events', { method: 'POST', body: JSON.stringify(body) })
}) as any;

describe('custom site events', () => {
  const custom = { site: 'https://www.example.com/folder/', date: '2026-11-09', type: 'custom', note: 'Переезд в подпапку' };

  it('creates, projects, rejects duplicates and deletes through the existing endpoint', async () => {
    const res = await POST(eventRequest(custom));
    const saved = await res.json();
    expect(saved).toMatchObject({ siteHost: 'example.com', date: custom.date, type: 'custom', note: custom.note });
    expect(toChartEvents(listSiteEventsForSite(db, 'sc-domain:example.com')))
      .toEqual([expect.objectContaining({ label: custom.note, date: custom.date, typeLabel: 'Custom event' })]);
    expect(listSiteEventsForSite(db, 'other.com')).toEqual([]);
    await expect(POST(eventRequest(custom))).rejects.toMatchObject({ status: 409 });
    await DELETE(eventRequest({ id: saved.id }));
    expect(listSiteEventsForSite(db, custom.site)).toEqual([]);
  });

  it.each([
    { note: '  ' }, { note: 'a'.repeat(201) }, { date: '2026-02-30' },
    { date: '2026-13-01' }, { date: '' }, { date: 42 }, { note: {} },
    { site: 'not a domain' }, { type: 42 }, { type: 'link_purchase' }, { type: 'unknown' }
  ])('rejects invalid input %j', async (invalid) => {
    await expect(POST(eventRequest({ ...custom, ...invalid }))).rejects.toMatchObject({ status: 400 });
    expect(listSiteEvents(db)).toEqual([]);
  });

  it('protects creation and deletion from non-admin users', async () => {
    await expect(POST(eventRequest(custom, 'manager'))).rejects.toMatchObject({ status: 403 });
    await expect(DELETE(eventRequest({ id: 1 }, 'manager'))).rejects.toMatchObject({ status: 403 });
  });

  it('persists custom annotations and existing merges when the database is reopened', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gsc-events-'));
    try {
      let disk = openDb(join(dir, 'events.db'));
      addSiteEvent(disk, { siteHost: 'example.com', date: custom.date, type: 'custom', note: custom.note });
      addGluedDomain(disk, { site: 'example.com', donor: 'donor.com', date: custom.date });
      disk.close();
      disk = openDb(join(dir, 'events.db'));
      try {
        expect(listSiteEventsForSite(disk, 'https://www.example.com/')).toEqual([
          expect.objectContaining({ type: 'custom', note: custom.note }),
          expect.objectContaining({ type: 'merge', note: '← donor.com' })
        ]);
      } finally { disk.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('restricts portfolio markers to included hosts and dates, keeping legacy types', async () => {
    addSiteEvent(db, { siteHost: 'example.com', date: custom.date, type: 'custom', note: custom.note });
    addSiteEvent(db, { siteHost: 'example.com', date: '2026-11-07', type: 'custom', note: 'Outside' });
    addSiteEvent(db, { siteHost: 'other.com', date: custom.date, type: 'custom', note: 'Other' });
    addGluedDomain(db, { site: 'example.com', donor: 'donor.com', date: custom.date });
    portfolio.mockResolvedValue({ daily: { series: [{ date: '2026-11-08' }, { date: '2026-11-10' }] }, hosts: ['example.com'], errors: [] });
    const res = await pulse({ url: new URL('http://localhost/properties/pulse?days=3'), locals: { user: { role: 'admin' } } } as any);
    const result = await res.json();
    expect(result.events.map((e: any) => e.label)).toEqual([custom.note, '← donor.com']);
  });
});

describe('calendar placement on chart series', () => {
  const dates = ['2026-11-01', '2026-11-03', '2026-11-05'];
  it('interpolates gaps instead of snapping to the next data day', () => {
    expect(eventPosition(dates, '2026-11-02')).toBe(0.25);
    expect(eventPosition(dates, '2026-11-03')).toBe(0.5);
    expect(eventPosition(dates, '2026-11-05')).toBe(1);
  });
  it('omits out-of-window events and handles empty/single-day series', () => {
    expect(eventPosition(dates, '2026-10-31')).toBeNull();
    expect(eventPosition(dates, '2026-11-06')).toBeNull();
    expect(eventPosition([], '2026-11-01')).toBeNull();
    expect(eventPosition(['2026-11-01'], '2026-11-01')).toBe(0.5);
  });
});
