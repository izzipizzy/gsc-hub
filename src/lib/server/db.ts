import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS google_accounts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  label         TEXT,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  scope         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  last_error    TEXT,
  added_at      INTEGER NOT NULL,
  owner_id      TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS url_inspection_cache (
  account_id   TEXT NOT NULL,
  site_url     TEXT NOT NULL,
  urls_hash    TEXT NOT NULL,
  fetched_at   INTEGER NOT NULL,
  payload      TEXT NOT NULL,
  PRIMARY KEY (account_id, site_url, urls_hash)
);

CREATE TABLE IF NOT EXISTS query_filters (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern   TEXT NOT NULL UNIQUE,
  added_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS indexnow_keys (
  host      TEXT PRIMARY KEY,
  key       TEXT NOT NULL,
  added_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hidden_sites (
  account_id TEXT NOT NULL,
  site_url   TEXT NOT NULL,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (account_id, site_url)
);

CREATE TABLE IF NOT EXISTS site_dates (
  host       TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  source     TEXT,
  synced_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_branded_keywords (
  site_url   TEXT PRIMARY KEY,
  terms      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_health (
  site_url   TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Seed the default 'site:' filter only when query_filters is first created, so
  // a user who deletes it doesn't get it back on the next restart.
  const filtersExisted = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='query_filters'")
    .get();
  db.exec(SCHEMA);
  const cols = db.prepare("PRAGMA table_info('google_accounts')").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'owner_id')) {
    db.exec('ALTER TABLE google_accounts ADD COLUMN owner_id TEXT');
  }
  if (!filtersExisted) {
    db.prepare('INSERT INTO query_filters (pattern, added_at) VALUES (?, ?)').run('site:', Date.now());
  }

  return db;
}

let _instance: Db | null = null;
export function db(): Db {
  if (!_instance) {
    const path = process.env.DB_PATH ?? './data/gsc-hub.db';
    _instance = openDb(path);
  }
  return _instance;
}
