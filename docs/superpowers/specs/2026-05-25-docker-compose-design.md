# Docker Compose для gsc-hub

**Дата:** 2026-05-25
**Статус:** утверждён к имплементации
**Цель:** перевести запуск с ручного `pnpm` / `pm2` на `docker compose` под OrbStack, чтобы сервис автоматически поднимался после ребута и был доступен по человекочитаемому имени `gsc.local`.

## Контекст

Сейчас приложение запускается на хосте: `pnpm build && node build/index.js` под `pm2` (`ecosystem.config.cjs`), слушает на `127.0.0.1:5173`. Это требует ручного `pm2 resurrect` после ребута и доступ только по `localhost:5173`.

OrbStack на маке стартует с логином пользователя и держит контейнеры с `restart: unless-stopped`. Лейбл `dev.orbstack.domains` автоматически даёт контейнеру TLS-домен в локальной OrbStack-сети.

## Скоуп

**В скоупе:**
- `Dockerfile` (multi-stage) для сборки приложения
- `compose.yaml` с единственным сервисом `gsc`
- `.dockerignore`
- Удаление `ecosystem.config.cjs` (pm2 больше не нужен)
- Обновление секции «Деплой» в `CLAUDE.md`

**Вне скоупа:**
- Cloudflared / удалённый доступ (приложение остаётся локальным)
- Healthcheck в compose (избыточно для одного контейнера)
- Non-root user (даст конфликт прав на bind-mount `./data`)
- Multi-arch сборка (только Apple Silicon)
- Менеджеры секретов (`.env` остаётся как есть)
- Любые правки прикладного кода — `DB_PATH` уже читается из env в `src/lib/server/db.ts:43`

## Дизайн

### Доступ к сервису

Один способ доступа: `https://gsc.local` (через OrbStack proxy с автоматическим TLS).

Порт на хосте **не пробрасывается**. Это требует от пользователя пользоваться доменом, но избегает конфликтов с любыми хостовыми процессами на 5173 и держит сетевую границу чистой.

### compose.yaml

```yaml
services:
  gsc:
    build: .
    container_name: gsc
    restart: unless-stopped
    env_file: .env
    environment:
      HOST: 0.0.0.0
      PORT: 3000
      DB_PATH: /data/gsc-hub.db
    volumes:
      - ./data:/data
    labels:
      dev.orbstack.domains: gsc.local
      dev.orbstack.http_port: "3000"
```

Решения:
- **`container_name: gsc`** — фиксированное имя в OrbStack-UI, и автоматически даёт `gsc.orb.local` помимо `gsc.local`.
- **`HOST=0.0.0.0`** — внутри контейнера слушаем на всех интерфейсах, иначе OrbStack-прокси не достучится из docker-сети.
- **`PORT=3000`** — стандарт для контейнеров, нет конфликта с дефолтным `5173`.
- **`DB_PATH=/data/gsc-hub.db`** — `src/lib/server/db.ts` уже умеет читать `DB_PATH` из env.
- **`./data:/data`** — bind-mount. Существующий `./data/gsc-hub.db` поднимется в контейнер без миграции и без копирования. Бэкап — обычным cp с хоста.
- **`restart: unless-stopped`** — OrbStack после старта поднимает контейнер автоматически.
- **`dev.orbstack.http_port: "3000"`** — говорит OrbStack-прокси, на какой внутренний порт слать `https://gsc.local`.
- **`env_file: .env`** — `GOOGLE_CLIENT_ID/SECRET`, `AUTH_SECRET`, `AUTH_TRUST_HOST` подтягиваются из существующего `.env` без дублирования.

### Dockerfile

```dockerfile
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

# Native build deps for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
RUN pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3000
CMD ["node", "build/index.js"]
```

Решения:
- **Multi-stage.** Builder содержит весь dev-toolchain (Vite, Tailwind, Svelte, gcc). Runtime — только готовый `build/` + production-зависимости. Финальный образ меньше и без поверхности атаки от dev-инструментов.
- **`python3 make g++` только в builder.** `better-sqlite3` собирается через `node-gyp` под linux/arm64 один раз. В runtime попадает уже скомпилированный `.node`-файл.
- **`pnpm-workspace.yaml` копируется.** В нём `onlyBuiltDependencies: [better-sqlite3, esbuild]` — без этого pnpm не запустит build-скрипт нативного модуля.
- **Кеш слоёв.** `package.json` + `pnpm-lock.yaml` копируются отдельно от исходников, чтобы `pnpm install` не пересобирался при изменении svelte-файлов.
- **`pnpm prune --prod`** в builder убирает Vite/Tailwind/Svelte из `node_modules` перед копированием в runtime.
- **Без `USER node`.** Bind-mount `./data` принадлежит uid пользователя на хосте; запуск под non-root внутри контейнера даст permission-denied на запись в SQLite. Для локального персонального инструмента риск root-внутри-контейнера приемлем.

### .dockerignore

Исключить из build-контекста:

```
node_modules
.svelte-kit
build
data
.env
.env.*
.git
.vscode
docs
tests
*.md
DESIGN.json
ecosystem.config.cjs
```

Это уменьшает контекст, переданный в docker daemon, и гарантирует, что хостовые `node_modules` (darwin-arm64) не попадут в образ.

## Изменения в репо

| Файл | Действие |
|---|---|
| `Dockerfile` | создать |
| `compose.yaml` | создать |
| `.dockerignore` | создать |
| `ecosystem.config.cjs` | удалить |
| `CLAUDE.md` | переписать секцию «Деплой» (docker compose вместо pm2 + cloudflared) |

Прикладной код **не трогаем**: `DB_PATH` уже читается из env, `HOST`/`PORT` уже поддерживаются Node-адаптером SvelteKit.

## Внешние действия (не автоматизируются)

1. В Google Cloud Console → OAuth client → Authorized redirect URIs добавить `https://gsc.local/auth/callback/google` (точное имя callback-роута уточнить при тестировании Auth.js).
2. Первый запуск: `docker compose up -d --build`.

## Верификация

Считается готовым, когда:

1. `docker compose up -d --build` поднимается без ошибок.
2. `https://gsc.local` отвечает 200 (или редиректит на Google OAuth).
3. Логин через Google проходит до конца.
4. Файл `./data/gsc-hub.db` обновляется после действий в UI (bind-mount живой).
5. После `docker compose restart gsc` подключённые аккаунты в UI остаются.
6. (Руками после) после ребута мака контейнер сам поднимается без вмешательства.

## Риски и митигации

- **Redirect URI в GCP.** Если забыть добавить `https://gsc.local/...` в OAuth-клиенте, логин упадёт после первого входа. Митигация: явный шаг в чеклисте «Внешние действия».
- **Существующий `./data/gsc-hub.db` в WAL-режиме.** При первом старте контейнера better-sqlite3 откроет файл, увидит существующий WAL, накатит и продолжит. Дополнительной миграции не требуется. Митигация: перед первым `compose up` сделать `cp -r data data.backup`.
- **OrbStack DNS.** `gsc.local` резолвится только когда OrbStack запущен. Это и есть желаемое поведение: нет смысла иметь приложение без рантайма.
