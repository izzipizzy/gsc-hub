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

// A brand term is matched as a substring against every query, so a wrong one is
// not cosmetic — these hosts each have a plausible-but-useless answer.
describe('defaultBrandFromDomain edge cases', () => {
  it.each([
    ['sc-domain:user.github.io', 'user'],
    ['https://name.blogspot.com/', 'name']
  ])('uses the label below a private suffix for %s', (siteUrl, expectedBrand) => {
    expect(defaultBrandFromDomain(siteUrl)).toBe(expectedBrand);
  });

  it.each([
    ['https://192.168.1.20/', '192.168.1.20'],
    ['sc-domain:203.0.113.9', '203.0.113.9']
  ])('keeps an IP host whole rather than picking an octet for %s', (siteUrl, expectedBrand) => {
    expect(defaultBrandFromDomain(siteUrl)).toBe(expectedBrand);
  });
});
