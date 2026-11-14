// Interface languages and themes. Shared by server and browser code.
export const LOCALES = ['ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ru';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = 'system';

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
export const isTheme = (v: unknown): v is Theme => typeof v === 'string' && (THEMES as readonly string[]).includes(v);

/** First supported language in an Accept-Language header, or the default. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  for (const part of (header ?? '').split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase().slice(0, 2);
    if (isLocale(tag)) return tag;
  }
  return DEFAULT_LOCALE;
}

/** Intl locale tag for number and date formatting. */
export const intlTag = (l: Locale) => (l === 'ru' ? 'ru-RU' : 'en-US');
