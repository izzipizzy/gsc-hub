import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { magicLinksClient, MagicLinksError } from '$lib/server/magiclinks';
import { magic369Client, Magic369Error, type Magic369Article } from '$lib/server/magic369';
import { orderProvider } from '$lib/server/magiclinks-purchases';
import { PROVIDER_FIELDLINK, PROVIDER_MAGIC369 } from '$lib/server/magiclinks-providers';
import { rowsToCsv } from '$lib/server/csv';

// Шесть колонок контракта, одна позиция — одна строка. Экранирование и защита
// от формул — те же, что у остальных выгрузок хаба.
export const GET: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);

  const known = orderProvider(db(), params.orderId);
  try {
    if (known === PROVIDER_MAGIC369) return await csvMagic369(params.orderId);
    return await csvFieldlink(params.orderId);
  } catch (e) {
    if (known === null && e instanceof MagicLinksError && e.status === 404) {
      return await csvMagic369(params.orderId);
    }
    if (e instanceof MagicLinksError || e instanceof Magic369Error) {
      throw error(e.status === 404 ? 404 : 502, e.message);
    }
    throw error(502, 'Сервис покупок не ответил');
  }
};

async function csvFieldlink(orderId: string) {
  const client = magicLinksClient(db());
  if (!client) throw new MagicLinksError(404, 'NO_TOKEN', 'Ключ MagicLinks не задан');

  const { rows } = await client.order(orderId);
  return csvResponse(
    orderId,
    ['URL акцептора', 'Анкор', 'Ключевые слова для статьи', 'Язык', 'Статус', 'URL публикации'],
    rows.map((r) => [
      r.input?.targetUrl ?? '',
      r.input?.anchor ?? '',
      r.input?.titleKeyword ?? '',
      r.input?.language ?? '',
      r.status,
      r.result?.destination ?? r.result?.source ?? ''
    ])
  );
}

// У 369 позиции вычисляются: статья = выполненная позиция, а недостающие до
// заказа — ещё в работе. Ключевые слова у выполненных — реальный заголовок
// статьи, он покажет, о чём текст вышел на самом деле.
async function csvMagic369(orderId: string) {
  const client = magic369Client(db());
  if (!client) throw new Magic369Error(404, 'NO_TOKEN', 'Ключ Magic 369 не задан');

  const [order, articles] = await Promise.all([client.order(orderId), client.orderArticles(orderId)]);
  const rows: Array<[string, string, string, string, string, string]> = [];
  for (const item of order.items) {
    const mine = articles.filter(
      (a) => a.url === item.url && a.anchor === item.anchor
    );
    for (const a of mine) rows.push(articleRow(item.language, a));
    for (let i = 0; i < item.failed; i++) {
      rows.push([item.url, item.anchor, '', item.language, 'failed', '']);
    }
    const pending = Math.max(0, item.count - mine.length - item.failed);
    for (let i = 0; i < pending; i++) {
      rows.push([item.url, item.anchor, '', item.language, 'in_progress', '']);
    }
  }
  return csvResponse(
    orderId,
    ['URL акцептора', 'Анкор', 'Ключевые слова для статьи', 'Язык', 'Статус', 'URL публикации'],
    rows
  );
}

function articleRow(language: string, a: Magic369Article): [string, string, string, string, string, string] {
  return [a.url, a.anchor, a.title, language, 'completed', a.publishedUrl];
}

function csvResponse(orderId: string, header: string[], rows: string[][]): Response {
  return new Response(rowsToCsv(header, rows, (r) => r), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="magiclinks-${orderId}.csv"`
    }
  });
}
