import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import {
  magicLinksClient,
  validateBrief,
  idempotencyKeyFor,
  MagicLinksError,
  type MagicLinksBrief
} from '$lib/server/magiclinks';
import { magic369Client, Magic369Error } from '$lib/server/magic369';
import { PROVIDER_FIELDLINK, PROVIDER_MAGIC369, isMagicProviderId } from '$lib/server/magiclinks-providers';

interface PurchaseItem {
  targetUrl: string;
  query: string;
  language: string;
  count: number;
}

function parseItems(raw: unknown): MagicLinksBrief[] {
  if (!Array.isArray(raw) || raw.length === 0) throw error(400, 'Пустое выделение');
  if (raw.length > 2000) throw error(400, 'За раз можно отправить не больше 2000 строк');
  try {
    // Анкор и ключевые слова для статьи — сам запрос из Search Console.
    return (raw as PurchaseItem[]).map((r, i) =>
      validateBrief(
        {
          targetUrl: String(r?.targetUrl ?? ''),
          anchor: String(r?.query ?? ''),
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
}

// Шаг 1 покупки. FieldLink: сохранить задание и вернуть расчёт — деньги ещё
// не тратятся, публикация не начинается. Magic 369: операции «расчёт» в API
// нет, цена приходит с /balance, так что расчёт считается по ней, и заказ
// создаётся только на следующем шаге.
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);

  const body = (await request.json().catch(() => null)) as
    | { items?: PurchaseItem[]; name?: string; provider?: string }
    | null;
  const provider = isMagicProviderId(body?.provider) ? body.provider : PROVIDER_FIELDLINK;
  const items = parseItems(body?.items);

  const requested = items.reduce((s, b) => s + (b.count ?? 1), 0);
  if (requested > 10000) throw error(400, 'Больше 10000 размещений за раз сервис не примет');

  if (provider === PROVIDER_MAGIC369) {
    const client = magic369Client(db());
    if (!client) throw error(400, 'Ключ Magic 369 не задан');
    try {
      const balance = await client.balance();
      const amountMinor = requested * balance.priceMinor;
      return json({
        provider,
        quote: {
          placementCount: requested,
          bonusCount: 0,
          totalPlacementCount: requested,
          amountMinor,
          balanceMinor: balance.balanceMinor,
          shortfallMinor: Math.max(0, amountMinor - balance.balanceMinor),
          canSubmit: balance.balanceMinor >= amountMinor && requested > 0,
          billed: true
        },
        requested,
        rows: items.length
      });
    } catch (e) {
      if (e instanceof Magic369Error) throw error(e.status === 401 ? 400 : 502, e.message);
      throw e;
    }
  }

  const client = magicLinksClient(db());
  if (!client) throw error(400, 'Ключ MagicLinks не задан');

  const payload = {
    name: String(body?.name ?? '').trim() || `gsc-hub ${new Date().toISOString().slice(0, 10)}`,
    topic: 'casino',
    items
  };

  try {
    const created = await client.createPosts(payload, idempotencyKeyFor(payload));
    const taskId = created.taskId ?? created.task?.id;
    if (!taskId) throw error(502, 'Сервис не вернул id задания');
    const quote = await client.quote(taskId);
    return json({
      provider: PROVIDER_FIELDLINK,
      taskId,
      quote,
      requested,
      rows: items.length,
      replayed: !!created.replayed
    });
  } catch (e) {
    if (e instanceof MagicLinksError) throw error(e.status === 401 ? 400 : 502, e.message);
    throw e;
  }
};
