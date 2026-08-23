# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are git tags.

Русская версия — [CHANGELOG.ru.md](CHANGELOG.ru.md).

## [0.6.4] — 2026-08-23

### Fixed
- The default brand term is now the registrable label, not the second-to-last
  one. For every multi-label public suffix the old rule returned a fragment of
  the suffix — `co` for `example.co.uk`, `com` for `store.example.com.au`. That
  term is matched case-insensitively as a *substring*, so the branded split did
  not merely get noisy, it inverted: `discount code` and `cost of delivery`
  counted as branded while `example login` did not. Derived from the Public
  Suffix List. (thanks @klimenkoalex — [#5](https://github.com/izzipizzy/gsc-hub/pull/5))
- Private suffixes are consulted, so `user.github.io` yields `user` rather than
  `github`, and `name.blogspot.com` yields `name` rather than `blogspot`.
- An IP host is kept whole instead of falling through to the old rule, which
  returned an octet — `168` as a brand term matches a great many queries.

Per-site overrides in `site_branded_keywords` are untouched and still win over
the default. Sites already storing one see no change.

Known limitation, tracked in [#8](https://github.com/izzipizzy/gsc-hub/issues/8):
the split still matches terms as substrings, so a short *manual* override (`go`,
`it`, `ai`) produces the same false positives this release removes from the
defaults.

## [0.6.3] — 2026-08-23

Security release. **Upgrade if you run this app on anything other than
loopback.** Two shortcuts meant for a single-user localhost install could hand a
visitor full admin over every connected Search Console account when the app was
reachable from the internet.

### Security
- An instance behind a public origin no longer falls back to anonymous local
  admin. `decideRoute` passed *every* request as admin whenever login was off —
  a mode intended for a loopback install, but nothing checked that the request
  came from loopback. A deployment that lost its `ADMIN_EMAIL`/`ADMIN_PASSWORD`,
  or came up on a fresh volume, served an open panel. It now refuses to serve
  anything (503) until a login is configured.
- The setup wizard is no longer reachable anonymously on a public origin. `/setup`
  is deliberately open until setup completes, which on a public host meant the
  first visitor could claim the instance. Configure `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` through the
  environment when deploying exposed.
- A rejected setup form no longer leaves the app configured. The Google
  credentials were written before the admin password was validated, and
  `isSetupComplete()` only looks at those credentials — so a failed submission
  flipped the app from "redirect everything to /setup" to "set up, no login,
  everything open". Nothing is written now until every field is accepted, and
  the writes happen in one transaction. (thanks @klimenkoalex — [#2](https://github.com/izzipizzy/gsc-hub/pull/2))
- Exposed mode always enables login. `LOGIN_ENABLED` was set only when creating
  the first admin, so a second submission completed setup with login switched off.
- Reconfiguring a completed setup now requires an admin, instead of accepting an
  anonymous POST to `/setup`.
- The login throttle can no longer be bypassed with whitespace. The user lookup
  trims and lowercases the email while the throttle key only lowercased it, so
  `" admin@example.com"` was a fresh five-attempt bucket against the same
  password hash. A per-address bucket was added alongside it, so one client
  cannot spend a full allowance against each of many accounts in turn.

### Added
- `EXPOSED_MODE` forces the exposed/loopback decision either way. By default it
  is derived from `ORIGIN` (falling back to `AUTH_URL`): loopback addresses,
  mDNS `.local` names and private IP ranges are treated as not exposed.
- Per-site link into the Search Console UI that opens under the owning account,
  landing directly on Performance → Search results.

## [0.6.2] — 2026-08-04

Reliability release for large portfolios: the per-site fan-out no longer melts
the socket pool, and an expired token is refreshed once instead of once per site.

### Fixed
- Per-site fan-outs are bounded to 8 concurrent Search Console calls instead of
  one connection per property. On a ~200-site account the unbounded fan-out
  saturated the socket pool and the whole batch died with `UND_ERR_CONNECT_TIMEOUT`,
  so the Sites table rendered dashes. (thanks @KuznetsovRA — [#1](https://github.com/izzipizzy/gsc-hub/pull/1))
- An expired access token is now refreshed once per account per fan-out. The
  shared account row is updated in place and concurrent refreshes are deduped, so
  a 200-site page load no longer sends 200 token-endpoint requests — a burst
  Google can answer with 400s that were being read as `invalid_grant` and marked
  the account revoked.

### Changed
- Fan-out concurrency is tunable via `GSC_CONCURRENCY` (default 8). URL Inspection
  runs narrower under `GSC_INSPECT_CONCURRENCY` (default 4) — it is capped by quota
  (2000/day, 600/min per property), not by the socket pool.

## [0.6.1] — 2026-07-19

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

[0.6.2]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.6.2
[0.6.1]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.6.1
[0.6.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.6.0
[0.3.1]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.3.1
[0.3.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.3.0
[0.2.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.2.0
[0.1.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.1.0
