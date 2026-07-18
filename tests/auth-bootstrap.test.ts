import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { initAuth, countAdmins, getUserByEmail } from '../src/lib/server/auth-session';
import { upsertAccount, listAccounts } from '../src/lib/server/accounts';

describe('auth bootstrap', () => {
  let dir: string; let db: Db;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gsc-hub-')); db = openDb(join(dir, 't.db')); });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it('seeds an admin from env when none exists, idempotently', async () => {
    await initAuth(db, { ADMIN_EMAIL: 'root@x.com', ADMIN_PASSWORD: 'pw12345' });
    expect(countAdmins(db)).toBe(1);
    await initAuth(db, { ADMIN_EMAIL: 'root@x.com', ADMIN_PASSWORD: 'pw12345' });
    expect(countAdmins(db)).toBe(1); // not duplicated
    expect(getUserByEmail(db, 'root@x.com')?.role).toBe('admin');
  });

  it('does nothing when env creds are absent', async () => {
    await initAuth(db, {});
    expect(countAdmins(db)).toBe(0);
  });

  it('backfills owner_id of existing accounts to the first admin', async () => {
    upsertAccount(db, { id: 's1', email: 'a@x.com', access_token: 'at', refresh_token: 'rt', expires_at: 1, scope: '' });
    await initAuth(db, { ADMIN_EMAIL: 'root@x.com', ADMIN_PASSWORD: 'pw12345' });
    const admin = getUserByEmail(db, 'root@x.com')!;
    expect(listAccounts(db)[0].owner_id).toBe(admin.id);
  });
});
