// Plural forms. Russian needs one/few/many(/other), English one/other.
type Forms = { ru: { one: string; few: string; many: string; other: string }; en: { one: string; other: string } };

export const plurals = {
  'сайт': { ru: { one: '{n} сайт', few: '{n} сайта', many: '{n} сайтов', other: '{n} сайта' }, en: { one: '{n} site', other: '{n} sites' } },
  'день': { ru: { one: '{n} день', few: '{n} дня', many: '{n} дней', other: '{n} дня' }, en: { one: '{n} day', other: '{n} days' } },
  'событие': { ru: { one: '{n} событие', few: '{n} события', many: '{n} событий', other: '{n} события' }, en: { one: '{n} event', other: '{n} events' } },
  'ошибка чтения': { ru: { one: '{n} ошибка чтения', few: '{n} ошибки чтения', many: '{n} ошибок чтения', other: '{n} ошибки чтения' }, en: { one: '{n} read error', other: '{n} read errors' } },
  'запрос': { ru: { one: '{n} запрос', few: '{n} запроса', many: '{n} запросов', other: '{n} запроса' }, en: { one: '{n} query', other: '{n} queries' } },
  'URL': { ru: { one: '{n} URL', few: '{n} URL', many: '{n} URL', other: '{n} URL' }, en: { one: '{n} URL', other: '{n} URLs' } },
  'строка': { ru: { one: '{n} строка', few: '{n} строки', many: '{n} строк', other: '{n} строки' }, en: { one: '{n} row', other: '{n} rows' } },
  'аккаунт': { ru: { one: '{n} аккаунт', few: '{n} аккаунта', many: '{n} аккаунтов', other: '{n} аккаунта' }, en: { one: '{n} account', other: '{n} accounts' } }
} satisfies Record<string, Forms>;
