import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '$lib/server/db';
import { upsertAccount } from '$lib/server/accounts';
import { LOCAL_ADMIN } from '$lib/server/guard';

let database: Db;

vi.mock('$lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/db')>();
  return { ...actual, db: (): Db => database };
});

import { GET } from '../src/routes/properties/export/+server';

let requests = 0;

function stubEndlessPages(): void {
  requests = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    requests += 1;
    // Always a full page, so the walk only ends at the cap — or when the
    // consumer stops asking.
    const rows = Array.from({ length: 2 }, (_, i) => ({
      keys: [`q${requests}-${i}`], clicks: 1, impressions: 1, ctr: 1, position: 1
    }));
    return new Response(JSON.stringify({ rows }));
  }));
}

function callWithDays(days: number) {
  return GET({
    url: new URL(`http://localhost/properties/export?account=a1&site=https://a.com/&dim=query&days=${days}`),
    locals: { user: LOCAL_ADMIN },
    request: new Request('http://localhost/properties/export')
  } as unknown as Parameters<typeof GET>[0]) as Promise<Response>;
}

function call() {
  return GET({
    url: new URL('http://localhost/properties/export?account=a1&site=https://a.com/&dim=query&days=7'),
    locals: { user: LOCAL_ADMIN },
    request: new Request('http://localhost/properties/export')
  } as unknown as Parameters<typeof GET>[0]) as Promise<Response>;
}

describe('export streaming', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-export-'));
    database = openDb(join(dir, 'test.db'));
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'csec');
    vi.stubEnv('GSC_EXPORT_PAGE_SIZE', '2');
    // Small cap so a producer ignoring demand finishes rather than hanging.
    vi.stubEnv('GSC_EXPORT_MAX_ROWS', '100');
    upsertAccount(database, {
      id: 'a1', email: 'a1@x', access_token: 't1', refresh_token: 'r',
      expires_at: Math.floor(Date.now() / 1000) + 3600, scope: 's'
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    database.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('does not fetch ahead of what the consumer has read', async () => {
    stubEndlessPages();
    const res = await call();
    const reader = res.body!.getReader();

    await reader.read(); // header
    await reader.read(); // first page
    // Give a producer that ignores demand time to run to the row cap.
    await new Promise((r) => setTimeout(r, 100));
    expect(requests).toBeLessThanOrEqual(3);

    await reader.cancel();
  });

  it('stops fetching once the consumer cancels', async () => {
    stubEndlessPages();
    const res = await call();
    const reader = res.body!.getReader();
    await reader.read();
    await reader.read();
    const atCancel = requests;

    await reader.cancel();
    await new Promise((r) => setTimeout(r, 50));

    expect(requests).toBe(atCancel);
  });

  it('marks a truncated file with a line no parser will read as data', async () => {
    stubEndlessPages();
    const res = await call();
    const text = await new Response(res.body).text();
    const last = text.trimEnd().split('\n').at(-1)!;
    // A bare "truncated at N rows,,,," is a valid CSV record and lands in the
    // spreadsheet as a row of data.
    expect(last.startsWith('#')).toBe(true);
    expect(last).toContain('truncated');
  });

  it('fails the transfer when a page errors mid-stream', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({
          rows: [{ keys: ['a'], clicks: 1, impressions: 1, ctr: 1, position: 1 },
                 { keys: ['b'], clicks: 1, impressions: 1, ctr: 1, position: 1 }]
        }));
      }
      return new Response('upstream exploded', { status: 500 });
    }));

    const res = await call();
    const reader = res.body!.getReader();
    await reader.read();
    await reader.read();
    // A clean close here would hand over a short file that looks complete.
    await expect(reader.read()).rejects.toThrow();
  });

  it('asks for the same completed-day window the dashboard uses', async () => {
    // A CSV that disagrees with the screen for the same "days" is the bug this
    // whole change set is about, left in the other half of the product.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T06:00:00Z'));
    const windows: { startDate: string; endDate: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body)) as { startDate: string; endDate: string };
      windows.push({ startDate: b.startDate, endDate: b.endDate });
      return new Response(JSON.stringify({ rows: [] }));
    }));

    const res = await callWithDays(7);
    await new Response(res.body).text();

    expect(windows[0]).toEqual({ startDate: '2026-08-15', endDate: '2026-08-21' });
  });
});
