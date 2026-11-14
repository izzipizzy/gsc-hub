// One gate for every Search Analytics / sites.list call the process makes.
//
// Search Console counts quota per Google account (1,200 queries a minute per
// user, the same per site) and per Cloud project (40,000 a minute). Before this
// module each fan-out ran its own pool of 8, so two pages and a background
// refresh opened 24 sockets and together sailed past the per-user minute; the
// 429s that followed were reported as site errors. Now every caller shares:
//
// - a sliding 60-second window per account and one for the whole project,
//   counted at the moment a request is actually sent;
// - one process-wide concurrency bound (GSC_CONCURRENCY, default 8);
// - bounded retries for 429/503 with exponential backoff and jitter, honouring
//   Retry-After, each retry passing through the same window.
//
// URL Inspection has a different quota and keeps its own INSPECT_LIMIT.

import { DEFAULT_LIMIT, parseLimit } from './concurrency';

export interface LimiterClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: LimiterClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};

export interface LimiterOptions {
  perAccountPerMinute: number;
  projectPerMinute: number;
  concurrency: number;
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  clock: LimiterClock;
  random: () => number;
}

const WINDOW_MS = 60_000;
const RETRYABLE = new Set([429, 503]);

/** Sliding log of send times; at most `limit` entries inside any WINDOW_MS. */
class Window {
  private stamps: number[] = [];
  private head = 0;
  constructor(readonly limit: number) {}

  private prune(now: number) {
    while (this.head < this.stamps.length && this.stamps[this.head] <= now - WINDOW_MS) this.head++;
    // Compact now and then so the array does not grow for the life of the process.
    if (this.head > 4096 && this.head * 2 > this.stamps.length) {
      this.stamps = this.stamps.slice(this.head);
      this.head = 0;
    }
  }

  /** 0 when a request may go now, otherwise how long until one may. */
  waitMs(now: number): number {
    this.prune(now);
    if (this.stamps.length - this.head < this.limit) return 0;
    return this.stamps[this.head] + WINDOW_MS - now;
  }

  record(now: number) {
    this.stamps.push(now);
  }

  /** Requests sent within the last minute — for status displays and tests. */
  used(now: number): number {
    this.prune(now);
    return this.stamps.length - this.head;
  }
}

export class GscLimiter {
  private opts: LimiterOptions;
  private readonly accounts = new Map<string, Window>();
  private project: Window;
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(opts: Partial<LimiterOptions> = {}) {
    this.opts = {
      perAccountPerMinute: 1200,
      projectPerMinute: 40_000,
      concurrency: DEFAULT_LIMIT,
      retries: 3,
      baseDelayMs: 2_000,
      maxDelayMs: 60_000,
      clock: realClock,
      random: Math.random,
      ...opts
    };
    this.project = new Window(this.opts.projectPerMinute);
  }

  private account(key: string): Window {
    let w = this.accounts.get(key);
    if (!w) {
      w = new Window(this.opts.perAccountPerMinute);
      this.accounts.set(key, w);
    }
    return w;
  }

  private acquire(): Promise<void> {
    if (this.active < this.opts.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release() {
    const next = this.queue.shift();
    // The slot passes straight to the next waiter; `active` stays the same.
    if (next) next();
    else this.active--;
  }

  /**
   * Runs one request under the window and the concurrency bound. The slot is
   * held only while the request is in flight: waiting for the window happens
   * outside it, so one exhausted account does not stall another.
   */
  private async send(key: string, request: () => Promise<Response>): Promise<Response> {
    const { clock } = this.opts;
    const win = this.account(key);
    for (;;) {
      const wait = Math.max(win.waitMs(clock.now()), this.project.waitMs(clock.now()));
      if (wait > 0) {
        await clock.sleep(wait);
        continue;
      }
      await this.acquire();
      // Others may have spent the budget while we queued for a slot.
      const now = clock.now();
      if (win.waitMs(now) > 0 || this.project.waitMs(now) > 0) {
        this.release();
        continue;
      }
      win.record(now);
      this.project.record(now);
      try {
        return await request();
      } finally {
        this.release();
      }
    }
  }

  private retryDelay(res: Response, attempt: number): number {
    const header = res.headers.get('retry-after');
    if (header) {
      const secs = Number(header);
      if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, this.opts.maxDelayMs);
      const at = Date.parse(header);
      if (Number.isFinite(at)) return Math.min(Math.max(0, at - this.opts.clock.now()), this.opts.maxDelayMs);
    }
    const exp = this.opts.baseDelayMs * 2 ** attempt;
    // Full jitter halves the herd: a burst of 429s does not come back as one burst.
    return Math.min(exp / 2 + this.opts.random() * (exp / 2), this.opts.maxDelayMs);
  }

  /** Sends `request` for `account`, retrying 429/503 a bounded number of times. */
  async run(account: string, request: () => Promise<Response>): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.send(account, request);
      if (!RETRYABLE.has(res.status) || attempt >= this.opts.retries) return res;
      // Drain the body so the socket goes back to the pool before we sleep.
      await res.arrayBuffer().catch(() => undefined);
      await this.opts.clock.sleep(this.retryDelay(res, attempt));
    }
  }

  /** Tests: shorten delays or swap the clock, and forget every window. */
  configure(opts: Partial<LimiterOptions>) {
    this.opts = { ...this.opts, ...opts };
    this.accounts.clear();
    this.project = new Window(this.opts.projectPerMinute);
  }

  usedLastMinute(account: string): number {
    return this.account(account).used(this.opts.clock.now());
  }

  get inFlight(): number {
    return this.active;
  }
}

export const gscLimiter = new GscLimiter({
  perAccountPerMinute: parseLimit(process.env.GSC_QPM, 1200),
  projectPerMinute: parseLimit(process.env.GSC_PROJECT_QPM, 40_000)
});
