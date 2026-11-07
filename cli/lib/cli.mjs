import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// Each command exposes only options supported by the server tool.
/** @type {Record<string, {tool?: string, options: string[], required: string[], description: string}>} */
export const COMMANDS = {
  sites: { tool: 'list_sites', options: ['days'], required: [], description: 'Sites available to this API key' },
  queries: { tool: 'site_queries', options: ['site', 'days', 'limit'], required: ['site'], description: 'Queries for one property' },
  'query-pages': { tool: 'query_pages', options: ['site', 'query', 'days'], required: ['site', 'query'], description: 'Pages ranking for an exact query' },
  striking: { tool: 'striking_keywords', options: ['site', 'days', 'limit'], required: [], description: 'Keywords at positions 4–20' },
  cannibalization: { tool: 'cannibalization', options: ['site', 'days', 'limit'], required: ['site'], description: 'Queries with competing pages' },
  ctr: { tool: 'ctr_benchmark', options: ['site', 'days'], required: ['site'], description: 'CTR curve and missed-click opportunities' },
  decay: { tool: 'decay', options: ['site', 'days', 'limit'], required: ['site'], description: 'Declining pages compared with the previous period' },
  countries: { tool: 'site_countries', options: ['site', 'days'], required: ['site'], description: 'Country breakdown for a property' },
  events: { tool: 'site_events', options: ['site'], required: [], description: 'Read site events' },
  merge: { options: ['site', 'donor', 'date', 'yes'], required: ['site', 'donor'], description: 'Record an existing domain merge (writes; requires --yes)' },
  skills: { options: ['name'], required: [], description: 'List skills, or download one with --name' },
  doc: { options: [], required: [], description: 'Print the server API documentation' }
};

/** @type {import('node:util').ParseArgsOptionsConfig} */
const GLOBAL = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  json: { type: 'boolean' },
  url: { type: 'string' },
  timeout: { type: 'string' }
};

class CliError extends Error {
  /** @param {string} message */
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

/** @param {string | undefined} command */
function help(command) {
  const spec = command ? COMMANDS[command] : undefined;
  const lines = ['gsc-hub — Google Search Console hub CLI', '', 'Usage: gsc-hub <command> [options]', ''];
  if (spec) {
    lines.push(`${command}: ${spec.description}`, ...spec.options.map((name) =>
      `  --${name}${name === 'yes' ? '' : ' <value>'}${spec.required.includes(name) ? ' (required)' : ''}`));
  } else {
    lines.push(...Object.entries(COMMANDS).map(([name, value]) => `  ${name.padEnd(16)} ${value.description}`));
  }
  lines.push('', 'Global options:',
    '  --url <base>      Server origin; otherwise GSC_HUB_URL or http://localhost:5173',
    '  --json            JSON result on stdout; JSON errors on stderr',
    '  --timeout <ms>    Request deadline, 1..600000 (default 60000)',
    '  -h, --help        Command help', '  -v, --version     CLI version', '',
    'Authentication: set GSC_HUB_KEY in the environment (key from the server /api page).',
    'Use the exact property from sites, e.g. --site sc-domain:example.com.',
    '--days: 1..480 (default 28); --limit: 1..500 (cannibalization/decay: 1..200).',
    'Exit codes: 0 success, 2 usage/config, 3 auth, 4 HTTP/connection, 5 API/protocol.',
    'Examples:', '  gsc-hub sites --days 28 --json',
    '  gsc-hub striking --site sc-domain:example.com --limit 50 --json');
  return lines.join('\n') + '\n';
}

/** @param {string} value @param {string} name @param {number} max */
function integer(value, name, max) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
    throw new CliError(`--${name} must be an integer from 1 to ${max}`);
  }
  return Number(value);
}

/** @param {unknown} value */
const cell = (value) => (typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '—'))
  .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');

/** @param {any} data Arbitrary JSON returned by the server. */
export function formatText(data) {
  if (typeof data === 'string') return data.endsWith('\n') ? data : data + '\n';
  if (!data || typeof data !== 'object') return cell(data) + '\n';
  const lines = [];
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value)) {
      lines.push(`${key}: ${cell(value)}`);
      continue;
    }
    lines.push(`${key} (${value.length}):`);
    if (value.length && value.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
      const columns = [...new Set(value.flatMap((row) => Object.keys(row)))];
      lines.push(columns.join('\t'), ...value.map((row) => columns.map((key) => cell(row[key])).join('\t')));
    } else {
      lines.push(...value.map(cell));
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Run with injectable I/O and fetch so failures can be tested without live GSC data.
 * @param {string[]} argv
 * @param {{env?: Record<string, string | undefined>, stdout?: {write: (s: string) => unknown}, stderr?: {write: (s: string) => unknown}, fetchImpl?: typeof fetch}} [io]
 */
export async function run(argv, {
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  fetchImpl = globalThis.fetch
} = {}) {
  let json = argv.includes('--json');
  const token = (env.GSC_HUB_KEY ?? '').trim();
  /** @param {string} text */
  const redact = (text) => token ? text.split(token).join('[REDACTED]') : text;
  try {
    // Parse global and per-command options together, then reject options not
    // supported by this command. Flags may precede or follow the command.
    const options = { ...GLOBAL };
    for (const spec of Object.values(COMMANDS)) {
      for (const name of spec.options) options[name] = { type: name === 'yes' ? 'boolean' : 'string' };
    }
    let parsed;
    try {
      parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
    } catch {
      throw new CliError('Invalid arguments. Run gsc-hub --help.');
    }
    const { values, positionals } = parsed;
    /** @param {string} name */
    const stringValue = (name) => typeof values[name] === 'string' ? values[name].trim() : '';
    json = Boolean(values.json);
    const command = positionals[0];
    const spec = Object.hasOwn(COMMANDS, command ?? '') ? COMMANDS[command] : undefined;
    if (positionals.length > 1 || (command && !spec)) throw new CliError('Unknown command or extra argument. Run gsc-hub --help.');
    if (values.version) {
      stdout.write(json ? JSON.stringify({ version: VERSION }) + '\n' : VERSION + '\n');
      return 0;
    }
    if (values.help || !command) {
      stdout.write(help(command));
      return 0;
    }
    if (!spec) throw new CliError('Unknown command.');
    for (const key of Object.keys(values)) {
      if (!Object.hasOwn(GLOBAL, key) && !spec.options.includes(key)) throw new CliError(`--${key} is not supported by ${command}`);
    }
    for (const name of spec.required) {
      if (!stringValue(name)) throw new CliError(`--${name} is required for ${command}`);
    }
    /** @type {Record<string, string | number>} */
    const args = {};
    for (const name of spec.options) {
      if (values[name] !== undefined && name !== 'yes') args[name] = stringValue(name);
    }
    if (args.days !== undefined) args.days = integer(String(args.days), 'days', 480);
    if (args.limit !== undefined) args.limit = integer(String(args.limit), 'limit', ['decay', 'cannibalization'].includes(command) ? 200 : 500);
    const timeout = integer(values.timeout !== undefined ? stringValue('timeout') : '60000', 'timeout', 600000);
    if (command === 'merge') {
      if (!values.yes) throw new CliError('merge writes a site event. Add --yes after authorizing this specific operation.');
      if (args.date !== undefined) {
        const date = String(args.date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
            new Date(date).toISOString().slice(0, 10) !== date) throw new CliError('--date must be a real YYYY-MM-DD date');
      }
    }
    if (command === 'skills' && args.name !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(args.name))) {
      throw new CliError('--name must be a skill name such as gsc-hub-cli');
    }
    let base;
    try {
      base = new URL(values.url !== undefined ? stringValue('url') : env.GSC_HUB_URL ?? 'http://localhost:5173');
      if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
    } catch {
      throw new CliError('GSC_HUB_URL / --url must be an HTTP(S) base URL without credentials, query or fragment.');
    }
    if (!token) throw new CliError('Set GSC_HUB_KEY to an API key from the server /api page.');
    let path = '/mcp';
    let body;
    if (spec.tool) body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: spec.tool, arguments: args } };
    else if (command === 'merge') { path = '/site-events'; body = args; }
    else if (command === 'skills') path = args.name ? `/skills/${encodeURIComponent(args.name)}` : '/skills';
    else path = '/doc.md';
    const endpoint = new URL(base);
    endpoint.pathname = base.pathname.replace(/\/$/, '') + '/api/v1' + path;
    let response;
    let raw;
    try {
      response = await fetchImpl(endpoint, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/plain', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout)
      });
      raw = await response.text();
    } catch {
      throw new CliError('Request failed or timed out. Check the server URL, connection and --timeout.', 4);
    }
    if (response.status === 401 || response.status === 403) throw new CliError(`Authentication failed (HTTP ${response.status}). Check GSC_HUB_KEY and its scope.`, 3);
    if (!response.ok) throw new CliError(`Server returned HTTP ${response.status}.${response.status === 404 ? ' Resource unavailable to this key or server version.' : ''}`, 4);
    let data;
    if (command === 'doc' || (command === 'skills' && args.name)) data = raw;
    else {
      try { data = JSON.parse(raw); } catch { throw new CliError('Server returned invalid JSON.', 5); }
    }
    if (spec.tool) {
      if (data?.jsonrpc !== '2.0' || data.id !== 1) throw new CliError('Invalid API response envelope.', 5);
      if (data.error) throw new CliError(`API: ${data.error.message ?? 'protocol error'}`, 5);
      if (data.result?.isError) throw new CliError(`API: ${data.result.content?.find((/** @type {{type?: string, text?: string}} */ item) => item.type === 'text')?.text ?? 'tool failed'}`, 5);
      if (data.result?.structuredContent !== undefined) data = data.result.structuredContent;
      else {
        try { data = JSON.parse(data.result.content.find((/** @type {{type?: string, text?: string}} */ item) => item.type === 'text').text); }
        catch { throw new CliError('API response has no valid result.', 5); }
      }
    }
    stdout.write(redact(json ? JSON.stringify(data) + '\n' : formatText(data)));
    return 0;
  } catch (error) {
    const code = error instanceof CliError ? error.code : 5;
    const message = redact(error instanceof CliError ? error.message : 'Unexpected CLI error.');
    stderr.write(json ? JSON.stringify({ error: { code, message } }) + '\n' : `gsc-hub: ${cell(message)}\n`);
    return code;
  }
}
