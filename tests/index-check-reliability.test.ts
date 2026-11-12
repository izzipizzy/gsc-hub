import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { setConfigValue } from '../src/lib/server/config';
import { IndexCheckJobs } from '../src/lib/server/index-check-jobs';
import { IndexProviderError } from '../src/lib/server/index-check-providers';
import { indexCheckOptions, saveIndexCheckOptions } from '../src/lib/server/index-check-options';
import { getSavedIndexCheckRun } from '../src/lib/server/index-check-history';
let db: Db;
const input={site:'sc-domain:example.com',accountId:'account',sitemaps:[],warnings:[],urls:Array.from({length:25},(_,i)=>`https://example.com/${i}`)};
beforeEach(()=>{
 vi.useFakeTimers();db=openDb(':memory:');
 for(const key of ['XMLRIVER_USER','XMLRIVER_KEY','XMLRIVER_THREADS','XMLRIVER_RETRIES','XMLRIVER_RETRY_DELAY_MINUTES','DATAFORSEO_RETRIES','DATAFORSEO_RETRY_DELAY_MINUTES'])vi.stubEnv(key,'');
 setConfigValue(db,'XMLRIVER_USER','123');setConfigValue(db,'XMLRIVER_KEY','private-key');
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();db.close();});
it('defaults to ten XML River streams and three retries after three minutes, validates atomically',()=>{
 expect(indexCheckOptions(db,'xmlriver')).toEqual({concurrency:10,retries:3,retryDelayMinutes:3});
 for(const bad of ['0','11','1.5','abc'])expect(()=>saveIndexCheckOptions(db,'xmlriver',{XMLRIVER_THREADS:bad})).toThrow();
 expect(()=>saveIndexCheckOptions(db,'xmlriver',{XMLRIVER_THREADS:'2',XMLRIVER_RETRIES:'11'})).toThrow();
 expect(indexCheckOptions(db,'xmlriver').concurrency).toBe(10);
 saveIndexCheckOptions(db,'xmlriver',{XMLRIVER_THREADS:'1',XMLRIVER_RETRIES:'0',XMLRIVER_RETRY_DELAY_MINUTES:'60'});
 expect(indexCheckOptions(db,'xmlriver')).toEqual({concurrency:1,retries:0,retryDelayMinutes:60});
 vi.stubEnv('XMLRIVER_THREADS','11');expect(()=>indexCheckOptions(db,'xmlriver')).toThrow();
});
it.each([1,3,10])('never exceeds %i simultaneous requests and journals every completed URL',async(limit)=>{
 setConfigValue(db,'XMLRIVER_THREADS',String(limit));let active=0,peak=0;
 const check=vi.fn(async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,100));active--;return {status:'found' as const};});
 const jobs=new IndexCheckJobs(check,0),d=jobs.addDraft(input),run=jobs.start(db,d.id,'xmlriver');
 expect(check).toHaveBeenCalledTimes(limit);
 setConfigValue(db,'XMLRIVER_THREADS','2'); // Running job keeps its snapshot.
 await vi.runAllTimersAsync();const result=await jobs.whenSettled(run.id);
 expect(peak).toBe(limit);expect(result?.state).toBe('completed');expect(check).toHaveBeenCalledTimes(25);
 expect(result?.options?.concurrency).toBe(limit);expect(getSavedIndexCheckRun(db,run.id)).toEqual(result);
});
it('regression: a busy XML River channel waits, retries that URL and continues the rest',async()=>{
 saveIndexCheckOptions(db,'xmlriver',{XMLRIVER_THREADS:'1',XMLRIVER_RETRIES:'2',XMLRIVER_RETRY_DELAY_MINUTES:'1'});
 const check=vi.fn().mockResolvedValueOnce({status:'found'}).mockRejectedValueOnce(new IndexProviderError('rate_limit','XML River code110')).mockResolvedValue({status:'not_found'});
 const jobs=new IndexCheckJobs(check,0),d=jobs.addDraft({...input,urls:input.urls.slice(0,4)}),run=jobs.start(db,d.id,'xmlriver');
 await vi.advanceTimersByTimeAsync(0);
 const waiting=jobs.get(run.id)!;expect(waiting.state).toBe('running');expect(waiting.rows.map(r=>r.status)).toEqual(['found','retrying','pending','pending']);
 expect(getSavedIndexCheckRun(db,run.id)?.rows[1]).toMatchObject({attempts:1,status:'retrying',nextAttemptAt:Date.now()+60_000});
 await vi.advanceTimersByTimeAsync(59_999);expect(check).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(1);const result=await jobs.whenSettled(run.id);
 expect(result?.state).toBe('completed');expect(result?.rows[1]).toMatchObject({status:'not_found',attempts:2});expect(result?.rows[1].errorCode).toBeUndefined();
 expect(check).toHaveBeenCalledTimes(5);expect(check.mock.calls[2][1]).toBe(input.urls[1]);
});
it('caps three retries at four total calls, reaches a final error and releases the provider',async()=>{
 const check=vi.fn().mockRejectedValue(new IndexProviderError('rate_limit','busy'));
 const jobs=new IndexCheckJobs(check,0),d=jobs.addDraft({...input,urls:input.urls.slice(0,1)}),run=jobs.start(db,d.id,'xmlriver');
 await vi.advanceTimersByTimeAsync(540_000);const result=await jobs.whenSettled(run.id);
 expect(result?.state).toBe('failed');expect(result?.rows[0].attempts).toBe(4);expect(check).toHaveBeenCalledTimes(4);expect(result?.stopReason).toContain('повторы исчерпаны');
 check.mockResolvedValue({status:'found'});const next=jobs.start(db,jobs.addDraft({...input,urls:input.urls.slice(0,1)}).id,'xmlriver');
 expect((await jobs.whenSettled(next.id))?.state).toBe('completed');
});
it('honors provider cooldown beyond the configured interval and can cancel during backoff',async()=>{
 const check=vi.fn().mockRejectedValue(new IndexProviderError('rate_limit','blocked',true,600_000));
 const jobs=new IndexCheckJobs(check,0),d=jobs.addDraft({...input,urls:input.urls.slice(0,1)}),run=jobs.start(db,d.id,'xmlriver');
 await vi.advanceTimersByTimeAsync(180_000);expect(check).toHaveBeenCalledTimes(1);
 jobs.cancel(run.id);expect((await jobs.whenSettled(run.id))?.state).toBe('cancelled');
 await vi.advanceTimersByTimeAsync(1_000_000);expect(check).toHaveBeenCalledTimes(1);
});
it.each(['auth','quota'] as const)('never retries permanent %s errors',async(code)=>{
 const check=vi.fn().mockRejectedValue(new IndexProviderError(code,'permanent'));
 const jobs=new IndexCheckJobs(check,0),run=jobs.start(db,jobs.addDraft({...input,urls:input.urls.slice(0,1)}).id,'xmlriver');
 expect((await jobs.whenSettled(run.id))?.state).toBe('failed');expect(check).toHaveBeenCalledTimes(1);
});
it('finishes even if transport ignores abort forever, and another run can start',async()=>{
 setConfigValue(db,'XMLRIVER_RETRIES','0');
 const check=vi.fn().mockImplementationOnce(()=>new Promise(()=>{})).mockResolvedValue({status:'found'});
 const jobs=new IndexCheckJobs(check,0,Date.now,70),d=jobs.addDraft({...input,urls:input.urls.slice(0,1)}),r=jobs.start(db,d.id,'xmlriver');
 await vi.advanceTimersByTimeAsync(70);const final=await jobs.whenSettled(r.id);
 expect(final?.state).toBe('failed');expect(final?.rows[0]).toMatchObject({status:'error',errorCode:'timeout',attempts:1});
 const next=jobs.start(db,jobs.addDraft({...input,urls:input.urls.slice(0,1)}).id,'xmlriver');expect((await jobs.whenSettled(next.id))?.state).toBe('completed');
});
it('a restart preserves retry evidence but never resends queued paid retries',async()=>{
 const check=vi.fn().mockRejectedValue(new IndexProviderError('network','timeout'));
 const jobs=new IndexCheckJobs(check,0),r=jobs.start(db,jobs.addDraft({...input,urls:input.urls.slice(0,1)}).id,'xmlriver');
 await vi.advanceTimersByTimeAsync(0);
 const freshCheck=vi.fn(),fresh=new IndexCheckJobs(freshCheck,0);
 const recovered=fresh.get(r.id,db);expect(recovered?.state).toBe('interrupted');expect(recovered?.rows[0]).toMatchObject({status:'skipped',attempts:1});
 expect(recovered?.rows[0].nextAttemptAt).toBeUndefined();expect(freshCheck).not.toHaveBeenCalled();
 jobs.cancel(r.id);await jobs.whenSettled(r.id); // Simulated old process is stopped as well.
});
