# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are git tags.

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

[0.3.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.3.0
[0.2.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.2.0
[0.1.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.1.0
