import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import {
  addQueryFilter,
  filterPatterns,
  queryHidden,
  dropFilteredQueries,
  listQueryFilters
} from '../src/lib/server/filters';

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
});
afterEach(() => {
  db.close();
});

describe('фильтры мусорных запросов', () => {
  it('свежая база уже прячет site:', () => {
    expect(listQueryFilters(db).map((f) => f.pattern)).toContain('site:');
    expect(queryHidden('site:example.com', filterPatterns(db))).toBe(true);
  });

  it('фильтр ищет подстроку без учёта регистра', () => {
    const p = ['site:'];
    expect(queryHidden('SITE:example.com', p)).toBe(true);
    expect(queryHidden('как проверить site:example.com', p)).toBe(true);
    expect(queryHidden('casino online', p)).toBe(false);
  });

  it('не режет живые запросы, похожие на оператор', () => {
    expect(queryHidden('site map generator', ['site:'])).toBe(false);
    expect(queryHidden('website design', ['site:'])).toBe(false);
  });

  it('dropFilteredQueries вырезает строки по запросу', () => {
    addQueryFilter(db, 'inurl:');
    const rows = [
      { query: 'site:a.com', impressions: 52 },
      { query: 'inurl:buy', impressions: 40 },
      { query: 'купить квартиру', impressions: 11 }
    ];
    const out = dropFilteredQueries(rows, filterPatterns(db), (r) => r.query);
    expect(out.map((r) => r.query)).toEqual(['купить квартиру']);
  });

  it('пустой список фильтров ничего не трогает', () => {
    const rows = [{ query: 'site:a.com' }];
    expect(dropFilteredQueries(rows, [], (r) => r.query)).toHaveLength(1);
  });
});
