import type { Db } from './db';

// Единственный модуль с SQL по magiclinks_purchases. След покупки пишется
// только после успешно отправленного заказа: созданная, но не оплаченная
// задача покупкой не является.

export interface PurchaseInput {
  siteHost: string;
  targetUrl: string;
  query: string;
  language: string;
  quantity: number;
  taskId: string;
  orderId: string;
  /** Провайдер покупки; у сделанных до появления поля — FieldLink. */
  provider?: string;
}

export interface PurchaseRow extends PurchaseInput {
  id: number;
  createdAt: number;
}

/** Сводка по паре «URL + запрос»: сколько всего куплено и когда в последний раз. */
export interface PurchaseSummary {
  targetUrl: string;
  query: string;
  quantity: number;
  lastAt: number;
  orders: { orderId: string; quantity: number; createdAt: number }[];
}

interface Row {
  id: number;
  site_host: string;
  target_url: string;
  query: string;
  language: string;
  quantity: number;
  task_id: string;
  order_id: string;
  provider: string;
  created_at: number;
}

const toPurchase = (r: Row): PurchaseRow => ({
  id: r.id,
  siteHost: r.site_host,
  targetUrl: r.target_url,
  query: r.query,
  language: r.language,
  quantity: r.quantity,
  taskId: r.task_id,
  orderId: r.order_id,
  provider: r.provider,
  createdAt: r.created_at
});

export function recordPurchases(db: Db, rows: PurchaseInput[], now = Date.now()): number {
  if (rows.length === 0) return 0;
  // OR IGNORE, а не просто INSERT: уникальный индекс по (заказ, URL, запрос)
  // делает повторный импорт безвредным даже при гонке двух одновременных.
  const ins = db.prepare(
    `INSERT OR IGNORE INTO magiclinks_purchases
       (site_host, target_url, query, language, quantity, task_id, order_id, provider, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((batch: PurchaseInput[]) => {
    let written = 0;
    for (const r of batch) {
      const res = ins.run(
        r.siteHost,
        r.targetUrl,
        r.query,
        r.language,
        r.quantity,
        r.taskId,
        r.orderId,
        r.provider ?? 'fieldlink',
        now
      );
      written += res.changes;
    }
    return written;
  });
  return tx(rows) as number;
}

/** Тот же заказ повторно не пишем: submit идемпотентен и может вернуть уже созданный. */
export function orderRecorded(db: Db, orderId: string): boolean {
  return !!db.prepare('SELECT 1 FROM magiclinks_purchases WHERE order_id = ?').get(orderId);
}

/**
 * Какому провайдеру принадлежит заказ. null — история не знает (заказ сделан
 * мимо хаба или история ещё не догнала): тогда страница заказа пробует обоих.
 */
export function orderProvider(db: Db, orderId: string): string | null {
  const row = db
    .prepare('SELECT provider FROM magiclinks_purchases WHERE order_id = ? LIMIT 1')
    .get(orderId) as { provider?: string } | undefined;
  return row?.provider ?? null;
}

/**
 * Заказы, сделанные мимо интерфейса (CLI, кабинет сервиса) или до появления
 * этой таблицы, история не знает. Импорт восстанавливает их по брифам самого
 * сервиса: источник тот же, что и при обычной покупке.
 */
export async function importOrderHistory(
  db: Db,
  client: {
    listOrders(limit?: number): Promise<{ id: string; taskId?: string; createdAt?: string }[]>;
    taskRows(taskId: string): Promise<
      { targetUrl: string; anchor: string; language: string; count?: number; quantity?: number }[]
    >;
  },
  hostOf: (url: string) => string
): Promise<{ orders: number; rows: number }> {
  let orders = 0;
  let rows = 0;
  for (const order of await client.listOrders()) {
    // Уже записанный заказ не перечитываем: и лишний запрос, и риск задвоить.
    if (!order.taskId || orderRecorded(db, order.id)) continue;
    const briefs = await client.taskRows(order.taskId);
    const at = Date.parse(order.createdAt ?? '') || Date.now();
    const batch: PurchaseInput[] = briefs
      .map((b) => ({
        siteHost: hostOf(b.targetUrl),
        targetUrl: b.targetUrl,
        query: b.anchor,
        language: b.language,
        quantity: Number(b.count ?? b.quantity ?? 1),
        taskId: order.taskId as string,
        orderId: order.id
      }))
      .filter((r) => r.siteHost && r.quantity > 0);
    if (batch.length === 0) continue;
    const written = recordPurchases(db, batch, at);
    if (written === 0) continue; // всё уже было в истории
    rows += written;
    orders++;
  }
  return { orders, rows };
}

export function listPurchases(db: Db, siteHost?: string): PurchaseRow[] {
  const rows = siteHost
    ? (db
        .prepare('SELECT * FROM magiclinks_purchases WHERE site_host = ? ORDER BY created_at DESC')
        .all(siteHost) as Row[])
    : (db.prepare('SELECT * FROM magiclinks_purchases ORDER BY created_at DESC').all() as Row[]);
  return rows.map(toPurchase);
}

/**
 * Сводка по парам, ключ — `${targetUrl}\n${query}`. Таблицы striking читают её
 * из своей базы, без обращения к сервису, поэтому ничего не тормозит.
 */
export function purchaseSummary(db: Db, siteHost?: string): Record<string, PurchaseSummary> {
  const out: Record<string, PurchaseSummary> = {};
  for (const p of listPurchases(db, siteHost)) {
    const key = `${p.targetUrl}\n${p.query}`;
    const cur = (out[key] ??= {
      targetUrl: p.targetUrl,
      query: p.query,
      quantity: 0,
      lastAt: 0,
      orders: []
    });
    cur.quantity += p.quantity;
    cur.lastAt = Math.max(cur.lastAt, p.createdAt);
    const order = cur.orders.find((o) => o.orderId === p.orderId);
    if (order) order.quantity += p.quantity;
    else cur.orders.push({ orderId: p.orderId, quantity: p.quantity, createdAt: p.createdAt });
  }
  return out;
}
