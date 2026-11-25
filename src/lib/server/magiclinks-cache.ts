import { createHash } from 'node:crypto';
import type { Db } from './db';
import { magicLinksClient, getMagicLinksToken, getMagicLinksBase } from './magiclinks';
import { magic369Client, getMagic369Token, getMagic369Base } from './magic369';
import { saitamaClient, getSaitamaToken, getSaitamaBase } from './saitamalinks';
const MINUTE = 60_000;
const inflight = new WeakMap<Db, Map<string, Promise<unknown>>>();
interface CacheRow { payload: string | null; fetched_at: number; expires_at: number; retry_after: number; error: string | null }

/**
 * Read through the persistent provider cache.
 *
 * `swr` (stale-while-revalidate) is for pages: an expired entry with a payload
 * is returned at once and refreshed in the background, so opening /magiclinks
 * never waits on the providers once something has been read. Without it an
 * expired entry is fetched before returning (background jobs, explicit refresh).
 */
export async function cachedProviderRead<T>(database: Db, key: string, load: () => Promise<T>, ttl: number | ((data: T) => number), force = false, now = Date.now(), swr = false): Promise<T> {
  const cached = database.prepare('SELECT * FROM magiclinks_read_cache WHERE cache_key=?').get(key) as CacheRow | undefined;
  if (!force && cached && (cached.expires_at > now || cached.retry_after > now)) {
    if (cached.payload !== null) return JSON.parse(cached.payload);
    throw new Error(cached.error ?? 'Сервис не ответил');
  }
  if (swr && !force && cached?.payload != null) {
    // Old numbers now, fresh ones on the next visit; a failed refresh is
    // recorded (retry_after) by the fetch itself and never reaches the page.
    void fetchAndStore().catch(() => undefined);
    return JSON.parse(cached.payload) as T;
  }
  return fetchAndStore();

  function fetchAndStore(): Promise<T> {
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
  const map = running;
  return task.finally(() => map.delete(key));
  }
}

function cacheClient<T extends object>(database: Db, client: T | null, provider: string, token: string | undefined, base: string, force: boolean, swr = false): T | null {
  if (!client) return null;
  const prefix = provider + ':' + createHash('sha256').update(base+'\n'+(token ?? '')).digest('hex').slice(0,24);
  const reads = new Set(['balance','listTasks','listOrders','order','taskRows','orderArticles','orderLinks']);
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      if (!reads.has(String(property))) return value.bind(target);
      return (...args: unknown[]) => {
        const ttl = (data: any) => {
          if (property === 'balance') return MINUTE;
          if (property === 'order') return /^(completed|cancelled|partial|partially_completed|failed)$/.test(data?.order?.status ?? data?.status ?? '') ? 6*60*MINUTE : 5*MINUTE;
          if (property === 'orderArticles' || property === 'orderLinks' || property === 'taskRows') return 60*MINUTE;
          return 5*MINUTE;
        };
        return cachedProviderRead(database, prefix+':'+String(property)+':'+JSON.stringify(args), () => value.apply(target,args), ttl, force, Date.now(), swr);
      };
    }
  });
}
/** `swr`: pages pass true to get the last answer at once and refresh in the background. */
export function cachedMagicLinksClient(database: Db, force = false, swr = false) {
  return cacheClient(database, magicLinksClient(database), 'fieldlink', getMagicLinksToken(database), getMagicLinksBase(database), force, swr);
}
export function cachedMagic369Client(database: Db, force = false, swr = false) {
  return cacheClient(database, magic369Client(database), 'magic369', getMagic369Token(database), getMagic369Base(database), force, swr);
}
export function cachedSaitamaClient(database: Db, force = false, swr = false) {
  return cacheClient(database, saitamaClient(database), 'saitamalinks', getSaitamaToken(database), getSaitamaBase(database), force, swr);
}
/** `refreshing`: provider reads are running now (the page polls until they finish). */
export function providerCacheState(database: Db) {
  const row = database.prepare('SELECT MAX(fetched_at) AS at, SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors FROM magiclinks_read_cache').get() as { at: number | null; errors: number | null };
  return { updatedAt: row.at, stale: (row.errors ?? 0) > 0, refreshing: (inflight.get(database)?.size ?? 0) > 0 };
}
/**
 * Marks every cached answer expired instead of deleting it: the next page
 * open shows the previous answers at once and refreshes them in the
 * background (stale-while-revalidate). Deleting made that open wait for every
 * order of every provider - minutes on a large account. Error back-offs are
 * cleared too, so a fixed key is retried right away.
 */
export function invalidateProviderCache(database: Db) {
  database.prepare('UPDATE magiclinks_read_cache SET expires_at = 0, retry_after = 0').run();
}
