// Interface preferences per user: language and theme. The only module with SQL
// on user_prefs. Keyed by user id, so the passwordless local admin
// ('local-admin', no users row) keeps its choice too.
import type { Db } from './db';
import { DEFAULT_THEME, isLocale, isTheme, type Locale, type Theme } from '$lib/i18n/locale';

export interface UiPrefs { locale: Locale | null; theme: Theme }

export function getUiPrefs(db: Db, userId: string): UiPrefs {
  const row = db.prepare('SELECT locale, theme FROM user_prefs WHERE user_id = ?').get(userId) as
    | { locale: string | null; theme: string | null } | undefined;
  return {
    locale: isLocale(row?.locale) ? row!.locale as Locale : null,
    theme: isTheme(row?.theme) ? row!.theme as Theme : DEFAULT_THEME
  };
}

export function setUiPrefs(db: Db, userId: string, prefs: { locale?: Locale; theme?: Theme }): void {
  const current = getUiPrefs(db, userId);
  db.prepare(
    `INSERT INTO user_prefs (user_id, locale, theme, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET locale = excluded.locale, theme = excluded.theme, updated_at = excluded.updated_at`
  ).run(userId, prefs.locale ?? current.locale, prefs.theme ?? current.theme, Date.now());
}
