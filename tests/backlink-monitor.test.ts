import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setConfigValue } from '../src/lib/server/config';
import { openDb, type Db } from '../src/lib/server/db';
const { field, magic } = vi.hoisted(() => ({ field: { listTasks: vi.fn(), order: vi.fn() }, magic: { orderArticles: vi.fn() } }));
vi.mock('../src/lib/server/magiclinks', async (original) => ({ ...await original<typeof import('../src/lib/server/magiclinks')>(), magicLinksClient: () => field }));
vi.mock('../src/lib/server/magic369', async (original) => ({ ...await original<typeof import('../src/lib/server/magic369')>(), magic369Client: () => magic }));
import { syncPlacements, recordCheck, readChecks, checkSummary, enqueueCheck, latestJob, runNextCheck, scheduleAutomaticCheck, type Placement } from '../src/lib/server/backlink-monitor';
const DAY = 86_400_000;
const p: Placement = { provider: 'fieldlink', orderId: 'order', placementId: 'row', sourceUrl: 'https://donor.example/p/', targetUrl: 'https://mysite.com/a/', expectedAnchor: 'My anchor' };
const missing = { status: 'missing' as const, links: [], finalUrl: p.sourceUrl, error: null };
const found = { status: 'found' as const, links: [{ url: p.targetUrl, anchor: 'My anchor', rel: '' }], finalUrl: p.sourceUrl, error: null };
let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  field.listTasks.mockResolvedValue([{ order: { id: 'order' } }]);
  field.order.mockResolvedValue({ rows: [{ id: 'row', input: { targetUrl: p.targetUrl, anchor: p.expectedAnchor }, result: { destination: p.sourceUrl } }] });
  magic.orderArticles.mockResolvedValue([]);
});
afterEach(() => { db.close(); vi.clearAllMocks(); });
it('requires a repeat after a day, clears problems on recovery, retains history', () => {
  syncPlacements(db, p.provider, p.orderId, [p]);
  expect(recordCheck(db, p, missing, 1, DAY).confirmed).toBe(false);
  expect(recordCheck(db, p, missing, 2, DAY + 1000).confirmed).toBe(false);
  expect(recordCheck(db, p, missing, 3, 3*DAY).confirmed).toBe(true);
  expect(recordCheck(db, p, found, 4, 4*DAY).confirmed).toBe(false);
  expect(readChecks(db)[0].result?.status).toBe('found');
  expect(readChecks(db, p.provider, p.orderId)[0].history).toHaveLength(4);
  expect((db.prepare('SELECT next_check_at FROM backlink_placements').get() as any).next_check_at).toBe(11*DAY);
});
it('keeps errors separate from missing links and reports anchor and rel issues', () => {
  syncPlacements(db, p.provider, p.orderId, [p]);
  recordCheck(db, p, { ...missing, status: 'error', error: 'HTTP 403' }, 1, DAY);
  expect(checkSummary(readChecks(db))).toMatchObject({ errors: 1, missing: 0, suspect: 0 });
  recordCheck(db, p, { ...found, links: [{ url: p.targetUrl, anchor: 'different', rel: 'nofollow' }] }, 2, DAY);
  expect(checkSummary(readChecks(db))).toMatchObject({ found: 1, changed: 1 });
});
it('isolates provider/order/id and resets a check when the publication changes', () => {
  syncPlacements(db, p.provider, p.orderId, [p]);
  recordCheck(db, p, found, 1, DAY);
  syncPlacements(db, p.provider, p.orderId, [{ ...p, sourceUrl: 'https://other.example/new/' }]);
  expect(readChecks(db)[0].result).toBeNull();
  expect(readChecks(db, 'magic369', 'order')).toEqual([]);
  syncPlacements(db, p.provider, p.orderId, []);
  expect(readChecks(db)).toEqual([]);
});
it('caps history at twenty records', () => {
  syncPlacements(db, p.provider, p.orderId, [p]);
  for (let i=0;i<30;i++) recordCheck(db, p, found, i, DAY+i);
  expect(readChecks(db, p.provider, p.orderId)[0].history).toHaveLength(20);
});
it('runs manual discovery/checks in the background and deduplicates job requests', async () => {
  const job = enqueueCheck(db);
  expect(enqueueCheck(db).id).toBe(job.id);
  const checker = vi.fn().mockResolvedValue(found);
  await runNextCheck(db, checker);
  expect(checker).toHaveBeenCalledWith(p.sourceUrl, p.targetUrl);
  expect(latestJob(db)).toMatchObject({ status: 'completed', checked: 1, total: 1, errors: [] });
});
it('automatic runs skip fresh checks while manual runs override their due date', async () => {
  syncPlacements(db, p.provider, p.orderId, [p]);
  recordCheck(db, p, found, 0, Date.now());
  enqueueCheck(db, {}, true);
  const checker = vi.fn().mockResolvedValue(found);
  await runNextCheck(db, checker);
  expect(checker).not.toHaveBeenCalled();
  enqueueCheck(db, { provider: p.provider, orderId: p.orderId, placementId: p.placementId });
  await runNextCheck(db, checker);
  expect(checker).toHaveBeenCalledOnce();
});
it('recovers an expired worker lease without repeating already recorded placements', async () => {
  syncPlacements(db, p.provider, p.orderId, [p]);
  const job = enqueueCheck(db);
  recordCheck(db, p, found, job.id);
  db.prepare("UPDATE backlink_jobs SET status='running',lease_until=0,checked=1,total=1").run();
  const checker = vi.fn();
  await runNextCheck(db, checker);
  expect(checker).not.toHaveBeenCalled();
  expect(latestJob(db)).toMatchObject({ status: 'completed', checked: 1, total: 1 });
});
it('retains previous results when a provider fails and shows discovery errors', async () => {
  syncPlacements(db, p.provider, p.orderId, [p]);
  recordCheck(db, p, found, 0);
  field.order.mockRejectedValue(new Error('provider unavailable'));
  enqueueCheck(db, {}, true);
  await runNextCheck(db, vi.fn());
  expect(readChecks(db)[0].result?.status).toBe('found');
  expect(latestJob(db)?.errors).toEqual(['fieldlink · order: provider unavailable']);
});

it('schedules by default once per week and respects the disable setting', () => {
  const first = scheduleAutomaticCheck(db, DAY)!;
  expect(first.automatic).toBe(1);
  expect(scheduleAutomaticCheck(db, 2*DAY)).toBeNull();
  db.prepare("UPDATE backlink_jobs SET status='completed'").run();
  expect(scheduleAutomaticCheck(db, 2*DAY)).toBeNull();
  expect(scheduleAutomaticCheck(db, 8*DAY)?.id).not.toBe(first.id);
  db.prepare("UPDATE backlink_jobs SET status='completed'").run();
  setConfigValue(db, 'BACKLINK_AUTO_ENABLED', '0');
  expect(scheduleAutomaticCheck(db, 16*DAY)).toBeNull();
});
it('does not silently replace a scoped manual request with a different active job', () => {
  enqueueCheck(db);
  expect(() => enqueueCheck(db, {provider:'fieldlink',orderId:'order'})).toThrow('другая проверка');
});

it('counts the weekly interval from completion so later checks are not skipped for an extra week', () => {
  const job = scheduleAutomaticCheck(db, DAY)!;
  db.prepare("UPDATE backlink_jobs SET status='completed', finished_at=? WHERE id=?").run(DAY+600_000,job.id);
  expect(scheduleAutomaticCheck(db, 8*DAY)).toBeNull();
  expect(scheduleAutomaticCheck(db, 8*DAY+600_000)?.automatic).toBe(1);
});

it('does not report an anchor mismatch when the brief has no expected text', () => {
  for (const expectedAnchor of ['', '  \t ']) {
    const placement = { ...p, expectedAnchor };
    syncPlacements(db, p.provider, p.orderId, [placement]);
    expect(recordCheck(db, placement, found, 1, DAY).anchorChanged).toBe(false);
    expect(checkSummary(readChecks(db))).toMatchObject({ found: 1, changed: 0 });
    recordCheck(db, placement, { ...found, links: [{ ...found.links[0], rel: 'nofollow' }] }, 2, DAY);
    expect(checkSummary(readChecks(db)).changed).toBe(1);
  }
});
