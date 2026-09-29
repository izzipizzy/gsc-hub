import { describe, it, expect } from 'vitest';
import { aggregateBingRows, bingCacheKey, parseBingDate } from '../src/lib/server/bing';

const AUG_24 = Date.UTC(2025, 7, 24);   // внутри окна августа
const JUL_01 = Date.UTC(2025, 6, 1);    // вне его

describe('bing rows', () => {
  it('parses the /Date(...)/ wire format', () => {
    expect(parseBingDate(`/Date(${AUG_24})/`)).toBe('2025-08-24');
    expect(parseBingDate('nonsense')).toBeNull();
  });

  it('keeps only rows inside the window', () => {
    const rows = [
      { Query: 'a', Date: `/Date(${AUG_24})/`, Clicks: 1, Impressions: 10, AvgImpressionPosition: 5 },
      { Query: 'a', Date: `/Date(${JUL_01})/`, Clicks: 9, Impressions: 90, AvgImpressionPosition: 9 }
    ];
    const out = aggregateBingRows(rows as never, '2025-08-01', '2025-08-31');
    expect(out).toEqual([{ query: 'a', clicks: 1, impressions: 10, ctr: 0.1, position: 5 }]);
  });

  it('drops site: operator noise', () => {
    const rows = [{ Query: 'site:example.com', Date: `/Date(${AUG_24})/`,
                    Clicks: 5, Impressions: 50, AvgImpressionPosition: 1 }];
    expect(aggregateBingRows(rows as never, '2025-08-01', '2025-08-31')).toEqual([]);
  });

  it('separates cached periods', () => {
    expect(bingCacheKey(28)).not.toBe(bingCacheKey(7));
  });
});
