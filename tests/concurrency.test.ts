import { describe, it, expect } from 'vitest';
import { allSettledLimit } from '../src/lib/server/concurrency';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('allSettledLimit', () => {
  it('keeps results positionally aligned with the input tasks', async () => {
    const tasks = [10, 0, 5, 1].map((ms, i) => async () => {
      await tick(ms);
      return i;
    });

    const results = await allSettledLimit(tasks, 2);

    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([0, 1, 2, 3]);
  });

  it('settles rejections instead of throwing, like Promise.allSettled', async () => {
    const boom = new Error('boom');
    const results = await allSettledLimit(
      [async () => 'ok', async () => { throw boom; }],
      2
    );

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'ok' });
    expect(results[1]).toEqual({ status: 'rejected', reason: boom });
  });

  it('never runs more than `limit` tasks at once', async () => {
    let running = 0;
    let peak = 0;
    const tasks = Array.from({ length: 50 }, () => async () => {
      running++;
      peak = Math.max(peak, running);
      await tick(2);
      running--;
      return true;
    });

    await allSettledLimit(tasks, 8);

    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1); // still concurrent, not serialised
  });

  it('holds the limit even when tasks reject', async () => {
    let running = 0;
    let peak = 0;
    const tasks = Array.from({ length: 30 }, (_, i) => async () => {
      running++;
      peak = Math.max(peak, running);
      await tick(1);
      running--;
      if (i % 3 === 0) throw new Error(`fail ${i}`);
      return i;
    });

    const results = await allSettledLimit(tasks, 4);

    expect(peak).toBeLessThanOrEqual(4);
    expect(results).toHaveLength(30);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(10);
  });

  it('handles an empty task list', async () => {
    await expect(allSettledLimit([], 8)).resolves.toEqual([]);
  });

  it('does not spawn more workers than there are tasks', async () => {
    const results = await allSettledLimit([async () => 1], 64);
    expect(results).toEqual([{ status: 'fulfilled', value: 1 }]);
  });
});
