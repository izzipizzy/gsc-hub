import { Parser } from 'htmlparser2';
import type { Db } from './db';
import { configSource, getConfigValue, setConfigValue, clearConfigValue, type ConfigKey } from './config';
import { indexCheckOptionSettings } from './index-check-options';
import type { IndexCheckProvider, IndexCheckError } from '$lib/utils/index-check';

export const PROVIDER_FIELDS = {
  xmlriver: [
    { key: 'XMLRIVER_USER', label: 'User ID XML River' },
    { key: 'XMLRIVER_KEY', label: 'API-ключ XML River' }
  ],
  dataforseo: [
    { key: 'DATAFORSEO_LOGIN', label: 'API Login DataForSEO' },
    { key: 'DATAFORSEO_PASSWORD', label: 'API Password DataForSEO' }
  ]
} as const;
export function indexCheckSettings(database: Db) {
  return (['xmlriver', 'dataforseo'] as const).map((id) => {
    const fields = PROVIDER_FIELDS[id].map((f) => ({ ...f, configured: !!getConfigValue(database, f.key), source: configSource(database, f.key) }));
    return { id, options: indexCheckOptionSettings(database, id), configured: fields.every((f) => f.configured), fields };
  });
}
export function saveIndexCheckSettings(database: Db, provider: IndexCheckProvider, values: Record<string, unknown>) {
  const edits: [ConfigKey, string][] = [];
  for (const field of PROVIDER_FIELDS[provider]) {
    const raw = values[field.key];
    if (raw !== undefined && typeof raw !== 'string') throw new Error('Некорректные настройки');
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) {
      if (!getConfigValue(database, field.key)) throw new Error(`Заполни ${field.label}`);
      continue; // Blank fields preserve configured credentials; secrets never round-trip.
    }
    if (configSource(database, field.key) === 'env') throw new Error(`${field.label} задан в окружении сервера`);
    if (value.length > 512 || /\s/.test(value) || (field.key === 'XMLRIVER_USER' && !/^\d+$/.test(value)) || (field.key === 'DATAFORSEO_LOGIN' && value.includes(':'))) {
      throw new Error(`Проверь ${field.label}: недопустимый формат`);
    }
    edits.push([field.key, value]);
  }
  database.transaction(() => { for (const [key, value] of edits) setConfigValue(database, key, value); })();
}
export function clearIndexCheckSettings(database: Db, provider: IndexCheckProvider) {
  database.transaction(() => {
    for (const field of PROVIDER_FIELDS[provider]) clearConfigValue(database, field.key);
  })(); // Environment values remain in force, as in other integration settings.
}
export interface IndexCheckCredentials { provider: IndexCheckProvider; login: string; secret: string }
export function indexCheckCredentials(database: Db, provider: IndexCheckProvider): IndexCheckCredentials {
  const [first, second] = PROVIDER_FIELDS[provider];
  const login = getConfigValue(database, first.key), secret = getConfigValue(database, second.key);
  if (!login || !secret) throw new Error('Настрой выбранный сервис в разделе «Индексаторы»');
  return { provider, login, secret };
}
export class IndexProviderError extends Error {
  constructor(public code: IndexCheckError, message: string, public retryable = ['network', 'timeout', 'rate_limit'].includes(code), public retryAfterMs = 0) { super(message); }
}
export interface IndexCheckOutcome { status: 'found' | 'not_found'; matchedUrl?: string }
function comparableUrl(raw: string): string | null {
  try { const u = new URL(raw); if (!['http:', 'https:'].includes(u.protocol)) return null; u.hash = ''; return u.href; }
  catch { return null; }
}
function matchResult(url: string, urls: string[]): IndexCheckOutcome {
  const target = comparableUrl(url);
  const matchedUrl = urls.find((candidate) => target !== null && comparableUrl(candidate) === target);
  return matchedUrl ? { status: 'found', matchedUrl } : { status: 'not_found' };
}
function xmlError(code: string): IndexProviderError {
  if (['31', '42', '45'].includes(code)) return new IndexProviderError('auth', 'XML River: проверь User ID, API-ключ и доступ с IP сервера');
  if (code === '200') return new IndexProviderError('quota', 'XML River: недостаточно средств');
  if (['110', '111', '115'].includes(code)) return new IndexProviderError('rate_limit', `XML River: ${code === '111' ? 'сейчас нет свободного канала сервиса' : code === '110' ? 'заняты все каналы аккаунта; уменьши число потоков' : 'временная блокировка из-за превышения потоков'} (код ${code})`, true, code === '115' ? 600_000 : 0);
  return new IndexProviderError('provider', `XML River: ошибка сервиса (код ${/^\d+$/.test(code) ? code : 'неизвестен'})`, ['20', '21', '22', '23', '24', '101', '500'].includes(code));
}
export function parseXmlRiver(xml: string, url: string): IndexCheckOutcome {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new IndexProviderError('provider', 'XML River: некорректный XML');
  const stack: string[] = [], urls: string[] = [];
  let errorCode = '', text = '', response = false, results = false, invalid = false;
  const parser = new Parser({
    onopentag(name, attrs) {
      stack.push(name);
      if (stack.join('/') === 'yandexsearch/response') response = true;
      if (stack.join('/') === 'yandexsearch/response/results') results = true;
      if (stack.join('/') === 'yandexsearch/response/error') errorCode = attrs.code || 'unknown';
      text = '';
    },
    ontext(value) { text += value; },
    onclosetag(name, implied) {
      const path = stack.join('/');
      if (implied || stack.pop() !== name) invalid = true;
      if (path === 'yandexsearch/response/results/grouping/group/doc/url') urls.push(text.trim());
      text = '';
    }
  }, { xmlMode: true, decodeEntities: true });
  parser.end(xml);
  if (invalid || !response || !xml.includes('</yandexsearch>')) throw new IndexProviderError('provider', 'XML River: получен неполный или неизвестный ответ');
  if (errorCode === '15') return { status: 'not_found' };
  if (errorCode) throw xmlError(errorCode);
  if (!results) throw new IndexProviderError('provider', 'XML River: в ответе нет результатов проверки');
  return matchResult(url, urls);
}
function dfsError(code: number): IndexProviderError {
  if ([40100, 40104, 40201, 40204, 40207, 40208].includes(code)) return new IndexProviderError('auth', 'DataForSEO: проверь API-доступ, Login, Password и ограничения аккаунта');
  if ([40200, 40203, 40210].includes(code)) return new IndexProviderError('quota', 'DataForSEO: недостаточно средств или исчерпан лимит расходов');
  if ([40202, 40205, 40206, 40209].includes(code)) return new IndexProviderError('rate_limit', 'DataForSEO: достигнут лимит запросов или повторов');
  return new IndexProviderError('provider', `DataForSEO: ошибка сервиса (код ${Number.isInteger(code) ? code : 'неизвестен'})`, code >= 50000 && code < 60000);
}
export function parseDataForSeo(data: any, url: string): IndexCheckOutcome {
  if (data?.status_code !== 20000) throw dfsError(Number(data?.status_code));
  const task = Array.isArray(data.tasks) && data.tasks.length === 1 ? data.tasks[0] : null;
  if (!task) throw new IndexProviderError('provider', 'DataForSEO: отсутствует результат задачи');
  if (task.status_code === 40102) return { status: 'not_found' };
  if (![20000, 40106].includes(task.status_code)) throw dfsError(Number(task.status_code));
  const result = task.result?.[0];
  if (!result || (!Array.isArray(result.items) && !(result.items === null && result.items_count === 0))) {
    throw new IndexProviderError('provider', 'DataForSEO: неполный ответ задачи');
  }
  const outcome = matchResult(url, (result.items ?? []).filter((item: any) => item?.type === 'organic' && typeof item.url === 'string').map((item: any) => item.url));
  if (outcome.status === 'not_found' && (task.status_code === 40106 || result.spell)) {
    throw new IndexProviderError('provider', 'DataForSEO: неполная выдача или поисковик изменил запрос; результат неизвестен');
  }
  return outcome;
}
async function readResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new IndexProviderError('provider', 'Сервис вернул пустой ответ');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new IndexProviderError('provider', 'Слишком большой ответ сервиса');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
export async function checkIndexUrl(credentials: IndexCheckCredentials, url: string, signal?: AbortSignal): Promise<IndexCheckOutcome> {
  const signals = [AbortSignal.timeout(65_000), ...(signal ? [signal] : [])];
  const options: RequestInit = { signal: AbortSignal.any(signals), redirect: 'error' };
  let endpoint: string;
  if (credentials.provider === 'xmlriver') {
    if (url.length > 1400) throw new IndexProviderError('invalid_url', 'XML River: URL длиннее 1400 символов');
    const params = new URLSearchParams({ user: credentials.login, key: credentials.secret, query: url, inindex: '1', strict: '1', page: '1', groupby: '10' });
    endpoint = `https://xmlriver.com/search/xml?${params}`;
  } else {
    const keyword = `site:${url}`.replace(/%/g, '%25').replace(/\+/g, '%2B');
    if (keyword.length > 700) throw new IndexProviderError('invalid_url', 'DataForSEO: поисковый запрос длиннее 700 символов');
    endpoint = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';
    options.method = 'POST';
    options.headers = { Authorization: `Basic ${Buffer.from(`${credentials.login}:${credentials.secret}`).toString('base64')}`, 'Content-Type': 'application/json' };
    options.body = JSON.stringify([{ keyword, location_code: 2840, language_code: 'en', device: 'desktop', depth: 10 }]);
  }
  try {
    const response = await fetch(endpoint, options);
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new IndexProviderError('auth', 'Сервис отклонил авторизацию или доступ с IP сервера');
      if (response.status === 402) throw new IndexProviderError('quota', 'Сервис: недостаточно средств');
      if (response.status === 429) {
        const raw = response.headers.get('retry-after'), seconds = raw ? Number(raw) : NaN;
        const retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : raw ? Date.parse(raw) - Date.now() : 0;
        throw new IndexProviderError('rate_limit', 'Сервис: превышен лимит запросов', true, Math.min(3_600_000, Math.max(0, retryAfterMs || 0)));
      }
      throw new IndexProviderError('provider', `Сервис вернул HTTP ${response.status}`, response.status >= 500);
    }
    const body = await readResponse(response);
    if (credentials.provider === 'xmlriver') return parseXmlRiver(body, url);
    let data: unknown;
    try { data = JSON.parse(body); } catch { throw new IndexProviderError('provider', 'DataForSEO: ответ не является JSON'); }
    return parseDataForSeo(data, url);
  } catch (e) {
    if (e instanceof IndexProviderError) throw e;
    if (signal?.aborted) throw new IndexProviderError('cancelled', 'Отправленный запрос прерван; результат неизвестен');
    if (options.signal?.aborted) throw new IndexProviderError('timeout', 'Сервис не ответил за 65 секунд; результат и списание неизвестны');
    // Never echo fetch errors: XML River credentials are carried in its query string.
    throw new IndexProviderError('network', 'Не удалось получить ответ сервиса; автоматического повтора платного запроса нет');
  }
}
