# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are git tags.

Русская версия — [CHANGELOG.ru.md](CHANGELOG.ru.md).

## [Unreleased]

### Added
- Browser **setup wizard** at `/setup`: configure Google OAuth keys and access
  mode without editing `.env`. `AUTH_SECRET` is auto-generated and stored in SQLite.
- Admin for exposed deployments is now created in the browser (argon2), not via
  `ADMIN_PASSWORD` env — removes the env-quoting / one-shot-seed lockout traps.

### Fixed
- Single-user (loopback) mode no longer forces a login redirect; it runs as a
  local admin. Login is enabled only when an admin exists or env creds are set.
- Token refresh resolves the Google OAuth client credentials through the config
  layer (env or wizard-stored), so a wizard-configured self-host keeps refreshing
  access tokens instead of failing once the first one expires.

### Changed
- Config precedence: environment variables override the wizard-stored values;
  env-provided fields are shown read-only in the wizard.

### Security
- Before setup completes, `/setup` is reachable without authentication. On a
  publicly-exposed instance with no `GOOGLE_*`/`ADMIN_*` env set, the first
  visitor could complete the wizard and claim the admin account — set env
  before exposing, or complete `/setup` yourself first.

## [0.6.0] — 2026-07-18

Big release: a full SEO analytics suite on top of Search Console — per-site
deep-dives and a portfolio-wide view — plus Bing/IndexNow, site health checks,
and optional multi-user login. All analytics are live-fetched; no GSC data is
stored.

### Added

**Per-site analytics** — a new detail page at `/properties/[site]` with tabs:
- **Striking Distance** — queries ranking at positions 4–20 with real
  impressions (the fastest wins to page 1).
- **Keyword Cannibalization** — queries where several of your own URLs compete,
  with a clear winner/loser breakdown.
- **CTR Benchmark** — your actual click-through rate by position vs an
  industry-reference curve, plus the pages that under-perform it.
- **Content Decay** — pages losing clicks **or impressions** vs the previous
  period.
- **Branded vs non-branded** split, with editable brand terms per site.
- **Site Health** — SSL (expiry/issuer/grade), Google Safe Browsing, and Core
  Web Vitals (PageSpeed Insights, mobile). Run on demand, cached per site.

**Portfolio analytics** — a new `/properties/portfolio` view aggregating every
non-hidden site:
- Tabbed Striking / Cannibalization / CTR / Branded / Decay, all
  **URL-addressable** (`?tab=`), computed from a single query fan-out.
- **Country (Geo) filter** and **copy-queries-to-clipboard**, both respecting
  the current filter.
- Per-decaying-page **index status** via the GSC URL Inspection API, with a
  direct link into the right Google account's inspection panel.
- Async streaming (the shell renders immediately) + a short in-memory result
  cache, so re-opens and period switches are instant.

**Other**
- **Sparklines** of daily clicks on the site cards.
- **Privacy Blur** — one click blurs PII (emails, domains, metrics) for
  screenshots and screen-sharing.
- **Bing Webmaster + IndexNow** — Bing performance data, merged GSC/Bing keys,
  submit sitemap to Bing, push URLs to IndexNow, and an IndexNow-key indicator.
- **Optional login & roles** (`admin` / `manager`) for when you expose the app
  beyond loopback: login form, server sessions (argon2-hashed passwords), a user
  management page, and per-owner account scoping. Off by default — the tool stays
  single-user and loopback-only unless `ADMIN_EMAIL`/`ADMIN_PASSWORD` are set.
- `/properties` niceties: junk-query filters, custom day range, export-all-queries
  CSV, print/PDF stylesheet, sitemap management popup, per-account totals, and an
  average-position range filter.

### Changed
- Analytics are computed **live** — no GSC data is persisted. The database holds
  only OAuth tokens plus small per-site config (brand terms) and a cache of the
  external health checks.
- Secure cookies turn on automatically when `ORIGIN` starts with `https://`.

### Notes / upgrade
- Site Health is optional and needs its own Google API key(s): set `PAGESPEED_KEY`
  and `GOOGLE_SAFE_BROWSING_KEY` (one key works for both — enable the PageSpeed
  Insights API and the Safe Browsing API). Without them the Health tab stays
  hidden; nothing else needs them.
- New tables (`site_branded_keywords`, `site_health`) are created automatically by
  the startup migration.

## [0.3.1] — 2026-06-11

### Added
- **Totals bar** on `/properties`: sums Sites / Impressions / Clicks across all
  non-hidden sites for the selected period.

## [0.3.0] — 2026-06-08

Major release: deploy moved to Docker Compose + OrbStack, sitemap submitting was
added, and query analytics / mobile UI were expanded.

### Added
- **Sitemap submit.** A per-site **Submit sitemap** button resubmits every
  sitemap Search Console already knows for the property (falling back to a
  guessed `/sitemap.xml` if none are registered), plus a **Submit all sitemaps**
  toolbar button that fans out across all visible sites in parallel. Failure
  reasons surface in the row tooltip.
- **Query breakdown by page and country** (query × page × country) in the Top
  queries table.
- **Google SERP link**: click a query's position cell to open the Google SERP for
  that query in the matching country.
- **"G" badge** next to each site for a one-click Google `site:` indexation check.
- **1-day and 60-day** periods in addition to 3/7/28.
- **Docker Compose + OrbStack deploy**: multi-stage `Dockerfile`, `compose.yaml`
  (served at `https://gsc.local` with automatic TLS), `.dockerignore`. The
  container also binds `127.0.0.1:5173 → 3000` so OAuth can run over localhost.

### Changed
- OAuth scope is now `webmasters` (read-write) instead of `webmasters.readonly`,
  required for sitemap submitting. Revert `src/auth.ts` to `.readonly` for
  read-only use.
- Deploy story switched from pm2 to Docker Compose (the pm2 ecosystem config was
  removed).
- Secrets are injected at runtime via `$env/dynamic/private` instead of being
  read at build time.
- Both READMEs (en/ru) and `CLAUDE.md` updated for the new deploy and OAuth flow.

### Fixed
- Pinned `@auth/core` to `0.41.2` to match `@auth/sveltekit` 1.11.2; the stray
  `0.34.3` shadowed it and broke sign-in with
  `TypeError: basePath?.replace is not a function`.

### Notes / upgrade
- **Connect accounts over `http://localhost:5173`, not `https://gsc.local`** —
  Google rejects OAuth redirects to the `.local` TLD (`Error 400: invalid_request`).
- Reconnect each account once to grant the read-write scope before sitemap submit
  works.
- The loopback port is intentionally bound to `127.0.0.1` only; the app has no
  built-in auth and the DB holds OAuth tokens — do not expose it to the network.

## [0.2.0] — 2026-05-02

### Added
- Inline **URL Inspection** expansion per site (top 10 URLs: verdict, coverage,
  robots, last crawl, canonical mismatch).
- 12-hour SQLite cache for URL Inspection responses, with a force-refresh option,
  to stay under Google's 2000-call/day quota.
- Sitemap fallback for URL selection when a site has few/no impressions; the
  homepage is always included.

## [0.1.0] — 2026-05-02

- Initial release: multi-account Google Search Console hub — OAuth connect,
  unified sites table, aggregated top queries/pages, per-site dashboard with
  sparklines and period-over-period deltas, 16-month query history, CSV exports.

[0.6.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.6.0
[0.3.1]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.3.1
[0.3.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.3.0
[0.2.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.2.0
[0.1.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.1.0
