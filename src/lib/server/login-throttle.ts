export const MAX_FAILURES = 5;
// Deliberately far looser than the per-account limit. Behind a reverse proxy or
// a NAT this key is shared by everyone, so a tight limit here would let one
// client — or one neighbour — lock the owner out for a whole window.
export const MAX_FAILURES_PER_ADDRESS = 50;
export const WINDOW_MS = 15 * 60 * 1000;

// key -> failure timestamps (ms). In-memory; single-instance deployment.
const failures = new Map<string, number[]>();

function fresh(key: string, now: number): number[] {
  return (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
}

// Keys are attacker-chosen (any email, any spoofable address), and until now
// nothing dropped one that went quiet, so the map only ever grew.
function sweep(now: number): void {
  for (const [key, times] of failures) {
    if (times.length === 0 || now - times[times.length - 1] >= WINDOW_MS) {
      failures.delete(key);
    }
  }
}

export function recordFailure(key: string, now: number = Date.now()): void {
  const arr = fresh(key, now);
  arr.push(now);
  failures.set(key, arr);
  if (failures.size > 1000) sweep(now);
}
export function clearFailures(key: string): void {
  failures.delete(key);
}
export function isBlocked(
  key: string,
  now: number = Date.now(),
  limit: number = MAX_FAILURES
): boolean {
  const arr = fresh(key, now);
  failures.set(key, arr);
  return arr.length >= limit;
}

// Test-only: the map outlives any single test, so leftover buckets would make
// results depend on the order tests ran in.
export function resetThrottle(): void {
  failures.clear();
}
