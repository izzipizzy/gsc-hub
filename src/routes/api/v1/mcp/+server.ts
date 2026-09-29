import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiToken } from '$lib/server/api-token';
import { handleRpc, MCP_PROTOCOL_VERSION, MCP_SERVER_NAME, type JsonRpcRequest } from '$lib/server/mcp';
import { appVersion } from '$lib/server/version';

// MCP поверх HTTP: один POST на запрос, без состояния и без SSE-потока.
// Замок — тот же requireApiToken, что и у остальных /api/v1, первой строкой.
export const POST: RequestHandler = async ({ request }) => {
  const caller = requireApiToken(request);

  const body = (await request.json().catch(() => null)) as JsonRpcRequest | JsonRpcRequest[] | null;
  if (!body || typeof body !== 'object') {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'тело не JSON' } }, { status: 400 });
  }

  const version = appVersion.release;

  // Батч: массив запросов — массив ответов, уведомления из ответа выпадают.
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((r) => handleRpc(r, caller, version)))).filter(Boolean);
    return out.length === 0 ? new Response(null, { status: 202 }) : json(out);
  }

  const res = await handleRpc(body, caller, version);
  return res === null ? new Response(null, { status: 202 }) : json(res);
};

/** Клиенты дёргают GET, чтобы понять, живой ли сервер и какой транспорт. */
export const GET: RequestHandler = async ({ request }) => {
  requireApiToken(request);
  return json({
    server: MCP_SERVER_NAME,
    protocolVersion: MCP_PROTOCOL_VERSION,
    transport: 'streamable-http',
    note: 'MCP-запросы шлите POST-ом (JSON-RPC 2.0)'
  });
};
