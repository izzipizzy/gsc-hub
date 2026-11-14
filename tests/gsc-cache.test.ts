import { it, expect } from 'vitest';
import { gscCached, gscCacheInvalidate, gscCacheSize, MAX_ENTRIES } from '../src/lib/server/gsc-cache';

it('shares one fetch between concurrent callers of the same key', async () => {
  let calls = 0;
  let release!: (v: number) => void;
  const fetcher = () => (calls++, new Promise<number>((r) => (release = r)));
  const a = gscCached('k', fetcher);
  const b = gscCached('k', fetcher);
  await Promise.resolve();
  release(42);
  expect(await Promise.all([a, b])).toEqual([42, 42]);
  expect(calls).toBe(1);
  expect(await gscCached('k', fetcher)).toBe(42);
  expect(calls).toBe(1);
});

it('does not cache a failure, and lets the next caller retry', async () => {
  let calls = 0;
  const failing = () => (calls++, Promise.reject(new Error('boom')));
  await expect(gscCached('f', failing)).rejects.toThrow('boom');
  await expect(gscCached('f', async () => (calls++, 1))).resolves.toBe(1);
  expect(calls).toBe(2);
});

it('drops an answer that was in flight when the cache was invalidated', async () => {
  let release!: (v: string) => void;
  const p = gscCached('x', () => new Promise<string>((r) => (release = r)));
  await Promise.resolve();
  gscCacheInvalidate();
  release('old');
  expect(await p).toBe('old');
  expect(await gscCached('x', async () => 'new')).toBe('new');
});

it('holds a 10,000-site fan-out without evicting its own first half', async () => {
  expect(MAX_ENTRIES).toBeGreaterThanOrEqual(20_000);
  for (let i = 0; i < 10_000; i++) await gscCached(`saq:${i}`, async () => i);
  let refetched = 0;
  for (let i = 0; i < 10_000; i++) await gscCached(`saq:${i}`, async () => (refetched++, i));
  expect(refetched).toBe(0);
  expect(gscCacheSize()).toBe(10_000);
});
