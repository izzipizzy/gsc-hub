import pkg from '../../../package.json';
import type { Db } from './db';
import { getConfigValue, configSource } from './config';
import { decodePage, inspectHtml, validateSourceUrl, isPublicAddress, type BacklinkResult } from './backlink-checker';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import { SocksProxyAgent } from 'socks-proxy-agent';

export const BACKLINK_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const MAX_BYTES = 4 * 1024 * 1024;
export function validateProxy(raw: string): URL {
  let proxy: URL;
  try { proxy = new URL(raw); } catch { throw new Error('Укажи SOCKS URL: socks5://user:pass@host:port'); }
  if (!['socks4:', 'socks5:'].includes(proxy.protocol) || !proxy.hostname || !proxy.port || proxy.pathname && proxy.pathname !== '/' || proxy.search || proxy.hash) {
    throw new Error('Нужен socks4://user@host:port или socks5://user:pass@host:port');
  }
  if (proxy.protocol === 'socks4:' && proxy.password) throw new Error('SOCKS4 поддерживает только User ID. Для логина и пароля выбери SOCKS5');
  return proxy;
}
export function backlinkSettings(database: Db) {
  const proxy = getConfigValue(database, 'BACKLINK_PROXY_URL');
  let proxyLabel: string | null = null;
  try { if (proxy) { const u = validateProxy(proxy); proxyLabel = `${u.protocol}//${u.host}`; } } catch { proxyLabel = 'Некорректный прокси'; }
  return { proxyConfigured: !!proxy, proxyLabel, source: configSource(database, 'BACKLINK_PROXY_URL'),
    automatic: getConfigValue(database, 'BACKLINK_AUTO_ENABLED') !== '0', userAgent: BACKLINK_UA };
}

export async function publicDestination(raw: string) {
  const url = validateSourceUrl(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = ipaddr.isValid(hostname)
    ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }]
    : await Promise.race([lookup(hostname, { all: true }), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Таймаут DNS')), 10_000);
    })]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) throw new Error('Адрес публикации не является публичным');
  return { url, address: addresses.find((a) => a.family === 4) ?? addresses[0] };
}

export async function readPublicDocument(raw: string, proxyUrl: string | undefined, xml = false): Promise<{ body: Buffer; finalUrl: string; type: string }> {
  if (proxyUrl) validateProxy(proxyUrl);
  const agent = proxyUrl ? new SocksProxyAgent(proxyUrl, { timeout: 15_000 }) : false;
  let current = raw;
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const { url, address } = await publicDestination(current);
      // The SOCKS tunnel also uses this checked IP; TLS and Host keep the site's name.
      const transport = new URL(url);
      transport.hostname = address.family === 6 ? `[${address.address}]` : address.address;
      const response = await new Promise<{ location?: string; body: Buffer; type: string }>((resolve, reject) => {
        const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(transport, {
          agent, servername: url.hostname.replace(/^\[|\]$/g, ''),
          headers: { Host: url.host, 'User-Agent': xml ? `gsc-hub/${pkg.version}` : BACKLINK_UA, Accept: xml ? 'application/xml,text/xml,*/*' : 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity' }
        }, (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume(); resolve({ location: res.headers.location, body: Buffer.alloc(0), type: '' }); return;
          }
          if (status < 200 || status >= 300) { res.resume(); reject(new Error(`HTTP ${status}`)); return; }
          if (Number(res.headers['content-length']) > MAX_BYTES) { res.destroy(); reject(new Error('Страница больше 4 МБ')); return; }
          let size = 0;
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BYTES) { res.destroy(new Error('Страница больше 4 МБ')); return; }
            chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () => {
            try {
              let body = Buffer.concat(chunks);
              const encoding = res.headers['content-encoding'];
              const options = { maxOutputLength: MAX_BYTES };
              if (encoding === 'gzip') body = gunzipSync(body, options);
              else if (encoding === 'deflate') body = inflateSync(body, options);
              else if (encoding === 'br') body = brotliDecompressSync(body, options);
              else if (encoding && encoding !== 'identity') throw new Error('Неизвестное сжатие страницы');
              resolve({ body, type: res.headers['content-type'] ?? '' });
            } catch (e) { reject(e); }
          });
        });
        const timer = setTimeout(() => req.destroy(new Error('Таймаут проверки')), 20_000);
        req.on('close', () => clearTimeout(timer));
        req.on('error', reject);
        req.end();
      });
      if (response.location) { current = new URL(response.location, url).href; continue; }
      if (!xml && response.type && !/html|^application\/octet-stream/i.test(response.type)) throw new Error('Ответ не является HTML');
      return { body: response.body, finalUrl: url.href, type: response.type };
    }
    throw new Error('Слишком много редиректов');
  } finally { if (agent) agent.destroy(); }
}

export async function checkBacklink(database: Db, sourceUrl: string, targetUrl: string): Promise<BacklinkResult> {
  const proxy = getConfigValue(database, 'BACKLINK_PROXY_URL');
  try {
    const page = await readPublicDocument(sourceUrl, proxy);
    return inspectHtml(decodePage(page.body, page.type), page.finalUrl, targetUrl);
  } catch (e) {
    // No fallback to direct requests when a configured proxy fails.
    let message = (e as Error).message;
    if (proxy) {
      message = message.split(proxy).join('[прокси]');
      try { const u = new URL(proxy); for (const secret of [u.username, u.password]) if (secret) message = message.split(secret).join('[скрыто]').split(decodeURIComponent(secret)).join('[скрыто]'); } catch { /* bad URL */ }
    }
    return { status: 'error', links: [], finalUrl: sourceUrl, error: message.slice(0, 300) };
  }
}
