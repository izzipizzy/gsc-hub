import { randomBytes } from 'node:crypto';
import type { Db } from './db';

export type ConfigKey = 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'AUTH_SECRET' | 'LOGIN_ENABLED';

function envVal(key: ConfigKey): string | undefined {
  const v = process.env[key];
  return v && v.trim() !== '' ? v : undefined;
}

export function getConfigValue(db: Db, key: ConfigKey): string | undefined {
  const e = envVal(key);
  if (e !== undefined) return e;
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as
    | { value: string } | undefined;
  return row?.value;
}

export function configSource(db: Db, key: ConfigKey): 'env' | 'db' | 'none' {
  if (envVal(key) !== undefined) return 'env';
  const row = db.prepare('SELECT 1 FROM app_config WHERE key = ?').get(key);
  return row ? 'db' : 'none';
}

export function setConfigValue(db: Db, key: ConfigKey, value: string): void {
  db.prepare(
    `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, Date.now());
}

export function setConfigValues(db: Db, values: Partial<Record<ConfigKey, string>>): void {
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) setConfigValue(db, k as ConfigKey, v);
  }
}

export function getGoogleClientId(db: Db): string | undefined {
  return getConfigValue(db, 'GOOGLE_CLIENT_ID');
}
export function getGoogleClientSecret(db: Db): string | undefined {
  return getConfigValue(db, 'GOOGLE_CLIENT_SECRET');
}
export function isSetupComplete(db: Db): boolean {
  return !!getGoogleClientId(db) && !!getGoogleClientSecret(db);
}
export function ensureAuthSecret(db: Db): string {
  const existing = getConfigValue(db, 'AUTH_SECRET');
  if (existing) return existing;
  const secret = randomBytes(32).toString('base64');
  setConfigValue(db, 'AUTH_SECRET', secret);
  return secret;
}
