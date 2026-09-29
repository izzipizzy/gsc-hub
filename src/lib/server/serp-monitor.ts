/**
 * Клиент серпмонитора: реальная позиция рядом со средней из GSC.
 *
 * Ключевое различие — между «сайт не на мониторинге» и «спросить не
 * удалось». Раньше любая ошибка превращалась в пустоту, и при неверном
 * токене или лежащем серпмониторе страница уверенно писала «не на
 * мониторинге». Это ложь про состояние, поэтому состояние теперь явное:
 * off (интеграция не настроена), absent (спросили, сайта нет), ok, error.
 */
export interface SerpBinding {
  geo: string;
  project_id: number;
  name: string;
  keywords: number;
  checked_at: string | null;
}

export interface SerpPositions {
  checked_at: string | null;
  run_status: string | null;
  truncated?: boolean;
  rows: { query: string; position: number | null; url: string | null }[];
}

export type SerpState = 'off' | 'ok' | 'absent' | 'error';

export interface BindingsResult {
  state: SerpState;
  bindings: SerpBinding[];
  reason?: string;
}

export interface PositionsResult {
  state: SerpState;
  positions: SerpPositions | null;
  reason?: string;
}

// Серпмонитор — сосед по серверу, и здоровый ответ приходит за миллисекунды.
// Дефолт undici (300 с) на странице сайта означал бы её зависание на минуты:
// вызова два подряд, bindings и positions.
const TIMEOUT_MS = 5000;

function base(): { url: string; token: string } | null {
  const url = (process.env.SERP_MONITOR_URL ?? '').replace(/\/$/, '');
  const token = (process.env.SERP_MONITOR_TOKEN ?? '').trim();
  return url && token ? { url, token } : null;
}

async function ask(cfg: { url: string; token: string }, path: string): Promise<Response> {
  return fetch(`${cfg.url}${path}`, {
    headers: { authorization: `Bearer ${cfg.token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
}

/** Какие гео этого сайта на мониторинге. */
export async function fetchBindings(site: string): Promise<BindingsResult> {
  const cfg = base();
  if (!cfg) return { state: 'off', bindings: [] };
  try {
    const res = await ask(cfg, `/api/v1/bindings?site=${encodeURIComponent(site)}`);
    if (!res.ok) return { state: 'error', bindings: [], reason: `HTTP ${res.status}` };
    const bindings = ((await res.json()) as { bindings: SerpBinding[] }).bindings ?? [];
    return { state: bindings.length ? 'ok' : 'absent', bindings };
  } catch (e) {
    return { state: 'error', bindings: [], reason: (e as Error).name };
  }
}

/**
 * Позиции по сайту и гео. `queries` сужает запрос до того, что видно на
 * экране: у импортированного из GSC проекта ключей десятки тысяч, и тянуть
 * их целиком на каждое открытие страницы незачем.
 */
export async function fetchPositions(
  site: string,
  geo: string,
  queries: string[] = []
): Promise<PositionsResult> {
  const cfg = base();
  if (!cfg) return { state: 'off', positions: null };
  const params = new URLSearchParams({ site, geo });
  for (const q of queries.slice(0, 500)) params.append('queries', q);
  try {
    const res = await ask(cfg, `/api/v1/positions?${params.toString()}`);
    if (res.status === 404) return { state: 'absent', positions: null };
    if (!res.ok) return { state: 'error', positions: null, reason: `HTTP ${res.status}` };
    return { state: 'ok', positions: (await res.json()) as SerpPositions };
  } catch (e) {
    return { state: 'error', positions: null, reason: (e as Error).name };
  }
}

export async function requestCheck(
  site: string,
  geo: string,
  source = 'gsc'
): Promise<{ status: string } | null> {
  const cfg = base();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.url}/api/v1/checks`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ site, geo, source }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) return null;
    return (await res.json()) as { status: string };
  } catch {
    return null;
  }
}
