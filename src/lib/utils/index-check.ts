export const INDEX_CHECK_PROVIDERS = { xmlriver: 'XML River', dataforseo: 'DataForSEO' } as const;
export const INDEX_CHECK_SERVICE_LINKS = {
  xmlriver: { homepage: 'https://xmlriver.com/', docs: 'https://xmlriver.com/apidoc/api-about/' },
  dataforseo: { homepage: 'https://dataforseo.com/?aff=59fe7533-1014-4ec3-8a94-86f64d49cd8f', docs: 'https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/' }
} as const;
export type IndexCheckProvider = keyof typeof INDEX_CHECK_PROVIDERS;
export type IndexCheckError = 'auth' | 'quota' | 'rate_limit' | 'network' | 'provider' | 'invalid_url' | 'cancelled' | 'interrupted' | 'storage' | 'timeout';
export type IndexCheckStatus = 'pending' | 'checking' | 'found' | 'not_found' | 'error' | 'skipped' | 'retrying';
export type IndexCheckState = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
export interface IndexCheckRow {
  url: string;
  status: IndexCheckStatus;
  checkedAt: number | null;
  attempts?: number;
  nextAttemptAt?: number;
  attemptStartedAt?: number;
  matchedUrl?: string;
  errorCode?: IndexCheckError;
  message?: string;
}
export interface IndexCheckOptions { concurrency: number; retries: number; retryDelayMinutes: number }
export interface IndexCheckRun {
  id: string;
  accountId: string;
  site: string;
  provider: IndexCheckProvider;
  engine: 'google';
  state: IndexCheckState;
  startedAt: number;
  finishedAt: number | null;
  rows: IndexCheckRow[];
  batchId?: string;
  batchPosition?: number;
  options?: IndexCheckOptions;
  stopReason?: string;
  persistenceError?: string;
}
export interface IndexCheckDraft {
  id: string;
  site: string;
  accountId: string;
  sitemaps: string[];
  urls: string[];
  warnings: string[];
  createdAt: number;
}
export const INDEX_CHECK_STATUS: Record<IndexCheckStatus, string> = {
  pending: 'Ожидает', checking: 'Проверяется', found: 'Найден в Google',
  not_found: 'Не найден по запросу', retrying: 'Ожидает повтора', error: 'Ошибка проверки', skipped: 'Не проверен'
};
export function indexCheckCounts(rows: IndexCheckRow[]) {
  const counts = { total: rows.length, found: 0, not_found: 0, error: 0, pending: 0, checking: 0, skipped: 0, retrying: 0 };
  for (const row of rows) counts[row.status]++;
  return { ...counts, completed: counts.found + counts.not_found + counts.error };
}
export function isIndexCheckProvider(value: unknown): value is IndexCheckProvider {
  return value === 'xmlriver' || value === 'dataforseo';
}

export interface IndexCheckHistoryEntry {
  batchId?: string;
  batchPosition?: number;
  id: string;
  accountId: string;
  site: string;
  provider: IndexCheckProvider;
  engine: 'google';
  state: IndexCheckState;
  startedAt: number;
  finishedAt: number | null;
  totalUrls: number;
  checkedUrls: number;
  foundCount: number | null;
  errorCount: number;
  skippedCount: number;
}
export interface IndexCheckHistoryPage {
  entries: IndexCheckHistoryEntry[];
  total: number;
  offset: number;
  limit: number;
}

export interface IndexCheckBatch {
  id: string;
  provider: IndexCheckProvider;
  state: IndexCheckState;
  runs: IndexCheckHistoryEntry[];
  totalUrls: number;
  checkedUrls: number;
  foundCount: number | null;
  finishedSites: number;
  activeRunId: string | null;
}
