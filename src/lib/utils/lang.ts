// Язык статьи для MagicLinks. Гео из GSC (ESP, FRA, ARG) языком не является,
// и дока сервиса прямо запрещает угадывать: неизвестное лучше спросить.
// Поэтому здесь только подсказка по домену, а выбор всегда за оператором.

export const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'uk', label: 'Українська' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'fi', label: 'Suomi' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'fr-ca', label: 'Français (CA)' },
  { code: 'kk', label: 'Қазақша' }
];

export const LANGUAGE_CODES = new Set(LANGUAGE_OPTIONS.map((l) => l.code));

/** Человеческое название языка по коду: у второго провайдера в API уходят имена, а не коды. */
export function languageLabel(code: string): string {
  return LANGUAGE_OPTIONS.find((l) => l.code === code)?.label ?? '';
}

// Только те TLD, где язык страны однозначен. .com/.net/.org сюда не входят:
// на них с равным успехом живут испанский, португальский и английский сайты.
const TLD_LANGUAGE: Record<string, string> = {
  es: 'es',
  fr: 'fr',
  de: 'de',
  nl: 'nl',
  fi: 'fi',
  gr: 'el',
  ua: 'uk',
  ru: 'ru',
  kz: 'kk',
  pt: 'pt',
  br: 'pt',
  uk: 'en', // .uk это Великобритания, английский; код языка uk это украинский
  us: 'en',
  ca: 'en',
  au: 'en',
  nz: 'en'
};

/** Подсказка по домену, либо '' — тогда оператор выбирает сам. */
export function defaultLanguageForHost(host: string): string {
  const clean = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const parts = clean.split('.');
  if (parts.length < 2) return '';
  // com.br, co.uk и прочие двойные окончания: берём обе последние части.
  const last = parts[parts.length - 1];
  const twoLevel = parts.length > 2 ? `${parts[parts.length - 2]}.${last}` : '';
  if (twoLevel === 'com.br') return 'pt';
  if (twoLevel === 'co.uk' || twoLevel === 'org.uk') return 'en';
  return TLD_LANGUAGE[last] ?? '';
}
