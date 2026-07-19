import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { createUser, countUsers } from '../src/lib/server/auth-session';
import { loginEnabled } from '../src/lib/server/guard';
import { setConfigValue } from '../src/lib/server/config';

function clearEnv() { delete process.env.ADMIN_EMAIL; delete process.env.ADMIN_PASSWORD; }

describe('login-mode gating', () => {
  let dir: string; let db: Db;
  beforeEach(() => { clearEnv(); dir = mkdtempSync(join(tmpdir(), 'gsc-lm-')); db = openDb(join(dir, 't.db')); });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); clearEnv(); });

  it('countUsers counts all users', async () => {
    expect(countUsers(db)).toBe(0);
    await createUser(db, { email: 'a@x.com', password: 'pw12345678', role: 'admin' });
    expect(countUsers(db)).toBe(1);
  });

  it('loginEnabled is false on a fresh db with no env admin', () => {
    expect(loginEnabled(db)).toBe(false);
  });

  it('loginEnabled is true when a user exists', async () => {
    await createUser(db, { email: 'a@x.com', password: 'pw12345678', role: 'admin' });
    expect(loginEnabled(db)).toBe(true);
  });

  it('loginEnabled is true when LOGIN_ENABLED config is set', () => {
    setConfigValue(db, 'LOGIN_ENABLED', '1');
    expect(loginEnabled(db)).toBe(true);
  });

  it('loginEnabled is true when env admin creds are present', () => {
    process.env.ADMIN_EMAIL = 'root@x.com';
    process.env.ADMIN_PASSWORD = 'pw12345678';
    expect(loginEnabled(db)).toBe(true);
  });
});
