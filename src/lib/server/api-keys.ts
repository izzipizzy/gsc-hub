import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db';

// Ключи для /api/v1: их создаёт админ на странице /api и отдаёт агенту или скрипту.
// Показывается ключ ОДИН раз, в базе лежит только sha256 — по утёкшей базе в API не войти.
// Токен серпмонитора из окружения (SERP_API_TOKEN) живёт рядом и работает как раньше.

export interface ApiKeyInfo {
  id: number;
  name: string;
  prefix: string; // первые 8 знаков — чтобы узнать ключ в списке, не храня его
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  /** Область: какие property видит ключ. Пустой массив — все. */
  sites: string[];
}

interface KeyRow {
  id: number;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  sites: string | null;
}

/** Список сайтов ключа. Битый JSON читается как «все», а не как «ничего»:
 *  ключ не должен внезапно ослепнуть из-за кривой записи. */
function parseSites(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const KEY_PREFIX = 'gsk_';

function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function createApiKey(db: Db, name: string, sites: string[] = []): ApiKeyInfo & { key: string } {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error('name required');
  // Дубли и пустые строки в области — это не «меньше доступа», а мусор,
  // по которому потом не понять, что ключу разрешено.
  const scope = [...new Set(sites.map((s) => s.trim()).filter(Boolean))];
  const key = KEY_PREFIX + randomBytes(24).toString('base64url');
  const now = Date.now();
  const res = db
    .prepare('INSERT INTO api_keys (name, prefix, hash, created_at, sites) VALUES (?, ?, ?, ?, ?)')
    .run(clean, key.slice(0, 8), hashKey(key), now, scope.length ? JSON.stringify(scope) : null);
  return {
    id: Number(res.lastInsertRowid),
    name: clean,
    prefix: key.slice(0, 8),
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
    sites: scope,
    key
  };
}

export function listApiKeys(db: Db): ApiKeyInfo[] {
  const rows = db
    .prepare(
      'SELECT id, name, prefix, created_at, last_used_at, revoked_at, sites FROM api_keys ORDER BY revoked_at IS NOT NULL, created_at DESC'
    )
    .all() as KeyRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
    sites: parseSites(r.sites)
  }));
}

export function revokeApiKey(db: Db, id: number): void {
  db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(Date.now(), id);
}

/** Живой ключ пускает и отмечает время последнего использования; отозванный — нет.
 *  Сравнивается хеш по уникальному индексу: сам ключ высокой энтропии, и подбор по
 *  времени ответа ничего не даёт.
 *  Возвращает не «да/нет», а сам ключ: вызывающему нужна его область сайтов. */
export function verifyApiKey(db: Db, supplied: string): { id: number; sites: string[] } | null {
  if (!supplied.startsWith(KEY_PREFIX)) return null;
  const row = db
    .prepare('SELECT id, sites FROM api_keys WHERE hash = ? AND revoked_at IS NULL')
    .get(hashKey(supplied)) as { id: number; sites: string | null } | undefined;
  if (!row) return null;
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id);
  return { id: row.id, sites: parseSites(row.sites) };
}
