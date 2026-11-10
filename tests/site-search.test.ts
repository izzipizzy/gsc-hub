import { describe, expect, it } from 'vitest';
import { matchesSiteDomain } from '../src/lib/utils/site';

const properties = [
  'sc-domain:Alpha.com',
  'https://beta.com/docs/',
  'http://gamma.org/',
  'https://example.net/.com/'
];

describe('domain search shared by Dashboard and All sites', () => {
  it.each([
    ['.com', properties.slice(0, 2)],
    [' ALPHA.COM ', [properties[0]]],
    ['BeTa.CoM', [properties[1]]],
    ['', properties],
    ['   ', properties],
    ['missing.example', []]
  ])('filters %j across GSC property formats', (query, expected) => {
    expect(properties.filter((site) => matchesSiteDomain(site, query))).toEqual(expected);
  });
});
