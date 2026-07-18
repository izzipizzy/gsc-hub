import { describe, it, expect } from 'vitest';
import {
  computeStriking,
  computeCannibalization,
  computeCtrBenchmark,
  computeDecay,
  splitBranded,
  aggregateByQuery,
  BENCHMARK_CTR,
  type QueryPageRow,
  type PageRow
} from '../src/lib/server/analytics';

function qp(p: Partial<QueryPageRow> & { query: string; page: string }): QueryPageRow {
  return { clicks: 0, impressions: 0, ctr: 0, position: 1, ...p };
}

describe('computeStriking', () => {
  it('keeps only rows at position 4..20 with enough impressions, sorted by impressions', () => {
    const rows = [
      qp({ query: 'a', page: 'p1', position: 3, impressions: 100 }), // too high (page 1)
      qp({ query: 'b', page: 'p2', position: 5, impressions: 50 }), // keep
      qp({ query: 'c', page: 'p3', position: 12, impressions: 200 }), // keep
      qp({ query: 'd', page: 'p4', position: 8, impressions: 5 }), // too few impressions
      qp({ query: 'e', page: 'p5', position: 25, impressions: 300 }) // too deep
    ];
    const out = computeStriking(rows);
    expect(out.map((r) => r.query)).toEqual(['c', 'b']);
  });
});

describe('computeCannibalization', () => {
  it('flags queries with >=2 competing pages and picks the winner by clicks', () => {
    const rows = [
      qp({ query: 'shoes', page: '/a', clicks: 10, impressions: 100 }),
      qp({ query: 'shoes', page: '/b', clicks: 3, impressions: 80 }),
      qp({ query: 'hats', page: '/c', clicks: 5, impressions: 50 }) // only one page → not cannibalized
    ];
    const out = computeCannibalization(rows);
    expect(out).toHaveLength(1);
    expect(out[0].query).toBe('shoes');
    expect(out[0].winner).toBe('/a');
    expect(out[0].pages.map((p) => p.page)).toEqual(['/a', '/b']);
  });

  it('ignores low-impression pages when counting competitors', () => {
    const rows = [
      qp({ query: 'x', page: '/a', clicks: 4, impressions: 100 }),
      qp({ query: 'x', page: '/b', clicks: 1, impressions: 2 }) // below CANNIBAL_MIN_IMPRESSIONS
    ];
    expect(computeCannibalization(rows)).toHaveLength(0);
  });
});

describe('computeCtrBenchmark', () => {
  it('buckets by rounded position with impression-weighted CTR', () => {
    const rows = [
      qp({ query: 'a', page: '/a', position: 1.2, clicks: 20, impressions: 100 }),
      qp({ query: 'b', page: '/b', position: 0.9, clicks: 30, impressions: 100 })
    ];
    const { buckets } = computeCtrBenchmark(rows);
    const b1 = buckets.find((b) => b.position === 1)!;
    expect(b1.yourCtr).toBeCloseTo(0.25); // (20+30)/(100+100)
    expect(b1.benchmark).toBe(BENCHMARK_CTR[1]);
  });

  it('flags opportunities where CTR is well below benchmark', () => {
    const rows = [
      // position 3 benchmark 0.11; 0.7x = 0.077. ctr 0.02 → opportunity
      qp({ query: 'low', page: '/x', position: 3, ctr: 0.02, impressions: 500, clicks: 10 }),
      // position 3, ctr 0.10 → above threshold, not an opportunity
      qp({ query: 'ok', page: '/y', position: 3, ctr: 0.1, impressions: 500, clicks: 50 })
    ];
    const { opportunities } = computeCtrBenchmark(rows);
    expect(opportunities.map((o) => o.query)).toEqual(['low']);
  });
});

describe('splitBranded / aggregateByQuery', () => {
  it('splits by case-insensitive brand substring', () => {
    const rows = [
      { query: 'ikea chair', clicks: 100, impressions: 1000 },
      { query: 'IKEA', clicks: 50, impressions: 400 },
      { query: 'cheap desk', clicks: 30, impressions: 300 }
    ];
    const s = splitBranded(rows, ['ikea']);
    expect(s.branded.clicks).toBe(150);
    expect(s.nonBranded.clicks).toBe(30);
    expect(s.brandedPct).toBeCloseTo(150 / 180);
  });

  it('aggregates query+page rows to per-query totals', () => {
    const rows = [
      qp({ query: 'a', page: '/1', clicks: 2, impressions: 10 }),
      qp({ query: 'a', page: '/2', clicks: 3, impressions: 20 }),
      qp({ query: 'b', page: '/3', clicks: 1, impressions: 5 })
    ];
    const agg = aggregateByQuery(rows).sort((x, y) => x.query.localeCompare(y.query));
    expect(agg).toEqual([
      { query: 'a', clicks: 5, impressions: 30 },
      { query: 'b', clicks: 1, impressions: 5 }
    ]);
  });
});

describe('computeDecay', () => {
  it('flags decay on clicks OR impressions, ignores low-volume pages, sorts by lost impressions', () => {
    const prior: PageRow[] = [
      { page: '/big', clicks: 100, impressions: 1000 }, // clicks decay
      { page: '/impronly', clicks: 5, impressions: 500 }, // low clicks, but impressions decay
      { page: '/tiny', clicks: 3, impressions: 30 }, // below both thresholds → ignored
      { page: '/steady', clicks: 50, impressions: 500 } // flat → not decayed
    ];
    const recent: PageRow[] = [
      { page: '/big', clicks: 40, impressions: 950 }, // clicks -60%, impr -5%
      { page: '/impronly', clicks: 4, impressions: 200 }, // impr -60%
      { page: '/tiny', clicks: 0, impressions: 0 },
      { page: '/steady', clicks: 48, impressions: 490 } // -2% / -2%
    ];
    const out = computeDecay(recent, prior);
    // /impronly lost 300 impressions, /big lost 50 → sorted by lost impressions
    expect(out.map((d) => d.page)).toEqual(['/impronly', '/big']);
    const big = out.find((d) => d.page === '/big')!;
    expect(big.lostClicks).toBe(60);
    expect(big.priorImpressions).toBe(1000);
  });
});
