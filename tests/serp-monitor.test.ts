import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchBindings, fetchPositions, requestCheck } from '../src/lib/server/serp-monitor';

describe('serp-monitor client', () => {
  beforeEach(() => {
    process.env.SERP_MONITOR_URL = 'https://serp.example';
    process.env.SERP_MONITOR_TOKEN = 'secret';
  });
  afterEach(() => {
    delete process.env.SERP_MONITOR_URL;
    delete process.env.SERP_MONITOR_TOKEN;
    vi.unstubAllGlobals();
  });

  it('sends the token and returns rows', async () => {
    const seen: { url?: string; auth?: string; signal?: unknown } = {};
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.url = url;
      seen.auth = (init.headers as Record<string, string>).authorization;
      seen.signal = init.signal;
      return new Response(JSON.stringify({
        checked_at: '2026-08-27', run_status: 'done', truncated: false,
        rows: [{ query: 'a', position: 7, url: 'https://x/a' }]
      }), { status: 200 });
    });
    const got = await fetchPositions('sc-domain:example.com', 'es');
    expect(got.state).toBe('ok');
    expect(got.positions?.rows[0].position).toBe(7);
    expect(seen.auth).toBe('Bearer secret');
    expect(seen.url).toContain('geo=es');
    // Без таймаута зависший серпмонитор вешал бы страницу сайта на минуты:
    // дефолт undici — 300 секунд, а вызова здесь два подряд.
    expect(seen.signal).toBeInstanceOf(AbortSignal);
  });

  it('asks only for the queries the page shows', async () => {
    let asked = '';
    vi.stubGlobal('fetch', async (url: string) => {
      asked = url;
      return new Response(JSON.stringify({ rows: [], checked_at: null, run_status: null }), { status: 200 });
    });
    await fetchPositions('sc-domain:example.com', 'es', ['casino online', 'bono']);
    expect(asked).toContain('queries=casino+online');
    expect(asked).toContain('queries=bono');
  });

  it('separates "not monitored" from "could not ask"', async () => {
    // 404 — сайт действительно не заведён.
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ code: 'project_not_found' }), { status: 404 }));
    expect((await fetchPositions('sc-domain:other.com', 'es')).state).toBe('absent');

    // 401 и обрыв — мы НЕ ЗНАЕМ, заведён ли сайт. Показать «не на
    // мониторинге» здесь значит соврать про состояние.
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 401 }));
    expect((await fetchPositions('sc-domain:example.com', 'es')).state).toBe('error');

    vi.stubGlobal('fetch', async () => { throw new Error('ECONNREFUSED'); });
    expect((await fetchPositions('sc-domain:example.com', 'es')).state).toBe('error');
  });

  it('reports bindings failures instead of pretending there are none', async () => {
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 500 }));
    const got = await fetchBindings('sc-domain:example.com');
    expect(got.state).toBe('error');
    expect(got.bindings).toEqual([]);
  });

  it('says the integration is off when it is not configured', async () => {
    delete process.env.SERP_MONITOR_TOKEN;
    expect((await fetchBindings('sc-domain:example.com')).state).toBe('off');
    expect((await fetchPositions('sc-domain:example.com', 'es')).state).toBe('off');
  });

  it('surfaces already_active from the check endpoint', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ status: 'already_active' }), { status: 200 }));
    expect(await requestCheck('sc-domain:example.com', 'es')).toEqual({ status: 'already_active' });
  });
});
