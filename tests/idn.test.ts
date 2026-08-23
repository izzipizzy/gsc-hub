import { describe, expect, it } from 'vitest';
import { hostToUnicode } from '$lib/server/idn';
import { defaultBrandFromDomain } from '$lib/server/branded';

// new URL() normalises an international hostname to its ASCII form, so a
// property registered as https://пример.рф/ arrives as xn--e1afmkfd.xn--p1ai —
// a brand term no Russian query will ever contain.
describe('hostToUnicode', () => {
  it.each([
    ['xn--e1afmkfd.xn--p1ai', 'пример.рф'],
    ['xn--espaa-rta.es', 'españa.es'],
    ['xn--mller-kva.de', 'müller.de'],
    ['xn--wgv71a119e.jp', '日本語.jp'],
    // A label that is a mix of ASCII and encoded characters.
    ['xn----itbbjuqhdlic.xn--p1ai', 'пример-тест.рф']
  ])('decodes %s', (ascii, unicode) => {
    expect(hostToUnicode(ascii)).toBe(unicode);
  });

  it.each(['test.com', 'sub.example.co.uk', 'localhost', '127.0.0.1'])(
    'leaves plain host %s untouched',
    (host) => {
      expect(hostToUnicode(host)).toBe(host);
    }
  );

  it('leaves an undecodable label alone rather than throwing', () => {
    expect(hostToUnicode('xn--!!!.com')).toBe('xn--!!!.com');
  });

  it('is idempotent on an already-decoded host', () => {
    expect(hostToUnicode('пример.рф')).toBe('пример.рф');
  });
});

describe('defaultBrandFromDomain with international domains', () => {
  it('derives the same term whichever form the property is registered in', () => {
    // The two spellings are the same site; they must not split differently.
    expect(defaultBrandFromDomain('https://пример.рф/')).toBe('пример');
    expect(defaultBrandFromDomain('sc-domain:пример.рф')).toBe('пример');
  });

  it.each([
    ['https://españa.es/', 'españa'],
    ['https://www.müller.de/', 'müller']
  ])('derives a matchable term from %s', (siteUrl, brand) => {
    expect(defaultBrandFromDomain(siteUrl)).toBe(brand);
  });
});

// A hostname reaches this code from a Google API response or a stored account
// row. Neither is a place to assume well-formed input.
describe('hostToUnicode on hostile input', () => {
  it('refuses a body whose arithmetic overflows, at a length DNS allows', () => {
    // Ten digits is enough to overflow i on the eighth, and the label is well
    // inside the 63-octet limit — so the length bound cannot be what rejects
    // it. Remove the checked arithmetic and this decodes to garbage instead.
    const label = 'xn--' + '9'.repeat(10);
    expect(label.length).toBeLessThanOrEqual(63);
    expect(hostToUnicode(`${label}.com`)).toBe(`${label}.com`);
  });

  it('refuses an over-long label without decoding it', { timeout: 2000 }, () => {
    // This is what keeps the decoder from hanging: driving w to Infinity needs
    // a body of roughly two hundred digits, and adaptBias then divides Infinity
    // by 35 forever. No DNS label is that long, so none is ever decoded.
    const label = 'xn--' + '9'.repeat(400) + 'b';
    expect(label.length).toBeGreaterThan(63);
    expect(hostToUnicode(`${label}.com`)).toBe(`${label}.com`);
  });

  it('leaves an empty ACE label alone instead of decoding it to nothing', () => {
    // "xn--.com" is not a valid hostname label, and silently turning it into
    // ".com" hands the brand derivation a different domain than it was given.
    expect(hostToUnicode('xn--.com')).toBe('xn--.com');
  });

  it('refuses a body that decodes outside the Unicode range', () => {
    const label = 'xn--' + '999999z';
    expect(hostToUnicode(`${label}.com`)).toBe(`${label}.com`);
  });

  it('decodes an uppercase ACE prefix', () => {
    expect(hostToUnicode('XN--E1AFMKFD.xn--p1ai')).toBe('пример.рф');
  });
});

describe('unicode normalisation', () => {
  it('derives a brand term in a single normal form', () => {
    // "é" as e + U+0301 must not produce a term that fails to match the same
    // word typed precomposed.
    const decomposed = 'cafe\u0301.fr';
    expect(defaultBrandFromDomain(`sc-domain:${decomposed}`)).toBe('café'.normalize('NFC'));
  });

  it('decodes a fully-qualified name that carries a trailing dot', () => {
    expect(hostToUnicode('xn--e1afmkfd.xn--p1ai.')).toBe('пример.рф.');
  });
});
