import { invalidateProviderCache } from '$lib/server/magiclinks-cache';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { magicLinksClient, MagicLinksError, magicLinksErrorMessage, validateBrief, type MagicLinksBrief } from '$lib/server/magiclinks';
import { magic369Client, languageNameFor, Magic369Error, validateMagic369Link, type Magic369LinkRow } from '$lib/server/magic369';
import { recordPurchases, orderRecorded, type PurchaseInput } from '$lib/server/magiclinks-purchases';
import { PROVIDER_FIELDLINK, PROVIDER_MAGIC369, isMagicProviderId } from '$lib/server/magiclinks-providers';

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Шаг 2 покупки: отправка заказа. Это единственное место, которое тратит
// деньги, и единственное, которое пишет историю покупок.
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);

  const body = (await request.json().catch(() => null)) as
    | { provider?: string; taskId?: string; expectedMinor?: number; items?: unknown[]; service?: string }
    | null;
  const provider = isMagicProviderId(body?.provider) ? body.provider : PROVIDER_FIELDLINK;
  if (body?.provider !== undefined && !isMagicProviderId(body.provider)) throw error(400, 'Неизвестный провайдер');
  const service = body?.service ?? 'posts';
  if (service !== 'posts' && service !== 'links') throw error(400, 'Неизвестный тип размещения');
  const expectedMinor = Number(body?.expectedMinor);

  if (provider === PROVIDER_MAGIC369) return submitMagic369(body?.items ?? [], expectedMinor, service);
  return submitFieldlink(String(body?.taskId ?? ''), expectedMinor);
};

// 369Team: заказ одношаговый, деньги списывает сам POST /orders. Идемпотентности
// в API нет, поэтому цена перепроверяется прямо перед отправкой: если она
// уехала от суммы с кнопки — заказ не создаём, оператор считает заново.
async function submitMagic369(raw: unknown[], expectedMinor: number, service: 'posts' | 'links') {
  const client = magic369Client(db());
  if (!client) throw error(400, 'Ключ 369Team не задан');
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 2000) throw error(400, 'Нужно от 1 до 2000 строк');
  if (!Number.isInteger(expectedMinor) || expectedMinor < 0) throw error(400, 'Нет ожидаемой суммы');

  let items: MagicLinksBrief[];
  let linkRows: Magic369LinkRow[] = [];
  try {
    if (service === 'links') linkRows = (raw as Record<string, unknown>[]).map((r, i) => validateMagic369Link(r, i));
    items = service === 'links' ? linkRows.map((r) => ({ targetUrl: r.url, anchor: r.anchor, titleKeyword: '', language: '', count: r.count })) : (raw as Record<string, unknown>[]).map((r, i) =>
      validateBrief(
        {
          targetUrl: String(r?.targetUrl ?? ''),
          anchor: String(r?.query ?? r?.anchor ?? ''),
          titleKeyword: String(r?.query ?? ''),
          language: String(r?.language ?? ''),
          count: Number(r?.count)
        },
        i
      )
    );
  } catch (e) {
    throw error(400, (e as Error).message);
  }

  try {
    const balance = await client.balance();
    const total = items.reduce((s, b) => s + (b.count ?? 1), 0);
    if (total > 10000) throw error(400, 'Больше 10000 размещений за раз сервис не примет');
    const price = service === 'links' ? balance.linkPriceMinor : balance.priceMinor;
    if (price == null || !Number.isInteger(price) || price <= 0) throw error(502, '369Team не вернул цену размещения');
    const amountMinor = total * price;
    if (amountMinor !== expectedMinor) {
      throw error(409, 'Цена изменилась, пока шло подтверждение. Посчитай заново.');
    }
    if (balance.balanceMinor < amountMinor) throw error(402, 'Не хватает токенов, заказ не создан');

    const rows = service === 'links' ? linkRows : items.map((b) => ({
      // API 369 принимает человеческие названия языков, а не коды подсказки.
      url: b.targetUrl,
      anchor: b.anchor,
      language: languageNameFor(b.language),
      count: b.count ?? 1
    }));
    let created: Awaited<ReturnType<typeof client.createOrder>>;
    try {
      created = await client.createOrder(rows, service);
    } catch (e) {
      if (e instanceof Magic369Error) throw e;
      // Таймаут или обрыв после отправки: сервис мог уже списать деньги, а
      // идемпотентности нет. Повтор вслепую - второй заказ, так что говорим прямо.
      throw error(
        504,
        '369Team не ответил на создание заказа. Заказ мог создаться - проверь баланс, прежде чем платить снова.'
      );
    }

    // У 369 задач нет, только заказы; след покупки пишется по тем же брифам,
    // что ушли в заказ. Повторного submit с тем же заказом тут не бывает:
    // каждый вызов создаёт новый заказ.
    recordPurchases(
      db(),
      items.map((b) => ({
        siteHost: hostOf(b.targetUrl),
        targetUrl: b.targetUrl,
        query: b.anchor,
        language: b.language,
        quantity: b.count ?? 1,
        taskId: '',
        orderId: created.orderId,
        provider: PROVIDER_MAGIC369,
        service
      }))
    );

    invalidateProviderCache(db());
    return json({
      provider: PROVIDER_MAGIC369,
      service,
      orderId: created.orderId,
      order: {
        id: created.orderId,
        status: created.status,
        rowCount: created.totalCount,
        amountMinor: created.totalPriceMinor,
        balanceAfterMinor: created.balanceAfterMinor
      }
    });
  } catch (e) {
    if (e instanceof Magic369Error) {
      if (e.code === 'insufficient_balance' || e.status === 402) {
        throw error(402, 'Не хватает токенов, заказ не создан');
      }
      throw error(e.status >= 400 && e.status < 500 ? e.status : 502, e.message);
    }
    throw e;
  }
}

async function submitFieldlink(taskId: string, expectedMinor: number) {
  const client = magicLinksClient(db());
  if (!client) throw error(400, 'Ключ MagicLinks не задан');
  if (!taskId) throw error(400, 'Нет id задания');
  if (!Number.isInteger(expectedMinor) || expectedMinor < 0) throw error(400, 'Нет ожидаемой суммы');

  try {
    const res = await client.submitOrder(taskId, expectedMinor);
    const order = res.order;

    // История пишется по брифам, которые сохранил сам сервис, а не по тому,
    // что прислал браузер. Повторная отправка того же заказа её не дублирует.
    if (!orderRecorded(db(), order.id)) {
      const briefs = await client.taskRows(taskId);
      const rows: PurchaseInput[] = briefs
        .map((b) => ({
          siteHost: hostOf(b.targetUrl),
          targetUrl: b.targetUrl,
          query: b.anchor,
          language: b.language,
          quantity: Number(b.count ?? b.quantity ?? 1),
          taskId,
          orderId: order.id,
          provider: PROVIDER_FIELDLINK,
          service: order.type === 'links' ? 'links' as const : 'posts' as const
        }))
        .filter((r) => r.siteHost && r.quantity > 0);
      recordPurchases(db(), rows);
    }

    invalidateProviderCache(db());
    return json({
      provider: PROVIDER_FIELDLINK,
      orderId: order.id,
      order,
      replayed: !!res.replayed
    });
  } catch (e) {
    if (e instanceof MagicLinksError) {
      if (e.code === 'PRICE_CHANGED') {
        throw error(409, 'Цена изменилась, пока шло подтверждение. Посчитай заново.');
      }
      if (e.status === 402) throw error(402, 'Не хватает доступных кредитов, заказ не создан');
      throw error(e.status >= 400 && e.status < 500 ? e.status : 502, magicLinksErrorMessage(e));
    }
    throw e;
  }
}
