# Docker Compose для gsc-hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести запуск gsc-hub с ручного `pnpm`/`pm2` на `docker compose` под OrbStack, с автозапуском после ребута и доступом по `https://gsc.local`.

**Architecture:** Один сервис в `compose.yaml`, multi-stage Dockerfile (builder с pnpm + node-gyp deps → runtime с готовым `build/`), bind-mount `./data` для SQLite, OrbStack-лейблы для домена и проксирования.

**Tech Stack:** Docker, docker compose v2, OrbStack, Node 22 Alpine, pnpm, SvelteKit Node adapter, better-sqlite3.

**Спека:** `docs/superpowers/specs/2026-05-25-docker-compose-design.md`

---

## Pre-flight (внешнее, делает пользователь)

Перед началом работы:
1. В Google Cloud Console → APIs & Services → Credentials → OAuth client → Authorized redirect URIs добавить `https://gsc.local/auth/callback/google`. Сохранить.
2. Убедиться что OrbStack запущен (`orb status` или иконка в menu bar).
3. Если на хосте крутится pm2 с gsc-hub — остановить и снести: `pm2 stop gsc-hub && pm2 delete gsc-hub && pm2 save`.
4. Если порт 5173 занят чем-то ещё — это не помешает, мы его не пробрасываем.

---

## Task 1: Создать `.dockerignore`

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Создать `.dockerignore` в корне репо**

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

Почему: уменьшает docker build context, не пускает хостовые `node_modules` (собранные под darwin-arm64) в образ, и держит секреты (`.env`) вне образа. `.env` всё равно подцепится через `env_file:` в compose в рантайме.

- [ ] **Step 2: Проверить что файл создан**

Run: `cat .dockerignore | wc -l`
Expected: `13` (или больше, если добавил пустые строки в конце)

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "build: add .dockerignore for docker image context"
```

---

## Task 2: Создать `Dockerfile`

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Создать `Dockerfile` в корне репо**

```dockerfile
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

# Native build deps for better-sqlite3 (node-gyp)
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

Ключевые решения (из спеки):
- Multi-stage: builder содержит весь dev-toolchain и build-deps; runtime — только готовый `build/` и production-`node_modules`.
- `python3 make g++` нужны только в builder для компиляции `better-sqlite3`. В runtime попадает уже скомпилированный `.node`-файл.
- `pnpm-workspace.yaml` копируется — в нём `onlyBuiltDependencies: [better-sqlite3, esbuild]`, без этого pnpm не запускает build-скрипт нативного модуля.
- `pnpm prune --prod` после билда убирает Vite/Tailwind/Svelte из `node_modules`.

- [ ] **Step 2: Тестовый билд образа**

Run: `docker build -t gsc-hub:test .`
Expected: финальный layer `=> => writing image sha256:...`, exit 0. Билд занимает ~2-3 минуты первый раз.

Если упадёт на `pnpm install` с ошибкой `Cannot find matching keyid` — это конфликт версий pnpm/corepack. Тогда зафиксировать версию в Dockerfile: `RUN corepack enable && corepack prepare pnpm@9 --activate`.

Если упадёт на `pnpm build` с ошибкой `better-sqlite3 ... node-gyp` — значит `pnpm-workspace.yaml` не скопировался или `apk add` не отработал. Проверить наличие файла в build context (`ls pnpm-workspace.yaml`) и что `.dockerignore` его не исключает.

- [ ] **Step 3: Убедиться что образ запускается и слушает порт**

Run:
```bash
docker run --rm -d --name gsc-test -p 13000:3000 -e HOST=0.0.0.0 -e PORT=3000 -e DB_PATH=/tmp/test.db -e AUTH_SECRET=test -e AUTH_TRUST_HOST=true -e GOOGLE_CLIENT_ID=test -e GOOGLE_CLIENT_SECRET=test gsc-hub:test
sleep 3
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:13000/
docker stop gsc-test
```
Expected: `200` или `302` (редирект на OAuth). НЕ `000` (контейнер не поднялся) и НЕ `connection refused` (HOST не 0.0.0.0).

Если `connection refused`: убедиться что в команде `-e HOST=0.0.0.0`. Без этого SvelteKit Node adapter слушает только loopback внутри контейнера, снаружи недоступен.

- [ ] **Step 4: Прибрать тестовый образ**

Run: `docker rmi gsc-hub:test`
Expected: `Untagged: gsc-hub:test ...`

- [ ] **Step 5: Commit**

```bash
git add Dockerfile
git commit -m "build: add multi-stage Dockerfile for production runtime"
```

---

## Task 3: Создать `compose.yaml`

**Files:**
- Create: `compose.yaml`

- [ ] **Step 1: Создать `compose.yaml` в корне репо**

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

Решения (из спеки):
- `container_name: gsc` — фиксированное имя для OrbStack UI; даёт также автоматический домен `gsc.orb.local`.
- `HOST=0.0.0.0` — без этого SvelteKit слушает только loopback внутри контейнера.
- `DB_PATH=/data/gsc-hub.db` — `src/lib/server/db.ts:43` уже читает `DB_PATH` из env.
- `./data:/data` — bind-mount, существующий `./data/gsc-hub.db` поднимется без миграции.
- `restart: unless-stopped` — переживает ребут (OrbStack стартует с логином, поднимает контейнеры).
- `dev.orbstack.http_port: "3000"` — кавычки обязательны, иначе YAML распарсит как число и OrbStack может проигнорировать.
- Никакого `ports:` — снаружи доступа через `localhost:5173` нет, только через `gsc.local`.

- [ ] **Step 2: Валидация синтаксиса compose**

Run: `docker compose config`
Expected: вывод распаршенного compose (YAML без ошибок). Никаких `services.gsc Additional property X is not allowed`. Если ругается на `env_file: .env` — значит файла нет в корне (проверить `ls .env`).

- [ ] **Step 3: Commit**

```bash
git add compose.yaml
git commit -m "build: add compose.yaml with OrbStack domain labels"
```

---

## Task 4: Бэкап данных и первый запуск

**Files:**
- Modify (создаст): `data.backup/`

- [ ] **Step 1: Бэкап существующей БД**

Run: `cp -r data data.backup`
Expected: создана папка `data.backup` с копией `gsc-hub.db`, `gsc-hub.db-shm`, `gsc-hub.db-wal`.

Run: `ls data.backup/`
Expected: те же файлы что в `data/`.

Это страховка: если контейнер при первом старте что-то сделает с WAL-файлом неожиданно, всегда можно откатиться (`rm -rf data && mv data.backup data`).

- [ ] **Step 2: Поднять стек**

Run: `docker compose up -d --build`
Expected: вывод вида:
```
[+] Building ...
[+] Running 2/2
 ✔ Network gsc-hub_default  Created
 ✔ Container gsc            Started
```

Первый билд займёт ~2-3 минуты (повторные — секунды за счёт кеша слоёв).

- [ ] **Step 3: Проверить что контейнер живой**

Run: `docker compose ps`
Expected: `gsc` со статусом `Up`. Если `Restarting` — что-то крашится в цикле, смотри логи следующим шагом.

- [ ] **Step 4: Проверить логи**

Run: `docker compose logs gsc | tail -30`
Expected: строка `Listening on 0.0.0.0:3000` или похожая от SvelteKit Node-adapter. Никаких stack trace.

Возможные проблемы:
- `Error: Could not locate the bindings file` для better-sqlite3 → нативный модуль не собрался под linux/arm64. Пересобрать без кеша: `docker compose build --no-cache gsc`.
- `EACCES: permission denied, open '/data/gsc-hub.db'` → bind-mount пермишены. Не должно быть, т.к. контейнер под root. Если всё же — `chmod -R 777 data` (это локальный персональный тул, ок).
- `[auth][error] MissingSecret` → `.env` не подцепился. Проверить `docker compose exec gsc env | grep AUTH_SECRET`.

- [ ] **Step 5: Проверить HTTP-ответ через OrbStack-домен**

Run: `curl -sS -o /dev/null -w "%{http_code}\n" https://gsc.local/`
Expected: `200` или `302`. Если `curl: (6) Could not resolve host: gsc.local` → OrbStack proxy не активен или лейбл не подцепился; перезапустить: `docker compose restart gsc` и подождать 5 секунд.

- [ ] **Step 6: Открыть в браузере и пройти логин**

Открыть `https://gsc.local/` в браузере. Должна открыться главная gsc-hub. Если есть подключённые аккаунты из старой БД — они должны быть видны.

Если аккаунтов нет (новый запуск) — попробовать подключить аккаунт через UI. OAuth должен пройти до конца и вернуть на `/`. Если падает с `redirect_uri_mismatch` — забыт Pre-flight шаг 1 (добавить `https://gsc.local/auth/callback/google` в GCP).

- [ ] **Step 7: Проверить что bind-mount работает**

Подключение аккаунта (или любое действие, пишущее в БД) должно обновить `./data/gsc-hub.db` на хосте.

Run: `ls -la data/gsc-hub.db`
Expected: `mtime` свежее (последние минуты, не дата до запуска контейнера).

- [ ] **Step 8: Проверить переживание рестарта**

Run:
```bash
docker compose restart gsc
sleep 3
curl -sS -o /dev/null -w "%{http_code}\n" https://gsc.local/
```
Expected: `200`/`302`. Открыть UI в браузере — подключённые аккаунты должны остаться (если упадут — bind-mount не работает, проверить `docker compose config | grep -A3 volumes`).

- [ ] **Step 9: Удалить бэкап**

Если всё работает — `rm -rf data.backup`. Если есть сомнения — оставить ещё на день-два.

---

## Task 5: Снести `ecosystem.config.cjs`

**Files:**
- Delete: `ecosystem.config.cjs`

- [ ] **Step 1: Удалить файл из git**

Run: `git rm ecosystem.config.cjs`
Expected: `rm 'ecosystem.config.cjs'`. Файл удалён и stage'нут к коммиту.

- [ ] **Step 2: Commit**

```bash
git commit -m "build: remove pm2 ecosystem config (replaced by docker compose)"
```

---

## Task 6: Обновить `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (строки 1-3, 36-41, 54-59)

- [ ] **Step 1: Заменить заголовочную секцию (строки 1-3)**

Найти:
```markdown
# gsc-hub

Локальный мульти-аккаунт SvelteKit-апп для Google Search Console. Один пользователь (персональный инструмент). Доступен через cloudflared-туннель на gsc.doxer.top + локально на :5173.
```

Заменить на:
```markdown
# gsc-hub

Локальный мульти-аккаунт SvelteKit-апп для Google Search Console. Один пользователь (персональный инструмент). Запускается в docker compose под OrbStack, доступен по `https://gsc.local`.
```

- [ ] **Step 2: Обновить секцию «Команды» (строки 36-41)**

Найти:
```markdown
## Команды

- `pnpm dev` — dev-сервер
- `pnpm build && node build/index.js` — прод-запуск
- `pnpm test` — Vitest
- `pnpm check` — svelte-check (type-check)
```

Заменить на:
```markdown
## Команды

- `pnpm dev` — dev-сервер на хосте (для итерации с hot-reload)
- `docker compose up -d --build` — собрать и поднять прод-контейнер
- `docker compose logs -f gsc` — логи
- `docker compose restart gsc` — рестарт
- `docker compose down` — снести (данные в `./data` сохраняются)
- `pnpm test` — Vitest (на хосте)
- `pnpm check` — svelte-check (на хосте)
```

- [ ] **Step 3: Переписать секцию «Деплой» (строки 54-59)**

Найти:
```markdown
## Деплой

Локально на маке:
- `pm2 start "node build/index.js" --name gsc-hub` (или launchd-агент)
- `cloudflared tunnel run` с маршрутом `gsc.doxer.top → 127.0.0.1:5173`
- Cloudflare Access policy: allow только email пользователя
```

Заменить на:
```markdown
## Деплой

Локально на маке через OrbStack:
- `docker compose up -d --build` — поднять
- OrbStack стартует с логином пользователя, контейнер с `restart: unless-stopped` сам поднимается после ребута
- Доступ: `https://gsc.local` (OrbStack proxy с автоматическим TLS) или `https://gsc.orb.local` (auto-домен по имени контейнера)
- Порт на хост **не пробрасывается** — снаружи OrbStack-сети сервис недоступен

Для добавления Google-аккаунта redirect URI в GCP OAuth-клиенте должен включать `https://gsc.local/auth/callback/google`.
```

- [ ] **Step 4: Проверить итоговый файл**

Run: `grep -n "pm2\|cloudflared\|gsc.doxer.top" CLAUDE.md`
Expected: пусто (никаких упоминаний старого деплоя).

Run: `grep -n "docker compose\|gsc.local\|OrbStack" CLAUDE.md`
Expected: несколько совпадений в секциях «Команды» и «Деплой».

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md deploy section for docker compose"
```

---

## Task 7: Финальная верификация

- [ ] **Step 1: Чистый ребилд с нуля**

```bash
docker compose down
docker compose up -d --build
sleep 5
docker compose ps
```
Expected: `gsc` со статусом `Up`.

- [ ] **Step 2: Smoke-тест HTTP**

Run: `curl -sS -o /dev/null -w "%{http_code}\n" https://gsc.local/`
Expected: `200` или `302`.

- [ ] **Step 3: Smoke-тест UI**

Открыть `https://gsc.local/` в браузере. Главная отображается, подключённые аккаунты видны, можно зайти на `/dashboard` и `/properties`.

- [ ] **Step 4: Проверка автозапуска (опционально, требует ребута)**

Эта проверка реально гарантируется только перезагрузкой мака. Если есть возможность — перезагрузиться и убедиться что после логина и старта OrbStack контейнер сам поднялся (`docker compose ps` показывает Up без ручного `up -d`).

Если ребут невозможен сейчас — оставить как explicit todo для пользователя, отметить что код корректный (`restart: unless-stopped` + OrbStack autostart).

---

## Final Notes

- **Бэкап БД на постоянной основе:** копировать `./data/gsc-hub.db` (например в Time Machine — папка `./data` обычная, не volume).
- **Обновление кода:** `git pull && docker compose up -d --build`. Compose сам пересоберёт образ если что-то поменялось.
- **Если что-то сломается и хочется быстро откатиться:** `docker compose down && pnpm build && node build/index.js` (старая схема всё ещё работает, pm2-конфиг удалён но запустить руками можно).
