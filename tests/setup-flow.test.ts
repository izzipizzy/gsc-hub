import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '$lib/server/db';
import { countAdmins } from '$lib/server/auth-session';
import { getConfigValue, isSetupComplete } from '$lib/server/config';

let database: Db;

vi.mock('$lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/db')>();
  return { ...actual, db: (): Db => database };
});

import { actions } from '../src/routes/setup/+page.server';

const CONFIG_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'AUTH_SECRET', 'LOGIN_ENABLED'];

function clearSetupEnvironment(): void {
  for (const key of CONFIG_KEYS) delete process.env[key];
}

describe('setup exposed mode', () => {
  let directory: string;

  beforeEach(() => {
    clearSetupEnvironment();
    directory = mkdtempSync(join(tmpdir(), 'gsc-setup-'));
    database = openDb(join(directory, 'test.db'));
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
    clearSetupEnvironment();
  });

  it('does not complete setup when exposed-mode admin validation fails', async () => {
    const body = new URLSearchParams({
      client_id: 'fake-client-id',
      client_secret: 'fake-client-secret',
      mode: 'exposed',
      admin_email: 'admin@example.test',
      admin_password: 'short',
      admin_password2: 'short'
    });
    const request = new Request('http://localhost/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });

    const result = await actions.default!({
      request,
      cookies: { set: vi.fn() }
    } as unknown as Parameters<NonNullable<typeof actions.default>>[0]);

    expect(result).toMatchObject({ status: 400 });
    expect(countAdmins(database)).toBe(0);
    expect(getConfigValue(database, 'LOGIN_ENABLED')).toBeUndefined();
    expect(isSetupComplete(database)).toBe(false);
  });
});
