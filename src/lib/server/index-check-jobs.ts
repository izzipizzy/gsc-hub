import { randomUUID } from 'node:crypto';
import type { Db } from './db';
import { indexCheckOptions } from './index-check-options';
import { saveIndexCheckRun, saveIndexCheckProgress, getSavedIndexCheckRun, listIndexCheckHistory, recoverIndexCheckRuns, getSavedIndexCheckBatch } from './index-check-history';
import { checkIndexUrl, indexCheckCredentials, IndexProviderError, type IndexCheckCredentials, type IndexCheckOutcome } from './index-check-providers';
import type { IndexCheckDraft, IndexCheckProvider, IndexCheckRun } from '$lib/utils/index-check';
import { indexCheckCounts } from '$lib/utils/index-check';

function sleep(ms: number, _value: undefined, { signal }: { signal: AbortSignal }) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
const RETENTION = 30 * 60_000;
const CAPACITY = 20;
type Check = (credentials: IndexCheckCredentials, url: string, signal?: AbortSignal) => Promise<IndexCheckOutcome>;
interface StoredDraft { draft: IndexCheckDraft; runs: Partial<Record<IndexCheckProvider, string>> }
interface StoredRun { database: Db; run: IndexCheckRun; controller: AbortController; cancelled: boolean; done?: Promise<void> }
/** Bounded in-memory workers with a durable SQLite journal of each run. */
export class IndexCheckJobs {
  private drafts = new Map<string, StoredDraft>();
  private runs = new Map<string, StoredRun>();
  private active = new Map<IndexCheckProvider, string>();
  constructor(private check: Check = checkIndexUrl, private paceMs = 1000, private now = Date.now, private requestTimeoutMs = 70_000) {}
  private prune() {
    const cutoff = this.now() - RETENTION;
    for (const [id, d] of this.drafts) if (d.draft.createdAt < cutoff) this.drafts.delete(id);
    for (const [id, r] of this.runs) if (r.run.finishedAt !== null && r.run.finishedAt < cutoff) this.runs.delete(id);
  }
  addDraft(input: Omit<IndexCheckDraft, 'id' | 'createdAt'>): IndexCheckDraft {
    this.prune();
    if (this.drafts.size >= CAPACITY) this.drafts.delete(this.drafts.keys().next().value!);
    const draft: IndexCheckDraft = { ...structuredClone(input), id: randomUUID(), createdAt: this.now() };
    this.drafts.set(draft.id, { draft, runs: {} });
    return structuredClone(draft);
  }
  start(database: Db, draftId: string, provider: IndexCheckProvider): IndexCheckRun {
    this.prune();
    this.recover(database);
    const stored = this.drafts.get(draftId);
    if (!stored) throw new Error('Список URL устарел или сервер перезапущен. Получи страницы заново');
    const previousId = stored.runs[provider];
    const previous = previousId ? this.runs.get(previousId) : null;
    if (previous) return structuredClone(previous.run); // Idempotent start retries do not charge again.
    if (previousId) throw new Error('Результат этого запуска уже истёк. Получи страницы заново для новой проверки');
    if (this.active.has(provider)) throw new Error('Этот сервис уже выполняет проверку. Дождись завершения или останови её');
    const credentials = indexCheckCredentials(database, provider);
    if (this.runs.size >= CAPACITY) {
      const oldest = [...this.runs].find(([, item]) => item.run.state !== 'running');
      if (oldest) this.runs.delete(oldest[0]);
      else throw new Error('Слишком много активных проверок');
    }
    const { site, accountId, urls } = stored.draft;
    const run: IndexCheckRun = { id: randomUUID(), site, accountId, provider, engine: 'google',
      state: 'running', startedAt: this.now(), finishedAt: null,
      options: indexCheckOptions(database, provider),
      rows: urls.map((url) => ({ url, status: 'pending', checkedAt: null })) };
    saveIndexCheckRun(database, run); // Must succeed before any paid request is sent.
    const item: StoredRun = { database, run, controller: new AbortController(), cancelled: false };
    this.runs.set(run.id, item); stored.runs[provider] = run.id; this.active.set(provider, run.id);
    item.done = this.execute(item, credentials);
    return structuredClone(run);
  }
  startBatch(database: Db, draftIds: string[], provider: IndexCheckProvider) {
    this.prune(); this.recover(database);
    if (draftIds.length < 2 || draftIds.length > 20 || new Set(draftIds).size !== draftIds.length) throw new Error('Выбери от 2 до 20 разных сайтов');
    const drafts = draftIds.map((id) => this.drafts.get(id));
    if (drafts.some((d) => !d)) throw new Error('Списки URL устарели. Получи страницы заново');
    const previous = drafts.map((d) => d!.runs[provider]);
    if (previous.some(Boolean)) {
      const first = previous[0] ? getSavedIndexCheckRun(database, previous[0]) : null;
      const batch = first?.batchId ? this.getBatch(first.batchId, database) : null;
      if (batch && previous.every(Boolean) && batch.runs.length === previous.length && batch.runs.every((r) => previous.includes(r.id))) return batch;
      throw new Error('Один из списков уже запускался. Получи страницы заново');
    }
    if (this.active.has(provider)) throw new Error('Этот сервис уже выполняет проверку. Дождись завершения или останови её');
    while (this.runs.size + drafts.length > CAPACITY) {
      const old = [...this.runs].find(([, item]) => item.run.finishedAt !== null);
      if (!old) throw new Error('Недостаточно свободных мест в очереди; дождись завершения текущих проверок');
      this.runs.delete(old[0]);
    }
    const credentials = indexCheckCredentials(database, provider), options = indexCheckOptions(database, provider), batchId = randomUUID();
    const items: StoredRun[] = drafts.map((stored, position) => ({ database, cancelled: false, controller: new AbortController(), run: {
      id: randomUUID(), accountId: stored!.draft.accountId, site: stored!.draft.site, provider, engine: 'google',
      state: 'queued', startedAt: this.now(), finishedAt: null, batchId, batchPosition: position, options,
      rows: stored!.draft.urls.map((url) => ({ url, status: 'pending', checkedAt: null }))
    } }));
    database.transaction(() => { for (const item of items) saveIndexCheckRun(database, item.run); })();
    items.forEach((item, i) => { this.runs.set(item.run.id, item); drafts[i]!.runs[provider] = item.run.id; });
    this.active.set(provider, batchId);
    const done = this.executeBatch(items, credentials);
    for (const item of items) item.done = done;
    return this.getBatch(batchId, database)!;
  }
  getBatch(id: string, database: Db) {
    this.recover(database); return getSavedIndexCheckBatch(database, id);
  }
  cancelBatch(id: string, database: Db) {
    for (const item of this.runs.values()) if (item.run.batchId === id && ['queued', 'running'].includes(item.run.state)) {
      item.cancelled = true; item.controller.abort();
    }
    return this.getBatch(id, database);
  }
  async whenBatchSettled(id: string, database: Db) {
    const first = [...this.runs.values()].find((item) => item.run.batchId === id);
    await first?.done; return this.getBatch(id, database);
  }
  private async executeBatch(items: StoredRun[], credentials: IndexCheckCredentials) {
    let stop = '';
    try {
      for (const item of items) {
        if (item.cancelled || stop) {
          item.run.state = item.cancelled ? 'cancelled' : 'failed'; item.run.finishedAt = this.now();
          item.run.stopReason = item.cancelled ? 'Запуск остановлен пользователем' : `Сайт не запущен: ${stop}`;
          for (const row of item.run.rows) { row.status = 'skipped'; row.message = item.run.stopReason; }
          saveIndexCheckRun(item.database, item.run); continue;
        }
        item.run.state = 'running'; saveIndexCheckRun(item.database, item.run);
        await this.execute(item, credentials, false);
        stop = item.run.stopReason ?? (item.run.persistenceError ? 'ошибка сохранения истории' : '');
        if (item.cancelled) for (const remaining of items) { remaining.cancelled = true; remaining.controller.abort(); }
      }
    } catch {
      for (const item of items) if (['running', 'queued'].includes(item.run.state)) {
        item.run.state = 'failed'; item.run.finishedAt = this.now();
        item.run.persistenceError = 'Очередь остановлена: не удалось сохранить историю';
        for (const row of item.run.rows) if (['pending', 'retrying', 'checking'].includes(row.status)) { row.status = 'skipped'; delete row.nextAttemptAt; row.message = item.run.persistenceError; }
        try { saveIndexCheckRun(item.database, item.run); } catch { /* Recovery marks unsaved work interrupted. */ }
      }
    } finally { this.active.delete(credentials.provider); }
  }
  get(id: string, database?: Db): IndexCheckRun | null {
    this.prune();
    const run = this.runs.get(id)?.run;
    if (run) return structuredClone(run);
    if (database) { this.recover(database); return getSavedIndexCheckRun(database, id); }
    return null;
  }
  cancel(id: string, database?: Db): IndexCheckRun | null {
    const item = this.runs.get(id);
    if (!item) return this.get(id, database);
    if (item.run.batchId) { this.cancelBatch(item.run.batchId, item.database); return this.get(id); }
    if (item.run.state === 'running') { item.cancelled = true; item.controller.abort(); }
    return this.get(id);
  }
  private recover(database: Db) {
    recoverIndexCheckRuns(database, new Set([...this.runs].filter(([, item]) => ['running', 'queued'].includes(item.run.state)).map(([id]) => id)), this.now());
  }
  history(database: Db, filter: { site?: string; accountId?: string; offset?: number } = {}) {
    this.recover(database);
    return listIndexCheckHistory(database, filter);
  }
  async whenSettled(id: string) { await this.runs.get(id)?.done; return this.get(id); }
  private async boundedCheck(credentials: IndexCheckCredentials, url: string, signal: AbortSignal) {
    if (signal.aborted) throw new IndexProviderError('cancelled', 'Запрос прерван; результат и списание неизвестны');
    const attempt = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort!: () => void;
    const deadline = new Promise<never>((_resolve, reject) => {
      abort = () => { reject(new IndexProviderError('cancelled', 'Запрос прерван; результат и списание неизвестны')); attempt.abort(); };
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        reject(new IndexProviderError('timeout', 'Истекло время ожидания сервиса; результат и списание неизвестны'));
        attempt.abort();
      }, this.requestTimeoutMs);
    });
    try { return await Promise.race([this.check(credentials, url, AbortSignal.any([signal, attempt.signal])), deadline]); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  private async execute(item: StoredRun, credentials: IndexCheckCredentials, releaseProvider = true) {
    const { run, controller, database } = item;
    const options = run.options!;
    const inFlight = new Map<number, Promise<void>>();
    let halt = '', pauseUntil = 0, nextLaunchAt = 0, failures = 0;
    const storageFailure = () => {
      run.persistenceError = 'Не удалось сохранить историю. Проверка остановлена; текущие данные доступны только до перезапуска';
      halt = 'Ошибка сохранения истории'; controller.abort();
    };
    const processRow = async (position: number) => {
      const row = run.rows[position];
      row.status = 'checking'; row.attempts = (row.attempts ?? 0) + 1; row.attemptStartedAt = this.now();
      delete row.nextAttemptAt; delete row.errorCode; delete row.message;
      saveIndexCheckProgress(database, run, position); // Journal before every chargeable attempt.
      try {
        const result = await this.boundedCheck(credentials, row.url, controller.signal);
        Object.assign(row, result); failures = 0;
      } catch (e) {
        const failure = e instanceof IndexProviderError ? e : new IndexProviderError('provider', 'Не удалось завершить запрос к сервису');
        row.errorCode = failure.code; row.message = failure.message;
        if (!controller.signal.aborted && !halt && failure.retryable && row.attempts <= options.retries) {
          row.status = 'retrying';
          row.nextAttemptAt = this.now() + Math.max(options.retryDelayMinutes * 60_000, failure.retryAfterMs);
          // Channel exhaustion pauses all new calls, not just this URL.
          if (failure.code === 'rate_limit') pauseUntil = Math.max(pauseUntil, row.nextAttemptAt);
        } else {
          row.status = 'error'; failures++;
          if (['auth', 'quota'].includes(failure.code)) halt = failure.message;
          else if (failure.code === 'rate_limit') halt = 'Лимит каналов не снят; повторы исчерпаны. Уменьши число потоков или проверь лимит в кабинете';
          else if (failures >= 3) halt = 'Три запроса подряд завершились ошибкой после разрешённых попыток. Проверь доступность сервиса';
        }
      } finally {
        row.checkedAt = this.now(); saveIndexCheckProgress(database, run, position);
      }
    };
    try {
      while (true) {
        while (!halt && !controller.signal.aborted && inFlight.size < options.concurrency && this.now() >= Math.max(pauseUntil, nextLaunchAt)) {
          let position = run.rows.findIndex((r) => r.status === 'retrying' && r.nextAttemptAt! <= this.now());
          if (position < 0) position = run.rows.findIndex((r) => r.status === 'pending');
          if (position < 0) break;
          const work = processRow(position).catch(storageFailure).finally(() => { inFlight.delete(position); });
          inFlight.set(position, work);
          nextLaunchAt = this.now() + (run.provider === 'dataforseo' ? this.paceMs : 0);
        }
        const waiting = run.rows.filter((r) => r.status === 'pending' || r.status === 'retrying');
        if (!inFlight.size && (halt || controller.signal.aborted || !waiting.length)) break;
        if (controller.signal.aborted) break;
        const wake = new AbortController();
        const waits: Promise<unknown>[] = [...inFlight.values()];
        if (!halt && inFlight.size < options.concurrency && waiting.length) {
          const nextRowAt = waiting.some((r) => r.status === 'pending') ? this.now() : Math.min(...waiting.map((r) => r.nextAttemptAt!));
          const delay = Math.max(1, Math.max(pauseUntil, nextLaunchAt, nextRowAt) - this.now());
          waits.push(sleep(delay, undefined, { signal: AbortSignal.any([controller.signal, wake.signal]) }));
        }
        try { await Promise.race(waits); } catch { break; } finally { wake.abort(); }
      }
    } catch { storageFailure(); }
    finally {
      await Promise.allSettled(inFlight.values());
      if (halt) run.stopReason = halt;
      for (const row of run.rows) {
        if (['pending', 'checking', 'retrying'].includes(row.status)) {
          row.status = 'skipped'; delete row.nextAttemptAt;
          row.message = item.cancelled ? 'Проверка остановлена пользователем' : `Не отправлен: ${halt || 'проверка остановлена'}`;
        }
      }
      const counts = indexCheckCounts(run.rows);
      run.state = item.cancelled ? 'cancelled' :
        counts.error === 0 && counts.skipped === 0 ? 'completed' :
          counts.found + counts.not_found > 0 ? 'partial' : 'failed';
      run.finishedAt = this.now();
      try { saveIndexCheckRun(database, run); delete run.persistenceError; }
      catch { run.persistenceError = 'Не удалось сохранить историю. Текущие данные доступны только до перезапуска'; }
      if (releaseProvider) this.active.delete(run.provider);
    }
  }
}
export const indexCheckJobs = new IndexCheckJobs();
