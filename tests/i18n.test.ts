import { describe, it, expect } from 'vitest';
import { tr, plural, fmtNum, setLocale, t, tx } from '../src/lib/i18n/index.svelte';
import { MESSAGES } from '../src/lib/i18n/messages';
import { localeFromAcceptLanguage } from '../src/lib/i18n/locale';

describe('i18n', () => {
  it('returns the Russian key or its English text', () => {
    expect(tr('ru', 'Сайты')).toBe('Сайты');
    expect(tr('en', 'Сайты')).toBe('Sites');
  });

  it('fills placeholders in both languages', () => {
    expect(tr('en', 'Открыть {name}', { name: 'XML River' })).toBe('Open XML River');
    expect(tr('ru', 'Открыть {name}', { name: 'XML River' })).toBe('Открыть XML River');
  });

  it('picks Russian and English plural forms', () => {
    expect(plural('сайт', 1, 'ru')).toBe('1 сайт');
    expect(plural('сайт', 3, 'ru')).toBe('3 сайта');
    expect(plural('сайт', 82, 'ru')).toBe('82 сайта');
    expect(plural('сайт', 5, 'ru')).toBe('5 сайтов');
    expect(plural('сайт', 1, 'en')).toBe('1 site');
    expect(plural('сайт', 5, 'en')).toBe('5 sites');
  });

  it('groups thousands by language', () => {
    expect(fmtNum(1908852, 'en')).toBe('1,908,852');
    expect(fmtNum(1908852, 'ru').replace(/\s/g, ' ')).toBe('1 908 852');
  });

  it('t() follows the current language; tx() passes unknown text through', () => {
    setLocale('en');
    expect(t('Профиль')).toBe('Profile');
    expect(tx('Неизвестный сервис')).toBe('Unknown service');
    expect(tx('upstream said no')).toBe('upstream said no');
    setLocale('ru');
    expect(t('Профиль')).toBe('Профиль');
  });

  it('has an English text for every message', () => {
    const empty = Object.entries(MESSAGES).filter(([, en]) => !en.trim()).map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('reads Accept-Language', () => {
    expect(localeFromAcceptLanguage('en-US,en;q=0.9,ru;q=0.8')).toBe('en');
    expect(localeFromAcceptLanguage('de-DE,ru;q=0.5')).toBe('ru');
    expect(localeFromAcceptLanguage(null)).toBe('ru');
  });
});
