const MAX_BYTES = 2 * 1024 * 1024; // 2 MB cap

async function fetchTextCapped(url: string, timeoutMs = 5000): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'user-agent': 'gsc-hub/0.1 (+https://github.com/izzipizzy/gsc-hub)' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        ac.abort();
        break;
      }
      chunks.push(value);
    }
    return new TextDecoder('utf-8').decode(concat(chunks));
  } finally {
    clearTimeout(timer);
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

export function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]);
}

export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/**
 * Fetch a sitemap XML and return up to `limit` page URLs.
 * If the document is a sitemapindex, follow the first child sitemap.
 */
export async function fetchSitemapUrls(
  sitemapUrl: string,
  limit: number = 50
): Promise<string[]> {
  const xml = await fetchTextCapped(sitemapUrl);
  if (isSitemapIndex(xml)) {
    const childSitemaps = extractLocs(xml);
    if (childSitemaps.length === 0) return [];
    const childXml = await fetchTextCapped(childSitemaps[0]);
    return extractLocs(childXml).slice(0, limit);
  }
  return extractLocs(xml).slice(0, limit);
}
