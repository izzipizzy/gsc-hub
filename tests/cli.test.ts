import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { COMMANDS, run } from '../cli/lib/cli.mjs';

const exec = promisify(execFile);
const KEY = 'gsk_cli_test_not_a_real_secret';
const result = { site: 'sc-domain:example.com', days: 28, queries: [{ query: 'example', clicks: 12 }], partial: [] };
const rpc = (value: unknown) => Response.json({ jsonrpc: '2.0', id: 1, result: { structuredContent: value } });

async function invoke(args: string[], response: Response | (() => Promise<Response>) = rpc(result), env = { GSC_HUB_KEY: KEY, GSC_HUB_URL: 'https://hub.example' }) {
  let out = '';
  let err = '';
  const fetchImpl = vi.fn(async (_url: URL | RequestInfo, _options?: RequestInit) => typeof response === 'function' ? response() : response);
  const code = await run(args, { env, stdout: { write: (s: string) => { out += s; } }, stderr: { write: (s: string) => { err += s; } }, fetchImpl });
  return { out, err, code, fetchImpl };
}

describe('CLI commands and transport', () => {
  it.each(Object.entries(COMMANDS).filter(([, spec]) => 'tool' in spec))('%s calls the corresponding server tool with scoped property', async (name, spec) => {
    const args = [name, '--json'];
    for (const key of spec.required) args.push(`--${key}`, key === 'site' ? 'sc-domain:example.com' : 'example query');
    if (spec.options.includes('days')) args.push('--days', '60');
    if (spec.options.includes('limit')) args.push('--limit', '25');
    const res = await invoke(args);
    expect(res.code).toBe(0);
    expect(JSON.parse(res.out)).toEqual(result);
    expect(res.err).toBe('');
    const [url, options] = res.fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://hub.example/api/v1/mcp');
    expect(new Headers(options?.headers).get('Authorization')).toBe(`Bearer ${KEY}`);
    expect(options?.redirect).toBe('manual');
    expect(JSON.parse(String(options?.body))).toMatchObject({ method: 'tools/call', params: { name: spec.tool } });
    const params = JSON.parse(String(options?.body)).params.arguments;
    if (spec.required.includes('site')) expect(params.site).toBe('sc-domain:example.com');
    if (spec.options.includes('days')) expect(params.days).toBe(60);
    if (spec.options.includes('limit')) expect(params.limit).toBe(25);
  });

  it('accepts flags before commands and URL paths; explicit URL overrides env', async () => {
    const res = await invoke(['--url', 'https://other.example/hub/', '--json', 'sites']);
    expect(String(res.fetchImpl.mock.calls[0][0])).toBe('https://other.example/hub/api/v1/mcp');
  });

  it('supports older servers with text content instead of structuredContent', async () => {
    const res = await invoke(['sites', '--json'], Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } }));
    expect(JSON.parse(res.out)).toEqual(result);
  });

  it('prints text tables including partial failures, sanitizing terminal control characters', async () => {
    const res = await invoke(['queries', '--site', 'sc-domain:example.com'], rpc({ ...result, partial: [{ reason: 'revoked' }], queries: [{ query: 'bad\u001b[31m', clicks: 1 }] }));
    expect(res.out).toContain('query\tclicks\nbad [31m\t1');
    expect(res.out).toContain('partial (1):\nreason\nrevoked');
    expect(res.out).not.toContain('\u001b');
  });

  it('retrieves skill files and docs as raw text, and lists skills as JSON', async () => {
    for (const [args, path] of [[['skills', '--name', 'gsc-hub-cli'], '/skills/gsc-hub-cli'], [['doc'], '/doc.md']] as const) {
      const res = await invoke([...args], new Response('# instructions\n'));
      expect(res.out).toBe('# instructions\n');
      expect(String(res.fetchImpl.mock.calls[0][0]).endsWith(`/api/v1${path}`)).toBe(true);
      expect(res.fetchImpl.mock.calls[0][1]?.method).toBe('GET');
    }
    const res = await invoke(['skills', '--json'], Response.json({ skills: [{ name: 'gsc-hub-cli' }] }));
    expect(JSON.parse(res.out).skills[0].name).toBe('gsc-hub-cli');
  });

  it('requires explicit authorization before POSTing a merge, and preserves idempotent responses', async () => {
    const args = ['merge', '--site', 'sc-domain:example.com', '--donor', 'donor.example', '--date', '2026-11-07', '--json'];
    const denied = await invoke(args);
    expect(denied.code).toBe(2);
    expect(denied.fetchImpl).not.toHaveBeenCalled();
    const accepted = await invoke([...args, '--yes'], Response.json({ created: false, event: { id: 1 } }));
    const [url, options] = accepted.fetchImpl.mock.calls[0];
    expect(String(url).endsWith('/api/v1/site-events')).toBe(true);
    expect(JSON.parse(String(options?.body))).toEqual({ site: 'sc-domain:example.com', donor: 'donor.example', date: '2026-11-07' });
    expect(JSON.parse(accepted.out).created).toBe(false);
  });
});

describe('CLI validation and failures', () => {
  it.each([
    ['queries'], ['queries', '--site', ' '], ['sites', '--days', '0'], ['sites', '--days', '481'],
    ['sites', '--days', '1.5'], ['striking', '--limit', '501'], ['decay', '--site', 'x', '--limit', '201'],
    ['events', '--days', '28'], ['sites', '--site', 'x'], ['sites', '--timeout', '0'],
    ['merge', '--site', 'x', '--donor', 'y', '--date', '2026-02-30', '--yes'],
    ['skills', '--name', '../doc.md'], ['sites', '--url', 'https://user:secret@hub.example'],
    ['sites', '--url', 'file:///tmp/key'], ['sites', '--url', 'https://hub.example/?token=secret'],
    ['sites', 'extra'], ['unknown'], ['constructor'], ['sites', '--token', KEY], ['sites', '--wat']
  ])('rejects invalid arguments before sending requests: %j', async (...args) => {
    const res = await invoke([...args, '--json']);
    expect(res.code).toBe(2);
    expect(res.out).toBe('');
    expect(JSON.parse(res.err).error.code).toBe(2);
    expect(res.fetchImpl).not.toHaveBeenCalled();
    expect(res.err).not.toContain(KEY);
  });

  it('help and version need no credentials; requests do', async () => {
    for (const args of [[], ['--help'], ['decay', '--help'], ['--version']]) {
      expect((await invoke(args, rpc(result), { GSC_HUB_KEY: '', GSC_HUB_URL: '' })).code).toBe(0);
    }
    const res = await invoke(['sites'], rpc(result), { GSC_HUB_KEY: '', GSC_HUB_URL: 'https://hub.example' });
    expect(res.code).toBe(2);
    expect(res.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([[401, 3], [403, 3], [404, 4], [302, 4], [429, 4], [500, 4]])('maps HTTP %i to exit %i without exposing response bodies', async (status, code) => {
    const res = await invoke(['sites', '--json'], new Response(`secret ${KEY}`, { status }));
    expect(res.code).toBe(code);
    expect(JSON.parse(res.err).error.code).toBe(code);
    expect(res.err).not.toContain(KEY);
    expect(res.out).toBe('');
  });

  it.each([
    { jsonrpc: '2.0', id: 1, error: { message: `error ${KEY}` } },
    { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: `scope error ${KEY}` }] } },
    { jsonrpc: '2.0', id: 2, result: {} },
    { jsonrpc: '2.0', id: 1, result: {} },
    null
  ])('rejects protocol/tool errors and redacts echoed credentials', async (body) => {
    const res = await invoke(['queries', '--site', 'sc-domain:foreign.example', '--json'], Response.json(body));
    expect(res.code).toBe(5);
    expect(res.out).toBe('');
    expect(res.err).not.toContain(KEY);
  });

  it('handles invalid JSON and connection failures', async () => {
    expect((await invoke(['sites'], new Response('<html>login</html>'))).code).toBe(5);
    const res = await invoke(['sites', '--json'], async () => { throw new Error(`connection ${KEY}`); });
    expect(res.code).toBe(4);
    expect(res.err).not.toContain(KEY);
  });
});

describe('installed entrypoint over HTTP', () => {
  const servers: ReturnType<typeof createServer>[] = [];
  afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } });

  it('passes credentials, returns JSON, and aborts slow responses as a real process', async () => {
    let received: unknown;
    const server = createServer(async (req, res) => {
      expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
      let body = '';
      for await (const chunk of req) body += chunk;
      received = JSON.parse(body);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: result } }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const env = { ...process.env, GSC_HUB_KEY: KEY, GSC_HUB_URL: `http://127.0.0.1:${port}` };
    const res = await exec(process.execPath, ['cli/bin/gsc-hub.mjs', 'queries', '--site', 'sc-domain:example.com', '--json'], { env });
    expect(JSON.parse(res.stdout)).toEqual(result);
    expect(received).toMatchObject({ params: { name: 'site_queries', arguments: { site: 'sc-domain:example.com' } } });
    server.removeAllListeners('request');
    server.on('request', () => {});
    await expect(exec(process.execPath, ['cli/bin/gsc-hub.mjs', 'sites', '--timeout', '20', '--json'], { env }))
      .rejects.toMatchObject({ code: 4, stdout: '', stderr: expect.stringContaining('timed out') });
  });
});
