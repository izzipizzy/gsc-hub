import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { setConfigValue } from '../src/lib/server/config';
import { IndexCheckJobs } from '../src/lib/server/index-check-jobs';
import { IndexProviderError } from '../src/lib/server/index-check-providers';
import { indexCheckCounts } from '../src/lib/utils/index-check';
let db: Db;
const input = { site: 'sc-domain:example.com', accountId: 'account', urls: ['https://example.com/a','https://example.com/b','https://example.com/c','https://example.com/d'], sitemaps: ['https://example.com/sitemap.xml'], warnings: [] };
beforeEach(() => {
  db = openDb(':memory:');
  setConfigValue(db,'XMLRIVER_THREADS','1'); setConfigValue(db,'XMLRIVER_RETRIES','0'); setConfigValue(db,'DATAFORSEO_RETRIES','0');
  for (const key of ['XMLRIVER_USER', 'XMLRIVER_KEY', 'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'] as const) { vi.stubEnv(key, ''); setConfigValue(db,key,key==='XMLRIVER_USER'?'123':'test-secret'); }
});
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllEnvs(); });
it('starts once per draft/provider, records progress, snapshots credentials and returns safe copies', async () => {
  let release!: (value: {status:'found'}) => void;
  const check = vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;})).mockResolvedValue({status:'not_found'});
  const jobs = new IndexCheckJobs(check,0),draft=jobs.addDraft(input),run=jobs.start(db,draft.id,'xmlriver');
  expect(run.rows[0].status).toBe('checking'); expect(run.rows[1].status).toBe('pending');
  expect(jobs.start(db,draft.id,'xmlriver').id).toBe(run.id);expect(check).toHaveBeenCalledTimes(1);
  run.rows[0].url='mutated';expect(jobs.get(run.id)?.rows[0].url).toBe(input.urls[0]);
  setConfigValue(db,'XMLRIVER_KEY','changed-key'); release({status:'found'});
  const result=await jobs.whenSettled(run.id);expect(result?.state).toBe('completed');
  expect(indexCheckCounts(result!.rows)).toMatchObject({total:4,found:1,not_found:3,error:0,completed:4});
  expect(check.mock.calls[3][0].secret).toBe('test-secret');expect(JSON.stringify(result)).not.toContain('test-secret');
  expect(jobs.start(db,draft.id,'xmlriver').id).toBe(run.id);expect(check).toHaveBeenCalledTimes(4);
});
it.each(['auth','quota','rate_limit'] as const)('stops remaining work on %s without marking unchecked pages absent', async (code) => {
  const check=vi.fn().mockRejectedValue(new IndexProviderError(code,'controlled error'));
  const jobs=new IndexCheckJobs(check,0),d=jobs.addDraft(input),r=jobs.start(db,d.id,'xmlriver');
  const result=await jobs.whenSettled(r.id);
  expect(result?.state).toBe('failed');expect(result?.rows.map(r=>r.status)).toEqual(['error','skipped','skipped','skipped']);
  expect(indexCheckCounts(result!.rows).not_found).toBe(0);expect(check).toHaveBeenCalledTimes(1);
});
it('preserves successes on partial failure and stops after three consecutive provider failures', async () => {
  const check=vi.fn().mockResolvedValueOnce({status:'found'}).mockRejectedValue(new IndexProviderError('network','timeout'));
  const jobs=new IndexCheckJobs(check,0),d=jobs.addDraft({...input,urls:[...input.urls,'https://example.com/e']}),r=jobs.start(db,d.id,'xmlriver');
  const result=await jobs.whenSettled(r.id);expect(result?.state).toBe('partial');
  expect(result?.rows.map(r=>r.status)).toEqual(['found','error','error','error','skipped']);expect(check).toHaveBeenCalledTimes(4);
});
it('allows one active run per provider and cancellation marks unrequested pages separately', async () => {
  const check=vi.fn((_credentials,_url,signal?:AbortSignal)=>new Promise<never>((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(new IndexProviderError('cancelled','cancelled')))));
  const jobs=new IndexCheckJobs(check,0),d=jobs.addDraft(input),r=jobs.start(db,d.id,'xmlriver'),other=jobs.addDraft(input);
  expect(()=>jobs.start(db,other.id,'xmlriver')).toThrow('уже выполняет');
  jobs.cancel(r.id);const result=await jobs.whenSettled(r.id);
  expect(result?.state).toBe('cancelled');expect(result?.rows[0]).toMatchObject({status:'error',errorCode:'cancelled'});
  expect(result?.rows.slice(1).every(r=>r.status==='skipped')).toBe(true);expect(check).toHaveBeenCalledTimes(1);
});
it('paces DataForSEO requests and can stop during the wait without another paid call', async () => {
  vi.useFakeTimers();
  const check=vi.fn().mockResolvedValue({status:'found'});
  const jobs=new IndexCheckJobs(check,20),d=jobs.addDraft(input),r=jobs.start(db,d.id,'dataforseo');
  expect(check).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(20);expect(check).toHaveBeenCalledTimes(2);
  jobs.cancel(r.id);expect((await jobs.whenSettled(r.id))?.state).toBe('cancelled');expect(check).toHaveBeenCalledTimes(2);
});
it('expires previews/results, keeps active runs alive, and requires configured credentials', async () => {
  let now=0;const check=vi.fn().mockResolvedValue({status:'found'}),jobs=new IndexCheckJobs(check,0,()=>now);
  const d=jobs.addDraft(input),r=jobs.start(db,d.id,'xmlriver');await jobs.whenSettled(r.id);
  now=31*60_000;expect(jobs.get(r.id)).toBeNull();expect(()=>jobs.start(db,d.id,'xmlriver')).toThrow('устарел');
  const clean=openDb(':memory:');try{const d2=jobs.addDraft(input);expect(()=>jobs.start(clean,d2.id,'dataforseo')).toThrow('Настрой');}finally{clean.close();}
});
