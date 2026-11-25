import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { magicLinksClient, MagicLinksError } from '$lib/server/magiclinks';
import { magic369Client, Magic369Error, type Magic369Article } from '$lib/server/magic369';
import { orderProvider, orderService } from '$lib/server/magiclinks-purchases';
import { saitamaClient, SaitamaError, isSaitamaOrderId } from '$lib/server/saitamalinks';
import { PROVIDER_MAGIC369, PROVIDER_SAITAMALINKS } from '$lib/server/magiclinks-providers';
import { fieldlinkCsv } from '$lib/server/fieldlink-csv';
import { rowsToCsv } from '$lib/server/csv';

// Шесть колонок контракта, одна позиция — одна строка. Экранирование и защита
// от формул — те же, что у остальных выгрузок хаба.
export const GET: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);

  const id = params.orderId;
  const known = orderProvider(db(), id);
  // Заказ мимо хаба: FieldLink → 369Team → SaitamaLinks (у него id — UUID).
  const chain: (() => Promise<Response>)[] =
    known === PROVIDER_SAITAMALINKS ? [() => csvSaitama(id)]
    : known === PROVIDER_MAGIC369 ? [() => csvMagic369(id)]
    : known !== null ? [() => csvFieldlink(id)]
    : [() => csvFieldlink(id), () => csvMagic369(id), ...(isSaitamaOrderId(id) ? [() => csvSaitama(id)] : [])];
  for (let i = 0; ; i++) {
    try {
      return await chain[i]();
    } catch (e) {
      const known404 = (e instanceof MagicLinksError || e instanceof Magic369Error || e instanceof SaitamaError) && e.status === 404;
      if (known404 && i < chain.length - 1) continue;
      if (e instanceof MagicLinksError || e instanceof Magic369Error || e instanceof SaitamaError) {
        throw error(e.status === 404 ? 404 : 502, e.message);
      }
      throw error(502, 'Сервис покупок не ответил');
    }
  }
};

// SaitamaLinks: те же шесть колонок, что у статей 369Team. Сервис публикует
// до 30% бонусных статей сверх заказа — они тоже строки CSV.
async function csvSaitama(orderId: string) {
  const client = saitamaClient(db());
  if (!client) throw new SaitamaError(404, 'NO_TOKEN', 'Ключ SaitamaLinks не задан');
  const order = await client.order(orderId);
  const articles = await client.orderArticles(orderId);
  const rows: string[][] = [];
  const used = new Set<string>();
  for (const item of order.items) {
    const mine = articles.filter((a) => a.url === item.url && a.anchor === item.anchor);
    for (const a of mine) {
      used.add(a.id);
      rows.push([a.url, a.anchor, a.title, item.language, 'completed', a.publishedUrl]);
    }
    const status = order.status === 'cancelled' ? 'cancelled' : 'in_progress';
    for (let i = mine.length; i < item.count; i++) rows.push([item.url, item.anchor, '', item.language, status, '']);
  }
  // Статьи, не сопоставившиеся со строкой заказа (сервис нормализует URL).
  for (const a of articles) if (!used.has(a.id)) rows.push([a.url, a.anchor, a.title, '', 'completed', a.publishedUrl]);
  return csvResponse(
    orderId,
    ['URL акцептора', 'Анкор', 'Ключевые слова для статьи', 'Язык', 'Статус', 'URL публикации'],
    rows
  );
}

async function csvFieldlink(orderId: string) {
  const client = magicLinksClient(db());
  if (!client) throw new MagicLinksError(404, 'NO_TOKEN', 'Ключ MagicLinks не задан');

  const { order, rows } = await client.order(orderId);
  return new Response(fieldlinkCsv(order.type, rows), { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="magiclinks-${orderId}.csv"`
  } });
}

// У 369 позиции вычисляются: статья = выполненная позиция, а недостающие до
// заказа — ещё в работе. Ключевые слова у выполненных — реальный заголовок
// статьи, он покажет, о чём текст вышел на самом деле.
async function csvMagic369(orderId: string) {
  const client = magic369Client(db());
  if (!client) throw new Magic369Error(404, 'NO_TOKEN', 'Ключ 369Team не задан');

  const order = await client.order(orderId, orderService(db(), orderId));
  const articles = order.service === 'links' ? await client.orderLinks(orderId) : await client.orderArticles(orderId);
  if (order.service === 'links') {
    const rows: string[][] = articles.map((a) => [a.url, a.anchor, a.text ?? '', 'completed', a.publishedUrl]);
    for (const item of order.items) {
      for (let i = 0; i < item.failed; i++) rows.push([item.url, item.anchor, item.text ?? '', 'failed', '']);
      for (let i = 0; i < item.inProgress; i++) rows.push([item.url, item.anchor, item.text ?? '', 'in_progress', '']);
    }
    return csvResponse(orderId, ['URL акцептора', 'Анкор', 'Околоссылочный текст', 'Статус', 'URL донора'], rows);
  }
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
