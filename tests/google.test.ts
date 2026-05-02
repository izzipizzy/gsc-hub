import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { upsertAccount, getAccount } from '../src/lib/server/accounts';
import {
  refreshIfNeeded,
  listSitesForAllAccounts,
  searchAnalyticsQuery,
  listSitesWithSummary,
  fetchPerSiteQueries,
  fetchPerSitePages,
  fetchDailyBreakdown,
  fetchQueryHistory,
  bulkInspect
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
    expect(bySite['https://a.com/'].summary).toEqual({ clicks: 10, impressions: 100, ctr: 0.1, position: 5.0 });
    expect(bySite['https://b.com/'].summary).toEqual({ clicks: 3, impressions: 50, ctr: 0.06, position: 8.5 });
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
});
