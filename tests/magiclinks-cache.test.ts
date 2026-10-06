import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { cachedProviderRead, providerCacheState, invalidateProviderCache } from '../src/lib/server/magiclinks-cache';
let db: Db;
beforeEach(() => { db=openDb(':memory:'); vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
afterEach(() => { db.close(); vi.useRealTimers(); });
it('persists results, avoids repeated provider calls until TTL, and refreshes explicitly', async () => {
  const load=vi.fn().mockResolvedValue({status:'processing'});
  expect(await cachedProviderRead(db,'provider:order',load,300_000)).toEqual({status:'processing'});
  await cachedProviderRead(db,'provider:order',load,300_000);
  expect(load).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(300_001); load.mockResolvedValue({status:'completed'});
  expect(await cachedProviderRead(db,'provider:order',load,300_000)).toEqual({status:'completed'});
  await cachedProviderRead(db,'provider:order',load,300_000,true);
  expect(load).toHaveBeenCalledTimes(3);
  invalidateProviderCache(db);
  await cachedProviderRead(db,'provider:order',load,300_000);
  expect(load).toHaveBeenCalledTimes(4);
});
it('coalesces simultaneous page/worker reads into one provider request', async () => {
  let finish!: (data: object) => void;
  const load=vi.fn(() => new Promise<object>((resolve) => {finish=resolve;}));
  const a=cachedProviderRead(db,'same',load,60_000); const b=cachedProviderRead(db,'same',load,60_000);
  finish({rows:[1,2]});
  expect(await a).toEqual(await b);
  expect(load).toHaveBeenCalledOnce();
});
it('serves last good data during an outage and backs off instead of repeatedly polling', async () => {
  const load=vi.fn().mockResolvedValue({rows:[1]});
  await cachedProviderRead(db,'same',load,1000);
  vi.advanceTimersByTime(1001); load.mockRejectedValue(new Error('unavailable'));
  expect(await cachedProviderRead(db,'same',load,1000)).toEqual({rows:[1]});
  expect(providerCacheState(db).stale).toBe(true);
  await cachedProviderRead(db,'same',load,1000);
  expect(load).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(60_001); load.mockResolvedValue({rows:[2]});
  expect(await cachedProviderRead(db,'same',load,1000)).toEqual({rows:[2]});
  expect(providerCacheState(db).stale).toBe(false);
});
it('backs off failed initial loads without inventing empty successful data and isolates keys', async () => {
  const load=vi.fn().mockRejectedValue(new Error('unavailable'));
  await expect(cachedProviderRead(db,'field:order',load,60_000)).rejects.toThrow('unavailable');
  await expect(cachedProviderRead(db,'field:order',load,60_000)).rejects.toThrow('unavailable');
  expect(load).toHaveBeenCalledOnce();
  const second=vi.fn().mockResolvedValue({rows:[2]});
  expect(await cachedProviderRead(db,'other:order',second,60_000)).toEqual({rows:[2]});
});
