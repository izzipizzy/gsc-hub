import { it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { providerCheckTotals, type CheckRecord } from '../src/lib/server/backlink-monitor';
import { saveBacklinkSnapshot, readBacklinkDashboard } from '../src/lib/server/backlink-snapshots';
let db: Db;
beforeEach(() => {db=openDb(':memory:');}); afterEach(() => db.close());
const row=(provider: string, status: 'found'|'missing'|'error'|null, confirmed=false): CheckRecord => ({provider:provider as any,orderId:'order',placementId:'row',sourceUrl:'https://donor.example/',targetUrl:'https://mysite.com/',expectedAnchor:'Anchor',checkedAt:1,history:[],result:status?{status,confirmed,anchorChanged:false,links:[],finalUrl:'https://donor.example/',error:null}:null});
it('aggregates all providers including future ones, keeping errors and uncertain results out of dead counts', () => {
  const totals=providerCheckTotals([row('fieldlink','found'),row('fieldlink','error'),row('magic369','missing',false),row('future-provider','missing',true),row('future-provider',null)]);
  expect(totals.all).toMatchObject({total:5,found:1,missing:1,suspect:1,errors:1,unchecked:1});
  expect(totals['future-provider']).toMatchObject({total:2,missing:1});
  expect(readBacklinkDashboard(db,totals,10).providers).toContainEqual({id:'future-provider',name:'future-provider'});
});
it('starts with one honest baseline and preserves immutable counts over later checks', () => {
  const first=providerCheckTotals([row('fieldlink','found')]);
  expect(readBacklinkDashboard(db,first,10).history).toHaveLength(1);
  const later=providerCheckTotals([row('fieldlink','missing',true),row('magic369','found')]);
  expect(readBacklinkDashboard(db,later,20).history).toHaveLength(1);
  saveBacklinkSnapshot(db,later,1,30); saveBacklinkSnapshot(db,later,1,40);
  const data=readBacklinkDashboard(db,later,50);
  expect(data.history.map((p)=>p.at)).toEqual([10,30]);
  expect(data.history[0].totals.all).toMatchObject({total:1,found:1,missing:0});
  expect(data.history[1].totals.all).toMatchObject({total:2,found:1,missing:1});
});
