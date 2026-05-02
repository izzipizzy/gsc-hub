import { describe, it, expect } from 'vitest';
import { extractLocs, isSitemapIndex } from '../src/lib/server/sitemap';

describe('sitemap', () => {
  it('extractLocs pulls all <loc> values, trimming whitespace', () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://a.com/</loc></url>
        <url><loc>  https://a.com/post-1  </loc><lastmod>2026-04-01</lastmod></url>
        <url><loc>https://a.com/post-2</loc></url>
      </urlset>`;
    expect(extractLocs(xml)).toEqual([
      'https://a.com/',
      'https://a.com/post-1',
      'https://a.com/post-2'
    ]);
  });

  it('isSitemapIndex detects index documents', () => {
    expect(isSitemapIndex('<?xml ?><sitemapindex xmlns="..."></sitemapindex>')).toBe(true);
    expect(isSitemapIndex('<urlset></urlset>')).toBe(false);
  });
});
