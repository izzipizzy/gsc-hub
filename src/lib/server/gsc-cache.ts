// In-memory TTL cache for GSC read responses.
//
// The fan-out endpoints (dashboard, today, site pages) fire one Search Console
// request per site per window, and with a portfolio that is minutes of waiting
// and a pile of quota on every view. The data itself changes slowly — a 60
// minute cache trades "this very second" for "usable", which for this tool is
// the right trade.
//
// Memory only: nothing reaches the database, a restart or redeploy starts cold
// and the next load repopulates. Bound the map so a long-running process with
// many sites/windows cannot grow it forever — eviction is oldest-first.

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 5_000;

interface Entry {
  at: number;
  expires: number;
  value: unknown;
}

const store = new Map<string, Entry>();

function evictOverflow() {
  // Map iterates in insertion order, so the first keys are the oldest.
  for (const key of store.keys()) {
    if (store.size <= MAX_ENTRIES) break;
    store.delete(key);
  }
}

export async function gscCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) {
    // Refresh insertion order so a hot entry is never the first one evicted.
    store.delete(key);
    store.set(key, hit);
    return hit.value as T;
  }
  const value = await fetcher();
  // Delete-then-set also upgrades a stale entry's position.
  store.delete(key);
  store.set(key, { at: Date.now(), expires: Date.now() + ttlMs, value });
  evictOverflow();
  return value;
}

/** Drop everything, or only keys starting with `prefix` (`sites:acc123`). */
export function gscCacheInvalidate(prefix = ''): number {
  let n = 0;
  if (prefix === '') {
    n = store.size;
    store.clear();
    return n;
  }
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      n++;
    }
  }
  return n;
}

export function gscCacheSize(): number {
  return store.size;
}
