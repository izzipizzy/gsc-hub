# gsc-hub

> [Русская версия](README.ru.md)

## Screenshots

![Portfolio analytics — striking distance, cannibalization, CTR, branded & decay across all sites](docs/screenshots/portfolio.png)

| All sites — multi-account, sparklines, Bing/IndexNow | Dashboard — sparkline cards |
|---|---|
| ![Sites](docs/screenshots/sites.png) | ![Dashboard](docs/screenshots/dashboard.png) |

![Top queries](docs/screenshots/queries.png)

Local self-hosted multi-account hub for **Google Search Console**. Connect several Google accounts via OAuth, view all Search Console sites in a single table, aggregate queries and pages across accounts, see per-site dashboards with sparklines and period-over-period deltas, drill into 16-month query history with one click. Since 0.6.0 it also ships a full **SEO analytics suite** — per-site deep-dives (striking distance, cannibalization, CTR benchmark, content decay, branded split, site health) and a portfolio-wide view across all sites — plus Bing/IndexNow and optional multi-user login. No external service, no GSC data leaves your machine, only OAuth tokens (and a little per-site config) persist locally in SQLite. All analytics are live-fetched.

Built as a personal alternative to seogets-style SaaS tools when you have multiple Google accounts (personal, work, clients) and don't want to log in to each Search Console separately.

> **Status:** working MVP, used daily on macOS. Ships with a Docker Compose + OrbStack deploy served at `https://gsc.local`. Accounts are connected over `http://localhost:5173` because Google rejects OAuth redirects to `.local` domains (see [Deploying](#deploying-with-docker-compose--orbstack)).

## Features

### Multi-account OAuth
- Connect any number of Google accounts. Each click on **Connect Google account** runs a normal Google consent flow (`webmasters` read-write scope, `access_type=offline`, `prompt=consent`). The read-write scope is required to submit sitemaps; if you only need read access, change `src/auth.ts` back to `webmasters.readonly`.
- Tokens are stored in a local SQLite file (`./data/gsc-hub.db`). Refresh tokens auto-rotate; access tokens are refreshed transparently 60 seconds before they expire.
- Revoked tokens detected via the first 401 from Google: account is marked `revoked`, UI prompts reconnect, no silent failures.

### Unified sites table (`/properties`, displayed as **Sites**)
- All Search Console properties from all connected accounts, in one full-bleed table.
- Per-site live aggregate for the selected period: **Clicks / Impressions / CTR / Avg Pos**, plus a **CSV export** column (queries or pages, configurable period).
- A **totals bar** above the table sums **Sites / Impressions / Clicks** across all non-hidden sites for the selected period.
- URL-driven sort and filter: `?days=1|3|7|28|60&sort=clicks|impressions|ctr|position|site|account&dir=asc|desc`. Bookmark, share, browser-back work as expected.
- A **"G" badge** next to each site opens a Google `site:` search for a quick manual indexation check.
- Hide sites you don't care about (kept in localStorage per browser; doesn't sync).
- Domain properties displayed as `example.com` (the `sc-domain:` GSC prefix is stripped for display, link still goes to `https://example.com/`).
- Click any site row to expand a quick **URL Inspection** report for its top 10 URLs (verdict, coverage, robots, last crawl, canonical mismatch). Uses Google's URL Inspection API; daily quota is 2000 per Google account. Results are cached for **12 hours** in SQLite (key: account + site + url-set hash). Re-clicking the same site reuses the cache; **Force refresh** button bypasses it. The cache exists because URL Inspection has a hard 2000-call/day quota per Google account. Sites with no/low impressions in the current period fall back to URLs from their **sitemap**: gsc-hub asks Search Console which sitemaps the site submitted, downloads the first one (following sitemapindex if needed), and uses up to 10 page URLs from there. The homepage is always included.

### Sitemap submit
- **Submit sitemap** button per site: resubmits every sitemap Search Console already knows for that property, falling back to a guessed `/sitemap.xml` if none are registered. Inline status (`✓ N` / failure reason in the tooltip).
- **Submit all sitemaps** button in the toolbar: fans out across all visible (non-hidden) sites in parallel, with progress and an aggregate result.
- Requires the read-write `webmasters` scope (see Multi-account OAuth).

### Top queries (aggregated, sortable)
- Aggregated query-level rollup across all visible (non-hidden) sites for the selected period, broken down by **query × page × country**. Clicks, impressions, CTR (computed), Avg Pos (impression-weighted).
- Click the position cell to open the **Google SERP** for that query in the matching country.
- Click a row to expand a **16-month inline history chart** for that exact query: red position line + blue impression bars, gridlines, axis range labels. Aggregated by day across visible sites only.
- Client-side column sort (Query / Clicks / Impressions / CTR / Avg Pos), independent from the sites-table sort.

### Top pages (aggregated, sortable)
- Same pattern as Top queries, but at page-URL granularity. Useful for finding the URL that pulled a sudden spike.

### Per-site analytics (`/properties/[site]`)
Click through to a single property for a full SEO deep-dive. Tabs:
- **Striking Distance** — queries ranking at positions 4–20 with real impressions: the fastest wins to page 1.
- **Keyword Cannibalization** — queries where several of your own URLs compete, with a clear winner/loser breakdown.
- **CTR Benchmark** — your actual click-through rate by position vs an industry-reference curve, plus the pages that under-perform it.
- **Content Decay** — pages losing clicks **or** impressions vs the previous period.
- **Branded vs non-branded** — traffic split, with editable brand terms per site.
- **Site Health** — SSL (expiry / issuer / grade), Google Safe Browsing, and Core Web Vitals (PageSpeed Insights, mobile). Run on demand, cached per site. Needs a Google API key (see [Configuration](#configuration)); the tab stays hidden without one.

All tabs are computed live from Search Console; nothing is persisted beyond the editable brand terms and the health cache.

### Portfolio analytics (`/properties/portfolio`)
The same lenses across every non-hidden site at once, computed from a single query fan-out:
- Tabbed **Striking / Cannibalization / CTR / Branded / Decay**, all **URL-addressable** via `?tab=`.
- **Country (Geo) filter** and **copy-queries-to-clipboard**, both respecting the current filter.
- Per-decaying-page **index status** via the URL Inspection API, with a direct link into the owning Google account's inspection panel.
- Async streaming (the shell renders immediately) plus a short in-memory result cache, so re-opens and period switches are instant.

### Bing Webmaster + IndexNow
- Bing performance data alongside GSC, with merged GSC/Bing keyword rollups.
- **Submit sitemap to Bing** and **push URLs to IndexNow**, plus an IndexNow-key indicator per site.
- Requires `BING_API_KEY` (see [Configuration](#configuration)).

### Optional login & roles
- **Off by default** — the tool stays single-user and loopback-only. Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` to turn on a login form, server sessions (argon2-hashed passwords), a user-management page, and roles (**admin** / **manager**) with per-owner account scoping.
- Intended for when you expose the app beyond `127.0.0.1`; secure cookies switch on automatically once `ORIGIN` starts with `https://`.

### Dashboard (`/dashboard`)
- Grid of per-site cards: account label, site, sparkline of daily clicks for the current period, four metrics with **deltas vs the previous period of the same length** (e.g., last 7 days vs the 7 days before that). Green/red, also dual-encoded with `+` / `−` so colour-blind users get the signal.
- Configurable density: **2 / 4 / 6 columns** via URL `?cols=`. Same period filter as Sites.
- Stable order across reloads (clicks desc, impressions tiebreaker, then alphabetical).

### CSV exports
- Queries or pages, last N days (matches the period filter), sanitized filename. Streams `text/csv; charset=utf-8` with `Content-Disposition: attachment`. Downloaded directly from `/properties/export?account=...&site=...&days=...&dim=query|page`.

### Operator-grade UX details
- **Sparklines** of daily clicks on the site cards.
- **Privacy Blur** — one click blurs PII (emails, domains, metrics) for screenshots and screen-sharing.
- **Refresh** preserves all URL state (period, sort, dir, cols) via SvelteKit's `invalidateAll()`. No `<form method="POST">` redirect dance.
- All numbers in tables are tabular-nums for vertical alignment.
- Light hover affordance on rows. Sortable headers show ↑ / ↓.
- **No data is cached server-side.** Every page load is a live fan-out across active accounts. The cost is honest latency. The benefit is you see exactly what GSC sees, right now.
- No background jobs, no cron, no queues, no email.

## Quickstart

Requirements: **Node 22+**, **pnpm**.

```bash
git clone https://github.com/izzipizzy/gsc-hub.git
cd gsc-hub
pnpm install
pnpm dev
```

Open <http://localhost:5173> — the **setup wizard** opens on first run and asks for your Google Client ID/Secret; `AUTH_SECRET` is generated automatically, no manual `.env` editing needed. (Copying `.env.example` to `.env` is optional, only needed for automated/CI setups — see [Configuration](#configuration).) Click **Connect Google account**, complete consent, repeat for each account you want to connect.

For a long-running local deploy, use Docker Compose instead — see [Deploying with Docker Compose + OrbStack](#deploying-with-docker-compose--orbstack).

> **Connect accounts over `http://localhost:5173`, not `https://gsc.local`.** Google's OAuth policy rejects redirects to the `.local` TLD (`Error 400: invalid_request`). The Compose setup exposes a loopback port specifically so the consent flow can run on localhost; day-to-day you can still use `https://gsc.local`. The SQLite DB is shared, so a token obtained on localhost works on `gsc.local` too.

### Quick start (setup wizard)

1. `docker compose up -d --build`
2. Open the app (`http://localhost:5173` for connecting Google accounts).
3. The **setup wizard** opens automatically: paste your Google **Client ID** and
   **Client Secret** (the page shows the exact redirect URI to register in GCP),
   choose access mode (loopback-only or exposed-with-login), and save. No manual
   `.env` editing — `AUTH_SECRET` is generated for you and stored in SQLite.

If you're exposing the app on a public URL, set `GOOGLE_*`/`ADMIN_*` in env before
exposing it, or complete `/setup` yourself first — until setup completes, `/setup`
is open with no authentication and the first visitor to reach it could claim the
admin account.

The detailed GCP OAuth walkthrough below is only needed to obtain the two values
the wizard asks for. Everything under "Configuration" is optional / for automated
deploys (env vars take precedence over wizard values).

![Setup wizard](docs/screenshots/setup.png)

## Google Cloud setup

1. Open <https://console.cloud.google.com/apis/credentials>.
2. **Create credentials** → **OAuth client ID** → Application type **Web application**, name `gsc-hub`.
3. Authorized redirect URIs:
   - `http://localhost:5173/auth/callback/google` (dev)
   - `https://your-domain.example/auth/callback/google` (only if you deploy)
4. Enable the **Search Console API** in the same project: <https://console.cloud.google.com/apis/library/searchconsole.googleapis.com>.
5. **OAuth consent screen** (now under **Google Auth Platform → Audience**): set User Type to **External**. Either **Publish** the app (any Google account can sign in) or keep it in **Testing** and add your Google emails as Test users.
6. Copy the Client ID and Client Secret — paste them into the **setup wizard** when you first open the app. `AUTH_SECRET` needs no manual step; the wizard generates and stores it in SQLite.

The `webmasters` scope is a "sensitive scope" in Google's classification, but Google does not require formal verification for personal-tier usage (the OAuth user cap allows up to 100 consenting users for unverified sensitive scopes). You'll see an "unverified app" warning on the consent screen; click **Advanced → Go to gsc-hub (unsafe)** to proceed. Only register `http://localhost:5173/auth/callback/google` as the redirect URI — Google will not accept a `.local` redirect.

## Configuration

`.env` keys (see `.env.example`):

| key | required | description |
|-----|----------|-------------|
| `GOOGLE_CLIENT_ID` | yes | OAuth Web Application client ID |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth Web Application client secret |
| `AUTH_SECRET` | yes | Random 32-byte base64 secret for Auth.js (`openssl rand -base64 32`) |
| `AUTH_TRUST_HOST` | recommended | `true` for self-hosted/proxy setups |
| `DB_PATH` | optional | Path to SQLite file. Defaults to `./data/gsc-hub.db` |
| `PAGESPEED_KEY` | optional | Google API key for the Site Health tab (Core Web Vitals via PageSpeed Insights). Enable the **PageSpeed Insights API**. One Google API key can serve both Health checks. |
| `GOOGLE_SAFE_BROWSING_KEY` | optional | Google API key for the Site Health tab's Safe Browsing check. Enable the **Safe Browsing API** — the same key as `PAGESPEED_KEY` works. Without these two, the Health tab stays hidden; nothing else needs them. |
| `BING_API_KEY` | optional | Bing Webmaster API key — enables Bing data, "Submit to Bing", and IndexNow push. |
| `GSC_CONCURRENCY` | optional | Concurrent Search Console calls per fan-out. Defaults to `8`. Guards the local socket pool — unbounded, a ~200-site account times out the whole batch. Lower it if you still see connect timeouts. |
| `GSC_INSPECT_CONCURRENCY` | optional | Concurrent URL Inspection calls. Defaults to `4` — lower on purpose, since inspection is capped by quota (2000/day and 600/min per property), not by sockets. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | optional | Set both to enable multi-user login/roles (seeds an admin on first start). Leave unset for the default single-user, loopback-only mode. |
| `EXPOSED_MODE` | optional | Forces whether the app treats itself as reachable from outside loopback. Derived from `ORIGIN`/`AUTH_URL` by default. An exposed app with no login configured returns 503 rather than falling back to single-user local admin. |
| `ORIGIN` | optional | Public origin (e.g. `https://your-domain.example`). Enables secure cookies when it starts with `https://`. |
| `AUTH_URL` | optional | Public URL Auth.js uses to build the OAuth redirect; must match the GCP OAuth redirect base. |

## Architecture

```
[browser] ──┬─ https://gsc.local (OrbStack proxy, TLS) ──┐
            └─ http://localhost:5173 (loopback, for OAuth)┴─> [SvelteKit (Node) :3000] ──> Google Search Console API
                                                                       │
                                                                       └──> ./data/gsc-hub.db  (only OAuth tokens)
```

One Node process. One SQLite file. The DB schema is small — tokens plus a little per-site config and an external-check cache:

```sql
CREATE TABLE google_accounts (
  id            TEXT PRIMARY KEY,    -- google sub
  email         TEXT NOT NULL,
  label         TEXT,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  scope         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | revoked | error
  last_error    TEXT,
  added_at      INTEGER NOT NULL
);

CREATE TABLE url_inspection_cache (
  account_id   TEXT NOT NULL,
  site_url     TEXT NOT NULL,
  urls_hash    TEXT NOT NULL,
  fetched_at   INTEGER NOT NULL,
  payload      TEXT NOT NULL,
  PRIMARY KEY (account_id, site_url, urls_hash)
);

CREATE TABLE site_branded_keywords (
  site_url    TEXT PRIMARY KEY,
  terms       TEXT,
  updated_at  INTEGER
);

CREATE TABLE site_health (
  site_url    TEXT PRIMARY KEY,
  data        TEXT,
  checked_at  INTEGER
);
```

All four tables are created by the startup migration. When the optional login is enabled (`ADMIN_EMAIL`/`ADMIN_PASSWORD` set), two more tables — `users` and `sessions` — are seeded on first start.

**No GSC analytics data is persisted.** Every request to `/properties`, the per-site and portfolio analytics, `/dashboard`, the query-history endpoint or the CSV export does a fresh fan-out to Google. The database holds only OAuth tokens plus small per-site config (brand terms in `site_branded_keywords`) and a cache of the external health checks (`site_health`). Hidden sites are kept in browser localStorage only.

This keeps things simple, eliminates a "stale data" UX class, and means the database file you care about is tiny (a few KB per account). The trade-off is page-load latency proportional to the number of active sites: roughly 2N parallel API calls for the sites view, 3N for the dashboard, 1N for query history.

### Auth.js custom signIn callback

Auth.js v5 is wired with a custom `signIn` callback that, instead of creating an app session, **upserts the Google profile + tokens into `google_accounts`** keyed by `profile.sub`, then returns `'/'` to redirect cleanly without setting a session cookie. The app has no concept of "logged-in user" beyond local trust (single-user tool, defended by `127.0.0.1` binding in dev).

## Tech stack

- [SvelteKit](https://kit.svelte.dev/) (Svelte 5 runes) + TypeScript, Node adapter
- [Auth.js](https://authjs.dev/) (`@auth/sveltekit`) for the Google OAuth dance
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for the local token store
- [TailwindCSS v3](https://tailwindcss.com/) for styles (no custom palette extension; tokens documented in [DESIGN.md](DESIGN.md))
- [Vitest](https://vitest.dev/) for unit tests

No chart libraries: every sparkline and the query-history chart are hand-rolled SVG (`<rect>` + `<path>`). No icon fonts: every icon is a 14×14 inline SVG.

## Project layout

```
gsc-hub/
├── PRODUCT.md             — strategic context (users, principles, anti-references)
├── DESIGN.md              — visual system (colors, typography, components, rules)
├── DESIGN.json            — sidecar with HTML/CSS snippets per component
├── Dockerfile             — multi-stage production image (Node runtime)
├── compose.yaml           — Docker Compose: OrbStack domain + loopback port 5173
├── src/
│   ├── auth.ts            — SvelteKitAuth config + custom signIn callback
│   ├── hooks.server.ts
│   ├── app.css            — Tailwind + Operator Console utilities
│   ├── lib/
│   │   ├── server/
│   │   │   ├── db.ts               — SQLite open + migration
│   │   │   ├── accounts.ts         — CRUD over google_accounts (only file with SQL for that table)
│   │   │   ├── inspection_cache.ts — 12h SQLite cache for URL Inspection responses
│   │   │   ├── google.ts           — GSC client, refresh, fan-out, search analytics
│   │   │   ├── analytics.ts        — pure SEO analytics (striking / cannibalization / CTR benchmark / branded split / decay)
│   │   │   ├── health.ts           — Site Health (SSL / Safe Browsing / Core Web Vitals)
│   │   │   ├── branded.ts          — per-site brand terms (site_branded_keywords)
│   │   │   ├── bing.ts             — Bing Webmaster API client
│   │   │   ├── indexnow.ts         — IndexNow submit + key handling
│   │   │   └── csv.ts              — RFC 4180 CSV writer
│   │   └── utils/
│   │       ├── site.ts            — strip sc-domain: prefix, build proper href + Google site: search
│   │       └── country.ts         — map GSC country codes to Google SERP URLs
│   └── routes/
│       ├── +page.svelte           — Accounts list (/)
│       ├── auth/[...auth]/        — Auth.js catch-all
│       ├── accounts/[id]/         — delete, relabel
│       └── properties/
│           ├── +page.svelte       — Sites table + Top queries + Top pages
│           ├── [site]/            — per-site analytics detail (analytics / decay / health / branded sub-endpoints)
│           ├── striking/          — portfolio analytics + decay endpoint
│           ├── export/+server.ts        — CSV stream
│           ├── inspect/+server.ts       — URL Inspection (cached)
│           ├── refresh/+server.ts       — force-refresh helpers
│           ├── sitemap-urls/+server.ts  — fetch sitemap URLs for inspection fallback
│           ├── sitemap-submit/+server.ts — (re)submit sitemaps to GSC
│           └── query-history/+server.ts — 16-month per-query history
├── tests/                          — Vitest, mocks fetch/env
└── data/gsc-hub.db                 — gitignored, created on first run
```

## Commands

| command | description |
|---|---|
| `pnpm dev` | Dev server on http://localhost:5173 |
| `pnpm build` | Production build (Node target) |
| `pnpm preview` | Preview the production build |
| `pnpm test` | Run Vitest |
| `pnpm test:watch` | Watch mode |
| `pnpm check` | `svelte-check` type-check |
| `docker compose up -d --build` | Build and run the production container (OrbStack) |
| `docker compose logs -f gsc` | Follow container logs |
| `docker compose down` | Stop and remove the container (data in `./data` persists) |

## Tests

62 unit tests cover the server modules:
- SQLite migration and schema, including `url_inspection_cache` table (`tests/db.test.ts`)
- SEO analytics pure functions: striking distance, cannibalization, CTR benchmark, branded split, content decay (`tests/analytics.test.ts`)
- URL Inspection cache: hash determinism, miss, hit, TTL expiry, upsert, delete (`tests/inspection_cache.test.ts`)
- Accounts CRUD including `markActive` / `markRevoked` / `markError` (`tests/accounts.test.ts`)
- GSC client: token refresh skew window, 5xx → markError, 401/invalid_grant → markRevoked, fan-out aggregation, per-site queries / pages / daily breakdown / query-history (`tests/google.test.ts`)
- Sitemap URL fetching and parsing (`tests/sitemap.test.ts`)
- RFC 4180 CSV escaping (`tests/csv.test.ts`)

Routes are not unit-tested; smoke-tested via `curl` against `pnpm dev`.

## Privacy and data handling

- The only data persisted on your machine is the OAuth token row per connected Google account.
- No Search Console data (queries, clicks, impressions, page URLs, ranking positions) is ever written to disk.
- No analytics, no telemetry, no outbound calls except to Google's APIs.
- The SQLite file lives in `./data/` (gitignored). Delete it to wipe all connections.
- Tokens are stored in plaintext. This is acceptable for a local single-user tool; encrypt at rest if you ever expose this beyond `127.0.0.1`.
- The exception is the URL Inspection cache (`url_inspection_cache` table) which stores response payloads keyed by `(account_id, site_url, urls_hash)` for 12 hours, to avoid burning the daily 2000-call quota on repeat clicks. Delete `data/gsc-hub.db` to wipe it.
- Two more small tables hold per-site config, not GSC analytics: `site_branded_keywords` (your editable brand terms) and `site_health` (a cache of external SSL / Safe Browsing / Core Web Vitals checks). Both are wiped with the same DB file.

## Deploying with Docker Compose + OrbStack

The repo ships a `Dockerfile` (multi-stage, Node runtime) and a `compose.yaml` tuned for [OrbStack](https://orbstack.dev/) on macOS:

```bash
docker compose up -d --build   # build and start
docker compose logs -f gsc     # follow logs
docker compose restart gsc     # restart
docker compose down            # stop (data in ./data persists)
```

- Served at **`https://gsc.local`** via the OrbStack proxy (automatic TLS) — set by the `dev.orbstack.domains` label. Also reachable at `https://gsc.orb.local` (auto domain by container name).
- `restart: unless-stopped` brings the container back after a reboot (OrbStack starts on login).
- The container also binds **`127.0.0.1:5173 → 3000`** (loopback only). This exists solely so the OAuth flow can run on `http://localhost:5173` — Google rejects `.local` redirects. Use this URL to connect accounts; use `https://gsc.local` for everyday work.
- `.env` is read via `env_file`; secrets are injected at runtime through `$env/dynamic/private`, not baked into the image.
- `./data` is bind-mounted, so the SQLite token store survives rebuilds and is shared with `pnpm dev`.

**Security note:** the app has no built-in authentication (single-user tool). The port is intentionally bound to `127.0.0.1` only — do not expose it on `0.0.0.0` or the network, since the DB holds Google OAuth tokens. To publish on a public hostname, front it with an identity-aware proxy (e.g. Cloudflare Access) limited to your email, and add the production callback URL to your Google OAuth client.

## Roadmap

The SEO analytics suite (per-site + portfolio: striking distance, cannibalization, CTR benchmark, content decay, branded split, site health), Bing/IndexNow, and optional login/roles all shipped in 0.6.0. Still on the list:

- Daily background pull of aggregates into Postgres for trends and period comparisons that span weeks/months without re-querying GSC each time.
- Charts with hover tooltips on the dashboard cards.
- Sitemap change monitoring.
- Alerts on traffic drops.

Analytics stay intentionally live-fetched; a persistent cache will come only when usage shows it's needed. Until then, every load is fresh.

## License

MIT. See [LICENSE](LICENSE).
