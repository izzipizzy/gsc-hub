import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { addGluedDomain, normalizeDomain, listSiteEvents, GluedError, addSiteEvent, donorOf } from '../src/lib/server/site-events';

let db: Db;
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
