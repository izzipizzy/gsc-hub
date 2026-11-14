import { describe, it, expect } from 'vitest';
import { GscLimiter, type LimiterClock } from '../src/lib/server/gsc-limiter';

// Virtual time: sleepers wake in deadline order, and time only moves when every
// runnable task has had its turn — so the test sees exact send instants.
function virtualClock() {
  let t = 0;
  const timers: { at: number; resolve: () => void }[] = [];
  const clock: LimiterClock = {
    now: () => t,
    sleep: (ms) => new Promise<void>((resolve) => timers.push({ at: t + Math.max(0, ms), resolve }))
  };
  const settle = () => new Promise((r) => setImmediate(r));
  async function runUntil(done: () => boolean) {
    for (let guard = 0; guard < 1_000_000; guard++) {
      await settle();
      if (done()) return;
      if (timers.length === 0) continue;
      timers.sort((a, b) => a.at - b.at);
      const next = timers.shift()!;
      t = Math.max(t, next.at);
      next.resolve();
    }
    throw new Error('virtual clock did not converge');
  }
  return { clock, runUntil, now: () => t };
}

function maxInWindow(stamps: number[], windowMs = 60_000): number {
  const s = [...stamps].sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; i < s.length; i++) {
    while (s[i] - s[j] >= windowMs) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

describe('GscLimiter', () => {
  it('keeps every 60-second window at or under 1200 per account across concurrent sources', async () => {
    const v = virtualClock();
    const limiter = new GscLimiter({ clock: v.clock, concurrency: 8 });
    const sent: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const request = async () => {
      sent.push(v.now());
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await v.clock.sleep(300);
      inFlight--;
      return new Response('{}');
    };
    // Two page loads and a background refresh, all on one account, all at once.
    const sources = [1000, 1000, 1000].map((n) =>
      Promise.all(Array.from({ length: n }, () => limiter.run('acc', request)))
    );
    let finished = false;
    Promise.all(sources).then(() => (finished = true));
    await v.runUntil(() => finished);

    expect(sent).toHaveLength(3000);
    expect(maxInWindow(sent)).toBeLessThanOrEqual(1200);
    expect(maxInFlight).toBeLessThanOrEqual(8);
    // 3000 at 1200/min needs at least two full windows; it should not take much longer.
    expect(v.now()).toBeGreaterThanOrEqual(120_000);
    expect(v.now()).toBeLessThan(200_000);
  }, 60_000);

  it('gives each account its own budget', async () => {
    const v = virtualClock();
    const limiter = new GscLimiter({ clock: v.clock, perAccountPerMinute: 10, concurrency: 4 });
    const sent: Record<string, number[]> = { a: [], b: [] };
    const req = (k: string) => async () => (sent[k].push(v.now()), new Response('{}'));
    let finished = false;
    Promise.all([
      ...Array.from({ length: 20 }, () => limiter.run('a', req('a'))),
      ...Array.from({ length: 10 }, () => limiter.run('b', req('b')))
    ]).then(() => (finished = true));
    await v.runUntil(() => finished);
    // b is not held back behind a's exhausted window.
    expect(Math.max(...sent.b)).toBe(0);
    expect(maxInWindow(sent.a)).toBe(10);
  });

  it('caps the whole project across accounts', async () => {
    const v = virtualClock();
    const limiter = new GscLimiter({ clock: v.clock, perAccountPerMinute: 100, projectPerMinute: 30 });
    const sent: number[] = [];
    let finished = false;
    Promise.all(
      ['a', 'b', 'c'].flatMap((k) => Array.from({ length: 20 }, () => limiter.run(k, async () => (sent.push(v.now()), new Response('{}')))))
    ).then(() => (finished = true));
    await v.runUntil(() => finished);
    expect(maxInWindow(sent)).toBe(30);
  });

  it('retries 429 after Retry-After, through the same window, and gives up after the limit', async () => {
    const v = virtualClock();
    const limiter = new GscLimiter({ clock: v.clock, retries: 2 });
    const sent: number[] = [];
    let result: Response | undefined;
    limiter
      .run('acc', async () => {
        sent.push(v.now());
        return new Response('slow down', { status: 429, headers: { 'Retry-After': '7' } });
      })
      .then((r) => (result = r));
    await v.runUntil(() => result !== undefined);
    expect(sent).toEqual([0, 7000, 14000]);
    expect(result!.status).toBe(429);
  });

  it('backs off exponentially with jitter when no Retry-After is given', async () => {
    const v = virtualClock();
    const limiter = new GscLimiter({ clock: v.clock, retries: 3, baseDelayMs: 1000, random: () => 1 });
    const sent: number[] = [];
    let result: Response | undefined;
    let n = 0;
    limiter
      .run('acc', async () => {
        sent.push(v.now());
        return new Response('', { status: n++ < 3 ? 503 : 200 });
      })
      .then((r) => (result = r));
    await v.runUntil(() => result !== undefined);
    expect(result!.status).toBe(200);
    expect(sent).toEqual([0, 1000, 3000, 7000]);
  });

  it('does not turn a burst of 429s into a burst of retries', async () => {
    const v = virtualClock();
    let seed = 0;
    const limiter = new GscLimiter({ clock: v.clock, retries: 1, baseDelayMs: 4000, random: () => (seed = (seed * 9301 + 49297) % 233280) / 233280 });
    const retries: number[] = [];
    let first = true;
    let done = 0;
    for (let i = 0; i < 50; i++) {
      let attempt = 0;
      limiter
        .run('acc', async () => {
          if (attempt++ > 0) retries.push(v.now());
          return new Response('', { status: first ? 429 : 200 });
        })
        .then(() => done++);
    }
    first = true;
    await v.runUntil(() => done === 50);
    // Retries spread over the jitter span rather than landing on one instant.
    expect(new Set(retries).size).toBeGreaterThan(25);
  });

  it('passes non-retryable failures straight through', async () => {
    const limiter = new GscLimiter({ retries: 3 });
    let calls = 0;
    const res = await limiter.run('acc', async () => (calls++, new Response('', { status: 403 })));
    expect(res.status).toBe(403);
    expect(calls).toBe(1);
  });
});
