// Interface translation. A message's key is its Russian text; the dictionary
// holds the English one beside it (src/lib/i18n/messages/*). `t()` only accepts
// keys that exist there, so a missing translation fails `pnpm check`.
//
// The current language is module state, set by the root layout from page data
// before anything renders. Server-side rendering is synchronous per request, so
// the value cannot leak between requests mid-render; server code outside
// components (actions, endpoints) uses `tr(locale, …)` with `locals.locale`.
import { DEFAULT_LOCALE, intlTag, type Locale } from './locale';
import { MESSAGES, PLURALS, type MessageKey, type PluralKey } from './messages';

let current = $state<Locale>(DEFAULT_LOCALE);

export function setLocale(locale: Locale): void {
  current = locale;
}
export function getLocale(): Locale {
  return current;
}

type Params = Record<string, string | number>;

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** Text in a given language; for server actions and endpoints. */
export function tr(locale: Locale, key: MessageKey, params?: Params): string {
  return fill(locale === 'ru' ? key : MESSAGES[key], params);
}

/** Text in the current interface language. `{name}` placeholders are filled from params. */
export function t(key: MessageKey, params?: Params): string {
  return tr(current, key, params);
}

/**
 * Text that arrives at runtime (server messages, labels from server modules):
 * translated when the dictionary knows it, shown as is otherwise.
 */
export function tx(text: string | null | undefined, params?: Params): string {
  if (!text) return '';
  if (current === 'ru' || !(text in MESSAGES)) return fill(text, params);
  return fill(MESSAGES[text as MessageKey], params);
}

const rules = { ru: new Intl.PluralRules('ru-RU'), en: new Intl.PluralRules('en-US') };

/** `{n}` with the right plural form: plural('сайт', 5) → «5 сайтов» / «5 sites». */
export function plural(key: PluralKey, n: number, locale: Locale = current): string {
  const forms = PLURALS[key][locale] as Record<string, string>;
  const form = forms[rules[locale].select(n)] ?? forms.other;
  return fill(form, { n: fmtNum(n, locale) });
}

const numFmt = { ru: new Intl.NumberFormat('ru-RU'), en: new Intl.NumberFormat('en-US') };

/** 1 908 852 in Russian, 1,908,852 in English. */
export function fmtNum(n: number, locale: Locale = current): string {
  return numFmt[locale].format(n);
}

/** Percent from a 0..1 ratio with one decimal: 0.2% / 0,2 %. */
export function fmtPct(ratio: number, digits = 1, locale: Locale = current): string {
  return new Intl.NumberFormat(intlTag(locale), { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(ratio);
}

/** Decimal with fixed digits: 15.3 / 15,3. */
export function fmtDec(n: number, digits = 1, locale: Locale = current): string {
  return new Intl.NumberFormat(intlTag(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

/** Compact count for tight spots: 25 тыс. / 25K, 1,9 млн / 1.9M. */
export function fmtCompact(n: number, locale: Locale = current): string {
  return new Intl.NumberFormat(intlTag(locale), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** Short month + day for chart axes: «14 нояб.» / «Nov 14». ISO date in, UTC noon to avoid zone drift. */
export function fmtDay(iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }, locale: Locale = current): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(intlTag(locale), { ...opts, timeZone: 'UTC' });
}
