import { describe, it, expect } from 'vitest';
import { scheduleHours } from '../src/lib/server/portfolio-schedule';

describe('portfolio schedule interval', () => {
  it('defaults to 3 hours, 0 turns it off, clamps to 1–24', () => {
    expect(scheduleHours(undefined)).toBe(3);
    expect(scheduleHours('')).toBe(3);
    expect(scheduleHours('4')).toBe(4);
    expect(scheduleHours('0')).toBeNull();
    expect(scheduleHours('off')).toBeNull();
    expect(scheduleHours('0.25')).toBe(1);
    expect(scheduleHours('100')).toBe(24);
  });
});
