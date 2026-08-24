import { describe, expect, it } from 'vitest';
import { CHECK_INTERVAL_MS, isNewer, parseVersion, releaseUrl, shouldCheck } from '$lib/version';

describe('parseVersion', () => {
  it.each([
    ['v0.6.8', [0, 6, 8]],
    ['0.6.8', [0, 6, 8]],
    ['  v1.20.3  ', [1, 20, 3]]
  ])('parses %s', (input, expected) => {
    expect(parseVersion(input as string)).toEqual(expected);
  });

  // Anything that is not exactly three numbers is unknown territory: a
  // pre-release, a dev build ahead of the tag, or junk. Unknown must not be
  // guessed at — isNewer() turns null into "do not nag".
  it.each(['', 'latest', 'v1.2', 'v0.7.0-rc.1', 'v0.6.8-3-ga991ef4', 'vX.Y.Z'])(
    'refuses %s',
    (input) => {
      expect(parseVersion(input)).toBeNull();
    }
  );

  it.each([null, undefined])('refuses %s', (input) => {
    expect(parseVersion(input)).toBeNull();
  });
});

describe('isNewer', () => {
  it.each([
    ['v0.6.9', 'v0.6.8'],
    ['v0.7.0', 'v0.6.8'],
    ['v1.0.0', 'v0.9.9'],
    // Numeric, not lexical: '0.10.0' sorts before '0.9.9' as a string.
    ['v0.10.0', 'v0.9.9']
  ])('%s is newer than %s', (latest, current) => {
    expect(isNewer(latest, current)).toBe(true);
  });

  it.each([
    ['v0.6.8', 'v0.6.8'],
    ['v0.6.8', 'v0.6.9'],
    ['v0.9.9', 'v0.10.0'],
    // A local build ahead of the last tag must never be told to "update".
    ['v0.6.8', 'v0.6.8-3-ga991ef4'],
    ['v0.7.0-rc.1', 'v0.6.8'],
    ['garbage', 'v0.6.8'],
    ['v0.7.0', null]
  ])('%s is not newer than %s', (latest, current) => {
    expect(isNewer(latest, current as string | null)).toBe(false);
  });
});

describe('shouldCheck', () => {
  const now = 1_000_000_000_000;

  it('checks when nothing was ever recorded', () => {
    expect(shouldCheck(null, now)).toBe(true);
    expect(shouldCheck(undefined, now)).toBe(true);
  });

  it('stays quiet inside the interval', () => {
    expect(shouldCheck(now - 11 * 60 * 60 * 1000, now)).toBe(false);
  });

  it('checks once the interval has passed', () => {
    expect(shouldCheck(now - 13 * 60 * 60 * 1000, now)).toBe(true);
    expect(shouldCheck(now - CHECK_INTERVAL_MS, now)).toBe(true);
  });

  // A clock moved backwards (timezone fix, VM resume) would otherwise park the
  // stamp in the future and freeze the check forever.
  it('checks when the stamp is in the future', () => {
    expect(shouldCheck(now + 60_000, now)).toBe(true);
  });

  it('checks when the stamp is not a usable number', () => {
    expect(shouldCheck(Number.NaN, now)).toBe(true);
  });
});

describe('releaseUrl', () => {
  it('points at the release notes on GitHub', () => {
    expect(releaseUrl('v0.6.8')).toBe('https://github.com/izzipizzy/gsc-hub/releases/tag/v0.6.8');
  });
});
