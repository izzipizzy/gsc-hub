# gsc-hub

> [English version](README.md)

## Скриншоты

| Sites — мульти-аккаунт-сводка | Dashboard — карточки со sparkline |
|---|---|
| ![Sites](docs/screenshots/sites.png) | ![Dashboard](docs/screenshots/dashboard.png) |

![Top queries](docs/screenshots/queries.png)

Локальный self-hosted мульти-аккаунт хаб для **Google Search Console**. Подключаешь несколько Google-аккаунтов через OAuth, видишь все Search Console сайты в одной таблице, агрегируешь ключи и страницы поверх аккаунтов, дашборд карточек по сайтам с sparkline-графиками и дельтой к предыдущему периоду, по клику на ключ — 16-месячная история позиции. Никаких внешних сервисов, никакие данные GSC не уходят с твоей машины, локально хранятся только OAuth-токены в SQLite.

Сделан как личная альтернатива seogets-style SaaS-инструментам, когда у тебя несколько Google-аккаунтов (личный, рабочий, клиентские) и не хочется логиниться в каждый Search Console отдельно.

> **Статус:** рабочий MVP, используется ежедневно на macOS. В коробке деплой через Docker Compose + OrbStack на `https://gsc.local`. Аккаунты подключаются через `http://localhost:5173`, потому что Google не принимает OAuth-redirect на `.local`-домены (см. [Деплой](#деплой-через-docker-compose--orbstack)).

## Возможности

### Мульти-аккаунт OAuth
- Подключай произвольное количество Google-аккаунтов. Каждый клик на **Connect Google account** запускает обычный Google consent flow (`webmasters` read-write scope, `access_type=offline`, `prompt=consent`). Read-write scope нужен для отправки sitemap'ов; если нужен только доступ на чтение — верни в `src/auth.ts` `webmasters.readonly`.
- Токены хранятся в локальном SQLite-файле (`./data/gsc-hub.db`). Refresh-токены ротируются автоматически; access-токены обновляются прозрачно за 60 секунд до истечения.
- Отозванные токены детектятся первым 401 от Google: аккаунт помечается как `revoked`, UI просит переподключиться, никаких тихих сбоев.

### Объединённая таблица сайтов (`/properties`, в UI **Sites**)
- Все Search Console properties со всех подключённых аккаунтов в одной full-bleed таблице.
- Live-аггрегат на каждый сайт за выбранный период: **Clicks / Impressions / CTR / Avg Pos**, плюс колонка **CSV export** (queries или pages, период настраивается).
- **Строка итогов** над таблицей суммирует **Sites / Impressions / Clicks** по всем не скрытым сайтам за выбранный период.
- Сортировка и фильтр через URL: `?days=1|3|7|28|60&sort=clicks|impressions|ctr|position|site|account&dir=asc|desc`. Bookmark, шаринг, browser-back работают как ожидаешь.
- **Бейдж «G»** рядом с каждым сайтом открывает поиск Google `site:` для быстрой ручной проверки индексации.
- Скрывай сайты, которые не нужны (хранится в localStorage браузера, не синкается между устройствами).
- Domain properties отображаются как `example.com` (префикс `sc-domain:` GSC обрезается для UI, ссылка по-прежнему ведёт на `https://example.com/`).
- Клик по строке сайта разворачивает быстрый отчёт **URL Inspection** для топ-10 URL'ов (verdict, coverage, robots, last crawl, mismatch canonical). Использует Google URL Inspection API; дневная квота 2000 на Google-аккаунт. Результаты **кешируются на 12 часов** в SQLite (ключ: account + site + хэш url-набора). Повторный клик берёт из кеша; кнопка **Force refresh** — обновить с нуля. Кеш нужен потому что URL Inspection имеет жёсткий лимит 2000 вызовов/сутки на Google-аккаунт. Для сайтов без impressions или с малыми impressions в текущем периоде используется fallback по **sitemap**: gsc-hub спрашивает у Search Console какие sitemap'ы сабмиттил сайт, скачивает первый (с обработкой sitemapindex), и берёт до 10 URL'ов оттуда. Главная всегда включается.

### Отправка карт сайта (Sitemap submit)
- Кнопка **Submit sitemap** на каждый сайт: переотправляет в Search Console все уже зарегистрированные sitemap'ы, а если их нет — пробует угаданный `/sitemap.xml`. Inline-статус (`✓ N` / причина ошибки в подсказке).
- Кнопка **Submit all sitemaps** в тулбаре: параллельно по всем видимым (не скрытым) сайтам, с прогрессом и итоговой сводкой.
- Требует read-write scope `webmasters` (см. Мульти-аккаунт OAuth).

### Top queries (агрегированные, сортируемые)
- Агрегат по ключам поверх всех видимых (не скрытых) сайтов за выбранный период, с разбивкой **query × page × country**. Clicks, impressions, CTR (вычисляемый), Avg Pos (взвешенный по impressions).
- Клик по ячейке позиции открывает **Google SERP** для этого ключа в соответствующей стране.
- Клик на строку разворачивает **inline-график 16-месячной истории** для этого ключа: красная линия позиции + синие столбики impressions, gridlines, подписи диапазона. Агрегация по дням только по видимым сайтам.
- Client-side сортировка по столбцам (Query / Clicks / Impressions / CTR / Avg Pos), независимо от сортировки таблицы сайтов.

### Top pages (агрегированные, сортируемые)
- Тот же паттерн что и Top queries, но на уровне URL страниц. Полезно для поиска страницы, которая дала всплеск трафика.

### Dashboard (`/dashboard`)
- Сетка карточек по сайтам: account label, домен, sparkline дневных кликов за текущий период, четыре метрики с **дельтой к предыдущему периоду той же длины** (например, последние 7 дней vs предыдущие 7 дней). Зелёный/красный, плюс знак `+` / `−` чтобы colour-blind пользователи видели сигнал.
- Конфигурируемая плотность: **2 / 4 / 6 колонок** через URL `?cols=`. Тот же period filter что и на Sites.
- Стабильный порядок при перезагрузке (clicks desc, tiebreaker по impressions, потом alphabetically).

### CSV экспорты
- Queries или pages, последние N дней (соответствует period filter), безопасное имя файла. Стримит `text/csv; charset=utf-8` с `Content-Disposition: attachment`. Скачивается с `/properties/export?account=...&site=...&days=...&dim=query|page`.

### Operator-grade UX
- **Refresh** сохраняет всё URL-состояние (period, sort, dir, cols) через SvelteKit `invalidateAll()`. Никаких `<form method="POST">` redirect-танцев.
- Все числа в таблицах — tabular-nums для вертикального выравнивания.
- Лёгкий hover на строках. Сортируемые заголовки показывают ↑ / ↓.
- **Никаких server-side кешей.** Каждая загрузка страницы — свежий fan-out по active-аккаунтам. Цена — честная задержка. Польза — ты видишь ровно то, что видит GSC прямо сейчас.
- Никаких background-задач, cron, очередей, email-рассылок.

## Quickstart

Требования: **Node 22+**, **pnpm**.

```bash
git clone https://github.com/izzipizzy/gsc-hub.git
cd gsc-hub
pnpm install
cp .env.example .env
# заполни GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AUTH_SECRET
pnpm dev
```

Открой <http://localhost:5173>, кликни **Connect Google account**, пройди consent, повтори для каждого аккаунта.

Для постоянного локального деплоя используй Docker Compose — см. [Деплой через Docker Compose + OrbStack](#деплой-через-docker-compose--orbstack).

> **Подключай аккаунты через `http://localhost:5173`, а не `https://gsc.local`.** OAuth-политика Google отклоняет redirect на `.local`-домен (`Error 400: invalid_request`). Compose-конфиг специально пробрасывает loopback-порт, чтобы consent-flow шёл через localhost; повседневно можно пользоваться `https://gsc.local`. БД общая, поэтому токен, полученный на localhost, работает и на `gsc.local`.

## Google Cloud setup

1. Открой <https://console.cloud.google.com/apis/credentials>.
2. **Create credentials** → **OAuth client ID** → Application type **Web application**, имя `gsc-hub`.
3. Authorized redirect URIs:
   - `http://localhost:5173/auth/callback/google` (dev)
   - `https://your-domain.example/auth/callback/google` (только если будешь деплоить)
4. Включи **Search Console API** в том же проекте: <https://console.cloud.google.com/apis/library/searchconsole.googleapis.com>.
5. **OAuth consent screen** (теперь это **Google Auth Platform → Audience**): User Type — **External**. Дальше либо **Publish** (любой Google-аккаунт сможет залогиниться), либо оставь в **Testing** и добавь свои email-адреса в Test users.
6. Скопируй Client ID и Client Secret в `.env`. Сгенерируй `AUTH_SECRET` через `openssl rand -base64 32`.

`webmasters` у Google — «sensitive scope», но для personal-tier использования формальная verification не требуется (OAuth user cap допускает до 100 пользователей для неподтверждённых sensitive-scope). На consent screen увидишь предупреждение «unverified app», кликни **Advanced → Go to gsc-hub (unsafe)** чтобы продолжить. В redirect URI указывай только `http://localhost:5173/auth/callback/google` — `.local`-redirect Google не примет.

## Конфигурация

Переменные `.env` (см. `.env.example`):

| ключ | обязательный | описание |
|------|-------------|----------|
| `GOOGLE_CLIENT_ID` | да | OAuth Web Application client ID |
| `GOOGLE_CLIENT_SECRET` | да | OAuth Web Application client secret |
| `AUTH_SECRET` | да | Случайный 32-byte base64 secret для Auth.js (`openssl rand -base64 32`) |
| `AUTH_TRUST_HOST` | рекомендуется | `true` для self-hosted/proxy |
| `DB_PATH` | опционально | Путь к SQLite-файлу. По умолчанию `./data/gsc-hub.db` |

## Архитектура

```
[браузер] ──┬─ https://gsc.local (OrbStack proxy, TLS) ──┐
            └─ http://localhost:5173 (loopback, для OAuth)┴─> [SvelteKit (Node) :3000] ──> Google Search Console API
                                                                       │
                                                                       └──> ./data/gsc-hub.db  (только OAuth-токены)
```

Один Node-процесс. Один SQLite-файл. Схема БД — две таблицы:

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
```

**Никакие аналитические данные GSC не сохраняются.** Любой запрос на `/properties`, `/dashboard`, query-history endpoint или CSV-экспорт делает свежий fan-out в Google. Скрытые сайты живут только в localStorage браузера.

Это упрощает архитектуру, убирает класс багов «устаревший кеш», и делает БД-файл крошечным (несколько КБ на аккаунт). Цена — задержка page-load пропорциональна количеству активных сайтов: примерно 2N параллельных API-вызовов для Sites, 3N для Dashboard, 1N для query history.

### Auth.js custom signIn callback

Auth.js v5 настроен с кастомным `signIn` callback, который **вместо создания app-сессии апсертит профиль и токены Google в `google_accounts`** по `profile.sub`, потом возвращает `'/'` чтобы Auth.js сделал редирект без сессионной куки. У приложения нет понятия «залогиненный пользователь», есть только локальный trust (single-user тул, защищённый `127.0.0.1` binding в dev).

## Стек

- [SvelteKit](https://kit.svelte.dev/) (Svelte 5 runes) + TypeScript, Node adapter
- [Auth.js](https://authjs.dev/) (`@auth/sveltekit`) для Google OAuth
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) для локального хранилища токенов
- [TailwindCSS v3](https://tailwindcss.com/) для стилей (без расширения дефолтной палитры; токены задокументированы в [DESIGN.md](DESIGN.md))
- [Vitest](https://vitest.dev/) для unit-тестов

Никаких chart-библиотек: каждый sparkline и query-history chart нарисованы руками SVG (`<rect>` + `<path>`). Никаких icon-fonts: каждая иконка — inline 14×14 SVG.

## Структура проекта

```
gsc-hub/
├── PRODUCT.md             — стратегический контекст (юзеры, принципы, anti-references)
├── DESIGN.md              — визуальная система (цвета, типографика, компоненты, правила)
├── DESIGN.json            — sidecar с HTML/CSS-снипетами на компонент
├── CLAUDE.md              — инструкции для AI-ассистентов работающих в этой репе
├── Dockerfile             — multi-stage production-образ (Node runtime)
├── compose.yaml           — Docker Compose: OrbStack-домен + loopback-порт 5173
├── src/
│   ├── auth.ts            — SvelteKitAuth конфиг + custom signIn callback
│   ├── hooks.server.ts
│   ├── app.css            — Tailwind + Operator Console utilities
│   ├── lib/
│   │   ├── server/
│   │   │   ├── db.ts               — SQLite open + миграция
│   │   │   ├── accounts.ts         — CRUD по google_accounts
│   │   │   ├── inspection_cache.ts — 12h SQLite кеш для URL Inspection ответов
│   │   │   ├── google.ts           — GSC client, refresh, fan-out, search analytics
│   │   │   └── csv.ts              — RFC 4180 CSV writer
│   │   └── utils/
│   │       ├── site.ts            — обрезает sc-domain: префикс, строит href + Google site: поиск
│   │       └── country.ts         — маппинг кодов стран GSC в URL Google SERP
│   └── routes/
│       ├── +page.svelte           — Accounts list (/)
│       ├── auth/[...auth]/        — Auth.js catch-all
│       ├── accounts/[id]/         — delete, relabel
│       └── properties/
│           ├── +page.svelte       — Sites table + Top queries + Top pages
│           ├── export/+server.ts        — CSV stream
│           ├── inspect/+server.ts       — URL Inspection (с кешем)
│           ├── refresh/+server.ts       — force-refresh хелперы
│           ├── sitemap-urls/+server.ts  — получение URL из sitemap для fallback инспекции
│           ├── sitemap-submit/+server.ts — (пере)отправка sitemap'ов в GSC
│           └── query-history/+server.ts — 16-месячная история по ключу
├── tests/                          — Vitest, моки fetch/env
└── data/gsc-hub.db                 — gitignored, создаётся при первом запуске
```

## Команды

| команда | описание |
|---|---|
| `pnpm dev` | Dev-сервер на http://localhost:5173 |
| `pnpm build` | Production build (Node target) |
| `pnpm preview` | Preview production-сборки |
| `pnpm test` | Запустить Vitest |
| `pnpm test:watch` | Watch-режим |
| `pnpm check` | `svelte-check` type-check |
| `docker compose up -d --build` | Собрать и поднять прод-контейнер (OrbStack) |
| `docker compose logs -f gsc` | Логи контейнера |
| `docker compose down` | Остановить и удалить контейнер (данные в `./data` сохраняются) |

## Тесты

39 unit-тестов покрывают server-модули:
- SQLite миграция и схема, включая таблицу `url_inspection_cache` (`tests/db.test.ts`)
- Кеш URL Inspection: детерминизм хэша, промах, попадание, TTL, upsert, удаление (`tests/inspection_cache.test.ts`)
- Accounts CRUD включая `markActive` / `markRevoked` / `markError` (`tests/accounts.test.ts`)
- GSC client: skew window для refresh-токена, 5xx → markError, 401/invalid_grant → markRevoked, fan-out агрегация, per-site queries / pages / daily breakdown / query-history (`tests/google.test.ts`)
- Получение и парсинг URL из sitemap (`tests/sitemap.test.ts`)
- RFC 4180 CSV escaping (`tests/csv.test.ts`)

Маршруты не покрыты unit-тестами; smoke-тестятся через `curl` против `pnpm dev`.

## Приватность и данные

- На твоей машине сохраняется только строка с OAuth-токеном на каждый подключённый Google-аккаунт.
- Никакие данные Search Console (queries, clicks, impressions, URL страниц, позиции) никогда не пишутся на диск.
- Никакой аналитики, никакой телеметрии, никаких outbound-вызовов кроме Google API.
- SQLite-файл лежит в `./data/` (gitignored). Удали его — все подключения сбросятся.
- Токены хранятся plaintext. Это приемлемо для локального single-user тула; зашифруй at rest если когда-нибудь будешь выставлять это за пределы `127.0.0.1`.
- Исключение — кеш URL Inspection (таблица `url_inspection_cache`) хранит payload'ы ответов под ключом `(account_id, site_url, urls_hash)` на 12 часов, чтобы не жечь дневной лимит 2000 вызовов на повторных кликах. Удали `data/gsc-hub.db` чтобы сбросить.

## Деплой через Docker Compose + OrbStack

В репе есть `Dockerfile` (multi-stage, Node runtime) и `compose.yaml` под [OrbStack](https://orbstack.dev/) на macOS:

```bash
docker compose up -d --build   # собрать и поднять
docker compose logs -f gsc     # логи
docker compose restart gsc     # рестарт
docker compose down            # снести (данные в ./data сохраняются)
```

- Доступ на **`https://gsc.local`** через OrbStack-proxy (авто-TLS) — задаётся label'ом `dev.orbstack.domains`. Также работает `https://gsc.orb.local` (auto-домен по имени контейнера).
- `restart: unless-stopped` поднимает контейнер после ребута (OrbStack стартует с логином).
- Контейнер также биндит **`127.0.0.1:5173 → 3000`** (только loopback). Это нужно исключительно для OAuth: consent-flow идёт через `http://localhost:5173`, потому что Google не принимает `.local`-redirect. Этот адрес используй для подключения аккаунтов, а `https://gsc.local` — для повседневной работы.
- `.env` читается через `env_file`; секреты подставляются в рантайме через `$env/dynamic/private`, не вшиваются в образ.
- `./data` примонтирован bind-mount'ом, поэтому SQLite-хранилище токенов переживает пересборки и общее с `pnpm dev`.

**Про безопасность:** у приложения нет встроенной аутентификации (single-user тул). Порт намеренно привязан только к `127.0.0.1` — не открывай его на `0.0.0.0`/в сеть, т.к. в БД лежат OAuth-токены Google. Чтобы выставить на публичный хостнейм, поставь перед ним identity-aware proxy (например Cloudflare Access) с allowlist по своему email и добавь production callback URL в Google OAuth client.

## Roadmap (Phase B, ещё не сделано)

- Daily background pull агрегатов в Postgres для трендов и сравнения периодов длиной в недели/месяцы без перезапросов GSC на каждый клик.
- Графики с tooltip'ами на hover в карточках dashboard.
- URL Inspection bulk + sitemap monitoring.
- Алерты на падения трафика.

MVP намеренно cache-free; Phase B добавит кеш когда usage покажет что нужен. Пока — каждая загрузка свежая.

## Лицензия

MIT. См. [LICENSE](LICENSE).
