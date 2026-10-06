import { Parser } from 'htmlparser2';
import ipaddr from 'ipaddr.js';

export interface FoundLink { url: string; anchor: string; rel: string }
export interface BacklinkResult {
  status: 'found' | 'missing' | 'wrong_url' | 'error';
  links: FoundLink[];
  finalUrl: string;
  error: string | null;
}
const normalizeAnchor = (s: string) => s.replace(/\s+/g, ' ').trim();
export function comparableUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  return u.href;
}

// Same extraction rules as izzipizzy/backlink-finder: relative URLs, <base>,
// image alt text and rel; compare the purchased page as well as its domain.
export function inspectHtml(html: string, finalUrl: string, targetUrl: string): BacklinkResult {
  const links: { href: string; anchor: string; rel: string }[] = [];
  let current: (typeof links)[number] | null = null;
  let base: string | null = null;
  let skip = 0;
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (tag === 'script' || tag === 'style') { skip++; return; }
      if (skip) return;
      if (tag === 'base' && base === null && attrs.href?.trim()) base = attrs.href.trim();
      if (tag === 'a') {
        current = attrs.href?.trim() ? { href: attrs.href.trim(), anchor: '', rel: attrs.rel ?? '' } : null;
        if (current) links.push(current);
      }
      if (tag === 'img' && current && attrs.alt) current.anchor += ' ' + attrs.alt;
      if (tag === 'br' && current) current.anchor += ' ';
    },
    ontext(text) { if (current && !skip) current.anchor += text; },
    onclosetag(tag) {
      if (tag === 'script' || tag === 'style') skip = Math.max(0, skip - 1);
      if (tag === 'a') current = null;
    }
  });
  parser.end(html);
  let resolvedBase = finalUrl;
  try { if (base) resolvedBase = new URL(base, finalUrl).href; } catch { /* invalid base */ }
  const target = new URL(targetUrl);
  const host = target.hostname.toLowerCase().replace(/^www\./, '');
  const matches: FoundLink[] = [];
  for (const link of links) {
    try {
      if (link.href.startsWith('#')) continue;
      const url = new URL(link.href, resolvedBase);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      const h = url.hostname.toLowerCase().replace(/^www\./, '');
      if (h !== host && !h.endsWith('.' + host)) continue;
      const found = { url: url.href, anchor: normalizeAnchor(link.anchor).slice(0, 300), rel: normalizeAnchor(link.rel).toLowerCase() };
      if (!matches.some((m) => m.url === found.url && m.anchor === found.anchor && m.rel === found.rel)) matches.push(found);
    } catch { /* invalid href */ }
  }
  const exact = matches.filter((l) => comparableUrl(l.url) === comparableUrl(targetUrl));
  if (exact.length) return { status: 'found', links: exact, finalUrl, error: null };
  // A challenge page isn't evidence of a missing link.
  if (/cf-chl-|challenge-platform|g-recaptcha|hcaptcha|<title[^>]*>\s*(just a moment|access denied|checking your browser)/i.test(html)) {
    return { status: 'error', links: [], finalUrl, error: 'Капча или защита от ботов' };
  }
  return { status: matches.length ? 'wrong_url' : 'missing', links: matches, finalUrl, error: null };
}

export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

export function validateSourceUrl(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) {
    throw new Error('Недопустимый адрес публикации');
  }
  if ((!ipaddr.isValid(host) && (!host.includes('.') || host === 'localhost' || /\.(localhost|local|internal)$/.test(host))) || (ipaddr.isValid(host) && !isPublicAddress(host))) {
    throw new Error('Адрес публикации не является публичным');
  }
  return url;
}

export function decodePage(body: Buffer, type: string): string {
  if (body[0] === 0xff && body[1] === 0xfe) return new TextDecoder('utf-16le').decode(body);
  if (body[0] === 0xfe && body[1] === 0xff) return new TextDecoder('utf-16be').decode(body);
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return new TextDecoder('utf-8').decode(body);
  const prefix = body.subarray(0, 4096).toString('latin1');
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(type)?.[1]
    ?? /<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i.exec(prefix)?.[1];
  try { return new TextDecoder(charset ?? 'utf-8', { fatal: !charset }).decode(body); }
  catch { return new TextDecoder('windows-1252').decode(body); }
}

