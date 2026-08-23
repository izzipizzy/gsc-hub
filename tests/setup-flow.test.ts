import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '$lib/server/db';
import { countAdmins, createUser } from '$lib/server/auth-session';
import { getConfigValue, isSetupComplete, setConfigValues } from '$lib/server/config';

let database: Db;

vi.mock('$lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/db')>();
  return { ...actual, db: (): Db => database };
});

import { actions } from '../src/routes/setup/+page.server';
import { LOCAL_ADMIN } from '$lib/server/guard';

const CONFIG_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'AUTH_SECRET', 'LOGIN_ENABLED'];

function clearSetupEnvironment(): void {
  for (const key of CONFIG_KEYS) delete process.env[key];
}

function submit(fields: Record<string, string>, locals: App.Locals = {} as App.Locals) {
  const request = new Request('http://localhost/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields)
  });
  return actions.default!({
    request,
    cookies: { set: vi.fn() },
    locals
  } as unknown as Parameters<NonNullable<typeof actions.default>>[0]);
}

const VALID_EXPOSED = {
  client_id: 'fake-client-id',
  client_secret: 'fake-client-secret',
  mode: 'exposed',
  admin_email: 'admin@example.test',
  admin_password: 'correct horse battery',
  admin_password2: 'correct horse battery'
};

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

  // Reported by @klimenkoalex in izzipizzy/gsc-hub#2.
  it('does not complete setup when exposed-mode admin validation fails', async () => {
    const result = await submit({ ...VALID_EXPOSED, admin_password: 'short', admin_password2: 'short' });

    expect(result).toMatchObject({ status: 400 });
    expect(countAdmins(database)).toBe(0);
    expect(getConfigValue(database, 'LOGIN_ENABLED')).toBeUndefined();
    expect(getConfigValue(database, 'AUTH_SECRET')).toBeUndefined();
    expect(isSetupComplete(database)).toBe(false);
  });

  it.each([
    ['an empty admin email', { admin_email: '' }],
    ['mismatched passwords', { admin_password2: 'something else entirely' }],
    ['a quoted password', { admin_password: '"padded pass"', admin_password2: '"padded pass"' }]
  ])('persists nothing when the form has %s', async (_label, override) => {
    const result = await submit({ ...VALID_EXPOSED, ...override });

    expect(result).toMatchObject({ status: 400 });
    expect(isSetupComplete(database)).toBe(false);
    expect(countAdmins(database)).toBe(0);
  });

  it('enables login even when an admin already exists', async () => {
    // Without this, a second exposed-mode submission completes setup while
    // leaving LOGIN_ENABLED unset — which is what opens the app up.
    await createUser(database, {
      email: 'first@example.test', password: 'correct horse battery', role: 'admin'
    });

    await expect(submit(VALID_EXPOSED)).rejects.toMatchObject({ status: 303 });

    expect(getConfigValue(database, 'LOGIN_ENABLED')).toBe('1');
    expect(isSetupComplete(database)).toBe(true);
  });

  it('refuses an anonymous submission once setup is complete', async () => {
    setConfigValues(database, { GOOGLE_CLIENT_ID: 'existing', GOOGLE_CLIENT_SECRET: 'existing' });

    await expect(submit(VALID_EXPOSED)).rejects.toMatchObject({ status: 403 });

    expect(getConfigValue(database, 'GOOGLE_CLIENT_ID')).toBe('existing');
    expect(countAdmins(database)).toBe(0);
  });

  it('still lets the local admin reconfigure a completed setup', async () => {
    setConfigValues(database, { GOOGLE_CLIENT_ID: 'existing', GOOGLE_CLIENT_SECRET: 'existing' });

    await expect(
      submit({ client_id: 'new-id', client_secret: 'new-secret', mode: 'local' }, {
        user: LOCAL_ADMIN
      } as App.Locals)
    ).rejects.toMatchObject({ status: 303 });

    expect(getConfigValue(database, 'GOOGLE_CLIENT_ID')).toBe('new-id');
  });
});
