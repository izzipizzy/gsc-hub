import { describe, it, expect } from 'vitest';
import { alpha2ToAlpha3, alpha3ToAlpha2 } from '../src/lib/utils/country';

describe('country codes', () => {
  it('maps alpha-3 to alpha-2', () => {
    expect(alpha3ToAlpha2('esp')).toBe('ES');
    expect(alpha3ToAlpha2('ARG')).toBe('AR');
  });

  it('maps alpha-2 back to alpha-3', () => {
    expect(alpha2ToAlpha3('es')).toBe('esp');
    expect(alpha2ToAlpha3('AR')).toBe('arg');
    expect(alpha2ToAlpha3('mx')).toBe('mex');
  });

  it('returns null for unknown codes instead of guessing', () => {
    expect(alpha2ToAlpha3('zz')).toBeNull();
    expect(alpha3ToAlpha2('zzz')).toBeNull();
    expect(alpha2ToAlpha3('')).toBeNull();
  });
});
