import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/lib/server/db';

describe('db', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    dbPath = join(dir, 'test.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates google_accounts table on first open', () => {
    const db = openDb(dbPath);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='google_accounts'")
      .get();
    expect(row).toBeTruthy();
    db.close();
  });

  it('idempotent: opening twice does not throw', () => {
    openDb(dbPath).close();
    expect(() => openDb(dbPath).close()).not.toThrow();
  });

  it('schema has expected columns', () => {
    const db = openDb(dbPath);
    const cols = db.prepare("PRAGMA table_info('google_accounts')").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'access_token',
        'added_at',
        'email',
        'expires_at',
        'id',
        'label',
        'last_error',
        'refresh_token',
        'scope',
        'status'
      ].sort()
    );
    db.close();
  });
});
