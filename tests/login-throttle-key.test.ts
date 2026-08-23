import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '$lib/server/db';
import { createUser } from '$lib/server/auth-session';
import { MAX_FAILURES } from '$lib/server/login-throttle';

let database: Db;

vi.mock('$lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/db')>();
  return { ...actual, db: (): Db => database };
});

import { actions } from '../src/routes/login/+page.server';

function attempt(email: string, address = '203.0.113.9', password = 'wrong password') {
  const request = new Request('http://localhost/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password })
  });
  return actions.default!({
    request,
    cookies: { set: vi.fn() },
    getClientAddress: () => address
  } as unknown as Parameters<NonNullable<typeof actions.default>>[0]);
}

describe('login throttle keying', () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-throttle-'));
    database = openDb(join(dir, 'test.db'));
    await createUser(database, {
      email: 'admin@example.test', password: 'correct horse battery', role: 'admin'
    });
  });

  afterEach(() => {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('counts padded and cased spellings of one email into the same bucket', async () => {
    // verifyLogin trims and lowercases before looking the user up, so all of
    // these hit the same password hash. The throttle has to agree, or the limit
    // is bypassed by adding a space.
    const spellings = ['admin@example.test', ' admin@example.test', 'ADMIN@example.test  ', '  Admin@Example.test'];
    for (let i = 0; i < MAX_FAILURES; i++) {
      const result = await attempt(spellings[i % spellings.length]);
      expect(result).toMatchObject({ status: 401 });
    }

    const blocked = await attempt('   admin@example.test   ');
    expect(blocked).toMatchObject({ status: 429 });
  });

  it('does not let one address exhaust attempts against many accounts', async () => {
    const address = '198.51.100.7';
    for (let i = 0; i < MAX_FAILURES; i++) {
      await attempt(`victim${i}@example.test`, address);
    }

    const blocked = await attempt('another@example.test', address);
    expect(blocked).toMatchObject({ status: 429 });
  });

  it('leaves a different address unaffected', async () => {
    const result = await attempt('admin@example.test', '192.0.2.55');
    expect(result).toMatchObject({ status: 401 });
  });
});
