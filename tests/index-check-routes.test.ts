import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { setConfigValue } from '../src/lib/server/config';
import { upsertAccount } from '../src/lib/server/accounts';
let database: Db;
vi.mock('../src/lib/server/db', async (original) => ({ ...await original<typeof import('../src/lib/server/db')>(), db: () => database }));
const { listSites, listMaps, collect, start, get, cancel, history, startBatch, getBatch, cancelBatch } = vi.hoisted(() => ({ listSites:vi.fn(),listMaps:vi.fn(),collect:vi.fn(),start:vi.fn(),get:vi.fn(),cancel:vi.fn(),history:vi.fn(),startBatch:vi.fn(),getBatch:vi.fn(),cancelBatch:vi.fn() }));
vi.mock('../src/lib/server/google', () => ({ listSitesForAllAccounts: listSites, listSitemaps: listMaps }));
vi.mock('../src/lib/server/index-check-sitemap', () => ({ collectCheckSitemap: collect }));
vi.mock('../src/lib/server/index-check-jobs', () => ({ indexCheckJobs: { start,get,cancel,history,startBatch,getBatch,cancelBatch,addDraft: (input: any) => ({...input,id:'draft'}) } }));
import { GET as BALANCE } from '../src/routes/settings/index-check/balance/+server';
import { GET, POST } from '../src/routes/index-check/api/+server';
import { load } from '../src/routes/index-check/+page.server';
import { load as settingsLoad, actions } from '../src/routes/settings/index-check/+page.server';
import { saveIndexCheckRun } from '../src/lib/server/index-check-history';
const site='sc-domain:example.com';
const locals={user:{role:'admin'}};
const post=(body:unknown,role='admin')=>POST({locals:{user:{role}},request:new Request('http://localhost/index-check/api',{method:'POST',body:JSON.stringify(body)})} as any);
const formEvent=(entries:Record<string,string>,role='admin')=>{
  const form=new FormData();for(const [k,v] of Object.entries(entries))form.set(k,v);
  return {locals:{user:{role}},request:new Request('http://localhost/settings/index-check',{method:'POST',body:form})} as any;
};
beforeEach(()=>{
  database=openDb(':memory:');
  for(const key of ['XMLRIVER_USER','XMLRIVER_KEY','DATAFORSEO_LOGIN','DATAFORSEO_PASSWORD','NEURALINDEXER_API_TOKEN'])vi.stubEnv(key,'');
  upsertAccount(database,{id:'account',email:'owner@example.com',access_token:'private-google-token',refresh_token:'private-refresh',expires_at:9999999999,scope:''});
  listSites.mockResolvedValue({sites:[{siteUrl:site,accountId:'account',accountEmail:'owner@example.com',accountLabel:null}],errors:[]});
  listMaps.mockResolvedValue([{path:'https://example.com/gsc.xml'}]);
  collect.mockResolvedValue({urls:['https://example.com/a'],sitemaps:['https://example.com/sitemap.xml'],warnings:[]});
  history.mockReturnValue({entries:[],total:0,offset:0,limit:50});
  start.mockReturnValue({id:'run',state:'running'});get.mockReturnValue({id:'run',state:'running'});cancel.mockReturnValue({id:'run',state:'cancelled'});
});
afterEach(()=>{database.close();vi.clearAllMocks();vi.unstubAllEnvs();});
it('requires an admin on the page, job API and every new settings action',async()=>{
  await expect(load({locals:{user:{role:'manager'}},url:new URL('http://localhost/index-check')} as any)).rejects.toMatchObject({status:403});
  expect(()=>GET({locals:{user:{role:'manager'}},url:new URL('http://localhost/index-check/api?id=run')} as any)).toThrowError(expect.objectContaining({status:403}));
  await expect(post({action:'prepare',site,accountId:'account'},'manager')).rejects.toMatchObject({status:403});
  await expect((actions.saveIndexCheck as any)(formEvent({provider:'xmlriver'},'manager'))).rejects.toMatchObject({status:403});
  await expect((actions.clearIndexCheck as any)(formEvent({provider:'xmlriver'},'manager'))).rejects.toMatchObject({status:403});
  expect(collect).not.toHaveBeenCalled();expect(start).not.toHaveBeenCalled();
});
it('loads only public site/settings metadata and restores a known site selection',async()=>{
  setConfigValue(database,'XMLRIVER_USER','123');setConfigValue(database,'XMLRIVER_KEY','private-api-key');
  const result=await load({locals,url:new URL('http://localhost/index-check?account=account&site='+encodeURIComponent(site))} as any) as any;
  expect(result.initialSelection).toBe(JSON.stringify(['account',site]));
  expect(JSON.stringify(result)).not.toContain('private-');
});
it('prepares an immutable server-side URL draft without starting provider work',async()=>{
  const r=await post({action:'prepare',site,accountId:'account'});
  expect((await r.json()).draft).toMatchObject({id:'draft',site,accountId:'account',urls:['https://example.com/a']});
  expect(collect).toHaveBeenCalledWith(site,'',undefined,expect.any(Function));expect(start).not.toHaveBeenCalled();
});
it('rejects unknown account/property, malformed input and bad XML before provider calls',async()=>{
  await expect(post({action:'prepare',site,accountId:'unknown'})).rejects.toMatchObject({status:400});
  await expect(post({action:'prepare',site:'sc-domain:foreign.com',accountId:'account'})).rejects.toMatchObject({status:400});
  expect(collect).not.toHaveBeenCalled();
  collect.mockRejectedValueOnce(new Error('HTTP 503'));
  await expect(post({action:'prepare',site,accountId:'account'})).rejects.toMatchObject({status:400,body:{message:expect.stringContaining('HTTP 503')}});
  for(const body of [null,[],{action:'prepare',site,accountId:42},{action:'start',draftId:'draft',provider:'unknown',confirmed:true},{action:'start',draftId:'draft',provider:'xmlriver'}]){
    await expect(post(body)).rejects.toMatchObject({status:400});
  }
  await expect(post({action:'prepare',site,accountId:'account',sitemap:'a'.repeat(9000)})).rejects.toMatchObject({status:413});
  expect(start).not.toHaveBeenCalled();
});
it('requires explicit confirmation, polls without re-running and can stop the selected run',async()=>{
  expect((await (await post({action:'start',draftId:'draft',provider:'dataforseo',confirmed:true,expectedOptions:{concurrency:1,retries:3,retryDelayMinutes:3}})).json()).run.id).toBe('run');
  expect(start).toHaveBeenCalledWith(database,'draft','dataforseo');
  const response=await GET({locals,url:new URL('http://localhost/index-check/api?id=run')} as any);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json()).run.state).toBe('running');expect(start).toHaveBeenCalledTimes(1);
  expect((await (await post({action:'cancel',id:'run'})).json()).run.state).toBe('cancelled');
  get.mockReturnValueOnce(null);expect(()=>GET({locals,url:new URL('http://localhost/index-check/api?id=missing')} as any)).toThrowError(expect.objectContaining({status:404}));
});
it('saves/clears each settings pair independently and does not return credentials even on validation errors',async()=>{
  const result=await (actions.saveIndexCheck as any)(formEvent({provider:'xmlriver',XMLRIVER_USER:'123',XMLRIVER_KEY:'private-xml-key'}));
  expect(result).toEqual({saved:true,provider:'xmlriver'});
  await (actions.saveIndexCheck as any)(formEvent({provider:'dataforseo',DATAFORSEO_LOGIN:'api@example.com',DATAFORSEO_PASSWORD:'private-dfs-password'}));
  const data=await settingsLoad({locals} as any) as any;
  expect(data.indexCheck.every((p:any)=>p.configured)).toBe(true);expect(JSON.stringify(data)).not.toContain('private-');
  const failure=await (actions.saveIndexCheck as any)(formEvent({provider:'xmlriver',XMLRIVER_USER:'private invalid value'}));
  expect(failure.status).toBe(400);expect(JSON.stringify(failure)).not.toContain('private invalid');
  await (actions.clearIndexCheck as any)(formEvent({provider:'xmlriver'}));
  const after=await settingsLoad({locals} as any) as any;
  expect(after.indexCheck.find((p:any)=>p.id==='xmlriver').configured).toBe(false);
  expect(after.indexCheck.find((p:any)=>p.id==='dataforseo').configured).toBe(true);
});

it('protects, filters and paginates the durable history endpoint without paid requests', async () => {
  const url=new URL('http://localhost/index-check/api?action=history&site=sc-domain%3Aexample.com&account=account&offset=50');
  expect(()=>GET({locals:{user:{role:'manager'}},url} as any)).toThrowError(expect.objectContaining({status:403}));
  const response=await GET({locals,url} as any);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(history).toHaveBeenCalledWith(database,{site,accountId:'account',offset:50});
  expect((await response.json()).history.entries).toEqual([]);
  expect(start).not.toHaveBeenCalled();
  for(const offset of ['-1','x','1000001'])expect(()=>GET({locals,url:new URL('http://localhost/index-check/api?action=history&offset='+offset)} as any)).toThrowError(expect.objectContaining({status:400}));
});
it('protects a plain-text negative-URL export for a run or batch without sending provider requests',async()=>{
 saveIndexCheckRun(database,{id:'export-run',accountId:'account',site,provider:'xmlriver',engine:'google',state:'completed',startedAt:100,finishedAt:200,batchId:'export-batch',batchPosition:0,rows:[{url:'https://example.com/missing?x=1&y=2',status:'not_found',checkedAt:200},{url:'https://example.com/found',status:'found',checkedAt:200},{url:'https://example.com/error',status:'error',checkedAt:200}]});
 for(const scope of ['run=export-run','batch=export-batch']){
  const url=new URL('http://localhost/index-check/api?action=exportNotFound&'+scope);
  expect(()=>GET({locals:{user:{role:'manager'}},url} as any)).toThrowError(expect.objectContaining({status:403}));
  const response=await GET({locals,url} as any);
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toBe('https://example.com/missing?x=1&y=2');
 }
 for(const query of ['','&run=','&run=export-run&batch=export-batch'])expect(()=>GET({locals,url:new URL('http://localhost/index-check/api?action=exportNotFound'+query)} as any)).toThrowError(expect.objectContaining({status:400}));
 expect(()=>GET({locals,url:new URL('http://localhost/index-check/api?action=exportNotFound&run=absent')} as any)).toThrowError(expect.objectContaining({status:404}));
 expect(start).not.toHaveBeenCalled();expect(startBatch).not.toHaveBeenCalled();expect(listSites).not.toHaveBeenCalled();
});

it('saves bounded execution settings separately from credentials and protects mutations', async () => {
  await expect((actions.saveCheckOptions as any)(formEvent({provider:'xmlriver',XMLRIVER_THREADS:'2'},'manager'))).rejects.toMatchObject({status:403});
  expect(await (actions.saveCheckOptions as any)(formEvent({provider:'xmlriver',XMLRIVER_THREADS:'2',XMLRIVER_RETRIES:'3',XMLRIVER_RETRY_DELAY_MINUTES:'3'}))).toEqual({saved:true,provider:'xmlriver'});
  const saved=await settingsLoad({locals} as any) as any;
  expect(saved.indexCheck.find((p:any)=>p.id==='xmlriver').options.find((o:any)=>o.key==='XMLRIVER_THREADS').value).toBe(2);
  const bad=await (actions.saveCheckOptions as any)(formEvent({provider:'xmlriver',XMLRIVER_THREADS:'11'}));expect(bad.status).toBe(400);
});

it('protects balance reads and returns only balance metadata', async () => {
 const url=new URL('http://localhost/settings/index-check/balance?provider=xmlriver');
 await expect(BALANCE({locals:{user:{role:'manager'}},url} as any)).rejects.toMatchObject({status:403});
 setConfigValue(database,'XMLRIVER_USER','123');setConfigValue(database,'XMLRIVER_KEY','private-xml-key');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('12.5')));
 try { const response=await BALANCE({locals,url} as any);expect(response.headers.get('cache-control')).toBe('no-store');const result=await response.json();expect(result.balance).toMatchObject({amount:12.5,currency:'RUB'});expect(JSON.stringify(result)).not.toContain('private'); }
 finally { vi.unstubAllGlobals(); }
});

it('rejects a stale paid-start confirmation when execution settings changed',async()=>{
 await expect(post({action:'start',draftId:'draft',provider:'xmlriver',confirmed:true,expectedOptions:{concurrency:10,retries:0,retryDelayMinutes:3}})).rejects.toMatchObject({status:400});
 expect(start).not.toHaveBeenCalled();
});

it('passes the selected account/property sitemap list into discovery, without submitting or guessing maps',async()=>{
 await post({action:'prepare',site,accountId:'account'});
 const registered=collect.mock.calls[0][3];const signal=new AbortController().signal;
 expect(await registered(signal)).toEqual(['https://example.com/gsc.xml']);
 expect(listMaps).toHaveBeenCalledWith(database,expect.objectContaining({id:'account'}),site,signal);
});

it('requires confirmation/admin, bounds batch input and returns queue/detail without starting during polls',async()=>{
 const batch={id:'batch',activeRunId:'run',runs:[{id:'run'}],state:'running'};startBatch.mockReturnValue(batch);getBatch.mockReturnValue(batch);cancelBatch.mockReturnValue(batch);
 const body={action:'startBatch',draftIds:['a','b'],provider:'xmlriver',confirmed:true,expectedOptions:{concurrency:10,retries:3,retryDelayMinutes:3}};
 await expect(post(body,'manager')).rejects.toMatchObject({status:403});
 const started=await(await post(body)).json();expect(started.batch.id).toBe('batch');expect(startBatch).toHaveBeenCalledWith(database,['a','b'],'xmlriver');
 const response=await GET({locals,url:new URL('http://localhost/index-check/api?action=batch&id=batch')} as any);expect((await response.json()).batch.id).toBe('batch');expect(startBatch).toHaveBeenCalledTimes(1);
 expect(()=>GET({locals,url:new URL('http://localhost/index-check/api?action=batch&id=batch&run=foreign')} as any)).toThrowError(expect.objectContaining({status:400}));
 expect((await(await post({action:'cancelBatch',id:'batch'})).json()).batch.id).toBe('batch');
 for(const draftIds of [[],['a'],Array(21).fill('a'),[123,'b']])await expect(post({...body,draftIds})).rejects.toMatchObject({status:400});
});
