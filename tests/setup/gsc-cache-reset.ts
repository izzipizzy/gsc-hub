// The GSC response cache is process-global; without a per-test reset the mocked
// fetch in one test leaks its response into the next (call counts, 401 marking
// and error paths all desync). Fresh cache for every test.
import { beforeEach } from 'vitest';
import { gscCacheInvalidate } from '$lib/server/gsc-cache';

beforeEach(() => {
  gscCacheInvalidate();
});
