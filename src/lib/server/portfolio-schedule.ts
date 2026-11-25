// Scheduled refresh of the portfolio snapshot (/dashboard, /properties).
//
// Pages already refresh a stale snapshot on open (portfolio-store.ts); this
// adds a pass every few hours even when nobody opens them, and one shortly
// after start, so the first visit after a restart or a quiet night finds
// fresh numbers instead of a cold store. One pass, as ever: a tick while a
// pass is running does nothing.
//
// PORTFOLIO_REFRESH_HOURS: interval in hours (default 3, 1–24), 0 turns it off.

import { db } from './db';
import { portfolio } from './portfolio';
import { refreshCurrentTop } from './portfolio-top';

const DEFAULT_HOURS = 3;
const STARTUP_DELAY_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;
let nextAt: number | null = null;
let intervalMs = 0;

/** Interval from the environment; null when the schedule is off. */
export function scheduleHours(env: string | undefined = process.env.PORTFOLIO_REFRESH_HOURS): number | null {
  if (env === undefined || env.trim() === '') return DEFAULT_HOURS;
  const n = Number(env);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(24, Math.max(1, n));
}

function tick(): void {
  nextAt = Date.now() + intervalMs;
  try {
    const database = db();
    portfolio.refreshNow(database);
    refreshCurrentTop(database);
  } catch (e) {
    console.error('Portfolio schedule:', (e as Error).message);
  }
}

export function startPortfolioSchedule(): void {
  if (timer) return;
  const hours = scheduleHours();
  if (hours === null) return;
  intervalMs = hours * 3_600_000;
  // Warm the store soon after start; the regular interval counts from there.
  const first = setTimeout(() => {
    tick();
    timer = setInterval(tick, intervalMs);
    timer.unref();
  }, STARTUP_DELAY_MS);
  first.unref();
  timer = first as unknown as ReturnType<typeof setInterval>;
  nextAt = Date.now() + STARTUP_DELAY_MS;
}

/** For the status line: how often, and when the next scheduled pass starts. */
export function portfolioSchedule(): { hours: number; nextAt: number | null } | null {
  if (!timer) return null;
  return { hours: intervalMs / 3_600_000, nextAt };
}
