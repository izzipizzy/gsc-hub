import type { Db } from './db';
import { indexCheckCounts, isIndexCheckProvider, type IndexCheckRun, type IndexCheckRow,
  type IndexCheckHistoryEntry, type IndexCheckHistoryPage, type IndexCheckBatch } from '$lib/utils/index-check';

const META = `id, account_id AS accountId, site, provider, engine, state,
  started_at AS startedAt, finished_at AS finishedAt`;
const SUMMARY = `${META}, total_urls AS totalUrls, checked_urls AS checkedUrls,
  found_count AS foundCount, error_count AS errorCount, skipped_count AS skippedCount`;
function validate(run: IndexCheckRun) {
  if (run.engine !== 'google' || !isIndexCheckProvider(run.provider)) throw new Error('История поддерживает только проверки Google');
}
function assertIdentity(database: Db, run: IndexCheckRun) {
  const before = database.prepare(`SELECT ${META} FROM index_check_runs WHERE id = ?`).get(run.id) as Omit<IndexCheckRun, 'rows'> | undefined;
  if (before && (before.accountId !== run.accountId || before.site !== run.site || before.provider !== run.provider || before.startedAt !== run.startedAt)) {
    throw new Error('Идентификатор проверки уже используется');
  }
  return before;
}
function writeHeader(database: Db, run: IndexCheckRun) {
  const c = indexCheckCounts(run.rows), checked = c.found + c.not_found;
  database.prepare(`INSERT INTO index_check_runs
    (id, account_id, site, provider, engine, state, started_at, finished_at, total_urls, checked_urls, found_count, error_count, skipped_count, options_json, stop_reason, batch_id, batch_position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET state=excluded.state, finished_at=excluded.finished_at,
      total_urls=excluded.total_urls, checked_urls=excluded.checked_urls, found_count=excluded.found_count,
      error_count=excluded.error_count, skipped_count=excluded.skipped_count, stop_reason=excluded.stop_reason`)
    .run(run.id, run.accountId, run.site, run.provider, run.engine, run.state, run.startedAt, run.finishedAt,
      c.total, checked, checked > 0 ? c.found : null, c.error, c.skipped, run.options ? JSON.stringify({ concurrency: run.options.concurrency, retries: run.options.retries, retryDelayMinutes: run.options.retryDelayMinutes }) : null, run.stopReason ?? null, run.batchId ?? null, run.batchPosition ?? null);
}
const WRITE_ROW = `INSERT INTO index_check_results (run_id, position, url, status, checked_at, matched_url, error_code, message, attempts, next_attempt_at, attempt_started_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(run_id, position) DO UPDATE SET status=excluded.status, checked_at=excluded.checked_at,
    matched_url=excluded.matched_url, error_code=excluded.error_code, message=excluded.message, attempts=excluded.attempts,
    next_attempt_at=excluded.next_attempt_at, attempt_started_at=excluded.attempt_started_at
  WHERE status IS NOT excluded.status OR checked_at IS NOT excluded.checked_at OR matched_url IS NOT excluded.matched_url
    OR error_code IS NOT excluded.error_code OR message IS NOT excluded.message
    OR attempts IS NOT excluded.attempts OR next_attempt_at IS NOT excluded.next_attempt_at OR attempt_started_at IS NOT excluded.attempt_started_at`;
function values(id: string, position: number, row: IndexCheckRow) {
  return [id, position, row.url, row.status, row.checkedAt, row.matchedUrl ?? null, row.errorCode ?? null, row.message ?? null, row.attempts ?? 0, row.nextAttemptAt ?? null, row.attemptStartedAt ?? null];
}
function snapshot(run: IndexCheckRun) {
  return { id: run.id, accountId: run.accountId, site: run.site, provider: run.provider, engine: run.engine,
    state: run.state, batchId: run.batchId, batchPosition: run.batchPosition, startedAt: run.startedAt, finishedAt: run.finishedAt, options: run.options, stopReason: run.stopReason,
    rows: run.rows.map((r, i) => values(run.id, i, r)) };
}
/** Explicit columns whitelist snapshot data: no API credentials or caller extras. */
export function saveIndexCheckRun(database: Db, run: IndexCheckRun): void {
  validate(run);
  database.transaction(() => {
    const before = assertIdentity(database, run);
    if (before?.state !== undefined && !['running', 'queued'].includes(before.state)) {
      const previous = getSavedIndexCheckRun(database, run.id)!;
      // Only exact idempotent repeats are permitted after completion.
      if (JSON.stringify(snapshot(previous)) !== JSON.stringify(snapshot(run))) throw new Error('Завершённая запись истории неизменяема');
      return;
    }
    writeHeader(database, run);
    const statement = database.prepare(WRITE_ROW);
    run.rows.forEach((row, position) => statement.run(...values(run.id, position, row)));
  })();
}
/** Journal only the changed URL; do not rewrite thousands of rows per request. */
export function saveIndexCheckProgress(database: Db, run: IndexCheckRun, position: number): void {
  validate(run);
  database.transaction(() => {
    if (assertIdentity(database, run)?.state !== 'running') throw new Error('Активная запись истории недоступна');
    writeHeader(database, run);
    database.prepare(WRITE_ROW).run(...values(run.id, position, run.rows[position]));
  })();
}
export function getSavedIndexCheckRun(database: Db, id: string): IndexCheckRun | null {
  const record = database.prepare(`SELECT ${META}, options_json AS optionsJson, stop_reason AS stopReason, batch_id AS batchId, batch_position AS batchPosition FROM index_check_runs WHERE id = ?`).get(id) as (Omit<IndexCheckRun, 'rows'> & { optionsJson: string | null }) | undefined;
  if (!record) return null;
  const { optionsJson, stopReason, batchId, batchPosition, ...run } = record;
  const records = database.prepare(`SELECT url, status, checked_at AS checkedAt,
    matched_url AS matchedUrl, error_code AS errorCode, message, attempts, next_attempt_at AS nextAttemptAt, attempt_started_at AS attemptStartedAt FROM index_check_results
    WHERE run_id = ? ORDER BY position`).all(id) as IndexCheckRow[];
  const rows = records.map((r) => ({ url: r.url, status: r.status, checkedAt: r.checkedAt,
    ...(r.matchedUrl ? { matchedUrl: r.matchedUrl } : {}), ...(r.errorCode ? { errorCode: r.errorCode } : {}),
    ...(r.message ? { message: r.message } : {}), ...(r.attempts ? { attempts: r.attempts } : {}),
    ...(r.nextAttemptAt != null ? { nextAttemptAt: r.nextAttemptAt } : {}), ...(r.attemptStartedAt != null ? { attemptStartedAt: r.attemptStartedAt } : {}) }));
  return { ...run, ...(batchId ? { batchId, batchPosition: batchPosition! } : {}), ...(optionsJson ? { options: JSON.parse(optionsJson) } : {}), ...(stopReason ? { stopReason } : {}), rows };
}
/** One worker process per app; orphaned work is never automatically resent. */
export function recoverIndexCheckRuns(database: Db, active: ReadonlySet<string>, now = Date.now()): void {
  const rows = database.prepare("SELECT id FROM index_check_runs WHERE state IN ('running', 'queued')").all() as { id: string }[];
  database.transaction(() => {
    for (const { id } of rows) {
      if (active.has(id)) continue;
      const run = getSavedIndexCheckRun(database, id)!;
      run.state = 'interrupted'; run.finishedAt = now;
      for (const result of run.rows) {
        if (result.status === 'checking') {
          result.status = 'error'; result.errorCode = 'interrupted';
          result.message = 'Сервер перезапущен во время запроса; результат и списание неизвестны';
        } else if (result.status === 'pending' || result.status === 'retrying') {
          delete result.nextAttemptAt;
          result.status = 'skipped'; result.message = 'Не отправлен: сервер перезапущен';
        }
      }
      saveIndexCheckRun(database, run);
    }
  })();
}
export function listIndexCheckHistory(database: Db, filter: { site?: string; accountId?: string; offset?: number } = {}): IndexCheckHistoryPage {
  const offset = filter.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error('Некорректная страница истории');
  const where: string[] = [], values: string[] = [];
  if (filter.site) { where.push('site = ?'); values.push(filter.site); }
  if (filter.accountId) { where.push('account_id = ?'); values.push(filter.accountId); }
  const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (database.prepare(`SELECT COUNT(*) AS n FROM index_check_runs ${sql}`).get(...values) as { n: number }).n;
  const entries = database.prepare(`SELECT ${SUMMARY} FROM index_check_runs ${sql}
    ORDER BY started_at DESC, id DESC LIMIT 50 OFFSET ?`).all(...values, offset) as IndexCheckHistoryEntry[];
  return { entries, total, offset, limit: 50 };
}

/** Export observed not-found results from saved rows, independently of UI pagination. */
export function getIndexCheckNotFoundUrls(database: Db, id: string, scope: 'run' | 'batch'): string[] | null {
  const field = scope === 'batch' ? 'batch_id' : 'id';
  if (!database.prepare(`SELECT id FROM index_check_runs WHERE ${field} = ? LIMIT 1`).get(id)) return null;
  const rows = database.prepare(`SELECT u.url FROM index_check_results u
    JOIN index_check_runs r ON r.id = u.run_id
    WHERE r.${field} = ? AND u.status = 'not_found'
    ORDER BY r.batch_position, u.position`).all(id) as { url: string }[];
  return [...new Set(rows.map((row) => row.url))];
}

/** Read summaries only; returning every site's URL list on each poll is unbounded. */
export function getSavedIndexCheckBatch(database: Db, id: string): IndexCheckBatch | null {
  const runs = database.prepare(`SELECT ${SUMMARY} FROM index_check_runs WHERE batch_id = ? ORDER BY batch_position`).all(id) as IndexCheckHistoryEntry[];
  if (!runs.length) return null;
  const active = runs.find((r) => r.state === 'running');
  const waiting = runs.some((r) => ['running', 'queued'].includes(r.state));
  const checkedUrls = runs.reduce((n, r) => n + r.checkedUrls, 0);
  const state = waiting ? 'running' : runs.every((r) => r.state === 'completed') ? 'completed' :
    runs.every((r) => r.state === 'cancelled') ? 'cancelled' : runs.every((r) => r.state === 'interrupted') ? 'interrupted' :
      checkedUrls > 0 ? 'partial' : 'failed';
  return { id, provider: runs[0].provider, state, runs,
    totalUrls: runs.reduce((n, r) => n + r.totalUrls, 0), checkedUrls,
    foundCount: checkedUrls ? runs.reduce((n, r) => n + (r.foundCount ?? 0), 0) : null,
    finishedSites: runs.filter((r) => !['running', 'queued'].includes(r.state)).length,
    activeRunId: active?.id ?? null };
}
