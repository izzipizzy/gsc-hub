// One way to print time across the app: ISO dates, 24-hour clock, local time.
// Built by hand rather than with toLocale*String, whose output follows the
// browser's locale (that is how "02:02 PM" and "14:02" ended up side by side).

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-11-14` in local time. */
export function isoDate(ts: number | Date): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `14:02` in local time. */
export function clock(ts: number | Date): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `2026-11-14 14:02` in local time. */
export function dateTime(ts: number | Date): string {
  return `${isoDate(ts)} ${clock(ts)}`;
}

/** `14:02` for today, `2026-11-13 14:02` for any other day: the freshness stamp. */
export function stamp(ts: number | Date, now: number | Date = Date.now()): string {
  return isoDate(ts) === isoDate(now) ? clock(ts) : dateTime(ts);
}

/** `2026-11-14 14:02:11` for title tooltips. */
export function fullStamp(ts: number | Date): string {
  const d = new Date(ts);
  return `${dateTime(d)}:${pad(d.getSeconds())}`;
}
