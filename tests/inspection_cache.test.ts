import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import {
  hashUrls,
  getCachedInspection,
  setCachedInspection,
  deleteCachedInspection
} from '../src/lib/server/inspection_cache';

describe('inspection_cache', () => {
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

  it('hashUrls is deterministic and order-independent', () => {
    const a = hashUrls(['https://a.com/x', 'https://a.com/y']);
    const b = hashUrls(['https://a.com/y', 'https://a.com/x']);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns null when nothing cached', () => {
    expect(getCachedInspection(db, 'sub-1', 'https://a.com/', 'hash', 43200)).toBeNull();
  });

  it('round-trips a payload and respects TTL', () => {
    setCachedInspection(db, 'sub-1', 'https://a.com/', 'hash', '{"results":[]}');
    const fresh = getCachedInspection(db, 'sub-1', 'https://a.com/', 'hash', 43200);
    expect(fresh?.payload).toBe('{"results":[]}');
    expect(fresh?.fetchedAt).toBeGreaterThan(0);

    // simulate stale: age the row by setting fetched_at far in the past
    db.prepare(`UPDATE url_inspection_cache SET fetched_at = 1 WHERE account_id = 'sub-1'`).run();
    expect(getCachedInspection(db, 'sub-1', 'https://a.com/', 'hash', 43200)).toBeNull();
  });

  it('upsert replaces an existing entry instead of erroring', () => {
    setCachedInspection(db, 'sub-1', 'https://a.com/', 'hash', 'first');
    setCachedInspection(db, 'sub-1', 'https://a.com/', 'hash', 'second');
    const row = getCachedInspection(db, 'sub-1', 'https://a.com/', 'hash', 43200);
    expect(row?.payload).toBe('second');

    deleteCachedInspection(db, 'sub-1', 'https://a.com/', 'hash');
    expect(getCachedInspection(db, 'sub-1', 'https://a.com/', 'hash', 43200)).toBeNull();
  });
});
