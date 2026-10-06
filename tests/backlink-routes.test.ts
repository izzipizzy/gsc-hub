import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { setConfigValue } from '../src/lib/server/config';
let database: Db;
vi.mock('../src/lib/server/db', async (original) => ({ ...await original<typeof import('../src/lib/server/db')>(), db: () => database }));
vi.mock('../src/lib/server/backlink-monitor', async (original) => ({ ...await original<typeof import('../src/lib/server/backlink-monitor')>(), startBacklinkMonitor: vi.fn() }));
const { field, magic } = vi.hoisted(() => ({ field: { order: vi.fn() }, magic: { order: vi.fn(), orderArticles: vi.fn() } }));
vi.mock('../src/lib/server/magiclinks', async (original) => ({ ...await original<typeof import('../src/lib/server/magiclinks')>(), magicLinksClient: () => field }));
vi.mock('../src/lib/server/magic369', async (original) => ({ ...await original<typeof import('../src/lib/server/magic369')>(), magic369Client: () => magic }));
import { load } from '../src/routes/magiclinks/[orderId]/+page.server';
import { actions } from '../src/routes/magiclinks/+page.server';
import { GET, POST } from '../src/routes/magiclinks/checks/+server';
import { syncPlacements, recordCheck, latestJob } from '../src/lib/server/backlink-monitor';
import { backlinkSettings } from '../src/lib/server/backlink-fetch';
import { recordPurchases } from '../src/lib/server/magiclinks-purchases';
const admin = { user: { role: 'admin' } };
const p = { provider: 'fieldlink' as const, orderId: 'order', placementId: 'row', sourceUrl: 'https://donor.example/article/', targetUrl: 'https://mysite.com/page/', expectedAnchor: 'Anchor' };
beforeEach(() => {
  database = openDb(':memory:');
  field.order.mockResolvedValue({ order: {id:'order',status:'completed',rowCount:1,completedCount:1,failedCount:0}, rows: [{id:'row', status:'completed', input:{targetUrl:p.targetUrl,anchor:'Anchor',language:'en'},result:{destination:p.sourceUrl}}] });
  magic.order.mockResolvedValue({ id:'369-order', status:'completed', progress:{total:1,published:1}, items:[{url:p.targetUrl,anchor:'Anchor',language:'en'}] });
  magic.orderArticles.mockResolvedValue([{id:42,url:p.targetUrl,anchor:'Anchor',publishedUrl:p.sourceUrl,publishedAt:null,title:'Article'}]);
});
afterEach(() => { database.close(); vi.clearAllMocks(); });
it('exposes saved checks and history beside live FieldLink placements', async () => {
  syncPlacements(database,p.provider,p.orderId,[p]);
  recordCheck(database,p,{status:'found',links:[{url:p.targetUrl,anchor:'Anchor',rel:'nofollow'}],finalUrl:p.sourceUrl,error:null},0);
  const data = await load({locals:admin,params:{orderId:'order'},url:new URL('http://localhost/magiclinks/order')} as any) as any;
  expect(data.checks.row.result.status).toBe('found');
  expect(data.checks.row.history).toHaveLength(1);
  expect(data.checkSummary).toMatchObject({found:1,changed:1});
});
it('discovers all 369 placements even when the displayed order has a URL filter', async () => {
  recordPurchases(database,[{siteHost:'mysite.com',targetUrl:p.targetUrl,query:'Anchor',language:'en',quantity:1,orderId:'369-order',taskId:'369-order',provider:'magic369'}]);
  const data = await load({locals:admin,params:{orderId:'369-order'},url:new URL('http://localhost/magiclinks/369-order?url=https://mysite.com/other/')} as any) as any;
  expect(data.content.articles).toEqual([]);
  expect(data.checks['42'].sourceUrl).toBe(p.sourceUrl);
});
it('queues checks, rejects conflicting scopes, and exposes progress without credentials', async () => {
  setConfigValue(database,'BACKLINK_PROXY_URL','socks5://privateUser:privatePass@proxy.example:1080');
  const event = (body: unknown) => ({locals:admin,request:new Request('http://localhost/magiclinks/checks',{method:'POST',body:JSON.stringify(body)})}) as any;
  expect((await POST(event({provider:'fieldlink',orderId:'order',placementId:'row'}))).status).toBe(202);
  expect(latestJob(database)).toMatchObject({provider:'fieldlink',order_id:'order',placement_id:'row',status:'queued'});
  await expect(POST(event({}))).rejects.toMatchObject({status:409});
  const output = await GET({locals:admin,url:new URL('http://localhost/magiclinks/checks')} as any);
  expect(await output.text()).not.toContain('private');
  await expect(POST(event({provider:'invalid'}))).rejects.toMatchObject({status:400});
});
it('requires admin for read, check and proxy settings', async () => {
  const locals = {user:{role:'manager'}};
  expect(() => GET({locals,url:new URL('http://localhost')} as any)).toThrow();
  await expect(POST({locals,request:new Request('http://localhost',{method:'POST',body:'{}'})} as any)).rejects.toMatchObject({status:403});
  await expect(actions.saveBacklinkSettings({locals,request:new Request('http://localhost',{method:'POST'})} as any)).rejects.toMatchObject({status:403});
});
it('validates proxy auth, preserves a blank proxy, disables schedule and supports removal', async () => {
  const save = async (entries: Record<string,string>) => {
    const form = new FormData(); for (const [k,v] of Object.entries(entries)) form.set(k,v);
    return actions.saveBacklinkSettings({locals:admin,request:new Request('http://localhost',{method:'POST',body:form})} as any);
  };
  expect(await save({proxy:'socks4://user:pass@proxy.example:1080',automatic:'on'})).toMatchObject({status:400});
  expect(await save({proxy:'socks5://user:pass@proxy.example:1080',automatic:'on'})).toEqual({backlinkSaved:true});
  await save({proxy:''});
  expect(backlinkSettings(database)).toMatchObject({proxyConfigured:true,automatic:false});
  await save({proxy:'',clearProxy:'on',automatic:'on'});
  expect(backlinkSettings(database)).toMatchObject({proxyConfigured:false,automatic:true});
});
