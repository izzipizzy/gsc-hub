import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import {
  magicLinksClient,
  validateBrief,
  validateLinkBrief,
  magicLinksErrorMessage,
  idempotencyKeyFor,
  MagicLinksError,
  type MagicLinksBrief,
  type MagicLinksLinkBrief
} from '$lib/server/magiclinks';
import { magic369Client, Magic369Error, validateMagic369Link } from '$lib/server/magic369';
import { PROVIDER_FIELDLINK, PROVIDER_MAGIC369, isMagicProviderId, supportsMagicService } from '$lib/server/magiclinks-providers';

interface PurchaseItem {
  targetUrl: string;
  query: string;
  language: string;
  count: number;
  tier?: string;
  contentHint?: string;
  text?: string;
}

function parseItems(raw: unknown, service: 'posts' | 'links'): (MagicLinksBrief | MagicLinksLinkBrief)[] {
  if (!Array.isArray(raw) || raw.length === 0) throw error(400, 'Пустое выделение');
  if (raw.length > 2000) throw error(400, 'За раз можно отправить не больше 2000 строк');
  try {
    return (raw as PurchaseItem[]).map((r, i) => {
      const common = {
        targetUrl: String(r?.targetUrl ?? ''), anchor: String(r?.query ?? ''),
        language: String(r?.language ?? ''), count: Number(r?.count)
      };
      return service === 'links'
        ? validateLinkBrief({ ...common, tier: r?.tier, contentHint: r?.contentHint } as MagicLinksLinkBrief, i)
        : validateBrief({ ...common, titleKeyword: String(r?.query ?? '') }, i);
    });
  } catch (e) { throw error(400, (e as Error).message); }
}

// Шаг 1 покупки. FieldLink: сохранить задание и вернуть расчёт — деньги ещё
// не тратятся, публикация не начинается. 369Team: операции «расчёт» в API
// нет, цена приходит с /balance, так что расчёт считается по ней, и заказ
// создаётся только на следующем шаге.
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);

  const body = (await request.json().catch(() => null)) as
    | { items?: PurchaseItem[]; name?: string; provider?: string; service?: string; requestId?: string }
    | null;
  const provider = isMagicProviderId(body?.provider) ? body.provider : PROVIDER_FIELDLINK;
  if (body?.provider !== undefined && !isMagicProviderId(body.provider)) throw error(400, 'Неизвестный провайдер');
  const service = body?.service ?? 'posts';
  if (service !== 'posts' && service !== 'links') throw error(400, 'Неизвестный тип размещения');
  // Validate capabilities before contacting the provider.
  if (!supportsMagicService(provider, service)) throw error(400, 'Тип размещения не поддерживается провайдером');
  if (provider === PROVIDER_MAGIC369 && service === 'links') {
    if (!Array.isArray(body?.items) || !body.items.length || body.items.length > 2000) throw error(400, 'Нужно от 1 до 2000 строк');
    let rows;
    try { rows = body.items.map((r, i) => validateMagic369Link(r as unknown as Record<string, unknown>, i)); }
    catch (e) { throw error(400, (e as Error).message); }
    const requested = rows.reduce((sum, r) => sum + r.count, 0);
    if (requested > 10000) throw error(400, 'Больше 10000 размещений за раз сервис не примет');
    const client = magic369Client(db());
    if (!client) throw error(400, 'Ключ 369Team не задан');
    try {
      const balance = await client.balance();
      if (balance.linkPriceMinor === null || !Number.isInteger(balance.linkPriceMinor) || balance.linkPriceMinor <= 0) throw error(502, '369Team не вернул цену морды');
      const amountMinor = requested * balance.linkPriceMinor;
      const bonusCount = rows.reduce((sum, r) => sum + Math.floor(r.count * 30 / 100), 0);
      return json({ provider, service, requested, rows: rows.length, quote: {
        placementCount: requested, bonusCount, totalPlacementCount: requested + bonusCount,
        amountMinor, balanceMinor: balance.balanceMinor,
        shortfallMinor: Math.max(0, amountMinor - balance.balanceMinor),
        canSubmit: balance.balanceMinor >= amountMinor, billed: true
      } });
    } catch (e) {
      if (e instanceof Magic369Error) throw error(e.status === 401 ? 400 : 502, e.message);
      throw e;
    }
  }
  const items = parseItems(body?.items, service);

  const requested = items.reduce((s, b) => s + (b.count ?? 1), 0);
  if (requested > 10000) throw error(400, 'Больше 10000 размещений за раз сервис не примет');

  if (provider === PROVIDER_MAGIC369) {
    const client = magic369Client(db());
    if (!client) throw error(400, 'Ключ 369Team не задан');
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
    ...(service === 'posts' ? { topic: 'auto' } : {}),
    items
  };

  try {
    // A purchase attempt keeps its ID across network retries, while a later identical
    // campaign can create a fresh task instead of replaying an old paid order.
    const attempt = String(body?.requestId ?? '');
    if (attempt && !/^[a-zA-Z0-9_-]{8,128}$/.test(attempt)) throw error(400, 'Некорректный ID покупки');
    const key = idempotencyKeyFor({ service, attempt, payload });
    const created = service === 'links'
      ? await client.createLinks({ name: payload.name, items: items as MagicLinksLinkBrief[] }, key)
      : await client.createPosts({ name: payload.name, topic: 'auto', items: items as MagicLinksBrief[] }, key);
    const taskId = created.taskId ?? created.task?.id;
    if (!taskId) throw error(502, 'Сервис не вернул id задания');
    const quote = await client.quote(taskId);
    return json({
      provider: PROVIDER_FIELDLINK,
      taskId,
      service,
      quote,
      requested,
      rows: items.length,
      replayed: !!created.replayed
    });
  } catch (e) {
    if (e instanceof MagicLinksError) throw error(e.status === 401 ? 400 : e.status >= 400 && e.status < 500 ? e.status : 502, magicLinksErrorMessage(e));
    throw e;
  }
};
