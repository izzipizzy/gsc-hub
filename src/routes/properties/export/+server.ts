import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { getAccount } from '$lib/server/accounts';
import { searchAnalyticsPages } from '$lib/server/google';
import { csvHeader, csvLine } from '$lib/server/csv';
import { completedDayRange } from '$lib/server/gsc-calendar';
import { requireAdmin } from '$lib/server/guard';

export const GET: RequestHandler = async ({ url, locals, request }) => {
  requireAdmin(locals);
  const accountId = url.searchParams.get('account');
  const siteUrl = url.searchParams.get('site');
  const days = Number(url.searchParams.get('days') ?? '28');
  const dim = url.searchParams.get('dim') ?? 'query';

  if (!accountId || !siteUrl) throw error(400, 'account and site required');
  if (dim !== 'query' && dim !== 'page') throw error(400, 'dim must be query|page');
  if (!Number.isInteger(days) || days < 1 || days > 480) throw error(400, 'days 1..480');

  const acc = getAccount(db(), accountId);
  if (!acc) throw error(404, 'account not found');
  if (acc.status !== 'active') throw error(409, `account is ${acc.status}; reconnect`);

  // The same window the dashboard shows. Computing dates here separately is how
  // a CSV and a screen end up disagreeing about what "28 days" means.
  const { startDate, endDate } = completedDayRange(days);

  const pages = searchAnalyticsPages(
    db(),
    acc,
    siteUrl,
    { startDate, endDate, dimensions: [dim] },
    { signal: request.signal }
  );

  const iterator = pages[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  const columns = [dim, 'clicks', 'impressions', 'ctr', 'position'];
  let finished = false;

  // pull(), not start(): an async start() runs the whole walk immediately and
  // leaves every page sitting in the stream's queue, which is the same
  // unbounded buffer this was meant to remove. pull() is called only when the
  // consumer has room, so the walk advances at the speed of the download.
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(csvHeader(columns)));
    },
    async pull(controller) {
      const { value: page, done } = await iterator.next();
      if (done || !page) {
        if (!finished && pages.truncated) {
          finished = true;
          // The status line went out with the first chunk, so the only honest
          // place left to say the file is short is the file itself. Written as
          // a comment line rather than a record: as a row it would import as
          // data, which is a different way of lying about the contents.
          controller.enqueue(
            encoder.encode(`# truncated at ${pages.maxRows} rows\n`)
          );
          return;
        }
        controller.close();
        return;
      }
      let chunk = '';
      for (const r of page) {
        chunk += csvLine([
          r.keys[0] ?? '',
          String(r.clicks),
          String(r.impressions),
          r.ctr.toFixed(6),
          r.position.toFixed(2)
        ]);
      }
      controller.enqueue(encoder.encode(chunk));
    },
    async cancel() {
      // A closed download must stop costing Search Console quota.
      await iterator.return?.(undefined);
    }
  });

  const fname = `${siteUrl.replace(/[^a-z0-9]+/gi, '_')}_${dim}_${startDate}_${endDate}.csv`;

  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fname}"`
    }
  });
};
