import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { setConfigValue, getConfigValue } from '../src/lib/server/config';
import { saveIndexCheckRun, saveIndexCheckProgress, getSavedIndexCheckRun, listIndexCheckHistory, getIndexCheckNotFoundUrls } from '../src/lib/server/index-check-history';
import { IndexCheckJobs } from '../src/lib/server/index-check-jobs';
import type { IndexCheckRun } from '../src/lib/utils/index-check';
let db: Db, dir: string, path: string;
const row=(status:'found'|'not_found'|'error'|'checking'|'pending',url='https://example.com/a')=>({url,status,checkedAt:status==='pending'||status==='checking'?null:100});
function run(id='first', changes: Partial<IndexCheckRun>={}): IndexCheckRun {
  return {id,accountId:'account',site:'sc-domain:example.com',provider:'xmlriver',engine:'google',state:'completed',startedAt:100,finishedAt:200,rows:[row('found')],...changes};
}
const draft={site:'sc-domain:example.com',accountId:'account',urls:['https://example.com/a','https://example.com/b'],sitemaps:['https://example.com/sitemap.xml'],warnings:[]};
beforeEach(()=>{
 dir=mkdtempSync(join(tmpdir(),'gsc-check-history-'));path=join(dir,'app.db');db=openDb(path);
  setConfigValue(db,'XMLRIVER_THREADS','1'); setConfigValue(db,'XMLRIVER_RETRIES','0'); setConfigValue(db,'DATAFORSEO_RETRIES','0');
 for(const key of ['XMLRIVER_USER','XMLRIVER_KEY','DATAFORSEO_LOGIN','DATAFORSEO_PASSWORD'] as const){vi.stubEnv(key,'');setConfigValue(db,key,key==='XMLRIVER_USER'?'123':'test-secret');}
});
afterEach(()=>{vi.restoreAllMocks();db.close();rmSync(dir,{recursive:true,force:true});vi.unstubAllEnvs();});
it('keeps distinct immutable snapshots through repeated runs, database reopen and worker restart',()=>{
 const first=run();saveIndexCheckRun(db,first);saveIndexCheckRun(db,first);
 const second=run('second',{provider:'dataforseo',startedAt:300,finishedAt:400,rows:[row('not_found'),row('found','https://example.com/b')]});
 saveIndexCheckRun(db,second);
 expect(()=>saveIndexCheckRun(db,run('first',{rows:[row('not_found')]}))).toThrow('неизменяема');
 expect(()=>saveIndexCheckRun(db,run('first',{accountId:'other'}))).toThrow('уже используется');
 db.close();db=openDb(path);
 const fresh=new IndexCheckJobs(vi.fn(),0);
 expect(fresh.get('first',db)).toEqual(first);expect(fresh.get('second',db)).toEqual(second);
 const page=fresh.history(db);expect(page.total).toBe(2);expect(page.entries.map(e=>e.id)).toEqual(['second','first']);
 expect(page.entries[0]).toMatchObject({provider:'dataforseo',engine:'google',startedAt:300,finishedAt:400,totalUrls:2,foundCount:1,checkedUrls:2});
});
it('uses null for unavailable findings and preserves a real zero only after valid search responses',()=>{
 saveIndexCheckRun(db,run('failed',{state:'failed',rows:[row('error'),{...row('pending','https://example.com/b'),status:'skipped'}]}));
 saveIndexCheckRun(db,run('zero',{rows:[row('not_found')]}));
 const entries=listIndexCheckHistory(db).entries;
 expect(entries.find(e=>e.id==='failed')).toMatchObject({totalUrls:2,checkedUrls:0,foundCount:null,errorCount:1,skippedCount:1});
 expect(entries.find(e=>e.id==='zero')).toMatchObject({totalUrls:1,checkedUrls:1,foundCount:0});
});
it('exports every saved not-found URL across pages and sites, excluding errors and unprocessed rows',()=>{
 const missing=Array.from({length:125},(_,i)=>row('not_found',`https://example.com/missing-${i}`));
 saveIndexCheckRun(db,run('one',{batchId:'batch',batchPosition:0,rows:[...missing,row('found','https://example.com/found'),row('error','https://example.com/error'),row('pending','https://example.com/pending'),row('checking','https://example.com/checking'),{...row('pending','https://example.com/retry'),status:'retrying'},{...row('pending','https://example.com/skipped'),status:'skipped'}]}));
 saveIndexCheckRun(db,run('two',{batchId:'batch',batchPosition:1,rows:[row('not_found',missing[0].url),row('not_found','https://second.example/missing')]}));
 saveIndexCheckRun(db,run('unrelated',{rows:[row('not_found','https://other.example/missing')]}));
 db.close();db=openDb(path);
 expect(getIndexCheckNotFoundUrls(db,'one','run')).toEqual(missing.map(r=>r.url));
 expect(getIndexCheckNotFoundUrls(db,'batch','batch')).toEqual([...missing.map(r=>r.url),'https://second.example/missing']);
 expect(getIndexCheckNotFoundUrls(db,'absent','run')).toBeNull();
 expect(getIndexCheckNotFoundUrls(db,'absent','batch')).toBeNull();
});
it('distinguishes an existing check without negative results from missing history',()=>{
 saveIndexCheckRun(db,run('all-found'));
 expect(getIndexCheckNotFoundUrls(db,'all-found','run')).toEqual([]);
});
it('rejects non-Google history and excludes extra fields such as credentials',()=>{
 expect(()=>saveIndexCheckRun(db,{...run(),engine:'yandex'} as any)).toThrow('Google');
 const withExtra={...run(),credentials:{secret:'must-not-persist'},rows:[{...row('found'),secret:'must-not-persist'}]};
 saveIndexCheckRun(db,withExtra);
 const tables=JSON.stringify({header:db.prepare('SELECT * FROM index_check_runs').all(),rows:db.prepare('SELECT * FROM index_check_results').all()});
 expect(tables).not.toContain('must-not-persist');expect(getSavedIndexCheckRun(db,'first')).toEqual(run());
});
it('recovers an interrupted request without automatic retries and keeps earlier observed results',()=>{
 const interrupted=run('crash',{state:'running',finishedAt:null,rows:[row('found'),row('checking','https://example.com/b'),row('pending','https://example.com/c')]});
 saveIndexCheckRun(db,interrupted);db.close();db=openDb(path);
 const check=vi.fn(),fresh=new IndexCheckJobs(check,0,()=>500);
 const recovered=fresh.get('crash',db)!;
 expect(recovered).toMatchObject({state:'interrupted',finishedAt:500});
 expect(recovered.rows.map(r=>r.status)).toEqual(['found','error','skipped']);
 expect(recovered.rows[1]).toMatchObject({errorCode:'interrupted',checkedAt:null});expect(check).not.toHaveBeenCalled();
 expect(fresh.history(db).entries[0]).toMatchObject({totalUrls:3,checkedUrls:1,foundCount:1,errorCount:1,skippedCount:1});
 expect(fresh.get('crash',db)).toEqual(recovered);
});
it('journals the current URL before a paid request, preserves active runs and saves final results',async()=>{
 let release!: (value:{status:'found'})=>void;
 const check=vi.fn().mockImplementationOnce(()=>{
  const saved=listIndexCheckHistory(db).entries[0];expect(saved.state).toBe('running');
  expect(getSavedIndexCheckRun(db,saved.id)?.rows[0].status).toBe('checking');
  return new Promise(resolve=>{release=resolve;});
 }).mockResolvedValue({status:'not_found'});
 const jobs=new IndexCheckJobs(check,0),d=jobs.addDraft(draft),r=jobs.start(db,d.id,'xmlriver');
 expect(jobs.history(db).entries[0].state).toBe('running');
 release({status:'found'});await jobs.whenSettled(r.id);
 expect(getSavedIndexCheckRun(db,r.id)).toEqual(jobs.get(r.id));
 const fresh=new IndexCheckJobs(vi.fn(),0);expect(fresh.get(r.id,db)?.state).toBe('completed');
 expect(fresh.history(db).entries[0]).toMatchObject({totalUrls:2,checkedUrls:2,foundCount:1});
});
it('preserves cancelled and expired in-memory results in durable history',async()=>{
 let now=0;const check=vi.fn().mockResolvedValue({status:'not_found'}),jobs=new IndexCheckJobs(check,0,()=>now);
 const d=jobs.addDraft(draft),r=jobs.start(db,d.id,'xmlriver');await jobs.whenSettled(r.id);
 now=31*60_000;expect(jobs.get(r.id)).toBeNull();expect(jobs.get(r.id,db)?.state).toBe('completed');
 expect(()=>jobs.start(db,d.id,'xmlriver')).toThrow('устарел');
 const saved=run('cancelled',{state:'cancelled',rows:[{...row('pending'),status:'skipped'}]});saveIndexCheckRun(db,saved);
 expect(new IndexCheckJobs().get('cancelled',db)).toEqual(saved);
});
it('filters by site/account and pages all prior snapshots without returning URL rows in the summary',()=>{
 db.transaction(()=>{for(let i=0;i<55;i++)saveIndexCheckRun(db,run('r'+i,{startedAt:100+i,finishedAt:200+i,accountId:i===0?'other':'account'}));})();
 expect(listIndexCheckHistory(db).entries).toHaveLength(50);expect(listIndexCheckHistory(db,{offset:50}).entries).toHaveLength(5);
 const page=listIndexCheckHistory(db,{site:'sc-domain:example.com',accountId:'account'});expect(page.total).toBe(54);expect(page.entries[0].id).toBe('r54');
 expect(page.entries[0]).not.toHaveProperty('rows');expect(listIndexCheckHistory(db,{site:"' OR 1=1 --"}).total).toBe(0);
 expect(()=>listIndexCheckHistory(db,{offset:-1})).toThrow();
});
it('adds the schema idempotently to an existing database without losing its configuration',()=>{
 db.exec('DROP TABLE index_check_results; DROP TABLE index_check_runs;');
 setConfigValue(db,'NEURALINDEXER_API_TOKEN','existing-config');db.close();db=openDb(path);
 expect(getConfigValue(db,'NEURALINDEXER_API_TOKEN')).toBe('existing-config');expect(listIndexCheckHistory(db).total).toBe(0);
 saveIndexCheckRun(db,run());db.close();db=openDb(path);expect(listIndexCheckHistory(db).total).toBe(1);
});
it('does not send a paid request if the initial history write fails',()=>{
 const original=db.prepare.bind(db);vi.spyOn(db,'prepare').mockImplementation(((sql:string)=>{if(sql.includes('INSERT INTO index_check_runs'))throw new Error('disk full');return original(sql);}) as any);
 const check=vi.fn(),jobs=new IndexCheckJobs(check,0),d=jobs.addDraft(draft);
 expect(()=>jobs.start(db,d.id,'xmlriver')).toThrow('disk full');expect(check).not.toHaveBeenCalled();
});
it('stops after a journal write failure and exposes unsaved state instead of continuing to spend',async()=>{
 const original=db.prepare.bind(db);let fail=false;
 vi.spyOn(db,'prepare').mockImplementation(((sql:string)=>{if(fail&&sql.includes('INSERT INTO index_check_runs'))throw new Error('disk full');return original(sql);}) as any);
 const check=vi.fn(async()=>{fail=true;return {status:'found' as const};});
 const jobs=new IndexCheckJobs(check,0),d=jobs.addDraft(draft),r=jobs.start(db,d.id,'xmlriver');
 const result=await jobs.whenSettled(r.id);expect(result?.persistenceError).toContain('сохранить');
 expect(result?.rows.map(r=>r.status)).toEqual(['found','skipped']);expect(check).toHaveBeenCalledTimes(1);
 fail=false;const recovered=new IndexCheckJobs(vi.fn(),0).get(r.id,db);
 expect(recovered?.state).toBe('interrupted');expect(recovered?.rows[0].status).toBe('error');
});

it('migrates the previous history schema additively and keeps archived rows unchanged',()=>{
 saveIndexCheckRun(db,run('legacy'));
 db.exec('DROP INDEX IF EXISTS idx_index_check_batch');
 for(const column of ['options_json','stop_reason','batch_id','batch_position'])db.exec(`ALTER TABLE index_check_runs DROP COLUMN ${column}`);
 for(const column of ['attempts','next_attempt_at','attempt_started_at'])db.exec(`ALTER TABLE index_check_results DROP COLUMN ${column}`);
 db.close();db=openDb(path);expect(getSavedIndexCheckRun(db,'legacy')).toEqual(run('legacy'));
 db.close();db=openDb(path);expect(getSavedIndexCheckRun(db,'legacy')).toEqual(run('legacy'));
});

it('reopens a saved multi-site queue and marks both active and unstarted sites interrupted',()=>{
 saveIndexCheckRun(db,run('queued-a',{state:'running',finishedAt:null,batchId:'batch',batchPosition:0,rows:[row('checking')]}));
 saveIndexCheckRun(db,run('queued-b',{state:'queued',finishedAt:null,batchId:'batch',batchPosition:1,site:'sc-domain:second.example',rows:[row('pending','https://second.example/a')]}));
 db.close();db=openDb(path);const check=vi.fn(),fresh=new IndexCheckJobs(check,0);
 const batch=fresh.getBatch('batch',db);expect(batch?.state).toBe('interrupted');expect(batch?.runs.map(r=>r.id)).toEqual(['queued-a','queued-b']);expect(check).not.toHaveBeenCalled();
});
