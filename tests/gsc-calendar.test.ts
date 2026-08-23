import { describe, expect, it } from 'vitest';
import {
  addCalendarDays, gscToday, latestCompleteDay, dateSpan, completedDayRange
} from '$lib/server/gsc-calendar';

// Search Console keys its daily rows to America/Los_Angeles. Deriving dates
// from UTC means asking for a day the data does not have yet for a good part of
// every evening in Europe.
describe('gscToday', () => {
  const at = (iso: string) => gscToday(Date.parse(iso));

  it('is still yesterday in Pacific while UTC has moved on', () => {
    // 06:00 UTC is 23:00 the previous day in Los Angeles.
    expect(at('2026-08-23T06:00:00Z')).toBe('2026-08-22');
  });

  it('agrees with UTC once Pacific has caught up', () => {
    expect(at('2026-08-23T20:00:00Z')).toBe('2026-08-23');
  });

  it('handles the turn of the year', () => {
    expect(at('2027-01-01T05:00:00Z')).toBe('2026-12-31');
  });

  it('is unaffected by the process timezone', () => {
    // The helper must read the same in Moscow, UTC and Los Angeles.
    expect(at('2026-08-23T06:00:00Z')).toBe('2026-08-22');
    expect(at('2026-08-23T06:59:59Z')).toBe('2026-08-22');
    expect(at('2026-08-23T07:00:00Z')).toBe('2026-08-23');
  });
});

describe('addCalendarDays', () => {
  it('moves by calendar days, not by 86,400,000 milliseconds', () => {
    // Pacific loses an hour on 2026-03-08. Millisecond arithmetic drifts here.
    expect(addCalendarDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addCalendarDays('2026-03-08', 1)).toBe('2026-03-09');
    // And gains one on 2026-11-01.
    expect(addCalendarDays('2026-10-31', 2)).toBe('2026-11-02');
  });

  it('crosses month and year boundaries', () => {
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addCalendarDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('returns the same date for a zero delta', () => {
    expect(addCalendarDays('2026-08-23', 0)).toBe('2026-08-23');
  });
});

describe('latestCompleteDay', () => {
  it('is the day before the Pacific date, because today is still filling', () => {
    expect(latestCompleteDay(Date.parse('2026-08-23T20:00:00Z'))).toBe('2026-08-22');
    expect(latestCompleteDay(Date.parse('2026-08-23T06:00:00Z'))).toBe('2026-08-21');
  });
});

describe('dateSpan', () => {
  it('counts both ends of an inclusive range', () => {
    expect(dateSpan('2026-08-23', '2026-08-23')).toBe(1);
    expect(dateSpan('2026-08-17', '2026-08-23')).toBe(7);
    // Across a DST boundary the count must not slip.
    expect(dateSpan('2026-10-31', '2026-11-02')).toBe(3);
  });
});

describe('completedDayRange', () => {
  const at = (days: number) => completedDayRange(days, Date.parse('2026-08-23T06:00:00Z'));

  it('covers exactly N completed days in Search Console\'s timezone', () => {
    // Pacific is still 2026-08-22, so the last finished day is the 21st.
    expect(at(7)).toEqual({ startDate: '2026-08-15', endDate: '2026-08-21' });
    expect(dateSpan(at(7).startDate, at(7).endDate)).toBe(7);
  });

  it('is a single day at days=1', () => {
    expect(at(1)).toEqual({ startDate: '2026-08-21', endDate: '2026-08-21' });
  });
});
