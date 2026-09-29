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

CREATE TABLE IF NOT EXISTS site_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_host  TEXT NOT NULL,
  date       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'merge',
  note       TEXT NOT NULL DEFAULT '',
  added_at   INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_events_unique
  ON site_events (site_host, date, type, note);

-- Покупки ссылок MagicLinks: что уже куплено на пару «запрос + URL».
-- Сами задания и их статусы живут в сервисе и читаются живьём; здесь только
-- след покупки, чтобы таблицы striking знали, куда уже вкладывались.
CREATE TABLE IF NOT EXISTS magiclinks_purchases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_host   TEXT NOT NULL,
  target_url  TEXT NOT NULL,
  query       TEXT NOT NULL,
  language    TEXT NOT NULL,
  quantity    INTEGER NOT NULL,
  task_id     TEXT NOT NULL,
  order_id    TEXT NOT NULL,
  provider    TEXT NOT NULL DEFAULT 'fieldlink',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_magiclinks_purchases_pair
  ON magiclinks_purchases (target_url, query);
CREATE INDEX IF NOT EXISTS idx_magiclinks_purchases_site
  ON magiclinks_purchases (site_host);

-- API-ключи для агентов и скриптов. Сам ключ показывается один раз при создании;
-- хранится только sha256 — утёкшая база не даёт войти в API.
CREATE TABLE IF NOT EXISTS api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  hash         TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
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

  // Область ключа: JSON-массив siteUrl. Пусто — все сайты, поэтому ключи,
  // выданные до появления колонки, продолжают работать как раньше.
  const keyCols = db.prepare("PRAGMA table_info('api_keys')").all() as Array<{ name: string }>;
  if (!keyCols.some((c) => c.name === 'sites')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN sites TEXT');
  }
  // Одна связка одного заказа — одна строка истории. Без этого два импорта,
  // запущенные одновременно (страница и кнопка), успевают оба пройти проверку
  // «заказ уже записан» и удваивают количество.
  db.exec(
    `DELETE FROM magiclinks_purchases
      WHERE id NOT IN (
        SELECT MIN(id) FROM magiclinks_purchases GROUP BY order_id, target_url, query
      )`
  );
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_magiclinks_purchases_unique
       ON magiclinks_purchases (order_id, target_url, query)`
  );
  // Провайдер покупки: до появления второго провайдера все заказы были FieldLink.
  const purCols = db.prepare("PRAGMA table_info('magiclinks_purchases')").all() as Array<{
    name: string;
  }>;
  if (!purCols.some((c) => c.name === 'provider')) {
    db.exec("ALTER TABLE magiclinks_purchases ADD COLUMN provider TEXT NOT NULL DEFAULT 'fieldlink'");
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
