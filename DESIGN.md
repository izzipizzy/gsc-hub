---
name: gsc-hub
description: Локальный мульти-аккаунт хаб для Google Search Console — функциональный, плотный, без фуфла.
colors:
  operator-blue: "#2563eb"
  operator-blue-deep: "#1d4ed8"
  operator-blue-mist: "#dbeafe"
  operator-blue-haze: "#eff6ff"
  rank-decay-red: "#dc2626"
  drift-red: "#b91c1c"
  drift-red-tint: "#fee2e2"
  drift-red-vapor: "#fef2f2"
  alert-red-edge: "#fca5a5"
  drift-red-ink: "#991b1b"
  live-pulse-green: "#16a34a"
  live-pulse-tint: "#dcfce7"
  live-pulse-ink: "#166534"
  warning-amber-tint: "#fef9c3"
  warning-amber-ink: "#854d0e"
  impression-mist: "#bfdbfe"
  console-fog-50: "#f9fafb"
  console-fog-100: "#f3f4f6"
  console-fog-200: "#e5e7eb"
  console-fog-300: "#d1d5db"
  console-fog-400: "#9ca3af"
  console-fog-500: "#6b7280"
  console-fog-600: "#4b5563"
  console-fog-700: "#374151"
  console-fog-800: "#1f2937"
  paper-white: "#ffffff"
typography:
  page-title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 2rem
  section-title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.75rem
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.25rem
  metric-number:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.25rem
  caption:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1rem
rounded:
  edge: "4px"
  card: "8px"
spacing:
  cell-y: "8px"
  cell-x: "8px"
  card: "16px"
  page: "24px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.operator-blue}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.edge}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.operator-blue-deep}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.edge}"
  button-secondary:
    backgroundColor: "{colors.console-fog-100}"
    textColor: "{colors.console-fog-700}"
    rounded: "{rounded.edge}"
    padding: "8px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.console-fog-200}"
    textColor: "{colors.console-fog-700}"
    rounded: "{rounded.edge}"
  button-destructive:
    backgroundColor: "{colors.drift-red-tint}"
    textColor: "{colors.drift-red}"
    rounded: "{rounded.edge}"
    padding: "4px 8px"
  button-destructive-hover:
    backgroundColor: "{colors.alert-red-edge}"
    textColor: "{colors.drift-red-ink}"
    rounded: "{rounded.edge}"
  badge-active:
    backgroundColor: "{colors.live-pulse-tint}"
    textColor: "{colors.live-pulse-ink}"
    rounded: "{rounded.edge}"
    padding: "4px 8px"
  badge-revoked:
    backgroundColor: "{colors.drift-red-tint}"
    textColor: "{colors.drift-red-ink}"
    rounded: "{rounded.edge}"
    padding: "4px 8px"
  badge-error:
    backgroundColor: "{colors.warning-amber-tint}"
    textColor: "{colors.warning-amber-ink}"
    rounded: "{rounded.edge}"
    padding: "4px 8px"
  card-site:
    backgroundColor: "{colors.paper-white}"
    rounded: "{rounded.card}"
    padding: "16px"
  table-row:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.console-fog-800}"
    padding: "8px 0"
---

# Design System: gsc-hub

## 1. Overview

**Creative North Star: "The Operator's Console"**

`gsc-hub` визуально напоминает терминал диспетчера, а не маркетинговый дашборд. Сетка таблиц во всю ширину окна, без декоративных карточек и теней, без отступов-впрок. Числа и домены — главные жители страницы, всё остальное служит читаемости. Палитра — практически чёрно-белая с одним рабочим синим (`#2563eb`) на интерактив и тремя статусными (зелёный жив, красный отозван, янтарный сбоит). Графики — два цвета без тултипов: `rgb(220 38 38)` для позиции, `rgb(191 219 254)` для столбиков impressions.

Этот язык явно отвергает то, что перечислено в PRODUCT.md: Salesforce-захламлённость, Notion-эмодзи, hero-метрики SaaS, AI-фиолетово-розовые градиенты, glassmorphism, тяжёлые chart-libs. Тон — Stripe Dashboard и Linear: спокойный, плотный, доверяет цифрам.

**Key Characteristics:**
- Full-bleed layout (`w-full p-6`) — никаких `max-w-*` ограничителей.
- Mono-accent: один рабочий синий, всё остальное — нейтрали и статусы.
- Flat surfaces — теней почти нет, разделение через `border-b` и tonal layering.
- Density-first: `text-sm` (14px) как базовый размер тела, `py-2` строки таблиц.
- SVG-графики собраны вручную (`<path>`, `<rect>`) без библиотек.

## 2. Colors

Палитра — нейтральная серая шкала Tailwind с одним рабочим синим, тремя статусными цветами (зелёный/красный/янтарь) и парой служебных оттенков для столбиков графиков.

### Primary
- **Operator Blue** (`#2563eb`): рабочий accent — кнопка Connect, активная вкладка периода/колонок, ссылки в таблицах, sparkline clicks на дашборде. ≤10% любого экрана.
- **Operator Blue Deep** (`#1d4ed8`): hover-состояние primary-кнопок.
- **Operator Blue Mist** (`#dbeafe`): фон CSV-кнопок в таблицах, очень бледный синий.
- **Operator Blue Haze** (`#eff6ff`): зарезервирован под подсветку выбранной строки, не используется по умолчанию.

### Tertiary (статусы и графики)
- **Live Pulse Green** (`#16a34a`): пока только в дельтах на дашборде (рост clicks/impressions/CTR).
- **Live Pulse Tint** (`#dcfce7`) / **Live Pulse Ink** (`#166534`): badge `active` для подключённого аккаунта.
- **Rank Decay Red** (`#dc2626`): линия позиции в графике query history. Также падающая дельта на дашборде.
- **Drift Red Tint** (`#fee2e2`) / **Drift Red Ink** (`#991b1b`): badge `revoked`, кнопка Delete, плашка ошибок per-account.
- **Warning Amber Tint** (`#fef9c3`) / **Warning Amber Ink** (`#854d0e`): badge `error` для нерасшифрованных сбоев аккаунта.
- **Impression Mist** (`#bfdbfe`): столбики impressions в графике query history. Намеренно слабее линии позиции, чтобы не конкурировать.

### Neutral
- **Paper White** (`#ffffff`): фон страницы и карточек.
- **Console Fog 50** (`#f9fafb`): развёрнутый блок query history (контраст к строкам таблицы).
- **Console Fog 100** (`#f3f4f6`): фон Refresh-кнопки и кнопки Hide.
- **Console Fog 200** (`#e5e7eb`): hover Refresh, граница карточек дашборда (`border-gray-200`).
- **Console Fog 300** (`#d1d5db`): inputs, разделители таблиц.
- **Console Fog 400–500** (`#9ca3af` / `#6b7280`): второстепенные подписи (caption «Aggregated across N visible sites»).
- **Console Fog 600–800** (`#4b5563` / `#374151` / `#1f2937`): основной текст, заголовки таблиц.

### Named Rules
**The One-Voice Rule.** Operator Blue — единственный «громкий» цвет интерфейса. Если на экране два разных синих или два разных зелёных — это ошибка композиции, а не вариативность. Статусные цвета (зелёный/красный/янтарь) применяются строго в роли индикатора состояния, никогда декоративно.

**The No-Gradient Rule.** Цвета — плоские. Никаких `linear-gradient`, `radial-gradient`, `background-clip: text`. Ни в кнопках, ни в заголовках, ни в фонах. Один цвет — одна плоскость.

## 3. Typography

**Single Font:** `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` — нативный системный sans (San Francisco на macOS, Segoe UI на Windows). Никакого `@font-face`, никакого Google Fonts.

**Character:** интерфейсный, нейтральный, оптимизирован под плотные ряды чисел. Метрики не выделяются другим шрифтом — только weight (`font-semibold`).

### Hierarchy
- **Page Title** (`font-bold`, `text-2xl` = 24px, `leading-8`): «Connected Google accounts», «All properties», «Dashboard». Один на страницу.
- **Section Title** (`font-bold`, `text-xl` = 20px, `leading-7`): «Top queries (across all sites)», «Top pages», «Errors».
- **Body** (`font-normal`, `text-sm` = 14px, `leading-5`): таблицы, формы, тело dashboard-карточек. Базовый размер интерфейса.
- **Metric Number** (`font-semibold`, `text-sm` = 14px): большие числа в `<dl>` карточек дашборда.
- **Caption** (`font-normal`, `text-xs` = 12px, `leading-4`): подписи под графиками, «Top N queries by current sort over the last N days», status badges, account label под siteUrl, надписи дельт.

### Named Rules
**The System-Font Rule.** `font-family` — только системный sans-стек. Ни Inter, ни SF Pro Display, ни Roboto. Производительность и аутентичность ОС важнее «дизайнерского» шрифта.

**The Numbers-Don't-Whisper Rule.** Метрики (`{q.clicks}`, `{e.currentTotals.impressions}`) выводятся через `Intl.NumberFormat('en-US')` с разделителями. Числа без разделителей в таблице из 50 строк — нечитаемы.

## 4. Elevation

`gsc-hub` — flat-by-default. Тени — почти отсутствуют. Глубина создаётся tonal layering: фон страницы белый (`paper-white`), развёрнутый блок query history — `console-fog-50` (на полтона темнее), границы между строками — `border-b` `console-fog-200`. Карточки дашборда несут единственный slot тени — `shadow-sm` (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`) — и только её.

### Shadow Vocabulary
- **Site Card Lift** (`shadow-sm` = `0 1px 2px 0 rgb(0 0 0 / 0.05)`): только на `<article>` карточках дашборда. Очень слабая, на грани заметности — нужна только чтобы карточка визуально «оторвалась» от фона страницы при плотной сетке 4–6 в ряд.

### Named Rules
**The Flat-By-Default Rule.** Любой новый компонент рисуется без тени. Тень добавляется только если без неё компонент сливается с соседом. Никаких декоративных теней «для глубины».

**The No-Glass Rule.** `backdrop-filter`, `filter: blur`, полупрозрачные фоны с blur — запрещены. Glassmorphism является явным анти-референсом PRODUCT.md.

## 5. Components

### Buttons
- **Shape:** Square-ish (`rounded` = 4px). Никаких `rounded-full`, `rounded-2xl`.
- **Primary** (`bg-blue-600 text-white px-4 py-2`, hover `bg-blue-700`): «Connect Google account», активные таблетки в переключателях периода/колонок (`px-3 py-1` для компактных).
- **Secondary** (`bg-gray-100 text-gray-700 px-4 py-2`, hover `bg-gray-200`): «Refresh», «Hide», переключатели в неактивном состоянии. Также `bg-gray-200` для самых нейтральных Save-кнопок в inline-форме relabel.
- **Destructive** (`bg-red-100 text-red-700 px-2 py-1 text-sm`, hover `bg-red-200`): «Delete» account. Маленькая, не акцент. Окно `confirm()` страхует.
- **Tertiary action** (`bg-blue-100 text-blue-700 px-2 py-1`, hover `bg-blue-200`): «query CSV», «page CSV» в строках таблицы — частые, но не акцентные действия.

### Status Badges
- **Style:** `rounded px-2 py-1 text-xs`. Без бордера. Текст нижним регистром (`active`, `revoked`, `error`).
- **Active** (`bg-green-100 text-green-800`).
- **Revoked** (`bg-red-100 text-red-800`).
- **Error** (`bg-yellow-100 text-yellow-800`) — `last_error` показывается через нативный `title="..."`, без отдельного tooltip-компонента.

### Tables
- **Layout:** `w-full border-collapse`. Без внешних бордеров и обёртки `<div class="card">`. Шапка — `<tr class="border-b text-left">`, строки — `<tr class="border-b">`. Точка.
- **Padding:** `py-2` на ячейках. Compact-density — это намеренный выбор, не bug.
- **Sortable headers:** `<th class="cursor-pointer hover:underline">` с inline-стрелкой (` ↑` / ` ↓`) сразу после слова. Серверная сортировка через URL params (`?sort=`, `?dir=`) для главной таблицы; client-side `$state` для Top queries и Top pages.
- **Row click affordance:** в Top queries вся строка кликабельна (`cursor-pointer hover:bg-gray-50`), маркер `▸ / ▾` слева от текста ключа.

### Inputs
- **Style:** `border rounded px-2 py-1 text-sm`. Inline-форма для relabel — компактная, без label сверху, плейсхолдер `—`.
- **Focus:** браузерный default (Chrome/Safari/Firefox uniform — нет смысла переопределять).
- Используются крайне редко: сейчас только relabel-account.

### Cards (Dashboard only)
- **Shape:** `rounded-lg` (8px) — на полтона мягче кнопок, потому что объект крупнее.
- **Surface:** `bg-white border border-gray-200 shadow-sm`.
- **Header:** account label/email в `text-xs text-gray-500`, ниже — `<a>` на siteUrl в `text-sm font-medium text-blue-600`.
- **Sparkline:** SVG `viewBox="0 0 100 30" class="h-12 w-full"`, `<path>` без заливки, `stroke="rgb(37 99 235)" stroke-width="1.5"`.
- **Metric grid:** `grid grid-cols-2 gap-2 text-sm`, четыре `<div>` (Clicks/Impressions/CTR/Avg Pos) с label/value/delta.
- **Internal padding:** `p-4`.

### Navigation
- **Style:** один уровень — текстовые ссылки в шапке (`/` → «← Accounts», `/properties` → «→ View all properties», `/dashboard` → «→ Dashboard»). `text-blue-600 hover:underline`. Без активного состояния (на странице ясно, где ты).
- **Period / Columns toggles:** ряд таблеток (`<a>` ссылки), активная — `bg-blue-600 text-white`, неактивная — `bg-gray-100 text-gray-700`. URL-driven.

### Signature Component: Query History Chart
- Inline SVG `viewBox="0 0 800 200"` внутри развёрнутого `<tr>` поверх таблицы Top queries.
- `<rect>` импрешшнов в `rgb(191 219 254)` (Impression Mist), x-координата по timestamp реальной даты — gaps в данных видны как пустые промежутки.
- `<path>` позиции в `rgb(220 38 38)` (Rank Decay Red), `stroke-width="1.5"`, без `fill`. Lower position = higher Y (стандартная SEO-конвенция).
- Подписи дат — 6 evenly spaced ниже chart-area, `text-anchor="middle" font-size="10"`. Y-axis labels — minPos сверху, maxPos снизу красным мини-текстом.
- Loading-state: `<div class="text-sm text-gray-500">Loading 16-month history…</div>`. Error-state: `<div class="text-sm text-red-600">Failed: {message}</div>`.
- Никаких tooltip'ов на hover. Сознательное упрощение: пользователь сам читает дату по столбику снизу.

## 6. Do's and Don'ts

### Do:
- **Do** держать full-bleed layout (`w-full p-6`). Любой новый верхнеуровневый `<main>` использует именно это.
- **Do** использовать `text-sm` (14px) как базовый размер тела. Метрики, таблицы, формы — всё в нём.
- **Do** Tailwind-default colors через семантические описательные имена в DESIGN.md/JSON. Сам `tailwind.config.ts` не расширять без причины.
- **Do** хранить состояние страницы (period, sort, dir, cols) в URL query-params — следствие принципа PRODUCT.md «URL — это состояние».
- **Do** использовать `Intl.NumberFormat('en-US').format(n)` для всех целых чисел в таблицах.
- **Do** отображать домен через `displaySite(siteUrl)` — `sc-domain:` префикс GSC скрывается, href поднимается через `siteHref(siteUrl)`.
- **Do** дублировать цвет дельт знаком (`+12.4%` / `−3.0%`) — для colour-blind users.
- **Do** дать каждому external-link `target="_blank" rel="noopener noreferrer"`.

### Don't:
- **Don't** добавлять `max-w-*` обёртки на главный `<main>`. PRODUCT.md явно требует «полную ширину окна».
- **Don't** использовать `border-left` или `border-right` >1px как декоративную полосу слева у карточки/строки. Side-stripe borders — глобальный анти-паттерн impeccable.
- **Don't** использовать `background-clip: text` с градиентом ни в одном заголовке. Gradient-text — анти-референс PRODUCT.md.
- **Don't** использовать `backdrop-filter: blur`, `filter: blur`, `bg-white/70` для glassmorphism. Анти-референс PRODUCT.md.
- **Don't** делать hero-метрики уровня Salesforce («**42 318%** ↑ Growth!»). Числа в карточках — `text-sm font-semibold`, не `text-5xl`.
- **Don't** добавлять chart.js, ECharts, ApexCharts, Recharts. SVG-графики собираются вручную через `<rect>` и `<path>`. Анти-референс PRODUCT.md.
- **Don't** добавлять Inter, SF Pro, Roboto, любой `@import url('https://fonts...')`. Только системный sans-стек.
- **Don't** использовать эмодзи в UI или иконки sparkle/✨ в любых заголовках. Анти-референс PRODUCT.md.
- **Don't** обёртывать таблицу в `<div class="card">` или `<section class="rounded-xl shadow-md p-6 border">`. Таблица — это уже полноценная единица контента.
- **Don't** превращать Refresh в полноценный `<form method="POST">` с redirect — должен быть `invalidateAll()` чтобы URL state (period/sort/dir) сохранялся.
