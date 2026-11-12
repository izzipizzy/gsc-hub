import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { setConfigValue } from '../src/lib/server/config';
import { indexCheckBalance } from '../src/lib/server/index-check-balance';
let db: Db;
beforeEach(()=>{db=openDb(':memory:');for(const key of ['XMLRIVER_USER','XMLRIVER_KEY','DATAFORSEO_LOGIN','DATAFORSEO_PASSWORD'] as const){vi.stubEnv(key,'');setConfigValue(db,key,key==='XMLRIVER_USER'?'123':'private-secret');}});
afterEach(()=>{db.close();vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('uses only the official balance endpoint and preserves a valid zero',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response('0.000'));vi.stubGlobal('fetch',fetcher);
 expect(await indexCheckBalance(db,'xmlriver')).toMatchObject({amount:0,currency:'RUB'});
 const u=new URL(fetcher.mock.calls[0][0]);expect(u.pathname).toBe('/api/get_balance/');expect(u.searchParams.has('query')).toBe(false);
});
it('extracts only DataForSEO money.balance in USD, not deposits or account information',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({status_code:20000,tasks:[{status_code:20000,result:[{login:'private-login',money:{balance:12.34,total:999}}]}]}));vi.stubGlobal('fetch',fetcher);
 const b=await indexCheckBalance(db,'dataforseo');expect(b).toMatchObject({amount:12.34,currency:'USD'});expect(JSON.stringify(b)).not.toContain('private');expect(fetcher.mock.calls[0][0]).toBe('https://api.dataforseo.com/v3/appendix/user_data');
});
it.each(['ERROR private-secret','<html>error</html>','NaN',''])('rejects bad balance responses without echoing secrets or reporting zero',async(body)=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(body)));
 await expect(indexCheckBalance(db,'xmlriver')).rejects.toThrow('Баланс недоступен');
 try{await indexCheckBalance(db,'xmlriver');}catch(e){expect((e as Error).message).not.toContain('private-secret');}
});
it('has a hard deadline even when fetch ignores abort',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
 const promise=indexCheckBalance(db,'xmlriver');const assertion=expect(promise).rejects.toThrow('15 секунд');
 await vi.advanceTimersByTimeAsync(15_000);await assertion;
});
