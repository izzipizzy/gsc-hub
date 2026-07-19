import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import {
  getConfigValue, configSource, setConfigValue, setConfigValues,
  isSetupComplete, ensureAuthSecret
} from '../src/lib/server/config';

const KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'AUTH_SECRET', 'LOGIN_ENABLED'];
function clearEnv() { for (const k of KEYS) delete process.env[k]; }

describe('config layer', () => {
  let dir: string; let db: Db;
  beforeEach(() => { clearEnv(); dir = mkdtempSync(join(tmpdir(), 'gsc-cfg-')); db = openDb(join(dir, 't.db')); });
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); clearEnv(); });

  it('returns undefined when neither env nor db has the key', () => {
    expect(getConfigValue(db, 'GOOGLE_CLIENT_ID')).toBeUndefined();
    expect(configSource(db, 'GOOGLE_CLIENT_ID')).toBe('none');
  });

  it('reads from db when env is absent', () => {
    setConfigValue(db, 'GOOGLE_CLIENT_ID', 'db-id');
    expect(getConfigValue(db, 'GOOGLE_CLIENT_ID')).toBe('db-id');
    expect(configSource(db, 'GOOGLE_CLIENT_ID')).toBe('db');
  });

  it('env overrides db (env > db)', () => {
    setConfigValue(db, 'GOOGLE_CLIENT_ID', 'db-id');
    process.env.GOOGLE_CLIENT_ID = 'env-id';
    expect(getConfigValue(db, 'GOOGLE_CLIENT_ID')).toBe('env-id');
    expect(configSource(db, 'GOOGLE_CLIENT_ID')).toBe('env');
  });

  it('treats empty/whitespace env as absent', () => {
    setConfigValue(db, 'GOOGLE_CLIENT_ID', 'db-id');
    process.env.GOOGLE_CLIENT_ID = '   ';
    expect(getConfigValue(db, 'GOOGLE_CLIENT_ID')).toBe('db-id');
  });

  it('setConfigValue upserts', () => {
    setConfigValue(db, 'GOOGLE_CLIENT_ID', 'a');
    setConfigValue(db, 'GOOGLE_CLIENT_ID', 'b');
    expect(getConfigValue(db, 'GOOGLE_CLIENT_ID')).toBe('b');
  });

  it('setConfigValues writes multiple, skips undefined', () => {
    setConfigValues(db, { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: undefined });
    expect(getConfigValue(db, 'GOOGLE_CLIENT_ID')).toBe('id');
    expect(getConfigValue(db, 'GOOGLE_CLIENT_SECRET')).toBeUndefined();
  });

  it('isSetupComplete requires both google keys', () => {
    expect(isSetupComplete(db)).toBe(false);
    setConfigValue(db, 'GOOGLE_CLIENT_ID', 'id');
    expect(isSetupComplete(db)).toBe(false);
    setConfigValue(db, 'GOOGLE_CLIENT_SECRET', 'sec');
    expect(isSetupComplete(db)).toBe(true);
  });

  it('ensureAuthSecret generates once, persists, is idempotent', () => {
    const s1 = ensureAuthSecret(db);
    expect(s1.length).toBeGreaterThan(20);
    const s2 = ensureAuthSecret(db);
    expect(s2).toBe(s1);
    expect(getConfigValue(db, 'AUTH_SECRET')).toBe(s1);
  });

  it('ensureAuthSecret respects env and does not write to db', () => {
    process.env.AUTH_SECRET = 'env-secret';
    expect(ensureAuthSecret(db)).toBe('env-secret');
    expect(configSource(db, 'AUTH_SECRET')).toBe('env');
  });
});
