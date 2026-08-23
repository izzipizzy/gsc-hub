// Dates, the way Search Console means them.
//
// Its daily rows are keyed to America/Los_Angeles, not UTC. Deriving a date
// from `new Date().toISOString().slice(0, 10)` is therefore wrong for a good
// part of every evening east of the Atlantic: the app asks for a day the data
// does not have yet, and quietly gets less back than it thinks.
//
// Everything here works on plain YYYY-MM-DD strings. Once a date is a string
// rather than an instant, arithmetic on it has no timezone and no DST to drift
// across — which is why `addCalendarDays` does not subtract milliseconds.

const GSC_TIME_ZONE = 'America/Los_Angeles';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: GSC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** Today's date in Search Console's timezone, as YYYY-MM-DD. */
export function gscToday(now: number = Date.now()): string {
  // en-CA formats as YYYY-MM-DD, which is the shape the API wants.
  return formatter.format(new Date(now));
}

/** The most recent day that has finished — today is still accumulating. */
export function latestCompleteDay(now: number = Date.now()): string {
  return addCalendarDays(gscToday(now), -1);
}

export function addCalendarDays(date: string, delta: number): string {
  // Anchored at UTC midnight purely as a calendar, never as a wall clock, so
  // the hour a timezone gains or loses cannot move the result.
  const at = Date.parse(`${date}T00:00:00Z`) + delta * 86400_000;
  return new Date(at).toISOString().slice(0, 10);
}

/** How many dates an inclusive range covers. */
export function dateSpan(startDate: string, endDate: string): number {
  const ms = Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`);
  return Math.round(ms / 86400_000) + 1;
}

/**
 * A window of exactly `days` completed calendar days ending with the most
 * recent finished one. The single definition of what "last N days" means —
 * anything computing its own dates will disagree with the rest of the app.
 */
export function completedDayRange(
  days: number, now: number = Date.now()
): { startDate: string; endDate: string } {
  const endDate = latestCompleteDay(now);
  return { startDate: addCalendarDays(endDate, -(days - 1)), endDate };
}
