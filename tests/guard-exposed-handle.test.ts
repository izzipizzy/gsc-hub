import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '$lib/server/db';
import { setConfigValues } from '$lib/server/config';

let database: Db;

vi.mock('$lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/db')>();
  return { ...actual, db: (): Db => database };
});

import { authGuard } from '../src/lib/server/guard';

function requestEvent(path: string) {
  return {
    url: new URL(`https://gsc.example.com${path}`),
    cookies: { get: () => undefined },
    locals: {} as App.Locals
  } as unknown as Parameters<typeof authGuard>[0]['event'];
}

async function run(path: string) {
  const resolve = vi.fn(async () => new Response('ok'));
  return authGuard({
    event: requestEvent(path),
    resolve
  } as unknown as Parameters<typeof authGuard>[0]);
}

describe('authGuard on a deployment with a public ORIGIN', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-exposed-'));
    database = openDb(join(dir, 'test.db'));
    vi.stubEnv('ORIGIN', 'https://gsc.example.com');
    vi.stubEnv('ADMIN_EMAIL', '');
    vi.stubEnv('ADMIN_PASSWORD', '');
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    vi.stubEnv('LOGIN_ENABLED', '');
  });

  afterEach(() => {
    database.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('serves 503 rather than the anonymous setup wizard', async () => {
    await expect(run('/setup')).rejects.toMatchObject({ status: 503 });
  });

  it('serves 503 rather than passing a request as local admin', async () => {
    // Setup is complete, but nothing configures a login — the loopback build
    // would hand this request full admin rights.
    setConfigValues(database, { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csec' });
    await expect(run('/properties')).rejects.toMatchObject({ status: 503 });
  });

  it('redirects to /login once an env admin is configured', async () => {
    setConfigValues(database, { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csec' });
    vi.stubEnv('ADMIN_EMAIL', 'admin@example.test');
    vi.stubEnv('ADMIN_PASSWORD', 'correct horse battery');
    await expect(run('/properties')).rejects.toMatchObject({ status: 303, location: '/login' });
  });
});
