import { describe, expect, it } from 'vitest';
import { defaultBrandFromDomain } from '../src/lib/server/branded';

describe('defaultBrandFromDomain', () => {
  it.each([
    ['https://www.example.com/', 'example'],
    ['https://example.co.uk/', 'example'],
    ['sc-domain:store.example.com.au', 'example']
  ])('uses the registrable label for %s', (siteUrl, expectedBrand) => {
    expect(defaultBrandFromDomain(siteUrl)).toBe(expectedBrand);
  });

  it('keeps a host without a public suffix usable as a fallback', () => {
    expect(defaultBrandFromDomain('sc-domain:internal')).toBe('internal');
  });
});
