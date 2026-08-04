/** Concurrent Search Console calls. Google's per-user quota is far higher; this guards the socket pool. */
export const DEFAULT_LIMIT = 8;

/**
 * Bounded-concurrency variant of `Promise.allSettled(items.map(fn))`.
 *
 * A plain `Promise.allSettled(sites.map(fetchOne))` opens one connection per site at
 * once. On a portfolio of ~200 properties that saturates the local socket pool (in
 * Docker Desktop the whole batch dies with UND_ERR_CONNECT_TIMEOUT). Running the same
 * fetches a few at a time completes them all.
 *
 * Results stay positionally aligned with `items`, and the settled shape matches
 * Promise.allSettled so callers can keep their existing status checks.
 */
export async function mapSettledLimit<I, T>(
  items: I[],
  fn: (item: I, index: number) => Promise<T>,
  limit = DEFAULT_LIMIT
): Promise<PromiseSettledResult<T>[]> {
  const results = new Array<PromiseSettledResult<T>>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };

  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, worker));

  return results;
}
