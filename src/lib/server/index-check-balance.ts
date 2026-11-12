import type { Db } from './db';
import type { IndexCheckProvider } from '$lib/utils/index-check';
import { indexCheckCredentials, IndexProviderError } from './index-check-providers';

/** Account metadata endpoints only. Never calls paid SERP endpoints. */
export async function indexCheckBalance(database: Db, provider: IndexCheckProvider) {
  const credentials = indexCheckCredentials(database, provider);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error('Баланс недоступен: сервис не ответил за 15 секунд')); controller.abort(); }, 15_000);
  });
  const request = async () => {
    const endpoint = provider === 'xmlriver'
      ? `https://xmlriver.com/api/get_balance/?${new URLSearchParams({ user: credentials.login, key: credentials.secret })}`
      : 'https://api.dataforseo.com/v3/appendix/user_data';
    const response = await fetch(endpoint, { signal: controller.signal, redirect: 'error',
      ...(provider === 'dataforseo' ? { headers: { Authorization: `Basic ${Buffer.from(`${credentials.login}:${credentials.secret}`).toString('base64')}` } } : {}) });
    if (!response.ok) throw new Error('Баланс недоступен: проверь API-доступ и ограничения аккаунта');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Баланс недоступен: пустой ответ сервиса');
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.length;
        if (bytes > 2 * 1024 * 1024) throw new Error('Баланс недоступен: ответ сервиса слишком большой');
        chunks.push(value);
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    const body = Buffer.concat(chunks).toString('utf8').trim();
    let amount: unknown;
    if (provider === 'xmlriver') {
      amount = /^[+-]?\d+(?:\.\d+)?$/.test(body) ? Number(body) : null;
    } else {
      let data: any; try { data = JSON.parse(body); } catch { throw new Error('Баланс недоступен: некорректный ответ сервиса'); }
      if (data.status_code !== 20000 || data.tasks?.[0]?.status_code !== 20000) throw new Error('Баланс недоступен: проверь API-доступ и ограничения аккаунта');
      amount = data.tasks[0].result?.[0]?.money?.balance;
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error('Баланс недоступен: сервис не вернул сумму');
    return { amount, currency: provider === 'xmlriver' ? 'RUB' as const : 'USD' as const, checkedAt: Date.now() };
  };
  try { return await Promise.race([request(), deadline]); }
  catch (e) {
    if (e instanceof Error && e.message.startsWith('Баланс недоступен:')) throw e;
    // Provider/transport responses can contain credentials; keep diagnostics local and generic.
    throw new IndexProviderError('network', 'Баланс недоступен: не удалось получить ответ сервиса');
  } finally { clearTimeout(timer); controller.abort(); }
}
