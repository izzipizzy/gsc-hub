export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;

// key -> failure timestamps (ms). In-memory; single-instance deployment.
const failures = new Map<string, number[]>();

export function recordFailure(key: string, now: number = Date.now()): void {
  const arr = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  failures.set(key, arr);
}
export function clearFailures(key: string): void {
  failures.delete(key);
}
export function isBlocked(key: string, now: number = Date.now()): boolean {
  const arr = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(key, arr);
  return arr.length >= MAX_FAILURES;
}
