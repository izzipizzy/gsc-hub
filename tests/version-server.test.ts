import { describe, expect, it } from 'vitest';
import { appVersion } from '$lib/server/version';
import pkg from '../package.json';

describe('appVersion', () => {
  it('reports the release tag that matches the manifest', () => {
    expect(appVersion.release).toBe(`v${pkg.version}`);
  });

  it('normalises the release as vX.Y.Z', () => {
    expect(appVersion.release).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  // Under vitest NODE_ENV is 'test', so the git probe is skipped — otherwise
  // these tests would depend on the working tree's current commit.
  it('reports no commit outside development', () => {
    expect(process.env.NODE_ENV).not.toBe('development');
    expect(appVersion.commit).toBeNull();
  });
});
