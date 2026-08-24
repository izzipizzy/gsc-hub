// Update ticker. The app knows its own release tag and asks GitHub what the
// latest one is; these helpers are the only place that decides what "newer"
// and "stale enough to re-check" mean. Kept free of node imports so the
// browser half of the check can share them.

export const GITHUB_REPO = 'izzipizzy/gsc-hub';
export const RELEASES_LATEST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export function releaseUrl(tag: string): string {
  return `https://github.com/${GITHUB_REPO}/releases/tag/${tag}`;
}

/** `v0.6.8` / `0.6.8` → `[0, 6, 8]`. Anything else → null. */
export function parseVersion(v: string | null | undefined): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Whether `latest` is a strictly newer release than `current`. An unparseable
 * side (pre-release, dev build ahead of the tag, junk from the API) means we do
 * not know — and not knowing must never produce a nag.
 */
export function isNewer(
  latest: string | null | undefined,
  current: string | null | undefined
): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** True when the browser should ask GitHub again. */
export function shouldCheck(checkedAt: number | null | undefined, now: number): boolean {
  if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt)) return true;
  // A stamp in the future means the clock moved back; re-check instead of
  // waiting out an interval that will never elapse.
  if (checkedAt > now) return true;
  return now - checkedAt >= CHECK_INTERVAL_MS;
}
