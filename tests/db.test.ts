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
        'access_token', 'added_at', 'email', 'expires_at', 'id', 'label',
        'last_error', 'owner_id', 'refresh_token', 'scope', 'status'
      ].sort()
    );
    db.close();
  });

  it('creates users and sessions tables', () => {
    const db = openDb(dbPath);
    for (const t of ['users', 'sessions']) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(t);
      expect(row, `table ${t}`).toBeTruthy();
    }
    const ucols = (db.prepare("PRAGMA table_info('users')").all() as Array<{ name: string }>)
      .map((c) => c.name).sort();
    expect(ucols).toEqual(['created_at', 'email', 'id', 'password_hash', 'role'].sort());
    db.close();
  });

  it('adds owner_id to a pre-existing google_accounts table', async () => {
    // Simulate an old DB without owner_id, then re-open.
    const Database = (await import('better-sqlite3')).default;
    const raw = new Database(dbPath);
    raw.exec(`CREATE TABLE google_accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, label TEXT,
      access_token TEXT NOT NULL, refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL, scope TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', last_error TEXT, added_at INTEGER NOT NULL);`);
    raw.close();
    const db = openDb(dbPath);
    const cols = (db.prepare("PRAGMA table_info('google_accounts')").all() as Array<{ name: string }>)
      .map((c) => c.name);
    expect(cols).toContain('owner_id');
    db.close();
  });

  it('creates url_inspection_cache table with expected columns', () => {
    const db = openDb(dbPath);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='url_inspection_cache'")
      .get();
    expect(row).toBeTruthy();
    const cols = db
      .prepare("PRAGMA table_info('url_inspection_cache')")
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(['account_id', 'fetched_at', 'payload', 'site_url', 'urls_hash'].sort());
    db.close();
  });
});
