import { describe, it, expect, beforeEach } from 'vitest';
import { recordFailure, clearFailures, isBlocked, MAX_FAILURES } from '../src/lib/server/login-throttle';

describe('login-throttle', () => {
  beforeEach(() => clearFailures('k'));
  it('blocks after MAX_FAILURES within the window', () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_FAILURES; i++) { expect(isBlocked('k', t)).toBe(false); recordFailure('k', t); }
    expect(isBlocked('k', t)).toBe(true);
  });
  it('clears on success', () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure('k', t);
    clearFailures('k');
    expect(isBlocked('k', t)).toBe(false);
  });
  it('expires after the window', () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure('k', t);
    expect(isBlocked('k', t + 15 * 60 * 1000 + 1)).toBe(false);
  });
});
