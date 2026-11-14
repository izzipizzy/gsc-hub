// One set of periods for every screen with time-based data (gsc-hub-aus.9):
// a day, a week, four weeks, a quarter, a year and GSC's full 16 months,
// plus any custom number of days up to 480.
export const PERIODS = [1, 7, 28, 90, 365, 480] as const;
export const MAX_DAYS = 480;

/** Clamp free input to 1..480 whole days; null when it is not a number. */
export function parsePeriod(raw: string | number | null | undefined): number | null {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_DAYS) : null;
}
