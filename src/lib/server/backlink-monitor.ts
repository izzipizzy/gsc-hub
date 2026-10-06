import { saveBacklinkSnapshot, type BacklinkTotals } from './backlink-snapshots';
import { db, type Db } from './db';
import { cachedMagicLinksClient, cachedMagic369Client } from './magiclinks-cache';
import { MAGIC_PROVIDER_IDS, isMagicProviderId } from './magiclinks-providers';
import { listPurchases } from './magiclinks-purchases';
import type { BacklinkResult } from './backlink-checker';
import { checkBacklink, backlinkSettings } from './backlink-fetch';
import type { MagicProviderId } from './magiclinks-providers';

const DAY = 86_400_000;
export interface Placement {
  provider: MagicProviderId;
  orderId: string;
  placementId: string;
  sourceUrl: string;
  targetUrl: string;
  expectedAnchor: string;
}
export interface SavedBacklink extends BacklinkResult { confirmed: boolean; anchorChanged: boolean }
export interface CheckRecord extends Placement {
  result: SavedBacklink | null;
  checkedAt: number | null;
  history: { checkedAt: number; result: SavedBacklink }[];
}
export interface CheckJob {
  id: number; provider: MagicProviderId | null; order_id: string | null; placement_id: string | null;
  automatic: number; status: string; created_at: number; finished_at: number | null;
  total: number; checked: number; errors: string[];
}
export function latestJob(database: Db): CheckJob | null {
  const row = database.prepare('SELECT * FROM backlink_jobs ORDER BY id DESC LIMIT 1').get() as any;
  return row ? { ...row, errors: JSON.parse(row.errors) } : null;
}
export class CheckBusyError extends Error {
  constructor() { super('Уже идёт другая проверка. Дождись завершения и запусти нужную.'); }
}
export function enqueueCheck(database: Db, scope: { provider?: MagicProviderId; orderId?: string; placementId?: string } = {}, automatic = false, now = Date.now()): CheckJob {
  return database.transaction(() => {
    const active = database.prepare("SELECT * FROM backlink_jobs WHERE status IN ('queued', 'running')").get() as any;
    if (active) {
      if (active.provider !== (scope.provider ?? null) || active.order_id !== (scope.orderId ?? null) || active.placement_id !== (scope.placementId ?? null)) throw new CheckBusyError();
      return { ...active, errors: JSON.parse(active.errors) };
    }
    database.prepare('INSERT INTO backlink_jobs (provider, order_id, placement_id, automatic, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(scope.provider ?? null, scope.orderId ?? null, scope.placementId ?? null, Number(automatic), now);
    return latestJob(database)!;
  })();
}

export function syncPlacements(database: Db, provider: MagicProviderId, orderId: string, placements: Placement[]) {
  database.transaction(() => {
    database.prepare('UPDATE backlink_placements SET active=0 WHERE provider=? AND order_id=?').run(provider, orderId);
    const save = database.prepare(`INSERT INTO backlink_placements (provider, order_id, placement_id, source_url, target_url, expected_anchor)
      VALUES (@provider, @orderId, @placementId, @sourceUrl, @targetUrl, @expectedAnchor)
      ON CONFLICT(provider, order_id, placement_id) DO UPDATE SET
      source_url=excluded.source_url, target_url=excluded.target_url, expected_anchor=excluded.expected_anchor, active=1,
      result=CASE WHEN source_url<>excluded.source_url OR target_url<>excluded.target_url OR expected_anchor<>excluded.expected_anchor THEN NULL ELSE result END,
      checked_at=CASE WHEN source_url<>excluded.source_url OR target_url<>excluded.target_url OR expected_anchor<>excluded.expected_anchor THEN NULL ELSE checked_at END,
      next_check_at=CASE WHEN source_url<>excluded.source_url OR target_url<>excluded.target_url OR expected_anchor<>excluded.expected_anchor THEN 0 ELSE next_check_at END,
      missing_count=CASE WHEN source_url<>excluded.source_url OR target_url<>excluded.target_url OR expected_anchor<>excluded.expected_anchor THEN 0 ELSE missing_count END,
      last_job_id=CASE WHEN source_url<>excluded.source_url OR target_url<>excluded.target_url OR expected_anchor<>excluded.expected_anchor THEN NULL ELSE last_job_id END`);
    for (const p of placements) if (p.sourceUrl && p.targetUrl) save.run(p);
  })();
}

export function recordCheck(database: Db, placement: Placement, result: BacklinkResult, jobId: number, now = Date.now()): SavedBacklink {
  return database.transaction(() => {
    const previous = database.prepare('SELECT missing_count, checked_at FROM backlink_placements WHERE provider=? AND order_id=? AND placement_id=?')
      .get(placement.provider, placement.orderId, placement.placementId) as { missing_count: number; checked_at: number | null };
    const absent = result.status === 'missing' || result.status === 'wrong_url';
    // Repeated clicks within a day must not confirm a disappearance.
    const count = absent ? (previous.missing_count ? previous.missing_count + Number(now - (previous.checked_at ?? 0) >= DAY) : 1)
      : result.status === 'error' ? previous.missing_count : 0;
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
    const saved: SavedBacklink = { ...result, confirmed: absent && count >= 2,
      anchorChanged: !!normalize(placement.expectedAnchor) && result.status === 'found' && result.links.every((l) => normalize(l.anchor) !== normalize(placement.expectedAnchor)) };
    database.prepare(`UPDATE backlink_placements SET result=?, checked_at=?, next_check_at=?, missing_count=?, last_job_id=?
      WHERE provider=? AND order_id=? AND placement_id=?`).run(JSON.stringify(saved), now, now + 7 * DAY, count, jobId, placement.provider, placement.orderId, placement.placementId);
    database.prepare('INSERT INTO backlink_history (provider, order_id, placement_id, checked_at, result) VALUES (?, ?, ?, ?, ?)')
      .run(placement.provider, placement.orderId, placement.placementId, now, JSON.stringify(saved));
    // Retain the last 20 checks for each placement.
    database.prepare(`DELETE FROM backlink_history WHERE provider=? AND order_id=? AND placement_id=? AND id NOT IN
      (SELECT id FROM backlink_history WHERE provider=? AND order_id=? AND placement_id=? ORDER BY id DESC LIMIT 20)`)
      .run(placement.provider, placement.orderId, placement.placementId, placement.provider, placement.orderId, placement.placementId);
    return saved;
  })();
}

export function readChecks(database: Db, provider?: MagicProviderId, orderId?: string): CheckRecord[] {
  const rows = database.prepare(`SELECT * FROM backlink_placements WHERE active=1 AND (? IS NULL OR provider=?) AND (? IS NULL OR order_id=?)`)
    .all(provider ?? null, provider ?? null, orderId ?? null, orderId ?? null) as any[];
  const history = orderId ? database.prepare('SELECT * FROM backlink_history WHERE provider=? AND order_id=? ORDER BY id DESC').all(provider, orderId) as any[] : [];
  return rows.map((r) => ({ provider: r.provider, orderId: r.order_id, placementId: r.placement_id, sourceUrl: r.source_url,
    targetUrl: r.target_url, expectedAnchor: r.expected_anchor, checkedAt: r.checked_at, result: r.result ? JSON.parse(r.result) : null,
    history: history.filter((h) => h.placement_id === r.placement_id).map((h) => ({ checkedAt: h.checked_at, result: JSON.parse(h.result) })) }));
}
export function checkSummary(rows: CheckRecord[]) {
  return { total: rows.length, found: rows.filter((r) => r.result?.status === 'found').length,
    missing: rows.filter((r) => r.result?.confirmed).length,
    suspect: rows.filter((r) => r.result && ['missing', 'wrong_url'].includes(r.result.status) && !r.result.confirmed).length,
    errors: rows.filter((r) => r.result?.status === 'error').length,
    changed: rows.filter((r) => r.result?.anchorChanged || r.result?.links.some((l) => /\b(nofollow|sponsored|ugc)\b/.test(l.rel))).length,
    unchecked: rows.filter((r) => !r.result).length,
    checkedAt: rows.reduce<number | null>((n, r) => r.checkedAt ? Math.max(n ?? 0, r.checkedAt) : n, null) };
}

export function providerCheckTotals(rows: CheckRecord[]): BacklinkTotals {
  const providers = [...new Set([...MAGIC_PROVIDER_IDS, ...rows.map((r) => r.provider)])];
  return Object.fromEntries([['all', checkSummary(rows)], ...providers.map((id) => [id, checkSummary(rows.filter((r) => r.provider === id))])]);
}

async function discover(database: Db, job: CheckJob, errors: string[]) {
  const field = cachedMagicLinksClient(database, !!job.automatic);
  const magic = cachedMagic369Client(database, !!job.automatic);
  const orders = new Map<string, { provider: MagicProviderId; id: string }>();
  if (job.order_id && job.provider) orders.set(job.provider + ':' + job.order_id, { provider: job.provider, id: job.order_id });
  else {
    for (const p of listPurchases(database)) {
      if (isMagicProviderId(p.provider)) orders.set(p.provider + ':' + p.orderId, { provider: p.provider, id: p.orderId });
    }
    if (field) {
      try {
        for (const t of await field.listTasks()) if (t.order) orders.set('fieldlink:' + t.order.id, { provider: 'fieldlink', id: t.order.id });
      } catch { errors.push('FieldLink: список заказов не загрузился'); }
    }
  }
  for (const order of orders.values()) {
    try {
      let placements: Placement[];
      if (order.provider === 'fieldlink') {
        if (!field) throw new Error('нет ключа FieldLink');
        placements = (await field.order(order.id)).rows.filter((r) => r.result && r.input?.targetUrl).map((r) => ({
          provider: 'fieldlink', orderId: order.id, placementId: r.id,
          sourceUrl: r.result?.destination ?? r.result?.source ?? r.result?.donor ?? '', targetUrl: r.input.targetUrl, expectedAnchor: r.input.anchor ?? ''
        }));
      } else if (order.provider === 'magic369') {
        if (!magic) throw new Error('нет ключа 369Team');
        placements = (await magic.orderArticles(order.id)).map((a) => ({ provider: 'magic369', orderId: order.id,
          placementId: String(a.id), sourceUrl: a.publishedUrl, targetUrl: a.url, expectedAnchor: a.anchor }));
      } else { throw new Error('Для поставщика не подключён адаптер публикаций'); }
      syncPlacements(database, order.provider, order.id, placements);
    } catch (e) { errors.push(`${order.provider} · ${order.id}: ${(e as Error).message.slice(0, 200)}`); }
  }
}

export async function runNextCheck(database: Db, checker: (source: string, target: string) => Promise<BacklinkResult> = (source, target) => checkBacklink(database, source, target), now = Date.now()) {
  const job = database.transaction(() => {
    database.prepare("UPDATE backlink_jobs SET status='queued' WHERE status='running' AND lease_until<?").run(now);
    const queued = database.prepare("SELECT * FROM backlink_jobs WHERE status='queued' ORDER BY id LIMIT 1").get() as any;
    if (!queued) return null;
    database.prepare("UPDATE backlink_jobs SET status='running', lease_until=? WHERE id=?").run(Date.now() + 600_000, queued.id);
    return { ...queued, errors: JSON.parse(queued.errors) } as CheckJob;
  })();
  if (!job) return;
  const heartbeat = setInterval(() => database.prepare('UPDATE backlink_jobs SET lease_until=? WHERE id=?').run(Date.now() + 600_000, job.id), 30_000);
  heartbeat.unref();
  const errors: string[] = [];
  try {
    await discover(database, job, errors);
    const placements = readChecks(database, job.provider ?? undefined, job.order_id ?? undefined)
      .filter((p) => !job.placement_id || p.placementId === job.placement_id);
    const work = placements.filter((p) => {
      const state = database.prepare('SELECT next_check_at,last_job_id FROM backlink_placements WHERE provider=? AND order_id=? AND placement_id=?')
        .get(p.provider, p.orderId, p.placementId) as any;
      return state.last_job_id !== job.id && (!job.automatic || state.next_check_at <= now);
    });
    database.prepare('UPDATE backlink_jobs SET total=checked+?, errors=? WHERE id=?').run(work.length, JSON.stringify(errors), job.id);
    // A single worker and a pause keep donor sites from receiving a burst.
    for (const p of work) {
      const result = await checker(p.sourceUrl, p.targetUrl);
      database.transaction(() => {
        recordCheck(database, p, result, job.id);
        database.prepare('UPDATE backlink_jobs SET checked=checked+1 WHERE id=?').run(job.id);
      })();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    database.transaction(() => {
      const finishedAt = Date.now();
      database.prepare("UPDATE backlink_jobs SET status='completed', finished_at=?, lease_until=NULL, errors=? WHERE id=?")
        .run(finishedAt, JSON.stringify(errors), job.id);
      // A scoped manual check still captures the whole portfolio at that moment.
      saveBacklinkSnapshot(database, providerCheckTotals(readChecks(database)), job.id, finishedAt);
    })();
  } catch (e) {
    errors.push((e as Error).message.slice(0, 300));
    database.prepare("UPDATE backlink_jobs SET status='failed', finished_at=?, lease_until=NULL, errors=? WHERE id=?")
      .run(Date.now(), JSON.stringify(errors), job.id);
  } finally { clearInterval(heartbeat); }
}

export function scheduleAutomaticCheck(database: Db, now = Date.now()) {
  if (!backlinkSettings(database).automatic) return null;
  if (database.prepare("SELECT 1 FROM backlink_jobs WHERE status IN ('queued', 'running')").get()) return null;
  const last = database.prepare('SELECT MAX(COALESCE(finished_at, created_at)) AS at FROM backlink_jobs WHERE automatic=1').get() as { at: number | null };
  if (last.at !== null && now - last.at < 7 * DAY) return null;
  return enqueueCheck(database, {}, true, now);
}

let timer: ReturnType<typeof setInterval> | null = null;
let working = false;
let wake: (() => void) | null = null;
export function startBacklinkMonitor() {
  if (timer) { wake?.(); return; }
  const tick = async () => {
    if (working) return;
    working = true;
    try {
      const database = db();
      scheduleAutomaticCheck(database);
      await runNextCheck(database);
    } catch (e) { console.error('Backlink monitor:', (e as Error).message); }
    finally { working = false; }
  };
  wake = () => { void tick(); };
  timer = setInterval(wake, 60_000);
  timer.unref();
  void tick();
}
