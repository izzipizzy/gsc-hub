import { afterEach, it, expect, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../src/lib/server/backlink-fetch', () => ({ readPublicDocument: read }));
import { readIndexDocument } from '../src/lib/server/index-check-sitemap';
afterEach(() => vi.clearAllMocks());
it('uses the existing safe public-document loader and decodes gzipped sitemap files', async () => {
  const xml='<urlset><url><loc>https://example.com/a</loc></url></urlset>';
  read.mockResolvedValue({body:gzipSync(xml),finalUrl:'https://example.com/sitemap.xml.gz',type:'application/gzip'});
  expect(await readIndexDocument('https://example.com/sitemap.xml.gz','sc-domain:example.com')).toBe(xml);
  expect(read).toHaveBeenCalledWith('https://example.com/sitemap.xml.gz',undefined,true);
});
it('validates the final redirect destination and refuses foreign hosts', async () => {
  read.mockResolvedValue({body:Buffer.from('<urlset/>'),finalUrl:'https://foreign.example/sitemap.xml',type:'application/xml'});
  await expect(readIndexDocument('https://example.com/sitemap.xml','sc-domain:example.com')).rejects.toThrow();
});
it('bounds decompressed gzip output as well as network input', async () => {
  read.mockResolvedValue({body:gzipSync('a'.repeat(4*1024*1024+1)),finalUrl:'https://example.com/sitemap.xml.gz',type:'application/gzip'});
  await expect(readIndexDocument('https://example.com/sitemap.xml.gz','sc-domain:example.com')).rejects.toThrow();
});
