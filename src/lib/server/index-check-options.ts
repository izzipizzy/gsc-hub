import type { Db } from './db';
import { configSource, getConfigValue, setConfigValue, type ConfigKey } from './config';
import type { IndexCheckOptions, IndexCheckProvider } from '$lib/utils/index-check';

export function indexCheckOptionFields(provider: IndexCheckProvider) {
  const prefix = provider === 'xmlriver' ? 'XMLRIVER' : 'DATAFORSEO';
  return [
    ...(provider === 'xmlriver' ? [{ key: 'XMLRIVER_THREADS' as ConfigKey, option: 'concurrency' as const, label: 'Потоки', min: 1, max: 10, fallback: 10 }] : []),
    { key: `${prefix}_RETRIES` as ConfigKey, option: 'retries' as const, label: 'Повторы после ошибки', min: 0, max: 10, fallback: 3 },
    { key: `${prefix}_RETRY_DELAY_MINUTES` as ConfigKey, option: 'retryDelayMinutes' as const, label: 'Пауза между повторами, мин', min: 1, max: 60, fallback: 3 }
  ];
}
function parse(field: ReturnType<typeof indexCheckOptionFields>[number], value: unknown) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(number) || number < field.min || number > field.max) throw new Error(`${field.label}: укажи целое число от ${field.min} до ${field.max}`);
  return number;
}
export function indexCheckOptions(database: Db, provider: IndexCheckProvider): IndexCheckOptions {
  const options: IndexCheckOptions = { concurrency: provider === 'xmlriver' ? 10 : 1, retries: 3, retryDelayMinutes: 3 };
  for (const field of indexCheckOptionFields(provider)) {
    const raw = getConfigValue(database, field.key);
    options[field.option] = raw === undefined ? field.fallback : parse(field, raw);
  }
  return options;
}
export function indexCheckOptionSettings(database: Db, provider: IndexCheckProvider) {
  const options = indexCheckOptions(database, provider);
  return indexCheckOptionFields(provider).map((field) => ({ ...field, value: options[field.option], source: configSource(database, field.key) }));
}
export function saveIndexCheckOptions(database: Db, provider: IndexCheckProvider, values: Record<string, unknown>) {
  const edits: [ConfigKey, string][] = [];
  for (const field of indexCheckOptionFields(provider)) {
    if (values[field.key] === undefined) continue;
    const value = parse(field, values[field.key]);
    if (configSource(database, field.key) === 'env') throw new Error(`${field.label}: значение задано в окружении сервера`);
    edits.push([field.key, String(value)]);
  }
  database.transaction(() => { for (const [key, value] of edits) setConfigValue(database, key, value); })();
}
