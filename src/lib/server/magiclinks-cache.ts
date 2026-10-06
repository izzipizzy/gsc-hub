import { createHash } from 'node:crypto';
import type { Db } from './db';
import { magicLinksClient, getMagicLinksToken, getMagicLinksBase } from './magiclinks';
import { magic369Client, getMagic369Token, getMagic369Base } from './magic369';
const MINUTE = 60_000;
const inflight = new WeakMap<Db, Map<string, Promise<unknown>>>();
interface CacheRow { payload: string | null; fetched_at: number; expires_at: number; retry_after: number; error: string | null }

export async function cachedProviderRead<T>(database: Db, key: string, load: () => Promise<T>, ttl: number | ((data: T) => number), force = false, now = Date.now()): Promise<T> {
  const cached = database.prepare('SELECT * FROM magiclinks_read_cache WHERE cache_key=?').get(key) as CacheRow | undefined;
  if (!force && cached && (cached.expires_at > now || cached.retry_after > now)) {
    if (cached.payload !== null) return JSON.parse(cached.payload);
    throw new Error(cached.error ?? 'Сервис не ответил');
  }
  let running = inflight.get(database);
  if (!running) { running = new Map(); inflight.set(database, running); }
  const existing = running.get(key);
  if (existing) return existing as Promise<T>;
  const task = (async () => {
    try {
      const data = await load();
      const duration = typeof ttl === 'function' ? ttl(data) : ttl;
      const at = Date.now();
      database.prepare(`INSERT INTO magiclinks_read_cache (cache_key, payload, fetched_at, expires_at, retry_after, error)
        VALUES (?, ?, ?, ?, 0, NULL) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,
        fetched_at=excluded.fetched_at, expires_at=excluded.expires_at, retry_after=0, error=NULL`)
        .run(key, JSON.stringify(data), at, at + duration);
      return data;
    } catch (e) {
      const message = (e as Error).message.slice(0,300);
      database.prepare(`INSERT INTO magiclinks_read_cache (cache_key,payload,fetched_at,expires_at,retry_after,error)
        VALUES (?,NULL,0,0,?,?) ON CONFLICT(cache_key) DO UPDATE SET retry_after=excluded.retry_after,error=excluded.error`)
        .run(key, Date.now()+MINUTE, message);
      // Keep the last good response through a temporary provider outage.
      if (cached?.payload !== undefined && cached.payload !== null) return JSON.parse(cached.payload) as T;
      throw e;
    }
  })();
  running.set(key, task);
  try { return await task; } finally { running.delete(key); }
}

function cacheClient<T extends object>(database: Db, client: T | null, provider: string, token: string | undefined, base: string, force: boolean): T | null {
  if (!client) return null;
  const prefix = provider + ':' + createHash('sha256').update(base+'\n'+(token ?? '')).digest('hex').slice(0,24);
  const reads = new Set(['balance','listTasks','listOrders','order','taskRows','orderArticles']);
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      if (!reads.has(String(property))) return value.bind(target);
      return (...args: unknown[]) => {
        const ttl = (data: any) => {
          if (property === 'balance') return MINUTE;
          if (property === 'order') return /^(completed|partial|partially_completed|failed)$/.test(data?.order?.status ?? data?.status ?? '') ? 6*60*MINUTE : 5*MINUTE;
          if (property === 'orderArticles' || property === 'taskRows') return 60*MINUTE;
          return 5*MINUTE;
        };
        return cachedProviderRead(database, prefix+':'+String(property)+':'+JSON.stringify(args), () => value.apply(target,args), ttl, force);
      };
    }
  });
}
export function cachedMagicLinksClient(database: Db, force = false) {
  return cacheClient(database, magicLinksClient(database), 'fieldlink', getMagicLinksToken(database), getMagicLinksBase(database), force);
}
export function cachedMagic369Client(database: Db, force = false) {
  return cacheClient(database, magic369Client(database), 'magic369', getMagic369Token(database), getMagic369Base(database), force);
}
export function providerCacheState(database: Db) {
  const row = database.prepare('SELECT MAX(fetched_at) AS at, SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors FROM magiclinks_read_cache').get() as { at: number | null; errors: number | null };
  return { updatedAt: row.at, stale: (row.errors ?? 0) > 0 };
}
export function invalidateProviderCache(database: Db) { database.prepare('DELETE FROM magiclinks_read_cache').run(); }
