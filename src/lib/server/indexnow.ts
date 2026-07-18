import type { Db } from './db';

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX_URLS = 10000; // IndexNow per-request cap

export function getIndexNowKey(db: Db, host: string): string | null {
  const row = db.prepare('SELECT key FROM indexnow_keys WHERE host = ?').get(host) as
    | { key: string }
    | undefined;
  return row?.key ?? null;
}

// All hosts that have an IndexNow key (i.e. a {key}.txt is set up → ready for
// Bing/IndexNow). Used to flag sites that still need a key.
export function listIndexNowHosts(db: Db): Set<string> {
  const rows = db.prepare('SELECT host FROM indexnow_keys').all() as { host: string }[];
  return new Set(rows.map((r) => r.host));
}

export interface IndexNowResult {
  host: string;
  submitted: number;
  status: number;
  ok: boolean;
}

// POST a batch of URLs to IndexNow (Bing, Yandex, et al. consume it). 200/202 = ok.
export async function submitIndexNow(host: string, key: string, urls: string[]): Promise<IndexNowResult> {
  const urlList = [...new Set(urls)].slice(0, MAX_URLS);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host,
      key,
      keyLocation: `https://${host}/${key}.txt`,
      urlList
    })
  });
  return { host, submitted: urlList.length, status: res.status, ok: res.status === 200 || res.status === 202 };
}
