import { describe, it, expect } from 'vitest';
import { rowsToCsv } from '../src/lib/server/csv';

describe('csv.rowsToCsv', () => {
  it('writes header + rows', () => {
    const out = rowsToCsv(
      ['query', 'clicks', 'impressions'],
      [
        { keys: ['hello'], clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
        { keys: ['world'], clicks: 5, impressions: 50, ctr: 0.1, position: 7 }
      ],
      (r) => [r.keys[0], String(r.clicks), String(r.impressions)]
    );
    expect(out).toBe('query,clicks,impressions\nhello,10,100\nworld,5,50\n');
  });

  it('escapes commas, quotes, newlines per RFC 4180', () => {
    const out = rowsToCsv(
      ['a', 'b'],
      [{ a: 'x,y', b: 'z"w' }, { a: 'line1\nline2', b: 'plain' }],
      (r) => [r.a, r.b]
    );
    expect(out).toBe('a,b\n"x,y","z""w"\n"line1\nline2",plain\n');
  });
});
