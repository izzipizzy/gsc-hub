// A per-site value for every property of every active account, refreshed in
// the background and read without waiting.
//
// At 10,000 domains one pass over the portfolio is ~10,000 requests, and the
// per-account quota (1,200 a minute) puts that at eight or more minutes no
// matter how it is scheduled. So pages never wait for a pass: they read what
// the store holds and its status, and a stale store starts one refresh — one,
// however many pages ask — while the old values keep being served.
//
// Memory only, like gsc-cache: a restart starts cold and the first page shows
// the pass filling in.

import type { Db } from './db';
import { listAccounts, type AccountRow } from './accounts';
import { listSitesForAccount, type SiteRow } from './google';
import { gscCacheInvalidate } from './gsc-cache';
import { mapSettledLimit } from './concurrency';

export interface AccountError {
  accountId: string;
  accountEmail: string;
  reason: string;
}

export interface SiteSlot<T> {
  site: SiteRow;
  /** Null until the first successful fetch for this site. */
  value: T | null;
  /** Error of the latest attempt; `value` then still holds the previous answer. */
  error: string | null;
  fetchedAt: number | null;
}

export interface RefreshStatus {
  /** 'cold' until one pass has completed; pages then show progress, not numbers. */
  state: 'cold' | 'ready';
  refreshing: boolean;
  done: number;
  total: number;
  startedAt: number | null;
  /** When the last complete pass finished. */
  updatedAt: number | null;
  /** Set when a pass could not run at all (no site list from any account). */
  error: string | null;
}

export interface StoreView<T> {
  slots: SiteSlot<T>[];
  accountErrors: AccountError[];
  status: RefreshStatus;
}

export interface StoreOptions {
  ttlMs: number;
  /** How long a page waits on a cold store before rendering progress instead. */
  coldWaitMs: number;
  /** After a failed pass, how long before a read may start another. */
  errorRetryMs: number;
  now: () => number;
}

const DEFAULT_OPTIONS: StoreOptions = {
  ttlMs: 60 * 60 * 1000,
  coldWaitMs: 2_000,
  errorRetryMs: 60_000,
  now: () => Date.now()
};

export const slotKey = (accountId: string, siteUrl: string) => `${accountId}|${siteUrl}`;

/** What a fetch knows about the pass it belongs to. */
export interface PassInfo {
  /** Sites in this pass — for limits that scale with the portfolio. */
  total: number;
}

export class PortfolioStore<T> {
  private readonly opts: StoreOptions;
  private slots = new Map<string, SiteSlot<T>>();
  private accountErrors: AccountError[] = [];
  private run: Promise<void> | null = null;
  private startedAt: number | null = null;
  private updatedAt: number | null = null;
  private done = 0;
  private total = 0;
  private error: string | null = null;
  private stale = false;
  private rerun = false;
  private generation = 0;

  constructor(
    private readonly fetchSite: (db: Db, acc: AccountRow, site: SiteRow, pass: PassInfo) => Promise<T>,
    opts: Partial<StoreOptions> = {}
  ) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  /**
   * Current contents. Starts a refresh when the store is stale and none is
   * running. `wait: true` blocks only while the store is cold — for callers
   * that need complete numbers (API); pages pass `false` and get, at worst,
   * `coldWaitMs` of waiting and a progress status.
   */
  async get(db: Db, { wait }: { wait: boolean }): Promise<StoreView<T>> {
    this.ensureFresh(db);
    if (this.updatedAt === null && this.run) {
      if (wait) await this.run;
      else await Promise.race([this.run, new Promise((r) => setTimeout(r, this.opts.coldWaitMs))]);
    }
    return this.view(db);
  }

  /** Marks the store stale; the next read starts a refresh. Values are kept. */
  invalidate(): void {
    this.stale = true;
    if (this.run) this.rerun = true;
  }

  /** Forget everything — tests and account removal. */
  reset(): void {
    this.generation++;
    this.slots.clear();
    this.accountErrors = [];
    this.run = null;
    this.startedAt = this.updatedAt = null;
    this.done = this.total = 0;
    this.error = null;
    this.stale = this.rerun = false;
  }

  /** Resolves when the running refresh (if any) has finished. */
  async settled(): Promise<void> {
    while (this.run) await this.run;
  }

  private ensureFresh(db: Db): void {
    if (this.run) return;
    const age = this.startedAt === null ? Infinity : this.opts.now() - this.startedAt;
    // A failed pass is retried, but not on every page open: one try a minute.
    const retry = this.error !== null && age >= this.opts.errorRetryMs;
    if (age < this.opts.ttlMs && !this.stale && !retry) return;
    this.start(db);
  }

  private start(db: Db): void {
    this.stale = false;
    this.rerun = false;
    const gen = this.generation;
    this.run = this.refresh(db, gen)
      .catch((e) => {
        if (gen === this.generation) this.error = (e as Error).message;
      })
      .finally(() => {
        if (gen !== this.generation) return;
        this.run = null;
        if (this.rerun) this.start(db);
      });
  }

  private async refresh(db: Db, gen: number): Promise<void> {
    this.startedAt = this.opts.now();
    this.error = null;
    this.done = 0;

    const accounts = listAccounts(db).filter((a) => a.status === 'active');
    // A pass means current site lists too: a property added in Search Console
    // should show up within one pass, not one pass after the list cache expires.
    for (const a of accounts) gscCacheInvalidate(`sites:${a.id}`);
    const lists = await Promise.allSettled(accounts.map((a) => listSitesForAccount(db, a)));
    if (gen !== this.generation) return;

    const accountErrors: AccountError[] = [];
    const next = new Map<string, SiteSlot<T>>();
    const work: { acc: AccountRow; slot: SiteSlot<T> }[] = [];
    lists.forEach((r, i) => {
      const acc = accounts[i];
      if (r.status === 'rejected') {
        accountErrors.push({ accountId: acc.id, accountEmail: acc.email, reason: (r.reason as Error).message });
        // The list could not be read; keep what we had for this account rather
        // than dropping every one of its sites from the page.
        for (const [k, slot] of this.slots) if (slot.site.accountId === acc.id) next.set(k, slot);
        return;
      }
      for (const site of r.value) {
        const k = slotKey(acc.id, site.siteUrl);
        const prev = this.slots.get(k);
        const slot: SiteSlot<T> = prev ? { ...prev, site } : { site, value: null, error: null, fetchedAt: null };
        next.set(k, slot);
        work.push({ acc, slot });
      }
    });
    this.slots = next;
    this.accountErrors = accountErrors;
    this.total = work.length;
    if (accounts.length > 0 && accountErrors.length === accounts.length && next.size === 0) {
      throw new Error(accountErrors.map((e) => `${e.accountEmail}: ${e.reason}`).join('; '));
    }

    // Width matches the global limiter; it is the one that actually bounds sockets.
    const pass: PassInfo = { total: work.length };
    await mapSettledLimit(work, async ({ acc, slot }) => {
      try {
        const value = await this.fetchSite(db, acc, slot.site, pass);
        if (gen !== this.generation) return;
        slot.value = value;
        slot.error = null;
        slot.fetchedAt = this.opts.now();
      } catch (e) {
        if (gen !== this.generation) return;
        slot.error = (e as Error).message.slice(0, 200);
      } finally {
        if (gen === this.generation) this.done++;
      }
    });
    if (gen !== this.generation) return;
    this.updatedAt = this.opts.now();
  }

  private view(db: Db): StoreView<T> {
    // A deleted or revoked account disappears now, not at the next pass.
    const accounts = listAccounts(db);
    const active = new Set(accounts.filter((a) => a.status === 'active').map((a) => a.id));
    // The error that took an account out of service stays visible until it is reconnected or removed.
    const known = new Set(accounts.map((a) => a.id));
    const slots: SiteSlot<T>[] = [];
    for (const slot of this.slots.values()) if (active.has(slot.site.accountId)) slots.push(slot);
    return {
      slots,
      accountErrors: this.accountErrors.filter((e) => known.has(e.accountId)),
      status: {
        state: this.updatedAt === null ? 'cold' : 'ready',
        refreshing: this.run !== null,
        done: this.done,
        total: this.total,
        startedAt: this.startedAt,
        updatedAt: this.updatedAt,
        error: this.error
      }
    };
  }
}
