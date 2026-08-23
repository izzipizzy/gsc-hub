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

// Search queries are attacker-influenced: anyone can run a Google search that
// starts with "=", and it reaches this file through the property's export.
describe('csv.rowsToCsv formula injection', () => {
  const csvOf = (field: string) =>
    rowsToCsv(['q'], [{ q: field }], (r) => [r.q]).split('\n')[1];

  it.each(['=1+1', '-1+1', '@SUM(A1)', '=cmd|\' /c calc\'!A1'])(
    'neutralises the formula prefix in %s',
    (field) => {
      expect(csvOf(field).replace(/^"|"$/g, '')).toMatch(/^'/);
    }
  );

  it.each(['\t=1+1', ' =1+1', '\r=1+1'])(
    'neutralises %j, where whitespace hides the prefix',
    (field) => {
      expect(csvOf(field).replace(/^"|"$/g, '')).toMatch(/^'/);
    }
  );

  // A signed number is still a number: Excel evaluates "+1" to 1, and clicks
  // and position go through this same path. Only non-numeric payloads matter.
  it.each(['-5', '5', '0.0741', '-0.5', '+1'])('leaves the number %s alone', (field) => {
    expect(csvOf(field)).toBe(field);
  });

  it('leaves ordinary text alone', () => {
    expect(csvOf('best coffee beans')).toBe('best coffee beans');
  });

  it('still quotes a neutralised field that also needs escaping', () => {
    expect(csvOf('=1,2')).toBe('"\'=1,2"');
  });

  it('keeps the original text recoverable', () => {
    expect(csvOf('=1+1')).toBe("'=1+1");
  });
});
