# gsc-hub CLI

The CLI is a dependency-free Node 22.18+ client for an existing gsc-hub server.
It does not need Google OAuth credentials, a local database, or an MCP client.
Read commands call the server's stateless JSON-RPC `/api/v1/mcp` endpoint;
`merge` uses the existing REST `/api/v1/site-events` endpoint. Server key scopes,
query filters, quotas and caching apply unchanged.

## Install and configure

To install CLI and skills independently from GitHub or Gitea without the server,
use the [macOS / Windows preparation and installation guide](CLIENT-INSTALL.md).
It covers missing Git, Node/npm, Homebrew/winget, PATH and selecting components.
The repository installer (`node cli/install.mjs --cli`) installs a packed copy
that survives removal of the checkout. The direct npm command below is useful
for a permanent development checkout, since npm may link to that directory.

From this repository checkout:

```bash
npm install -g ./cli
gsc-hub --version
gsc-hub --help
```

Alternatively run `node cli/bin/gsc-hub.mjs` without installation. To distribute
an offline installer, run `npm pack ./cli` and install the resulting tarball
with `npm install -g /path/to/gsc-hub-cli-0.1.0.tgz`. No npm registry publication
is required. Reinstall after pulling updates.

The Docker image also includes `gsc-hub`. Inside the container use
`--url http://127.0.0.1:3000` and supply `GSC_HUB_KEY` privately at runtime.

Create a scoped key on your server's `/api` page and load it into `GSC_HUB_KEY`
through your shell's secret manager or a private environment file. There is
no token flag or on-disk credential store. Do not paste the key into chat,
command arguments or source files. Set the server URL separately:

```bash
export GSC_HUB_URL=https://gsc.example.com
# GSC_HUB_KEY is supplied privately in the environment.
gsc-hub sites --days 28 --json
```

URL precedence: `--url` > `GSC_HUB_URL` > `http://localhost:5173`.
Use HTTPS for remote servers. Redirects are rejected so a misconfigured proxy
cannot silently forward a request. API paths are appended to the base URL;
pass the instance root, not `/api/v1` or `/api/v1/mcp`.

## Commands

Use the exact property returned by `sites`, including `sc-domain:` or URL prefix.
Options can precede or follow the command. Unknown and unsupported options fail
before making a request.

| Command | Required options | Optional options |
|---|---|---|
| `sites` | — | `--days` |
| `queries` | `--site` | `--days`, `--limit` |
| `query-pages` | `--site`, `--query` | `--days` |
| `striking` | — | `--site`, `--days`, `--limit` |
| `cannibalization` | `--site` | `--days`, `--limit` |
| `ctr` | `--site` | `--days` |
| `decay` | `--site` | `--days`, `--limit` |
| `countries` | `--site` | `--days` |
| `events` | — | `--site` |
| `merge` | `--site`, `--donor`, `--yes` | `--date YYYY-MM-DD` |
| `skills` | — | `--name` (prints a SKILL.md) |
| `doc` | — | — |

All commands support `--url`, `--json`, `--timeout`, `--help`, `--version`.
Days: 1..480, default 28. Limit: 1..500 for queries/striking, 1..200 for
cannibalization/decay; server defaults apply when omitted. Timeout: 1..600000 ms,
default 60000. The CLI does not automatically retry requests.

```bash
gsc-hub queries --site sc-domain:example.com --days 28 --limit 100 --json
gsc-hub query-pages --site sc-domain:example.com --query "example query" --json
gsc-hub striking --days 28 --json
gsc-hub decay --site sc-domain:example.com --timeout 120000 --json
gsc-hub events --site sc-domain:example.com
```

Default output is text with tab-separated tables and metadata. Nested records
remain JSON within cells. `--json` prints the API result as one JSON value to
stdout; errors are `{ "error": { "code": ..., "message": ... } }` on stderr.
Keep `partial` warnings when building reports; they are not zero metrics.
Skill/doc downloads are raw text by default, or a JSON string with `--json`.

Exit codes: **0** success, **2** usage/configuration, **3** authentication
(HTTP 401/403), **4** HTTP/network/timeout, **5** tool/protocol failure.

`merge` records an already performed domain merge; it does not configure a 301
redirect. It requires explicit `--yes`. The date defaults to today UTC on the
server. The same site, donor and date return the existing event. No link-buying
or paid indexing command is exposed.

## Agent skill

The repository skill is `.agents/skills/gsc-hub-cli/SKILL.md`. It is also bundled
into the server and available through the existing skill API and MCP prompts.
To install into a user's Codex skills directory (only when requested):

```bash
mkdir -p ~/.codex/skills/gsc-hub-cli
gsc-hub skills --name gsc-hub-cli > ~/.codex/skills/gsc-hub-cli/SKILL.md
```

For Claude Code, use `~/.claude/skills/gsc-hub-cli/SKILL.md` as the destination.
The skill describes the CLI equivalents of the four existing SEO workflows;
their MCP tools continue to work.
