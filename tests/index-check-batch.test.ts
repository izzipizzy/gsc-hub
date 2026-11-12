import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { setConfigValue } from '../src/lib/server/config';
import { IndexCheckJobs } from '../src/lib/server/index-check-jobs';
import { IndexProviderError } from '../src/lib/server/index-check-providers';
import { getSavedIndexCheckRun, saveIndexCheckRun, listIndexCheckHistory } from '../src/lib/server/index-check-history';
import type { IndexCheckRun } from '../src/lib/utils/index-check';
let db: Db;
const input=(host:string)=>({site:`sc-domain:${host}`,accountId:host,urls:[`https://${host}/a`,`https://${host}/b`],sitemaps:[],warnings:[]});
beforeEach(()=>{vi.useFakeTimers();db=openDb(':memory:');for(const k of ['XMLRIVER_USER','XMLRIVER_KEY','XMLRIVER_THREADS','XMLRIVER_RETRIES'])vi.stubEnv(k,'');setConfigValue(db,'XMLRIVER_USER','123');setConfigValue(db,'XMLRIVER_KEY','secret');setConfigValue(db,'XMLRIVER_THREADS','2');setConfigValue(db,'XMLRIVER_RETRIES','0');});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllEnvs();db.close();});
it('creates all snapshots before sending, queues sites serially under one provider limit and starts idempotently',async()=>{
 let active=0,peak=0;const order:string[]=[];
 const check=vi.fn(async(_c,url:string)=>{expect(listIndexCheckHistory(db).total).toBe(2);active++;peak=Math.max(peak,active);order.push(new URL(url).host);await new Promise(r=>setTimeout(r,10));active--;return {status:'found' as const};});
 const jobs=new IndexCheckJobs(check,0),drafts=[jobs.addDraft(input('a.example')),jobs.addDraft(input('b.example'))];
 const batch=jobs.startBatch(db,drafts.map(d=>d.id),'xmlriver');
 expect(batch.runs.map(r=>r.state)).toEqual(['running','queued']);expect(batch.totalUrls).toBe(4);
 expect(jobs.startBatch(db,drafts.map(d=>d.id),'xmlriver').id).toBe(batch.id);expect(check).toHaveBeenCalledTimes(2);
 expect(()=>jobs.start(db,jobs.addDraft(input('c.example')).id,'xmlriver')).toThrow('уже выполняет');
 setConfigValue(db,'XMLRIVER_THREADS','10');await vi.runAllTimersAsync();const final=await jobs.whenBatchSettled(batch.id,db);
 expect(final).toMatchObject({state:'completed',checkedUrls:4,foundCount:4,finishedSites:2});expect(peak).toBe(2);expect(order).toEqual(['a.example','a.example','b.example','b.example']);
 expect(getSavedIndexCheckRun(db,batch.runs[1].id)?.options?.concurrency).toBe(2);
 expect(new IndexCheckJobs(vi.fn(),0).getBatch(batch.id,db)).toEqual(final);
});
it('cancels both active requests and unstarted sites without sending to later sites',async()=>{
 const check=vi.fn(()=>new Promise<never>(()=>{})),jobs=new IndexCheckJobs(check,0);
 const batch=jobs.startBatch(db,[jobs.addDraft(input('a.example')).id,jobs.addDraft(input('b.example')).id],'xmlriver');
 jobs.cancelBatch(batch.id,db);const final=await jobs.whenBatchSettled(batch.id,db);
 expect(final?.state).toBe('cancelled');expect(final?.runs.map(r=>r.state)).toEqual(['cancelled','cancelled']);expect(check).toHaveBeenCalledTimes(2);
 expect(getSavedIndexCheckRun(db,batch.runs[1].id)?.rows.every(r=>r.status==='skipped')).toBe(true);
});
it('halts later sites on a permanent provider failure and releases the provider reservation',async()=>{
 setConfigValue(db,'XMLRIVER_THREADS','1');
 const check=vi.fn().mockRejectedValue(new IndexProviderError('quota','no balance')),jobs=new IndexCheckJobs(check,0);
 const batch=jobs.startBatch(db,[jobs.addDraft(input('a.example')).id,jobs.addDraft(input('b.example')).id],'xmlriver');
 const final=await jobs.whenBatchSettled(batch.id,db);expect(final?.state).toBe('failed');expect(final?.foundCount).toBeNull();expect(check).toHaveBeenCalledTimes(1);
 expect(getSavedIndexCheckRun(db,batch.runs[1].id)).toMatchObject({state:'failed',stopReason:expect.stringContaining('не запущен')});
 check.mockResolvedValue({status:'found'});const next=jobs.start(db,jobs.addDraft({...input('c.example'),urls:['https://c.example/a']}).id,'xmlriver');expect((await jobs.whenSettled(next.id))?.state).toBe('completed');
});
it('preserves a completed site when another site has errors and keeps independent immutable history',async()=>{
 const check=vi.fn(async(_c,url:string)=>{if(url.includes('b.example'))throw new IndexProviderError('provider','bad response');return {status:'found' as const};});
 const jobs=new IndexCheckJobs(check,0),batch=jobs.startBatch(db,[jobs.addDraft(input('a.example')).id,jobs.addDraft(input('b.example')).id],'xmlriver');
 const final=await jobs.whenBatchSettled(batch.id,db);expect(final).toMatchObject({state:'partial',checkedUrls:2,foundCount:2});
 const first=getSavedIndexCheckRun(db,batch.runs[0].id)!;expect(first.state).toBe('completed');expect(()=>saveIndexCheckRun(db,{...first,state:'failed'})).toThrow('неизменяема');
 expect(listIndexCheckHistory(db,{site:'sc-domain:a.example'}).total).toBe(1);expect(listIndexCheckHistory(db,{site:'sc-domain:b.example'}).total).toBe(1);
});
it('recovers both running and queued sites as interrupted without resending paid work',()=>{
 for(let i=0;i<2;i++){const r:IndexCheckRun={id:'r'+i,accountId:'account',site:`sc-domain:${i}.example`,provider:'xmlriver',engine:'google',state:i===0?'running':'queued',startedAt:100,finishedAt:null,batchId:'saved-batch',batchPosition:i,rows:[{url:`https://${i}.example/a`,status:i===0?'checking':'pending',checkedAt:null}]};saveIndexCheckRun(db,r);}
 const check=vi.fn(),fresh=new IndexCheckJobs(check,0);const batch=fresh.getBatch('saved-batch',db);
 expect(batch?.state).toBe('interrupted');expect(batch?.runs.map(r=>r.state)).toEqual(['interrupted','interrupted']);expect(check).not.toHaveBeenCalled();expect(batch?.foundCount).toBeNull();
});
it('rejects invalid batch selections and already-spent single drafts before a new charge',async()=>{
 const check=vi.fn().mockResolvedValue({status:'found'}),jobs=new IndexCheckJobs(check,0),d=jobs.addDraft(input('a.example'));
 for(const ids of [[],[d.id],[d.id,d.id],Array.from({length:21},(_,i)=>String(i))])expect(()=>jobs.startBatch(db,ids,'xmlriver')).toThrow();
 expect(check).not.toHaveBeenCalled();const r=jobs.start(db,d.id,'xmlriver');await jobs.whenSettled(r.id);
 expect(()=>jobs.startBatch(db,[d.id,jobs.addDraft(input('b.example')).id],'xmlriver')).toThrow('уже запускался');
});
it('does not send anything if the initial multi-site transaction cannot be saved',()=>{
 const prepare=db.prepare.bind(db);vi.spyOn(db,'prepare').mockImplementation(((sql:string)=>{if(sql.includes('INSERT INTO index_check_runs'))throw new Error('disk full');return prepare(sql);}) as any);
 const check=vi.fn(),jobs=new IndexCheckJobs(check,0);expect(()=>jobs.startBatch(db,[jobs.addDraft(input('a.example')).id,jobs.addDraft(input('b.example')).id],'xmlriver')).toThrow('disk full');expect(check).not.toHaveBeenCalled();expect(listIndexCheckHistory(db).total).toBe(0);
});
