// The GSC response cache is process-global; without a per-test reset the mocked
// fetch in one test leaks its response into the next (call counts, 401 marking
// and error paths all desync). Fresh cache for every test.
// The limiter is process-global too: fresh windows per test, and retry delays
// in milliseconds rather than seconds so a mocked 429 does not stall a test.
import { beforeEach } from 'vitest';
import { gscCacheInvalidate } from '$lib/server/gsc-cache';
import { gscLimiter, realClock } from '$lib/server/gsc-limiter';

beforeEach(() => {
  gscCacheInvalidate();
  gscLimiter.configure({ baseDelayMs: 1, maxDelayMs: 5, clock: realClock });
});
