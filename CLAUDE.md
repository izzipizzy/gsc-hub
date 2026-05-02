# gsc-hub

Локальный мульти-аккаунт SvelteKit-апп для Google Search Console. Один пользователь (персональный инструмент). Доступен через cloudflared-туннель на gsc.doxer.top + локально на :5173.

## Стек

- SvelteKit (Node adapter) + TypeScript
- Auth.js (`@auth/sveltekit`) — Google OAuth
- better-sqlite3 — единственное хранилище (только OAuth-токены)
- TailwindCSS — минимальный UI
- Vitest — тесты

## Архитектура

**Что хранится в БД:** только токены подключённых Google-аккаунтов (`google_accounts`).
**Что НЕ хранится:** никакие данные GSC (Properties, queries, clicks). Всегда live-fetch.

**OAuth-flow (мульти-аккаунт):** Auth.js `signIn`-callback переопределён. Вместо создания app-сессии callback апсертит запись в `google_accounts` по `profile.sub` и возвращает редирект-URL (`'/'`). Auth.js при этом не создаёт сессионную куки и просто кидает обратно на главную. Апп защищён cloudflared+Cloudflare Access снаружи и localhost-binding изнутри.

**Refresh access-токена:** перед каждым GSC-вызовом проверяется `expires_at`. Если истёк — обмен через `https://oauth2.googleapis.com/token`. При 401 после refresh — `status='revoked'`, UI показывает «Reconnect».

**Без фоновых задач.** Никаких cron, очередей, воркеров.

## Структура

- `src/lib/server/db.ts` — SQLite + миграция при старте
- `src/lib/server/accounts.ts` — CRUD по google_accounts (единственный модуль с SQL)
- `src/lib/server/google.ts` — GSC API client + refresh + fan-out (единственный модуль, знающий GSC API)
- `src/lib/server/csv.ts` — CSV-стрим (чистая функция)
- `src/auth.ts` — Auth.js config + custom signIn callback
- `src/hooks.server.ts` — подключение Auth.js handle
- `src/routes/` — UI и API-роуты (только дёргают server-модули, без прямых SQL/API)

**Принцип изоляции:** роуты не вызывают SQL и Google API напрямую — только через модули из `src/lib/server/`.

## Команды

- `pnpm dev` — dev-сервер
- `pnpm build && node build/index.js` — прод-запуск
- `pnpm test` — Vitest
- `pnpm check` — svelte-check (type-check)

## Секреты

`.env` (gitignored, не коммитить):
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Web application client из GCP
- `AUTH_SECRET` — `openssl rand -base64 32`
- `AUTH_TRUST_HOST=true`

## БД

`./data/gsc-hub.db` (gitignored). Создаётся автоматически при старте через миграцию в `db.ts`. Для wipe — удали файл и перезапусти.

## Деплой

Локально на маке:
- `pm2 start "node build/index.js" --name gsc-hub` (или launchd-агент)
- `cloudflared tunnel run` с маршрутом `gsc.doxer.top → 127.0.0.1:5173`
- Cloudflare Access policy: allow только email пользователя

## Что вне MVP

Кеш данных GSC, графики, сравнения периодов, URL Inspection bulk, sitemap-monitor, алерты — относятся к фазе B (отдельная спецификация позже).
