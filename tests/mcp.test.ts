import { describe, it, expect } from 'vitest';
import {
  handleRpc,
  TOOLS,
  PROMPTS,
  MCP_PROTOCOL_VERSION,
  RPC_CODES
} from '../src/lib/server/mcp';
import { siteHostOf, allowsSite, scopeRows, type ApiCaller } from '../src/lib/server/api-token';

const ALL: ApiCaller = { kind: 'env', keyId: null, sites: [] };
const ES: ApiCaller = { kind: 'key', keyId: 1, sites: ['sc-domain:a.es'] };

const call = (method: string, params?: Record<string, unknown>, id: number | null = 1) =>
  handleRpc({ jsonrpc: '2.0', id, method, params }, ALL, 'test');

describe('область по сайтам', () => {
  it('разные написания одного сайта считаются одним', () => {
    expect(siteHostOf('sc-domain:a.es')).toBe('a.es');
    expect(siteHostOf('https://www.a.es/')).toBe('a.es');
    expect(siteHostOf('https://a.es')).toBe('a.es');
  });

  it('ключ с областью видит свой сайт в любом написании и не видит чужой', () => {
    expect(allowsSite(ES, 'https://a.es/')).toBe(true);
    expect(allowsSite(ES, 'https://www.a.es/')).toBe(true);
    expect(allowsSite(ES, 'sc-domain:b.fr')).toBe(false);
  });

  it('пустая область — это все сайты', () => {
    expect(allowsSite(ALL, 'sc-domain:какой-угодно.com')).toBe(true);
  });

  it('scopeRows вырезает чужие строки', () => {
    const rows = [{ site: 'sc-domain:a.es' }, { site: 'sc-domain:b.fr' }];
    expect(scopeRows(ES, rows, (r) => r.site)).toEqual([{ site: 'sc-domain:a.es' }]);
    expect(scopeRows(ALL, rows, (r) => r.site)).toHaveLength(2);
  });
});

describe('MCP: протокол', () => {
  it('initialize отдаёт версию протокола и возможности', async () => {
    const res = (await call('initialize')) as { result: Record<string, any> };
    expect(res.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(res.result.capabilities.tools).toBeTruthy();
    expect(res.result.capabilities.prompts).toBeTruthy();
    expect(res.result.serverInfo.name).toBe('gsc-hub');
  });

  it('отвечает той версией протокола, которую просит клиент', async () => {
    const older = (await handleRpc(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      ALL
    )) as { result: { protocolVersion: string } };
    expect(older.result.protocolVersion).toBe('2025-03-26');

    const unknown = (await handleRpc(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
      ALL
    )) as { result: { protocolVersion: string } };
    expect(unknown.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
  });

  it('уведомления остаются без ответа', async () => {
    expect(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, ALL)).toBeNull();
  });

  it('ping отвечает пустым результатом', async () => {
    expect(await call('ping')).toMatchObject({ result: {} });
  });

  it('неизвестный метод — ошибка -32601', async () => {
    const res = (await call('никакого/метода')) as { error: { code: number } };
    expect(res.error.code).toBe(RPC_CODES.NO_METHOD);
  });

  it('tools/list перечисляет инструменты со схемой', async () => {
    const res = (await call('tools/list')) as { result: { tools: any[] } };
    const names = res.result.tools.map((t) => t.name);
    expect(names).toContain('list_sites');
    expect(names).toContain('striking_keywords');
    expect(names).toContain('decay');
    for (const t of res.result.tools) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.inputSchema.type).toBe('object');
    }
  });

  it('неизвестный инструмент — ошибка параметров', async () => {
    const res = (await call('tools/call', { name: 'rm_rf', arguments: {} })) as { error: { code: number } };
    expect(res.error.code).toBe(RPC_CODES.BAD_PARAMS);
  });

  it('ошибка инструмента возвращается как isError, а не как сбой протокола', async () => {
    const res = (await call('tools/call', { name: 'site_queries', arguments: {} })) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('site');
  });

  it('чужой сайт для ключа с областью недоступен', async () => {
    const res = (await handleRpc(
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'site_queries', arguments: { site: 'sc-domain:b.fr' } } },
      ES
    )) as { result: { isError: boolean; content: { text: string }[] } };
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('недоступен');
  });
});

describe('MCP: только чтение', () => {
  it('ни один инструмент не пишет и не тратит деньги', () => {
    const forbidden = /(purchase|buy|submit|order|create|delete|update|add_|write)/i;
    for (const t of TOOLS) expect(t.name).not.toMatch(forbidden);
  });

  it('инструменты описаны и названы по-машинному', () => {
    for (const t of TOOLS) expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });
});

describe('MCP: скилы как промпты', () => {
  it('скилы из репозитория попадают в промпты', async () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(4);
    const res = (await call('prompts/list')) as { result: { prompts: { name: string }[] } };
    const names = res.result.prompts.map((p) => p.name);
    expect(names).toContain('gsc-striking-plan');
    expect(names).toContain('gsc-decay-triage');
  });

  it('prompts/get отдаёт текст скила без фронтматтера', async () => {
    const res = (await call('prompts/get', { name: 'gsc-striking-plan' })) as {
      result: { messages: { content: { text: string } }[] };
    };
    const text = res.result.messages[0].content.text;
    expect(text).not.toMatch(/^---/);
    expect(text).toContain('striking_keywords');
  });

  it('неизвестный промпт — ошибка параметров', async () => {
    const res = (await call('prompts/get', { name: 'нет-такого' })) as { error: { code: number } };
    expect(res.error.code).toBe(RPC_CODES.BAD_PARAMS);
  });
});

describe('MCP: мусорные запросы', () => {
  it('инструменты берут те же фильтры, что и экраны хаба', async () => {
    // Смотрим на исходник: инструменты обязаны прогонять запросы через
    // dropFilteredQueries, иначе агент получит `site:`-операторы под видом ключей.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/lib/server/mcp.ts', 'utf8')
    );
    expect(src).toContain('dropFilteredQueries');
    const perSite = src.slice(src.indexOf('async function queryPageRows'));
    expect(perSite.slice(0, 400)).toContain('dropFilteredQueries');
  });
});
