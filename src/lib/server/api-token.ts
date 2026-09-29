import { error } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { db as defaultDb, type Db } from './db';
import { verifyApiKey } from './api-keys';

/** Кто пришёл по машинной ручке. Пустой `sites` — доступ ко всем сайтам. */
export interface ApiCaller {
  kind: 'env' | 'key';
  keyId: number | null;
  sites: string[];
}

/**
 * Машинная авторизация для /api/v1: сессии у вызывающего нет, только Bearer.
 *
 * Пускают два замка, и оба независимы:
 * 1. SERP_API_TOKEN из окружения — им ходит серпмонитор сервер-сервером. Пустой
 *    токен этот замок закрывает: «не настроен, значит пускаем всех» открыло бы
 *    данные Search Console наружу. Он видит все сайты, как и раньше.
 * 2. Ключ со страницы /api — для агентов, скриптов и MCP. Отозванный не пускает.
 *    У ключа может быть область: тогда он видит только свои property.
 *
 * `database` передаётся геттером: проверка по env не должна открывать базу.
 */
export function requireApiToken(request: Request, database: () => Db = defaultDb): ApiCaller {
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!supplied) throw error(401, 'unauthorized');

  const configured = (process.env.SERP_API_TOKEN ?? '').trim();
  if (configured) {
    const a = Buffer.from(configured);
    const b = Buffer.from(supplied);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { kind: 'env', keyId: null, sites: [] };
    }
  }
  const key = verifyApiKey(database(), supplied);
  if (key) return { kind: 'key', keyId: key.id, sites: key.sites };
  throw error(401, 'unauthorized');
}

/**
 * Хост property: `sc-domain:example.com`, `https://example.com/` и
 * `https://www.example.com/` — это один сайт. Область выдаётся по сайтам,
 * а не по написанию property, иначе ключ на домен не увидел бы свой же
 * URL-префикс.
 */
export function siteHostOf(siteUrl: string): string {
  const raw = siteUrl.trim();
  const bare = raw.startsWith('sc-domain:') ? raw.slice('sc-domain:'.length) : raw;
  try {
    const host = bare.includes('://') ? new URL(bare).host : bare;
    return host.toLowerCase().replace(/^www\./, '').replace(/\/+$/, '');
  } catch {
    return bare.toLowerCase().replace(/^www\./, '').replace(/\/+$/, '');
  }
}

export function allowsSite(caller: ApiCaller, siteUrl: string): boolean {
  if (caller.sites.length === 0) return true; // область не задана — все сайты
  const want = siteHostOf(siteUrl);
  return caller.sites.some((s) => siteHostOf(s) === want);
}

/** 404, а не 403: чужой сайт для этого ключа не существует. */
export function requireSite(caller: ApiCaller, siteUrl: string): void {
  if (!allowsSite(caller, siteUrl)) throw error(404, 'site not found');
}

/** Отсечь из выдачи всё, что вне области ключа. */
export function scopeRows<T>(caller: ApiCaller, rows: T[], pick: (row: T) => string): T[] {
  if (caller.sites.length === 0) return rows;
  return rows.filter((r) => allowsSite(caller, pick(r)));
}
