// Dashboard favorites live in the browser (localStorage). A cookie mirrors them
// so the server, which pages the cards, can put favorites first on page 1.
export const FAVS_COOKIE = 'gsc-hub-favs';

export function parseFavs(raw: string | undefined | null): Set<string> {
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Writes the mirror cookie; a year, lax, path=/ — it holds no secret. */
export function writeFavsCookie(favs: Iterable<string>): void {
  document.cookie = `${FAVS_COOKIE}=${encodeURIComponent(JSON.stringify([...favs]))}; path=/; max-age=31536000; samesite=lax`;
}
