import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '$lib/server/db';
import { setConfigValues } from '$lib/server/config';
import { createUser } from '$lib/server/auth-session';

let database: Db;

vi.mock('$lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/db')>();
  return { ...actual, db: (): Db => database };
});

import { authGuard } from '../src/lib/server/guard';

function requestEvent(path: string, host = 'gsc.example.com') {
  return {
    url: new URL(`https://${host}${path}`),
    cookies: { get: () => undefined },
    locals: {} as App.Locals
  } as unknown as Parameters<typeof authGuard>[0]['event'];
}

async function run(path: string, host?: string) {
  const resolve = vi.fn(async () => new Response('ok'));
  return authGuard({
    event: requestEvent(path, host),
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

  it('redirects to /login once an admin exists', async () => {
    setConfigValues(database, { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csec' });
    // What initAuth seeds from ADMIN_EMAIL/ADMIN_PASSWORD at startup. Created
    // directly here because ensureInit() memoises its promise for the process,
    // so a later env change cannot re-trigger the seed.
    await createUser(database, {
      email: 'admin@example.test', password: 'correct horse battery', role: 'admin'
    });
    vi.stubEnv('ADMIN_EMAIL', 'admin@example.test');
    vi.stubEnv('ADMIN_PASSWORD', 'correct horse battery');
    await expect(run('/properties')).rejects.toMatchObject({ status: 303, location: '/login' });
  });

  it('treats a request arriving on a non-loopback host as exposed, whatever the config says', async () => {
    // OrbStack publishes the container as gsc.local to the whole network while
    // AUTH_URL still says localhost. The config alone would call this local.
    vi.stubEnv('ORIGIN', '');
    vi.stubEnv('AUTH_URL', 'http://localhost:5173');
    setConfigValues(database, { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csec' });
    await expect(run('/properties', 'gsc.local')).rejects.toMatchObject({ status: 503 });
  });

  it('still serves a loopback request as local admin', async () => {
    vi.stubEnv('ORIGIN', '');
    vi.stubEnv('AUTH_URL', 'http://localhost:5173');
    setConfigValues(database, { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csec' });
    await expect(run('/properties', 'localhost')).resolves.toBeInstanceOf(Response);
  });
});
