import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import {
  upsertAccount,
  listAccounts,
  getAccount,
  deleteAccount,
  relabelAccount,
  markRevoked,
  markError,
  markActive,
  updateTokens
} from '../src/lib/server/accounts';

describe('accounts', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const sample = {
    id: 'sub-1',
    email: 'a@example.com',
    access_token: 'at',
    refresh_token: 'rt',
    expires_at: 100,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly'
  };

  it('upsert inserts a new row', () => {
    upsertAccount(db, sample);
    const row = getAccount(db, 'sub-1');
    expect(row?.email).toBe('a@example.com');
    expect(row?.status).toBe('active');
    expect(row?.added_at).toBeGreaterThan(0);
  });

  it('upsert updates tokens but preserves label and added_at', () => {
    upsertAccount(db, sample);
    relabelAccount(db, 'sub-1', 'My label');
    const before = getAccount(db, 'sub-1')!;

    upsertAccount(db, { ...sample, access_token: 'at2', expires_at: 200 });
    const after = getAccount(db, 'sub-1')!;

    expect(after.access_token).toBe('at2');
    expect(after.expires_at).toBe(200);
    expect(after.label).toBe('My label');
    expect(after.added_at).toBe(before.added_at);
  });

  it('upsert resets status to active and clears last_error', () => {
    upsertAccount(db, sample);
    markError(db, 'sub-1', 'something');
    expect(getAccount(db, 'sub-1')?.status).toBe('error');
    upsertAccount(db, sample);
    const row = getAccount(db, 'sub-1')!;
    expect(row.status).toBe('active');
    expect(row.last_error).toBeNull();
  });

  it('listAccounts returns rows sorted by added_at', () => {
    upsertAccount(db, sample);
    upsertAccount(db, { ...sample, id: 'sub-2', email: 'b@example.com' });
    const rows = listAccounts(db);
    expect(rows.map((r) => r.id)).toEqual(['sub-1', 'sub-2']);
  });

  it('deleteAccount removes the row', () => {
    upsertAccount(db, sample);
    deleteAccount(db, 'sub-1');
    expect(getAccount(db, 'sub-1')).toBeUndefined();
  });

  it('markRevoked sets status and last_error', () => {
    upsertAccount(db, sample);
    markRevoked(db, 'sub-1', 'HTTP 401');
    const row = getAccount(db, 'sub-1')!;
    expect(row.status).toBe('revoked');
    expect(row.last_error).toBe('HTTP 401');
  });

  it('markActive sets status active and clears last_error', () => {
    upsertAccount(db, sample);
    markRevoked(db, 'sub-1', 'old');
    markActive(db, 'sub-1');
    const row = getAccount(db, 'sub-1')!;
    expect(row.status).toBe('active');
    expect(row.last_error).toBeNull();
  });

  it('updateTokens updates access_token and expires_at without touching status', () => {
    upsertAccount(db, sample);
    markRevoked(db, 'sub-1', 'old');
    updateTokens(db, 'sub-1', { access_token: 'new', expires_at: 500 });
    const row = getAccount(db, 'sub-1')!;
    expect(row.access_token).toBe('new');
    expect(row.expires_at).toBe(500);
    expect(row.status).toBe('revoked');
  });
});
