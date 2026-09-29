import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { magicLinksClient, MagicLinksError, type MagicLinksBilling } from '$lib/server/magiclinks';
import { magic369Client, Magic369Error, type Magic369Progress } from '$lib/server/magic369';
import { orderProvider } from '$lib/server/magiclinks-purchases';
import { PROVIDER_FIELDLINK, PROVIDER_MAGIC369 } from '$lib/server/magiclinks-providers';

// Литеры провайдера в kind обязаны остаться литерами: по ним шаблон выбирает,
// какую таблицу показывать. Поэтому content типизирован явно, а не выведен.
interface FieldlinkOrderContent {
  kind: 'fieldlink';
  order: {
    id: string;
    taskId: string | null;
    status: string;
    rowCount: number;
    requestedCount: number | null;
    bonusCount: number | null;
    completedCount: number;
    failedCount: number;
    createdAt: string | null;
    billing: MagicLinksBilling | null;
    held: boolean;
    trashed: boolean;
    locked: boolean;
  };
  rows: {
    id: string;
    placementIndex: number | null;
    isBonus: boolean;
    status: string;
    outcome: string | null;
    targetUrl: string;
    anchor: string;
    titleKeyword: string;
    language: string;
    url: string;
    indexing: string | null;
    error: string | null;
  }[];
}

interface Magic369OrderContent {
  kind: 'magic369';
  order: {
    id: string;
    status: string;
    createdAt: string | null;
    finalizedAt: string | null;
    priceMinor: number;
    totalPriceMinor: number;
    refundedMinor: number;
    progress: Magic369Progress;
  };
  lines: {
    url: string;
    anchor: string;
    language: string;
    count: number;
    published: number;
    inProgress: number;
    awaitingContent: number;
    failed: number;
  }[];
  articles: {
    id: number;
    targetUrl: string;
    anchor: string;
    title: string;
    language: string;
    publishedUrl: string;
    publishedAt: string | null;
  }[];
}

// Позиции одного заказа: что уже опубликовано, где, и что с индексацией.
// Провайдер заказа берём из истории покупок; заказ, сделанный мимо хаба,
// пробуем читать сначала у FieldLink, потом у Magic 369. Ошибки провайдеров
// доходят сюда сырыми: только здесь 404 одного превращается в попытку у
// другого, а всё остальное — в понятный HttpError.
export const load: PageServerLoad = async ({ locals, params, url }) => {
  requireAdmin(locals);
  const known = orderProvider(db(), params.orderId);

  try {
    if (known === PROVIDER_MAGIC369) return await loadMagic369(params.orderId, url);
    return await loadFieldlink(params.orderId, url);
  } catch (e) {
    if (known === null && isFirstNotFound(e)) return await loadMagic369(params.orderId, url);
    throw finalize(e);
  }
};

function isFirstNotFound(e: unknown): boolean {
  return e instanceof MagicLinksError && e.status === 404;
}

function finalize(e: unknown): never {
  if (e instanceof MagicLinksError || e instanceof Magic369Error) {
    throw error(e.status === 404 ? 404 : 502, e.message);
  }
  throw error(502, 'Сервис покупок не ответил');
}

async function loadFieldlink(orderId: string, url: URL) {
  const client = magicLinksClient(db());
  if (!client) throw new MagicLinksError(404, 'NO_TOKEN', 'Ключ MagicLinks не задан');

  try {
    const { order, rows } = await client.order(orderId);
    // Приход из таблицы striking: показываем позиции только этой связки,
    // иначе в большом заказе искать её глазами.
    const filter = {
      targetUrl: url.searchParams.get('url') ?? '',
      query: url.searchParams.get('q') ?? ''
    };
    const content: FieldlinkOrderContent = {
      kind: PROVIDER_FIELDLINK,
      order: {
        id: order.id,
        taskId: order.taskId ?? null,
        status: order.status,
        rowCount: order.rowCount,
        requestedCount: order.requestedCount ?? null,
        bonusCount: order.bonusCount ?? null,
        completedCount: order.completedCount,
        failedCount: order.failedCount,
        createdAt: order.createdAt ?? null,
        billing: order.billing ?? null,
        held: order.lifecycle?.executionState === 'held',
        trashed: !!order.lifecycle?.trashedAt,
        locked: !!order.lifecycle?.cancellationLocked
      },
      rows: rows.map((r) => ({
        id: r.id,
        placementIndex: r.placementIndex ?? null,
        isBonus: !!r.isBonus,
        status: r.status,
        outcome: r.outcome ?? null,
        targetUrl: r.input?.targetUrl ?? '',
        anchor: r.input?.anchor ?? '',
        titleKeyword: r.input?.titleKeyword ?? '',
        language: r.input?.language ?? '',
        // Пост возвращает destination, ссылка — donor. Синтезировать URL нельзя,
        // показываем ровно то, что пришло.
        url: r.result?.destination ?? r.result?.source ?? r.result?.donor ?? '',
        indexing: r.indexing?.status ?? null,
        error: r.error ?? null
      }))
    };
    return {
      filter: filter.targetUrl || filter.query ? filter : null,
      content
    };
  } catch (e) {
    if (e instanceof MagicLinksError) throw e;
    throw new MagicLinksError(502, 'UNREACHABLE', 'MagicLinks не ответил');
  }
}

async function loadMagic369(orderId: string, url: URL) {
  const client = magic369Client(db());
  if (!client) throw new Magic369Error(404, 'NO_TOKEN', 'Ключ Magic 369 не задан');

  try {
    // Живьём оба вызова: статус и уже размещённые статьи.
    const [order, articles] = await Promise.all([client.order(orderId), client.orderArticles(orderId)]);

    // Язык строки заказа доезжает до статьи через связку «URL + анкор».
    const lang = new Map(order.items.map((it) => [`${it.url}\n${it.anchor}`, it.language]));

    const filter = {
      targetUrl: url.searchParams.get('url') ?? '',
      query: url.searchParams.get('q') ?? ''
    };
    const filteredArticles =
      filter.targetUrl || filter.query
        ? articles.filter(
            (a) =>
              (!filter.targetUrl || a.url === filter.targetUrl) &&
              (!filter.query || a.anchor === filter.query)
          )
        : articles;

    const content: Magic369OrderContent = {
      kind: PROVIDER_MAGIC369,
      order: {
        id: order.id,
        status: order.status,
        createdAt: order.createdAt,
        finalizedAt: order.finalizedAt,
        priceMinor: order.priceMinor,
        totalPriceMinor: order.totalPriceMinor,
        refundedMinor: order.refundedMinor,
        progress: order.progress
      },
      lines: order.items,
      articles: filteredArticles.map((a) => ({
        id: a.id,
        targetUrl: a.url,
        anchor: a.anchor,
        title: a.title,
        language: lang.get(`${a.url}\n${a.anchor}`) ?? '',
        publishedUrl: a.publishedUrl,
        publishedAt: a.publishedAt
      }))
    };
    return {
      filter: filter.targetUrl || filter.query ? filter : null,
      content
    };
  } catch (e) {
    if (e instanceof Magic369Error) throw e;
    throw new Magic369Error(502, 'UNREACHABLE', 'Magic 369 не ответил');
  }
}
