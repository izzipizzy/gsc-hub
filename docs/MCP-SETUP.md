# MCP server & agent skills

gsc-hub ships a built-in **MCP server** at `/api/v1/mcp`, so Claude Code, Claude
Desktop, Cursor, Codex or any other MCP client can read your Search Console data
directly. Ready-made **agent skills** come with it, served by the same instance -
your agent needs a key and a URL, not a copy of this repository.

The tools are **read-only**. They return Search Console statistics and nothing
else: no writes, no domain merges, no spending.

## 1. Create a key

Open `/api` in your hub and create a key. Two things matter there:

- **Name** - who the key is for. It shows up in the list next to the last-used
  timestamp, which is how you notice a forgotten key still being used.
- **Sites** - the key's scope. Tick the properties this key may see, or leave
  everything unticked for "all sites".

You can create as many keys as you like, each with its own scope: one for an
agent working on your Spanish pool, another for a contractor who should see a
single site. A key never sees anything outside its scope - scoped-out properties
are missing from every list, and asking for one by name returns `404 site not
found`.

The secret is shown **once**. If you lose it, revoke the key and make a new one;
the database only stores its sha256.

## 2. Connect the server

```bash
claude mcp add --transport http gsc-hub https://your-hub.example.com/api/v1/mcp \
  --header "Authorization: Bearer gsk_your_key"
```

Any MCP client that speaks Streamable HTTP works the same way: the endpoint is a
single `POST` accepting JSON-RPC 2.0, with the key in the `Authorization`
header. There is no SSE stream and no session state, so a load balancer in front
of the hub needs no sticky sessions.

Check the wiring without a client:

```bash
curl -s https://your-hub.example.com/api/v1/mcp \
  -H "Authorization: Bearer gsk_your_key" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -40
```

## 3. Tools

| Tool | Returns | Required |
|---|---|---|
| `list_sites` | sites the key can see, with clicks/impressions/CTR/position for the period | - |
| `site_queries` | a site's queries | `site` |
| `query_pages` | which pages rank for one query | `site`, `query` |
| `striking_keywords` | positions 4-20 with real impressions; without `site`, across every site the key can see | - |
| `cannibalization` | queries where several of your own pages compete | `site` |
| `ctr_benchmark` | CTR against the expected curve, plus under-performing queries | `site` |
| `decay` | pages that lost clicks and impressions, recent window vs the previous one | `site` |
| `site_countries` | per-country split for a site | `site` |
| `site_events` | domain merges and link purchases with dates, read-only | - |

Every tool takes an optional `days` (1..480, default 28); list-shaped tools take
`limit`. A tool error comes back as a result with `isError: true` rather than a
protocol failure, so the model can read the message and fix its arguments.

Sites are matched by host, so `sc-domain:example.com`, `https://example.com/`
and `https://www.example.com/` are the same site both in a key's scope and in a
tool argument.

## 4. Skills

Four skills ship with the hub:

| Skill | For |
|---|---|
| `gsc-striking-plan` | turn positions 4-20 into a ranked plan of what to work on first |
| `gsc-cannibalization` | find competing pages and decide what to merge, rewrite or leave alone |
| `gsc-decay-triage` | explain a drop: which pages lost what, and whether a merge or a season explains it |
| `gsc-portfolio-review` | period review across the whole portfolio: what grew, what fell, where the growth is |

**As MCP prompts** - nothing to install. They are listed by `prompts/list` and
appear in Claude Code as `/mcp__gsc-hub__gsc-striking-plan` and friends.

**As files**, if you would rather have real local skills:

```bash
BASE=https://your-hub.example.com
KEY=gsk_your_key
for s in $(curl -s "$BASE/api/v1/skills" -H "Authorization: Bearer $KEY" \
            | python3 -c 'import json,sys; print(" ".join(s["name"] for s in json.load(sys.stdin)["skills"]))'); do
  mkdir -p ~/.claude/skills/$s
  curl -s "$BASE/api/v1/skills/$s" -H "Authorization: Bearer $KEY" > ~/.claude/skills/$s/SKILL.md
done
```

The same files live in this repository under `.agents/skills/`, if you have it.

## 5. What the server will not do

- It will not write. Domain merges, MagicLinks purchases and every other write
  in the hub stay out of the MCP surface on purpose, so an agent speaking MCP
  cannot change anything or spend money. The key is not read-only outside MCP:
  the REST endpoint `POST /api/v1/site-events` accepts the same Bearer and
  records a domain merge on a site within the key's scope.
- It will not show data outside a key's scope.
- It will not invent numbers. Every tool answers from a live Search Console
  fetch through the hub's own modules; nothing is cached in the database.
