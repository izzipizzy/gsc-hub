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
  added_at      INTEGER NOT NULL
);
`;

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
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
