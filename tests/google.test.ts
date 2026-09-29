import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { upsertAccount, getAccount } from '../src/lib/server/accounts';
import { setConfigValue } from '../src/lib/server/config';
import { DEFAULT_LIMIT, INSPECT_LIMIT } from '../src/lib/server/concurrency';
import {
  refreshIfNeeded,
  listSitesForAllAccounts,
  searchAnalyticsQuery,
  searchAnalyticsPages,
  listSitesWithSummary,
  fetchPerSiteQueries,
  fetchPerSitePages,
  fetchDailyBreakdown,
  fetchQueryHistory,
  fetchSiteDecayPages,
  fetchTodayTotals,
  bulkInspect,
  type SearchAnalyticsRow
} from '../src/lib/server/google';

const REFRESH_URL = 'https://oauth2.googleapis.com/token';
const SITES_URL = 'https://searchconsole.googleapis.com/webmasters/v3/sites';

describe('google.refreshIfNeeded', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 'test.db'));
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csec');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const baseAcc = {
    id: 'sub-1',
    email: 'a@x',
    access_token: 'old',
    refresh_token: 'r',
    expires_at: 0,
    scope: 's'
  };

  it('returns existing token when not expired', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, { ...baseAcc, expires_at: future });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const acc = getAccount(db, 'sub-1')!;
    const token = await refreshIfNeeded(db, acc);

    expect(token).toBe('old');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes when expired and updates DB', async () => {
    upsertAccount(db, { ...baseAcc, expires_at: 0 });
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(REFRESH_URL);
      return new Response(
        JSON.stringify({ access_token: 'new', expires_in: 3600 }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const acc = getAccount(db, 'sub-1')!;
    const token = await refreshIfNeeded(db, acc);

    expect(token).toBe('new');
    expect(getAccount(db, 'sub-1')!.access_token).toBe('new');
    expect(getAccount(db, 'sub-1')!.expires_at).toBeGreaterThan(
      Math.floor(Date.now() / 1000) + 3500
    );
  });

  it('refreshes once when a fan-out shares one account row concurrently', async () => {
    // A 200-site fan-out passes the same AccountRow to every call. Without in-flight
    // dedup each one POSTs to the token endpoint, and Google answers a refresh storm
    // with 400s that markRevoked would read as a dead account.
    upsertAccount(db, { ...baseAcc, expires_at: 0 });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const acc = getAccount(db, 'sub-1')!;
    const tokens = await Promise.all(
      Array.from({ length: 20 }, () => refreshIfNeeded(db, acc))
    );

    expect(tokens.every((t) => t === 'new')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('updates the shared row in place so later calls skip the refresh', async () => {
    upsertAccount(db, { ...baseAcc, expires_at: 0 });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const acc = getAccount(db, 'sub-1')!;
    await refreshIfNeeded(db, acc);
    const second = await refreshIfNeeded(db, acc);

    expect(second).toBe('new');
    expect(acc.access_token).toBe('new');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lets a later call retry after a failed refresh', async () => {
    upsertAccount(db, { ...baseAcc, expires_at: 0 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream broken', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    const acc = getAccount(db, 'sub-1')!;
    await expect(refreshIfNeeded(db, acc)).rejects.toThrow();
    await expect(refreshIfNeeded(db, acc)).resolves.toBe('new');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('marks revoked when refresh returns 400/401 invalid_grant', async () => {
    upsertAccount(db, { ...baseAcc, expires_at: 0 });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const acc = getAccount(db, 'sub-1')!;
    await expect(refreshIfNeeded(db, acc)).rejects.toThrow(/invalid_grant|revoked/i);
    expect(getAccount(db, 'sub-1')!.status).toBe('revoked');
  });

  it('refreshes when within 60s skew of expiry', async () => {
    const soonExpiry = Math.floor(Date.now() / 1000) + 30; // 30s away — within 60s skew
    upsertAccount(db, { ...baseAcc, expires_at: soonExpiry });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'fresh', expires_in: 3600 }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const acc = getAccount(db, 'sub-1')!;
    const token = await refreshIfNeeded(db, acc);

    expect(token).toBe('fresh');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('marks error (not revoked) on 5xx refresh failure', async () => {
    upsertAccount(db, { ...baseAcc, expires_at: 0 });
    const fetchMock = vi.fn(async () => new Response('upstream broken', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const acc = getAccount(db, 'sub-1')!;
    await expect(refreshIfNeeded(db, acc)).rejects.toThrow();
    const row = getAccount(db, 'sub-1')!;
    expect(row.status).toBe('error');
    expect(row.last_error).toMatch(/refresh 503/);
  });

  it('refreshes using client creds from the config layer when env is unset (wizard mode)', async () => {
    // Setup-wizard path: no env creds; Google keys live in app_config (DB).
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    setConfigValue(db, 'GOOGLE_CLIENT_ID', 'db-cid');
    setConfigValue(db, 'GOOGLE_CLIENT_SECRET', 'db-csec');
    upsertAccount(db, { ...baseAcc, expires_at: 0 });
    let sentBody = '';
    const fetchMock = vi.fn(async (_url: string, opts: { body?: unknown }) => {
      sentBody = String(opts.body);
      return new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const acc = getAccount(db, 'sub-1')!;
    const token = await refreshIfNeeded(db, acc);

    expect(token).toBe('new');
    expect(sentBody).toContain('client_id=db-cid');
    expect(sentBody).toContain('client_secret=db-csec');
  });
});

describe('google.listSitesForAllAccounts', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 'test.db'));
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csec');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('fan-outs across active accounts and aggregates sites', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });
    upsertAccount(db, {
      id: 'a2', email: 'a2@x', access_token: 't2', refresh_token: 'r', expires_at: future, scope: 's'
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(SITES_URL);
      const auth = (init?.headers as Record<string, string>).Authorization;
      const sites =
        auth === 'Bearer t1'
          ? [{ siteUrl: 'https://a.com/', permissionLevel: 'siteOwner' }]
          : [{ siteUrl: 'https://b.com/', permissionLevel: 'siteFullUser' }];
      return new Response(JSON.stringify({ siteEntry: sites }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listSitesForAllAccounts(db);
    expect(result.errors).toEqual([]);
    expect(result.sites).toHaveLength(2);
    const urls = result.sites.map((s) => s.siteUrl).sort();
    expect(urls).toEqual(['https://a.com/', 'https://b.com/']);
  });

  it('does not fail the whole call when one account 401s; marks it revoked', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });
    upsertAccount(db, {
      id: 'a2', email: 'a2@x', access_token: 't2', refresh_token: 'r', expires_at: future, scope: 's'
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).Authorization;
      if (auth === 'Bearer t1') {
        return new Response(JSON.stringify({ siteEntry: [] }), { status: 200 });
      }
      return new Response('unauthorized', { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listSitesForAllAccounts(db);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].accountId).toBe('a2');
    expect(getAccount(db, 'a2')!.status).toBe('revoked');
  });

  it('skips non-active accounts', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });
    upsertAccount(db, {
      id: 'a2', email: 'a2@x', access_token: 't2', refresh_token: 'r', expires_at: future, scope: 's'
    });
    db.prepare("UPDATE google_accounts SET status='revoked' WHERE id='a2'").run();

    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ siteEntry: [] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await listSitesForAllAccounts(db);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('google.searchAnalyticsQuery', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 'test.db'));
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csec');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns rows on success', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ rows: [{ keys: ['hello'], clicks: 5, impressions: 50, ctr: 0.1, position: 3 }] }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const acc = getAccount(db, 'a1')!;
    const rows = await searchAnalyticsQuery(db, acc, 'https://a.com/', {
      startDate: '2026-04-01', endDate: '2026-04-28', dimensions: ['query']
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].keys[0]).toBe('hello');
  });

  it('marks account revoked on 401', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));

    const acc = getAccount(db, 'a1')!;
    await expect(
      searchAnalyticsQuery(db, acc, 'https://a.com/', {
        startDate: '2026-04-01', endDate: '2026-04-28', dimensions: ['query']
      })
    ).rejects.toThrow(/401/);
    expect(getAccount(db, 'a1')!.status).toBe('revoked');
  });

  it('caches by the whole body: different filters are different entries', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });
    // Answers with the filter expression it was asked about, so a cache hit
    // on the wrong entry shows up as the wrong key.
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const expr = body.dimensionFilterGroups?.[0]?.filters?.[0]?.expression ?? '';
      return new Response(
        JSON.stringify({ rows: [{ keys: [expr], clicks: 1, impressions: 1, ctr: 1, position: 1 }] }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const acc = getAccount(db, 'a1')!;
    const ask = (expression: string) =>
      searchAnalyticsQuery(db, acc, 'https://a.com/', {
        startDate: '2026-04-01', endDate: '2026-04-28', dimensions: ['date'],
        dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'equals', expression }] }]
      });

    expect((await ask('alpha'))[0].keys[0]).toBe('alpha');
    expect((await ask('beta'))[0].keys[0]).toBe('beta');
    // The same filter again is a genuine hit.
    expect((await ask('alpha'))[0].keys[0]).toBe('alpha');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('google.listSitesWithSummary', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 'test.db'));
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csec');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('aggregates summary per site across all active accounts', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/sites')) {
        return new Response(
          JSON.stringify({
            siteEntry: [
              { siteUrl: 'https://a.com/', permissionLevel: 'siteOwner' },
              { siteUrl: 'https://b.com/', permissionLevel: 'siteOwner' }
            ]
          }),
          { status: 200 }
        );
      }
      // searchAnalytics endpoint includes site URL in path
      const fake = url.includes('a.com')
        ? { rows: [{ keys: [], clicks: 10, impressions: 100, ctr: 0.1, position: 5.0 }] }
        : { rows: [{ keys: [], clicks: 3, impressions: 50, ctr: 0.06, position: 8.5 }] };
      return new Response(JSON.stringify(fake), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listSitesWithSummary(db);
    expect(result.errors).toEqual([]);
    expect(result.sites).toHaveLength(2);

    const bySite = Object.fromEntries(result.sites.map((s) => [s.siteUrl, s]));
    expect(bySite['https://a.com/'].summary).toEqual({ clicks: 10, impressions: 100, ctr: 0.1, position: 5.0, series: [10] });
    expect(bySite['https://b.com/'].summary).toEqual({ clicks: 3, impressions: 50, ctr: 0.06, position: 8.5, series: [3] });
    expect(bySite['https://a.com/'].summaryError).toBeNull();
  });

  it('returns null summary + error string when one summary call fails, keeps the row', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/sites')) {
        return new Response(
          JSON.stringify({
            siteEntry: [
              { siteUrl: 'https://a.com/', permissionLevel: 'siteOwner' },
              { siteUrl: 'https://b.com/', permissionLevel: 'siteOwner' }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes('a.com')) {
        return new Response(JSON.stringify({ rows: [{ keys: [], clicks: 1, impressions: 10, ctr: 0.1, position: 3 }] }), { status: 200 });
      }
      return new Response('rate limited', { status: 429 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listSitesWithSummary(db);
    expect(result.sites).toHaveLength(2);
    const bySite = Object.fromEntries(result.sites.map((s) => [s.siteUrl, s]));
    expect(bySite['https://a.com/'].summary?.clicks).toBe(1);
    expect(bySite['https://a.com/'].summaryError).toBeNull();
    expect(bySite['https://b.com/'].summary).toBeNull();
    expect(bySite['https://b.com/'].summaryError).toMatch(/429|rate/i);
  });

  it('still surfaces per-account errors via top-level errors[]', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });
    upsertAccount(db, {
      id: 'a2', email: 'a2@x', access_token: 't2', refresh_token: 'r', expires_at: future, scope: 's'
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/sites')) {
        const auth = (init?.headers as Record<string, string>).Authorization;
        if (auth === 'Bearer t1') {
          return new Response(JSON.stringify({ siteEntry: [] }), { status: 200 });
        }
        return new Response('unauthorized', { status: 401 });
      }
      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listSitesWithSummary(db);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].accountId).toBe('a2');
  });
});

describe('google.fetchPerSiteQueries', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 'test.db'));
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csec');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns per-site rows tagged with accountId and siteUrl', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/sites')) {
        return new Response(
          JSON.stringify({
            siteEntry: [
              { siteUrl: 'https://a.com/', permissionLevel: 'siteOwner' },
              { siteUrl: 'https://b.com/', permissionLevel: 'siteOwner' }
            ]
          }),
          { status: 200 }
        );
      }
      const fake = url.includes('a.com')
        ? { rows: [{ keys: ['shared'], clicks: 4, impressions: 100, ctr: 0.04, position: 5.0 }] }
        : { rows: [{ keys: ['shared'], clicks: 6, impressions: 300, ctr: 0.02, position: 9.0 }] };
      return new Response(JSON.stringify(fake), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPerSiteQueries(db, 28);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(2);

    const a = result.entries.find((e) => e.siteUrl === 'https://a.com/')!;
    expect(a.accountId).toBe('a1');
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].query).toBe('shared');
    expect(a.rows[0].impressions).toBe(100);

    const b = result.entries.find((e) => e.siteUrl === 'https://b.com/')!;
    expect(b.rows[0].impressions).toBe(300);
  });

  it('surfaces per-account errors and returns entries only for healthy accounts (queries)', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });
    upsertAccount(db, {
      id: 'a2', email: 'a2@x', access_token: 't2', refresh_token: 'r', expires_at: future, scope: 's'
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/sites')) {
        const auth = (init?.headers as Record<string, string>).Authorization;
        if (auth === 'Bearer t1') {
          return new Response(
            JSON.stringify({ siteEntry: [{ siteUrl: 'https://a.com/', permissionLevel: 'siteOwner' }] }),
            { status: 200 }
          );
        }
        return new Response('unauthorized', { status: 401 });
      }
      return new Response(
        JSON.stringify({ rows: [{ keys: ['only-a-com'], clicks: 1, impressions: 5, ctr: 0.2, position: 3 }] }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPerSiteQueries(db, 7);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].accountId).toBe('a2');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].siteUrl).toBe('https://a.com/');
  });
});

describe('google.fetchPerSitePages', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 'test.db'));
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csec');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns per-site page rows tagged with accountId and siteUrl', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/sites')) {
        return new Response(
          JSON.stringify({
            siteEntry: [{ siteUrl: 'https://a.com/', permissionLevel: 'siteOwner' }]
          }),
          { status: 200 }
        );
      }
      // verify the request body asked for 'page' dimension
      const body = init?.body ? JSON.parse(init.body as string) : {};
      expect(body.dimensions).toEqual(['page']);
      return new Response(
        JSON.stringify({
          rows: [
            { keys: ['https://a.com/post-1'], clicks: 10, impressions: 200, ctr: 0.05, position: 4.2 },
            { keys: ['https://a.com/post-2'], clicks: 5, impressions: 50, ctr: 0.1, position: 8.5 }
          ]
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPerSitePages(db, 28);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].accountId).toBe('a1');
    expect(result.entries[0].siteUrl).toBe('https://a.com/');
    expect(result.entries[0].rows).toHaveLength(2);
    expect(result.entries[0].rows[0].page).toBe('https://a.com/post-1');
    expect(result.entries[0].rows[0].impressions).toBe(200);
  });
});

describe('google.fetchDailyBreakdown', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 'test.db'));
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csec');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns daily rows + period totals for current and previous windows', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });

    let saCallCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/sites')) {
        return new Response(
          JSON.stringify({ siteEntry: [{ siteUrl: 'https://a.com/', permissionLevel: 'siteOwner' }] }),
          { status: 200 }
        );
      }
      // searchAnalytics — first call is current, second is previous
      saCallCount++;
      const body = init?.body ? JSON.parse(init.body as string) : {};
      expect(body.dimensions).toEqual(['date']);
      const isCurrent = saCallCount === 1;
      return new Response(
        JSON.stringify({
          rows: isCurrent
            ? [
                { keys: ['2026-04-29'], clicks: 5, impressions: 50, ctr: 0.1, position: 4 },
                { keys: ['2026-04-30'], clicks: 7, impressions: 70, ctr: 0.1, position: 5 }
              ]
            : [
                { keys: ['2026-04-25'], clicks: 2, impressions: 20, ctr: 0.1, position: 6 },
                { keys: ['2026-04-26'], clicks: 3, impressions: 30, ctr: 0.1, position: 7 }
              ]
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchDailyBreakdown(db, 3);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(1);

    const e = result.entries[0];
    expect(e.siteUrl).toBe('https://a.com/');
    expect(e.current).toHaveLength(2);
    expect(e.previous).toHaveLength(2);
    expect(e.currentTotals.clicks).toBe(12);
    expect(e.currentTotals.impressions).toBe(120);
    expect(e.previousTotals.clicks).toBe(5);
    expect(e.error).toBeNull();
  });
});

describe('google.fetchQueryHistory', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 'test.db'));
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csec');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('forwards query as dimensionFilterGroups and returns daily rows per site', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/sites')) {
        return new Response(
          JSON.stringify({ siteEntry: [{ siteUrl: 'https://a.com/', permissionLevel: 'siteOwner' }] }),
          { status: 200 }
        );
      }
      const body = init?.body ? JSON.parse(init.body as string) : {};
      expect(body.dimensions).toEqual(['date']);
      expect(body.dimensionFilterGroups).toEqual([
        { filters: [{ dimension: 'query', operator: 'equals', expression: 'shoes' }] }
      ]);
      return new Response(
        JSON.stringify({
          rows: [
            { keys: ['2026-04-01'], clicks: 5, impressions: 50, ctr: 0.1, position: 5.0 },
            { keys: ['2026-04-02'], clicks: 7, impressions: 70, ctr: 0.1, position: 4.5 }
          ]
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQueryHistory(db, 'shoes', 30);
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].rows).toHaveLength(2);
    expect(result.entries[0].rows[0].date).toBe('2026-04-01');
    expect(result.entries[0].rows[1].position).toBe(4.5);
  });
});

describe('google.bulkInspect', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 'test.db'));
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csec');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('inspects multiple URLs in parallel and tags each ok/error', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (body.inspectionUrl === 'https://a.com/ok') {
        return new Response(JSON.stringify({
          inspectionResult: {
            indexStatusResult: {
              verdict: 'PASS',
              coverageState: 'Submitted and indexed',
              robotsTxtState: 'ALLOWED',
              indexingState: 'INDEXING_ALLOWED',
              lastCrawlTime: '2026-04-20T08:00:00Z'
            }
          }
        }), { status: 200 });
      }
      return new Response('boom', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const acc = getAccount(db, 'a1')!;
    const result = await bulkInspect(db, acc, 'https://a.com/', [
      'https://a.com/ok',
      'https://a.com/fail'
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('ok');
    expect(result[0].index?.verdict).toBe('PASS');
    expect(result[1].status).toBe('error');
    expect(result[1].error).toMatch(/500/);
  });

  it('keeps inspections narrower than the search-analytics fan-out', async () => {
    // URL Inspection is capped at 600/min per property, so it runs below DEFAULT_LIMIT.
    const future = Math.floor(Date.now() / 1000) + 3600;
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r', expires_at: future, scope: 's'
    });

    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return new Response(
        JSON.stringify({ inspectionResult: { indexStatusResult: { verdict: 'PASS' } } }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const urls = Array.from({ length: 40 }, (_, i) => `https://a.com/p${i}`);
    const result = await bulkInspect(db, getAccount(db, 'a1')!, 'https://a.com/', urls);

    expect(result).toHaveLength(40);
    expect(peak).toBeLessThanOrEqual(INSPECT_LIMIT);
    expect(INSPECT_LIMIT).toBeLessThan(DEFAULT_LIMIT);
  });
});

describe('google.searchAnalyticsPages', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 'test.db'));
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csec');
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r',
      expires_at: Math.floor(Date.now() / 1000) + 3600, scope: 's'
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // pageSize is injectable so these run at 2 rows instead of allocating 25,000.
  function stubPages(pages: SearchAnalyticsRow[][]) {
    const seen: { startRow: number; rowLimit: number }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { startRow: number; rowLimit: number };
      seen.push({ startRow: body.startRow, rowLimit: body.rowLimit });
      // Indexed by the walk's page size, not by rowLimit: the truncation probe
      // deliberately asks for a single row.
      const index = body.startRow / 2;
      return new Response(JSON.stringify({ rows: pages[index] ?? [] }));
    }));
    return seen;
  }
  const row = (k: string): SearchAnalyticsRow =>
    ({ keys: [k], clicks: 1, impressions: 1, ctr: 1, position: 1 });

  async function collect(gen: AsyncIterable<SearchAnalyticsRow[]>) {
    const out: SearchAnalyticsRow[] = [];
    for await (const page of gen) out.push(...page);
    return out;
  }

  const opts = (extra = {}) => ({ pageSize: 2, ...extra });
  type PagesArgs = [
    Parameters<typeof searchAnalyticsPages>[0],
    Parameters<typeof searchAnalyticsPages>[1],
    string,
    Parameters<typeof searchAnalyticsPages>[3]
  ];
  const args = (): PagesArgs => [db, getAccount(db, 'a1')!, 'https://a.com/', {
    startDate: '2026-04-01', endDate: '2026-04-28', dimensions: ['query']
  }];

  // Reported by @klimenkoalex in izzipizzy/gsc-hub#4: a single request stops at
  // the API's per-response maximum and the CSV looks complete.
  it('pages until a short page comes back', async () => {
    const seen = stubPages([[row('a'), row('b')], [row('c')]]);
    const rows = await collect(searchAnalyticsPages(...args(), opts()));
    expect(rows.map((r) => r.keys[0])).toEqual(['a', 'b', 'c']);
    expect(seen).toEqual([{ startRow: 0, rowLimit: 2 }, { startRow: 2, rowLimit: 2 }]);
  });

  it('costs one request when everything fits on a page', async () => {
    const seen = stubPages([[row('a')]]);
    await collect(searchAnalyticsPages(...args(), opts()));
    expect(seen).toHaveLength(1);
  });

  it('makes one extra request when the total is an exact multiple', async () => {
    const seen = stubPages([[row('a'), row('b')], []]);
    const rows = await collect(searchAnalyticsPages(...args(), opts()));
    expect(rows).toHaveLength(2);
    expect(seen).toHaveLength(2);
  });

  it('stops at maxRows instead of paging forever', async () => {
    const seen = stubPages([[row('a'), row('b')], [row('c'), row('d')], [row('e'), row('f')]]);
    const rows = await collect(searchAnalyticsPages(...args(), opts({ maxRows: 3 })));
    expect(rows).toHaveLength(3);
    expect(seen).toHaveLength(2);
  });

  it('reports whether the cap truncated the result', async () => {
    const capped = searchAnalyticsPages(...args(), opts({ maxRows: 3 }));
    stubPages([[row('a'), row('b')], [row('c'), row('d')]]);
    await collect(capped);
    expect(capped.truncated).toBe(true);
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    const seen = stubPages([[row('a'), row('b')], [row('c'), row('d')]]);
    const gen = searchAnalyticsPages(...args(), opts({ signal: controller.signal }));
    const out: SearchAnalyticsRow[] = [];
    for await (const page of gen) {
      out.push(...page);
      controller.abort();
    }
    expect(out).toHaveLength(2);
    expect(seen).toHaveLength(1);
  });

  it('does not claim truncation when the data ends exactly at the cap', async () => {
    // Two full pages fill maxRows exactly. Whether anything was lost is only
    // knowable by asking for the next page.
    const seen = stubPages([[row('a'), row('b')], [row('c'), row('d')], []]);
    const capped = searchAnalyticsPages(...args(), opts({ maxRows: 4 }));
    const rows = await collect(capped);
    expect(rows).toHaveLength(4);
    expect(capped.truncated).toBe(false);
    expect(seen).toHaveLength(3);
  });

  it('claims truncation when more rows follow the cap', async () => {
    stubPages([[row('a'), row('b')], [row('c'), row('d')], [row('e'), row('f')]]);
    const capped = searchAnalyticsPages(...args(), opts({ maxRows: 4 }));
    await collect(capped);
    expect(capped.truncated).toBe(true);
  });

  it('never asks for more rows than one response can carry', async () => {
    // Search Console caps a response at 25,000. Asking for 50,000 gets 25,000
    // back, which reads as "short page, we are done" while startRow would have
    // jumped past the rows never delivered.
    vi.stubEnv('GSC_EXPORT_PAGE_SIZE', '50000');
    const seen = stubPages([[row('a')]]);
    await collect(searchAnalyticsPages(...args(), {}));
    expect(seen[0].rowLimit).toBeLessThanOrEqual(25_000);
  });

  it('asks for a single row when probing past the cap', async () => {
    const seen = stubPages([[row('a'), row('b')], [row('c'), row('d')], []]);
    const capped = searchAnalyticsPages(...args(), opts({ maxRows: 4 }));
    await collect(capped);
    // The probe only needs to know whether anything follows.
    expect(seen.at(-1)!.rowLimit).toBe(1);
  });

  it('still yields the cap-filling page when the probe fails', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls <= 2) {
        return new Response(JSON.stringify({
          rows: [row(`p${calls}a`), row(`p${calls}b`)]
        }));
      }
      return new Response('probe exploded', { status: 500 });
    }));
    const capped = searchAnalyticsPages(...args(), opts({ maxRows: 4 }));
    const rows = await collect(capped);
    // Losing four rows we already hold, to find out whether a fifth exists,
    // is a bad trade.
    expect(rows).toHaveLength(4);
  });
});

// Inclusive number of calendar dates between two YYYY-MM-DD strings.
function dateCount(startDate: string, endDate: string): number {
  return (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400_000 + 1;
}

describe('google date windows', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 'test.db'));
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csec');
    vi.useFakeTimers();
    // 06:00 UTC is still the previous day in Los Angeles, which is where the
    // old UTC-derived dates went wrong.
    vi.setSystemTime(new Date('2026-08-23T06:00:00Z'));
    upsertAccount(db, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r',
      expires_at: Math.floor(Date.now() / 1000) + 3600, scope: 's'
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function captureWindows() {
    const windows: { startDate: string; endDate: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/sites')) {
        return new Response(JSON.stringify({
          siteEntry: [{ siteUrl: 'https://a.com/', permissionLevel: 'siteOwner' }]
        }));
      }
      const body = JSON.parse(String(init?.body)) as { startDate: string; endDate: string };
      windows.push({ startDate: body.startDate, endDate: body.endDate });
      return new Response(JSON.stringify({ rows: [] }));
    }));
    return windows;
  }

  it('asks for completed Pacific days, not a UTC window ending today', async () => {
    const windows = captureWindows();
    await listSitesWithSummary(db, 7);
    // Pacific is still 2026-08-22, so the last finished day is the 21st.
    expect(windows[0]).toEqual({ startDate: '2026-08-15', endDate: '2026-08-21' });
    expect(dateCount(windows[0].startDate, windows[0].endDate)).toBe(7);
  });

  it('compares two equal, adjacent windows that share no date', async () => {
    const windows = captureWindows();
    await fetchDailyBreakdown(db, 7);
    const [current, previous] = windows;
    expect(current).toEqual({ startDate: '2026-08-15', endDate: '2026-08-21' });
    expect(previous).toEqual({ startDate: '2026-08-08', endDate: '2026-08-14' });
    expect(dateCount(current.startDate, current.endDate)).toBe(7);
    expect(dateCount(previous.startDate, previous.endDate)).toBe(7);
    expect(previous.endDate < current.startDate).toBe(true);
  });

  it('gives the decay comparison equal windows with no shared date', async () => {
    const windows = captureWindows();
    await fetchSiteDecayPages(db, getAccount(db, 'a1')!, 'https://a.com/', 28);
    const [recent, prior] = windows;
    expect(dateCount(recent.startDate, recent.endDate)).toBe(28);
    expect(dateCount(prior.startDate, prior.endDate)).toBe(28);
    expect(prior.endDate < recent.startDate).toBe(true);
  });

  it('skips the previous period when history cannot reach it', async () => {
    const windows = captureWindows();
    // Search Console keeps about 16 months. At 300 days the previous period
    // would start ~600 days back, where there is nothing to compare against.
    const result = await fetchDailyBreakdown(db, 300);
    expect(result.comparable).toBe(false);
    // One window per site instead of two: comparing against an empty period
    // produces a confident -100%, and costs a second fan-out to do it.
    expect(windows).toHaveLength(1);
  });

  it('still compares when the history covers both periods', async () => {
    const windows = captureWindows();
    const result = await fetchDailyBreakdown(db, 28);
    expect(result.comparable).toBe(true);
    expect(windows).toHaveLength(2);
  });

  it('reports todays partial totals separately from any comparison', async () => {
    const windows = captureWindows();
    const today = await fetchTodayTotals(db);
    // Today only, and today is still filling — so there is nothing to compare
    // it against and the window is a single date.
    expect(windows[0]).toEqual({ startDate: '2026-08-22', endDate: '2026-08-22' });
    expect(today.date).toBe('2026-08-22');
    expect(today.totals.clicks).toBe(0);
  });

  it('reports the sites it could not read instead of quietly under-counting', async () => {
    upsertAccount(db, {
      id: 'a2', email: 'a2@x', access_token: 't2', refresh_token: 'r',
      expires_at: Math.floor(Date.now() / 1000) + 3600, scope: 's'
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/sites')) {
        return new Response(JSON.stringify({
          siteEntry: [{ siteUrl: 'https://a.com/', permissionLevel: 'siteOwner' }]
        }));
      }
      return new Response('nope', { status: 500 });
    }));

    const today = await fetchTodayTotals(db);

    // A total assembled from nothing is not a total.
    expect(today.errors.length).toBeGreaterThan(0);
    expect(today.partial).toBe(true);
  });

  it('is partial when a whole account\'s site list cannot be read', async () => {
    // The per-site fetches all succeed — there just are not any, because
    // discovery failed. Counting only site-level failures called that complete.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/sites')) return new Response('nope', { status: 500 });
      return new Response(JSON.stringify({ rows: [] }));
    }));

    const today = await fetchTodayTotals(db);

    expect(today.errors.length).toBeGreaterThan(0);
    expect(today.partial).toBe(true);
  });
});
