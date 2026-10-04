import { db } from './db';
import { listAccounts } from './accounts';
import {
  listSitesWithSummary,
  listSitesForAllAccounts,
  fetchSiteQueryPages,
  fetchSiteDecayPages,
  fetchPerSiteQueries,
  type SiteRow
} from './google';
import type { AccountRow } from './accounts';
import {
  rowToQueryPage,
  rowToPage,
  computeStriking,
  computeCannibalization,
  computeCtrBenchmark,
  computeDecay,
  aggregateByQuery
} from './analytics';
import { siteCountries } from './serp-api';
import { listHiddenSites } from './hidden';
import { dropFilteredQueries, filterPatterns } from './filters';
import { listSiteEvents, listSiteEventsForSite, donorOf } from './site-events';
import { allowsSite, scopeRows, type ApiCaller } from './api-token';

// MCP-сервер хаба: JSON-RPC 2.0 поверх одной HTTP-ручки, без состояния между
// запросами. Инструменты **только читают** статистику Search Console: ни
// склеек, ни покупок, ни записи — ключ, отданный агенту, не может ничего
// изменить и не видит сайтов вне своей области.

export const MCP_PROTOCOL_VERSION = '2025-06-18';

/**
 * Клиенты живут на разных редакциях протокола. По спецификации сервер обязан
 * ответить той же версией, если он её умеет, иначе своей — иначе рукопожатие
 * рвётся ещё до tools/list.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const MCP_SERVER_NAME = 'gsc-hub';

const DAYS = {
  type: 'integer',
  description: 'Период в днях, 1..480 (по умолчанию 28)',
  minimum: 1,
  maximum: 480
} as const;

const SITE = {
  type: 'string',
  description: 'Property как в Search Console: sc-domain:example.com или https://example.com/'
} as const;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  run(args: Record<string, unknown>, caller: ApiCaller): Promise<unknown>;
}

function days(args: Record<string, unknown>, fallback = 28): number {
  const n = Math.floor(Number(args.days ?? fallback));
  if (!Number.isFinite(n) || n < 1 || n > 480) throw new Error('days должен быть 1..480');
  return n;
}

function limit(args: Record<string, unknown>, fallback = 50, max = 500): number {
  const n = Math.floor(Number(args.limit ?? fallback));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === 'string' ? v.trim() : '';
}

/** Сайт из аргументов: обязателен и обязан быть в области ключа. */
function siteArg(args: Record<string, unknown>, caller: ApiCaller): string {
  const site = str(args, 'site');
  if (!site) throw new Error('нужен параметр site');
  // Тот же ответ, что и для несуществующего: чужой сайт для ключа не существует.
  if (!allowsSite(caller, site)) throw new Error(`сайт ${site} недоступен этому ключу`);
  return site;
}

/** Аккаунт, которому принадлежит property: одиночные выборки идут через него. */
async function accountFor(site: string): Promise<{ acc: AccountRow; site: SiteRow }> {
  const { sites } = await listSitesForAllAccounts(db());
  const hit = sites.find((s) => s.siteUrl === site);
  if (!hit) throw new Error(`property ${site} не найдено ни в одном подключённом аккаунте`);
  const acc = listAccounts(db()).find((a) => a.id === hit.accountId);
  if (!acc) throw new Error(`аккаунт property ${site} не подключён`);
  return { acc, site: hit };
}

/**
 * Строки query+page одного сайта, уже без мусорных запросов: `site:` и прочие
 * операторы — не ключи, и агенту они нужны ещё меньше, чем человеку.
 */
async function queryPageRows(site: string, d: number) {
  const { acc } = await accountFor(site);
  const raw = await fetchSiteQueryPages(db(), acc, site, d);
  return dropFilteredQueries(raw.map(rowToQueryPage), filterPatterns(db()), (r) => r.query);
}

export const TOOLS: McpTool[] = [
  {
    name: 'list_sites',
    description:
      'Сайты, доступные этому ключу, с итогами за период: клики, показы, CTR, средняя позиция.',
    inputSchema: { type: 'object', properties: { days: DAYS } },
    async run(args, caller) {
      const d = days(args);
      const { sites, errors } = await listSitesWithSummary(db(), d);
      // Скрытые в хабе сайты агенту не показываем — как и на страницах хаба.
      const hidden = new Set(listHiddenSites(db()));
      const visible = sites.filter((s) => !hidden.has(`${s.accountId}|${s.siteUrl}`));
      return {
        days: d,
        // Плоская строка на сайт: агенту не нужны ни id аккаунта, ни его почта.
        sites: scopeRows(caller, visible, (s) => s.siteUrl).map((s) => ({
          site: s.siteUrl,
          clicks: s.summary?.clicks ?? null,
          impressions: s.summary?.impressions ?? null,
          ctr: s.summary?.ctr ?? null,
          position: s.summary?.position ?? null,
          error: s.summaryError
        })),
        partial: errors.map((e) => ({ reason: e.reason }))
      };
    }
  },
  {
    name: 'site_queries',
    description: 'Запросы одного сайта за период: клики, показы, CTR, средняя позиция.',
    inputSchema: {
      type: 'object',
      properties: { site: SITE, days: DAYS, limit: { type: 'integer', minimum: 1, maximum: 500 } },
      required: ['site']
    },
    async run(args, caller) {
      const site = siteArg(args, caller);
      const d = days(args);
      const rows = aggregateByQuery(await queryPageRows(site, d));
      return { site, days: d, queries: rows.slice(0, limit(args)) };
    }
  },
  {
    name: 'query_pages',
    description:
      'Какие страницы сайта ранжируются по конкретному запросу: позиция, показы, клики по каждой.',
    inputSchema: {
      type: 'object',
      properties: { site: SITE, query: { type: 'string', description: 'Точный текст запроса' }, days: DAYS },
      required: ['site', 'query']
    },
    async run(args, caller) {
      const site = siteArg(args, caller);
      const query = str(args, 'query');
      if (!query) throw new Error('нужен параметр query');
      const d = days(args);
      const rows = (await queryPageRows(site, d)).filter((r) => r.query === query);
      return {
        site,
        query,
        days: d,
        pages: rows
          .map((r) => ({ page: r.page, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }))
          .sort((a, b) => b.impressions - a.impressions)
      };
    }
  },
  {
    name: 'striking_keywords',
    description:
      'Запросы на позициях 4-20 с заметными показами: куда докручивать, чтобы попасть в топ-3. Без site — по всем сайтам ключа.',
    inputSchema: {
      type: 'object',
      properties: { site: SITE, days: DAYS, limit: { type: 'integer', minimum: 1, maximum: 500 } }
    },
    async run(args, caller) {
      const d = days(args);
      const max = limit(args);
      if (str(args, 'site')) {
        const site = siteArg(args, caller);
        return { site, days: d, striking: computeStriking(await queryPageRows(site, d), max) };
      }
      // Веер по портфелю отдаёт готовые строки query+page на сайт: фильтр
      // striking тот же, что на странице, считать заново нечего.
      const { entries } = await fetchPerSiteQueries(db(), d);
      const patterns = filterPatterns(db());
      const out = scopeRows(caller, entries, (x) => x.siteUrl).flatMap((e) =>
        computeStriking(dropFilteredQueries(e.rows, patterns, (r) => r.query), max).map((r) => ({
          site: e.siteUrl,
          ...r
        }))
      );
      out.sort((a, b) => b.impressions - a.impressions);
      return { days: d, striking: out.slice(0, max) };
    }
  },
  {
    name: 'cannibalization',
    description: 'Запросы, по которым конкурируют несколько страниц одного сайта.',
    inputSchema: {
      type: 'object',
      properties: { site: SITE, days: DAYS, limit: { type: 'integer', minimum: 1, maximum: 200 } },
      required: ['site']
    },
    async run(args, caller) {
      const site = siteArg(args, caller);
      const d = days(args);
      return { site, days: d, groups: computeCannibalization(await queryPageRows(site, d), limit(args, 50, 200)) };
    }
  },
  {
    name: 'ctr_benchmark',
    description:
      'CTR сайта против ожидаемого по позиции: кривая по позициям и запросы, недобирающие клики.',
    inputSchema: { type: 'object', properties: { site: SITE, days: DAYS }, required: ['site'] },
    async run(args, caller) {
      const site = siteArg(args, caller);
      const d = days(args);
      const res = computeCtrBenchmark(await queryPageRows(site, d), limit(args, 50, 200));
      return { site, days: d, buckets: res.buckets, opportunities: res.opportunities };
    }
  },
  {
    name: 'decay',
    description:
      'Страницы, просевшие по кликам и показам: свежее окно против предыдущего такой же длины.',
    inputSchema: {
      type: 'object',
      properties: { site: SITE, days: DAYS, limit: { type: 'integer', minimum: 1, maximum: 200 } },
      required: ['site']
    },
    async run(args, caller) {
      const site = siteArg(args, caller);
      const d = days(args);
      const { acc } = await accountFor(site);
      const { recent, prior } = await fetchSiteDecayPages(db(), acc, site, d);
      return {
        site,
        days: d,
        decayed: computeDecay(recent.map(rowToPage), prior.map(rowToPage), limit(args, 50, 200))
      };
    }
  },
  {
    name: 'site_countries',
    description: 'Разбивка сайта по странам за период: клики, показы, средняя позиция.',
    inputSchema: { type: 'object', properties: { site: SITE, days: DAYS }, required: ['site'] },
    async run(args, caller) {
      const site = siteArg(args, caller);
      const d = days(args);
      return await siteCountries(db(), { site, days: d });
    }
  },
  {
    name: 'site_events',
    description:
      'События сайтов: склейки доменов и покупки ссылок с датами. Помогают сопоставить изменения трафика с действиями на сайте.',
    inputSchema: { type: 'object', properties: { site: SITE } },
    async run(args, caller) {
      if (str(args, 'site')) {
        const site = siteArg(args, caller);
        return { site, events: listSiteEventsForSite(db(), site).map(withDonor) };
      }
      return { events: scopeRows(caller, listSiteEvents(db()), (e) => e.siteHost).map(withDonor) };
    }
  }
];

const withDonor = (e: { id: number; siteHost: string; date: string; type: string; note: string }) => ({
  id: e.id,
  site: e.siteHost,
  date: e.date,
  type: e.type,
  donor: e.type === 'merge' ? donorOf(e.note) : null,
  note: e.note
});

// ─── Скилы как MCP-промпты ───────────────────────────────────────────────────
// Файлы скилов лежат в репозитории и попадают в бандл на сборке, поэтому
// клиенту не нужен ни доступ к репозиторию, ни файловая система рядом с аппом.

const SKILL_FILES = import.meta.glob('/.agents/skills/*/SKILL.md', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>;

export interface McpPrompt {
  name: string;
  description: string;
  text: string;
}

function parseSkill(path: string, raw: string): McpPrompt {
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const body = fm ? raw.slice(fm[0].length) : raw;
  const head = fm?.[1] ?? '';
  const field = (key: string) => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(head)?.[1]?.trim() ?? '';
  const fallback = path.split('/').slice(-2)[0];
  return {
    name: field('name') || fallback,
    description: field('description') || `Скил ${fallback}`,
    text: body.trim()
  };
}

export const PROMPTS: McpPrompt[] = Object.entries(SKILL_FILES)
  .map(([path, raw]) => parseSkill(path, raw))
  .sort((a, b) => a.name.localeCompare(b.name));

// ─── JSON-RPC ────────────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const RPC = { PARSE: -32700, INVALID: -32600, NO_METHOD: -32601, BAD_PARAMS: -32602, INTERNAL: -32603 };

const ok = (id: JsonRpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const err = (id: JsonRpcRequest['id'], code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message }
});

/**
 * Одна пара запрос-ответ. Уведомления (без id) ответа не имеют — возвращаем
 * null, и ручка отвечает 202 без тела, как требует транспорт.
 */
export async function handleRpc(
  req: JsonRpcRequest,
  caller: ApiCaller,
  version = 'dev'
): Promise<object | null> {
  const method = typeof req.method === 'string' ? req.method : '';
  const isNotification = req.id === undefined || req.id === null;
  const params = (req.params ?? {}) as Record<string, unknown>;

  if (!method) return isNotification ? null : err(req.id, RPC.INVALID, 'нет method');
  if (method.startsWith('notifications/')) return null;

  switch (method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return ok(req.id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, version },
        instructions:
          'Данные Google Search Console из gsc-hub. Инструменты только читают; ' +
          'ключ видит лишь свои сайты. Скилы доступны как промпты этого же сервера.'
      });
    }

    case 'ping':
      return ok(req.id, {});

    case 'tools/list':
      return ok(req.id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      });

    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return err(req.id, RPC.BAD_PARAMS, `нет инструмента ${name || '(пусто)'}`);
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await tool.run(args, caller);
        return ok(req.id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false
        });
      } catch (e) {
        // Ошибку инструмента отдаём как результат с isError, а не как ошибку
        // протокола: так её видит модель и может исправить аргументы.
        return ok(req.id, {
          content: [{ type: 'text', text: (e as Error).message }],
          isError: true
        });
      }
    }

    case 'prompts/list':
      return ok(req.id, {
        prompts: PROMPTS.map((p) => ({ name: p.name, description: p.description }))
      });

    case 'prompts/get': {
      const name = typeof params.name === 'string' ? params.name : '';
      const prompt = PROMPTS.find((p) => p.name === name);
      if (!prompt) return err(req.id, RPC.BAD_PARAMS, `нет промпта ${name || '(пусто)'}`);
      return ok(req.id, {
        description: prompt.description,
        messages: [{ role: 'user', content: { type: 'text', text: prompt.text } }]
      });
    }

    default:
      return isNotification ? null : err(req.id, RPC.NO_METHOD, `метод ${method} не поддерживается`);
  }
}

export const RPC_CODES = RPC;
