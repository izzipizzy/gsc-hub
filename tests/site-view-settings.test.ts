import { beforeEach, afterEach, it, expect } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { getSiteViewSettings, saveSiteViewSettings, chooseGeo } from '../src/lib/server/site-view-settings';
import { sortStriking, STRIKING_SORT_KEYS } from '../src/lib/utils/striking-sort';
let db: Db;
beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => db.close());

it('restores period, geo, tab and sorting across domain property forms, isolating sites', () => {
  saveSiteViewSettings(db, 'https://www.example.com/', { days: 365, geo: 'es', tab: 'keywords' });
  saveSiteViewSettings(db, 'sc-domain:example.com', { sort: 'bought', dir: 'asc' });
  expect(getSiteViewSettings(db, 'https://example.com/')).toEqual({ days: 365, geo: 'es', tab: 'keywords', sort: 'bought', dir: 'asc' });
  expect(getSiteViewSettings(db, 'sc-domain:other.com')).toMatchObject({ days: 28, geo: '', sort: 'impressions', dir: 'desc' });
  saveSiteViewSettings(db, 'sc-domain:example.com', { days: 90 });
  expect(getSiteViewSettings(db, 'https://example.com/')).toMatchObject({ days: 90, geo: 'es', sort: 'bought' });
});

it('rejects invalid settings atomically', () => {
  for (const patch of [{ days: 481 }, { days: '365' }, { geo: '/bad' }, { sort: 'unknown' }, { dir: 'up' }, { tab: 'other' }, { token: 'value' }, { days: 365, dir: 'up' }]) {
    expect(() => saveSiteViewSettings(db, 'sc-domain:example.com', patch)).toThrow();
  }
  expect(getSiteViewSettings(db, 'sc-domain:example.com').days).toBe(28);
});

it('prefers the requested geo then saved geo, falling back when a binding disappeared', () => {
  const bindings = [{ geo: 'fr' }, { geo: 'es' }];
  expect(chooseGeo('', 'es', bindings)).toBe('es');
  expect(chooseGeo('fr', 'es', bindings)).toBe('fr');
  expect(chooseGeo('', 'deleted', bindings)).toBe('fr');
  expect(chooseGeo('missing', 'es', bindings)).toBe('es');
  expect(chooseGeo('', 'es', [])).toBe('');
});

const rows = [
  { query: 'b', page: '/z', position: 6, impressions: 200, clicks: 10, ctr: .05 },
  { query: 'a', page: '/a', position: 8, impressions: 100, clicks: 30, ctr: .3 }
];
it('sorts every table column in both directions without mutating input', () => {
  const expected: Record<string, string> = { query: 'a', page: 'a', position: 'b', serp: 'a', impressions: 'a', clicks: 'b', ctr: 'b', bought: 'a' };
  const positions = (q: string) => q === 'a' ? 4 : 12;
  const bought = (_: string, q: string) => q === 'a' ? 0 : 15;
  for (const key of STRIKING_SORT_KEYS) {
    expect(sortStriking(rows, key, 'asc', positions, bought)[0].query).toBe(expected[key]);
    expect(sortStriking(rows, key, 'desc', positions, bought)[0].query).not.toBe(expected[key]);
  }
  expect(rows[0].query).toBe('b');
});

it('keeps unmeasured SERP values last and treats zero purchases as zero', () => {
  for (const dir of ['asc', 'desc'] as const) {
    expect(sortStriking(rows, 'serp', dir, (q) => q === 'b' ? null : 0, () => 0)[0].query).toBe('a');
    expect(sortStriking(rows, 'serp', dir, (q) => q === 'b' ? NaN : 5, () => 0)[0].query).toBe('a');
  }
  expect(sortStriking(rows, 'bought', 'asc', () => null, (_, q) => q === 'a' ? 0 : 20)[0].query).toBe('a');
});
