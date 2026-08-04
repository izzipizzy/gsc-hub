import { describe, it, expect } from 'vitest';
import { mapSettledLimit } from '../src/lib/server/concurrency';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('mapSettledLimit', () => {
  it('keeps results positionally aligned with the input items', async () => {
    const results = await mapSettledLimit(
      [10, 0, 5, 1],
      async (ms, i) => {
        await tick(ms);
        return i;
      },
      2
    );

    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([0, 1, 2, 3]);
  });

  it('settles rejections instead of throwing, like Promise.allSettled', async () => {
    const boom = new Error('boom');
    const results = await mapSettledLimit(
      ['ok', 'fail'],
      async (kind) => {
        if (kind === 'fail') throw boom;
        return kind;
      },
      2
    );

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'ok' });
    expect(results[1]).toEqual({ status: 'rejected', reason: boom });
  });

  it('never runs more than `limit` items at once', async () => {
    let running = 0;
    let peak = 0;

    await mapSettledLimit(
      Array.from({ length: 50 }, (_, i) => i),
      async () => {
        running++;
        peak = Math.max(peak, running);
        await tick(2);
        running--;
        return true;
      },
      8
    );

    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1); // still concurrent, not serialised
  });

  it('holds the limit even when items reject', async () => {
    let running = 0;
    let peak = 0;

    const results = await mapSettledLimit(
      Array.from({ length: 30 }, (_, i) => i),
      async (i) => {
        running++;
        peak = Math.max(peak, running);
        await tick(1);
        running--;
        if (i % 3 === 0) throw new Error(`fail ${i}`);
        return i;
      },
      4
    );

    expect(peak).toBeLessThanOrEqual(4);
    expect(results).toHaveLength(30);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(10);
  });

  it('handles an empty item list', async () => {
    await expect(mapSettledLimit([], async () => 1, 8)).resolves.toEqual([]);
  });

  it('does not spawn more workers than there are items', async () => {
    const results = await mapSettledLimit([1], async (n) => n, 64);
    expect(results).toEqual([{ status: 'fulfilled', value: 1 }]);
  });
});
