import { describe, it, expect } from 'vitest';
import {
  cacheKey, countryFilterGroups, excludeHidden, toCountriesPayload, toPropertiesPayload,
  toQueryPagesPayload, toSiteCountriesPayload, toSitesPayload
} from '../src/lib/server/serp-api';

const site = (siteUrl: string) => ({
  siteUrl, permissionLevel: 'siteOwner', accountId: '1',
  accountEmail: 'work@x', accountLabel: null
});

describe('serp-api cache key', () => {
  it('separates country, period and source', () => {
    expect(cacheKey({ country: 'es', days: 28, source: 'gsc' }))
      .not.toBe(cacheKey({ country: 'es', days: 7, source: 'gsc' }));
    expect(cacheKey({ country: 'es', days: 28, source: 'gsc' }))
      .not.toBe(cacheKey({ country: 'ar', days: 28, source: 'gsc' }));
  });
});

describe('country filter', () => {
  it('filters by the alpha-3 code GSC actually stores', () => {
    expect(countryFilterGroups('es')).toEqual([
      { filters: [{ dimension: 'country', operator: 'equals', expression: 'esp' }] }
    ]);
  });

  it('returns no filter for an unknown code rather than a broken one', () => {
    expect(countryFilterGroups('zz')).toBeUndefined();
  });
});

describe('serp-api sites payload', () => {
  const window = {
    start: '2026-07-31', end: '2026-08-27', fetchedAt: 'now', source: 'gsc' as const
  };

  it('carries partial account failures instead of failing the whole call', () => {
    const payload = toSitesPayload(
      [{ site: site('sc-domain:example.com'),
         totals: { clicks: 1, impressions: 2, ctr: 0.5, position: 3 } }],
      [{ accountId: '2', accountEmail: 'personal@x', reason: 'revoked' }],
      window
    );

    expect(payload.sites[0].site).toBe('sc-domain:example.com');
    expect(payload.sites[0].impressions).toBe(2);
    expect(payload.partial).toEqual([{ account: 'personal@x', reason: 'revoked' }]);
    expect(payload.period_start).toBe('2026-07-31');
    expect(payload.country_supported).toBe(true);
  });

  it('drops sites with no impressions in the country', () => {
    const payload = toSitesPayload(
      [{ site: site('sc-domain:quiet.com'), totals: null },
       { site: site('sc-domain:zero.com'),
         totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 } }],
      [], window
    );
    expect(payload.sites).toEqual([]);
  });
});

describe('serp-api countries payload', () => {
  it('aggregates rows by country and converts alpha-3 to alpha-2', () => {
    const payload = toCountriesPayload(
      [
        { site: site('sc-domain:a.es'), rows: [
          { keys: ['esp'], clicks: 3, impressions: 100, ctr: 0.03, position: 20 },
          { keys: ['arg'], clicks: 1, impressions: 40, ctr: 0.025, position: 30 }
        ] },
        { site: site('sc-domain:b.es'), rows: [
          { keys: ['esp'], clicks: 7, impressions: 900, ctr: 0.008, position: 25 }
        ] }
      ] as never,
      { start: '2026-07-31', end: '2026-08-27' }
    );

    expect(payload.countries[0]).toEqual({
      country: 'ES', sites: 2, clicks: 10, impressions: 1000
    });
    expect(payload.countries[1].country).toBe('AR');
  });

  it('drops rows whose country code GSC does not resolve', () => {
    const payload = toCountriesPayload(
      [{ site: site('sc-domain:a.es'), rows: [
        { keys: ['zzz'], clicks: 1, impressions: 5, ctr: 0.2, position: 1 }
      ] }] as never,
      { start: '2026-07-31', end: '2026-08-27' }
    );
    // 'zzz' — служебный код «страна неизвестна»: показать его как гео значит
    // предложить импорт в несуществующий рынок.
    expect(payload.countries).toEqual([]);
  });
});

describe('serp-api site identity', () => {
  it('returns one row per property even when two accounts see it', () => {
    // Один и тот же property, доступный из двух аккаунтов, — это ОДИН сайт с
    // одними и теми же цифрами. Две строки складывались бы в «Итого» и
    // задваивали показы.
    const shared = (accountId: string, accountEmail: string) => ({
      siteUrl: 'sc-domain:shared.es', permissionLevel: 'siteOwner',
      accountId, accountEmail, accountLabel: null
    });
    const totals = { clicks: 5, impressions: 100, ctr: 0.05, position: 10 };
    const payload = toSitesPayload(
      [{ site: shared('1', 'work@x'), totals },
       { site: shared('2', 'personal@x'), totals }],
      [],
      { start: '2026-07-31', end: '2026-08-27', fetchedAt: 'now', source: 'gsc' }
    );
    expect(payload.sites).toHaveLength(1);
    expect(payload.sites[0].impressions).toBe(100);
  });
});

describe('serp-api hidden sites', () => {
  const row = (accountId: string, siteUrl: string) => ({
    siteUrl, permissionLevel: 'siteOwner', accountId,
    accountEmail: `${accountId}@x`, accountLabel: null
  });

  it('drops what the user hid in the hub', () => {
    // Скрытый в хабе сайт не должен приезжать на экран импорта: человек уже
    // сказал, что не хочет его видеть.
    const kept = excludeHidden(
      [row('1', 'sc-domain:wanted.es'), row('1', 'sc-domain:hidden.es')],
      new Set(['1|sc-domain:hidden.es'])
    );
    expect(kept.map((s) => s.siteUrl)).toEqual(['sc-domain:wanted.es']);
  });

  it('hides per account pair, like the hub panel does', () => {
    // Тот же property виден из двух аккаунтов, скрыт в одном: хаб прячет
    // именно пару, и нам врать про вторую нельзя.
    const kept = excludeHidden(
      [row('1', 'sc-domain:shared.es'), row('2', 'sc-domain:shared.es')],
      new Set(['1|sc-domain:shared.es'])
    );
    expect(kept.map((s) => s.accountId)).toEqual(['2']);
  });
});

describe('serp-api properties payload', () => {
  const row = (accountId: string, siteUrl: string) => ({
    siteUrl, permissionLevel: 'siteOwner', accountId,
    accountEmail: `${accountId}@x`, accountLabel: null
  });

  it('lists every property once and marks the hidden ones instead of dropping them', () => {
    // Экран «один сайт → несколько гео» выбирает сайт руками, в том числе
    // скрытый: скрытие в панели — про шум в списке, а не про запрет импорта.
    const payload = toPropertiesPayload(
      [row('1', 'sc-domain:open.es'), row('1', 'sc-domain:quiet.es'), row('2', 'sc-domain:open.es')],
      new Set(['1|sc-domain:quiet.es']),
      [{ accountId: '3', accountEmail: 'gone@x', reason: 'revoked' }]
    );
    expect(payload.sites).toEqual([
      { site: 'sc-domain:open.es', account: '1@x', hidden: false },
      { site: 'sc-domain:quiet.es', account: '1@x', hidden: true }
    ]);
    expect(payload.partial).toEqual([{ account: 'gone@x', reason: 'revoked' }]);
  });

  it('calls a property hidden only when every account pair hides it', () => {
    const payload = toPropertiesPayload(
      [row('1', 'sc-domain:shared.es'), row('2', 'sc-domain:shared.es')],
      new Set(['1|sc-domain:shared.es']), []
    );
    expect(payload.sites[0].hidden).toBe(false);
  });
});

describe('serp-api site countries payload', () => {
  it('lists the geos of one site by volume in alpha-2 and drops the unknown code', () => {
    const payload = toSiteCountriesPayload(
      [
        { keys: ['arg'], clicks: 1, impressions: 40, ctr: 0.025, position: 30 },
        { keys: ['esp'], clicks: 3, impressions: 100, ctr: 0.03, position: 20 },
        { keys: ['zzz'], clicks: 1, impressions: 5, ctr: 0.2, position: 1 }
      ],
      { start: '2026-07-31', end: '2026-08-27', account: 'work@x' }
    );
    expect(payload.countries.map((c) => c.country)).toEqual(['ES', 'AR']);
    expect(payload.countries[0]).toEqual({ country: 'ES', clicks: 3, impressions: 100, position: 20 });
    expect(payload.period_start).toBe('2026-07-31');
    expect(payload.account).toBe('work@x');
  });
});

describe('serp-api query pages payload', () => {
  it('keeps the page with most impressions per query and flags truncation', () => {
    // Серпмонитору нужна посадочная страница запроса, чтобы отсеивать ключи,
    // приземляющиеся на новости и блог: у не найденного в выдаче ключа URL
    // позиции нет, и по нему такой ключ не отличить.
    const payload = toQueryPagesPayload(
      [
        { keys: ['casa', 'https://x.com/n/news-1/'], clicks: 1, impressions: 10, ctr: 0.1, position: 5 },
        { keys: ['casa', 'https://x.com/turkey/'], clicks: 3, impressions: 40, ctr: 0.1, position: 3 },
        { keys: ['villa', 'https://x.com/b/blog-2/'], clicks: 0, impressions: 7, ctr: 0, position: 20 }
      ],
      { start: '2026-06-07', end: '2026-09-04', truncated: true, maxRows: 250000, account: 'work@x' }
    );
    expect(payload.rows).toEqual([
      { query: 'casa', page: 'https://x.com/turkey/', clicks: 3, impressions: 40, pages: 2 },
      { query: 'villa', page: 'https://x.com/b/blog-2/', clicks: 0, impressions: 7, pages: 1 }
    ]);
    expect(payload.truncated).toBe(true);
    expect(payload.period_start).toBe('2026-06-07');
  });
});
