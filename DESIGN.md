---
name: gsc-hub
description: Мульти-аккаунт хаб Google Search Console в виде светлого торгового терминала - каждый сайт это тикер.
colors:
  bg: "#f6f7f9"
  pane: "#ffffff"
  sunk: "#fafbfc"
  line: "#e4e7ec"
  line-soft: "#eef0f3"
  ink: "#131722"
  ink-2: "#434a57"
  ink-3: "#6e7684"
  ink-4: "#aab1bd"
  acc: "#2962ff"
  acc-deep: "#1e4cd6"
  acc-t: "#e9efff"
  up: "#088771"
  up-t: "#e3f5f1"
  dn: "#e02a3a"
  dn-t: "#fdebed"
  upd: "#f5923c"
  upd-t: "#fff3e6"
  upd-ink: "#8a4a0c"
  upd-spam: "#e0a324"
  upd-discover: "#f0b35a"
  upd-other: "#d9a066"
  warn: "#a16207"
  warn-t: "#fef7e0"
  series-impr: "#9aa3b2"
  series-ctr: "#6b7684"
  series-prev: "#c3c9d3"
typography:
  symbol:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  table:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.06em"
  stat-value:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.45
    fontFeature: "tnum"
  num:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  axis:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "10.5px"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "tnum"
rounded:
  none: "0px"
  tag: "2px"
  chip: "3px"
  base: "4px"
spacing:
  px: "1px"
  cell-y: "6px"
  cell-x: "10px"
  pane: "12px"
  page: "16px"
  page-sm: "20px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.acc}"
    textColor: "{colors.pane}"
    rounded: "{rounded.base}"
    padding: "0 12px"
    height: "28px"
    typography: "{typography.title}"
  button-primary-hover:
    backgroundColor: "{colors.acc-deep}"
    textColor: "{colors.pane}"
  button-secondary:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "0 12px"
    height: "28px"
  button-secondary-hover:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink}"
  button-ghost:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.base}"
    padding: "0 12px"
    height: "28px"
  button-ghost-hover:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
  button-buy:
    backgroundColor: "{colors.up}"
    textColor: "{colors.pane}"
    rounded: "{rounded.base}"
    padding: "0 16px"
    height: "36px"
  button-danger:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.dn}"
    rounded: "{rounded.base}"
    padding: "0 12px"
    height: "28px"
  button-danger-hover:
    backgroundColor: "{colors.dn-t}"
    textColor: "{colors.dn}"
  input:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "0 8px"
    height: "28px"
  segment-active:
    backgroundColor: "{colors.acc-t}"
    textColor: "{colors.acc}"
    rounded: "{rounded.base}"
    padding: "0 8px"
    height: "24px"
  pane:
    backgroundColor: "{colors.pane}"
    rounded: "{rounded.base}"
    padding: "{spacing.pane}"
  pane-head:
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    padding: "0 12px"
    height: "36px"
  table-head:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink-3}"
    padding: "6px 10px"
  chip-up:
    backgroundColor: "{colors.up-t}"
    textColor: "{colors.up}"
    rounded: "{rounded.chip}"
    padding: "1px 6px"
  chip-dn:
    backgroundColor: "{colors.dn-t}"
    textColor: "{colors.dn}"
    rounded: "{rounded.chip}"
    padding: "1px 6px"
  badge-warn:
    backgroundColor: "{colors.warn-t}"
    textColor: "{colors.warn}"
    rounded: "{rounded.chip}"
    padding: "1px 6px"
  badge-muted:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.chip}"
    padding: "1px 6px"
  nav-bar:
    backgroundColor: "{colors.pane}"
    height: "40px"
    padding: "0 12px"
  nav-link-active:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.base}"
    padding: "0 10px"
    height: "28px"
---

# Design System: gsc-hub

## Overview

**Creative North Star: "Светлый торговый стол"**

Каждый сайт - тикер на одном светлом торговом столе. Оператор просматривает watchlist всех сайтов, открывает один и читает клики как цену, а показы как объём - на фоне апдейтов Google и склеек доменов. Отсюда грамматика терминала: панель символа со стрипом статистики, строка таймфреймов, ценовой график с правой шкалой и тегом последнего значения, под ним вкладки и плотная таблица. Это прямой отказ от сетки карточек SaaS-дашборда.

Мир светлый и плотный. Прохладный серый стол (`bg`) виден только как рамка; работа идёт на белых панелях, разделённых линией в 1px. Один синий (`acc`) означает действие и выделение. Зелёный и красный появляются только там, где есть знак: рост и падение, здоровье и поломка, покупка и удаление. Янтарь принадлежит апдейтам Google и больше никому. Все числа моноширинные и табличные, чтобы колонки читались вертикально.

Системный шрифт, светлая тема и плотность подтверждены пользователем: это не компромисс, а выбор. Данные никогда не кешируются, поэтому у каждого экрана с данными есть штамп `live HH:MM` и кнопка Refresh.

**Key Characteristics:**
- Панели стыкуются в «стол»: 1px линии вместо отступов, серый фон только снаружи.
- Один синий на действие, зелёный/красный только со знаком, янтарь только для апдейтов.
- Моно-цифры с `tabular-nums` везде: таблицы, стат-стрип, оси, чипы.
- Кнопки 28px, радиус 4px, порядок в ряду ghost → sec → pri.
- Графики собраны вручную на SVG, один цвет на метрику во всём приложении.
- Иконки только SVG со штрихом 1.5-1.6.

## Colors

Нейтральная прохладная шкала «стол / панель / чернила», один синий для действия и три зарезервированных семейства: направление (зелёный/красный), апдейты (янтарь), предупреждение (охра). Источник истины - RGB-каналы CSS-переменных в `src/app.css` (Tailwind применяет к ним альфу); цвета SVG продублированы литералами в `src/lib/chart-theme.ts`.

### Primary
- **Сигнальный синий** (`acc`): единственный цвет действия. Primary-кнопка, активный сегмент таймфрейма, подчёркивание активной вкладки, стрелка сортировки, кольцо фокуса, чекбоксы, линия кликов на графике и тег последнего значения.
- **Глубокий синий** (`acc-deep`): только hover primary-кнопки и ссылок в баннере.
- **Синий туман** (`acc-t`): фон активного сегмента, бейджа `acc`, выделенной строки таблицы (60%), баннера обновления.

### Secondary
- **Рост** (`up` / `up-t`): положительная дельта, бейдж «ok», положительный импакт апдейта, кнопка Buy в панели заказа.
- **Падение** (`dn` / `dn-t`): отрицательная дельта, CTR ниже бенчмарка, бейдж «revoked»/ошибка, блок ошибок, текст destructive-кнопки.

### Tertiary
- **Янтарь апдейта** (`upd`, семейство `upd-spam`, `upd-discover`, `upd-other`): полосы раскатки апдейтов Google на графике и их свотч в легенде. Тип апдейта различается оттенком внутри семейства, а подпись называет тип (Core, Spam, Discover).
- **Чернила апдейта** (`upd-ink`): текст подписей апдейтов на янтарной подложке.
- **Охра предупреждения** (`warn` / `warn-t`): статус «требует внимания» - бейдж warn, подсветка строки сайта без ключа IndexNow, заголовок панели с одноразовым API-ключом. Это статус, не апдейт; на графиках не появляется.

### Neutral
- **Стол** (`bg`): фон страницы, рамка вокруг панелей; hover ghost-кнопок и пунктов навигации.
- **Панель** (`pane`): рабочая поверхность, фон кнопок sec и полей.
- **Утопленная** (`sunk`): шапки таблиц, трей действий строки, hover строки, подписи групп кнопок.
- **Линия** (`line`): границы панелей, швы стола, границы кнопок и полей. **Мягкая линия** (`line-soft`): разделители строк и сетка графика.
- **Чернила** (`ink` → `ink-4`): текст по убыванию веса. `ink-3` - подписи и оси (4.6:1 на белом, нижняя граница для текста), `ink-4` - только плейсхолдеры, прочерки отсутствующих значений и выключенные пункты легенды.
- **Серии** (`series-impr`, `series-ctr`, `series-prev`): столбцы показов, линия CTR, пунктир прошлого периода. Позиция рисуется `ink`.

### Named Rules
**The Colour Reservation Rule.** Зелёный и красный несут знак: направление изменения, здоровье (ok/revoked), глагол заказа (Buy зелёный, удаление красное) - как в терминале. Янтарь - только апдейты Google. События сайта (склейки, миграции) и позиция рисуются чернилами `ink`, чтобы никогда не читаться как падение.

**The One Blue Rule.** Синий означает «можно нажать» или «выбрано». Им не красят заголовки, иллюстрации и декоративные акценты.

**The One Colour Per Metric Rule.** Клики всегда `acc`, показы всегда `series-impr`, позиция всегда `ink`, CTR всегда `series-ctr` - на графике сайта, спарклайнах дашборда и истории запроса. Новый график берёт цвета из `chart-theme.ts`, а не выдумывает свои.

## Typography

**Display Font:** нет - дисплейного шрифта в системе нет
**Body Font:** системный sans (`ui-sans-serif, system-ui, -apple-system, 'Segoe UI'`)
**Label/Mono Font:** `ui-monospace, 'SF Mono', Menlo, Consolas, monospace`

**Character:** Системный sans для слов, системный моно для чисел. Пара ничего не декларирует - она делает таблицу колонкой цифр, как в стакане котировок.

### Hierarchy
- **Symbol** (700, 17px, 1.25, трекинг -0.025em): имя сайта в панели символа и заголовок страницы. Крупнее на экране ничего нет.
- **Title** (600, 13px): заголовки секций, кнопки (12.5px), активная вкладка.
- **Body** (400, 13px, 1.45): базовый размер `body`.
- **Table** (400, 12.5px): ячейки таблиц, поля, вкладки, пункты навигации.
- **Label** (600, 11px, 0.06em, uppercase): заголовки панелей; подписи стат-стрипа (500, 10.5px, 0.05em), подписи групп сегментов (500, 11px).
- **Stat value** (mono 600, 14px, tnum): значения в стат-стрипе; дельта рядом mono 11.5px.
- **Num** (mono 400, 12px, tnum): числа в таблицах, всегда выровнены вправо.
- **Axis** (mono 10.5px, `ink-3`): метки осей, даты легенды, теги на оси.

### Named Rules
**The Mono Numbers Rule.** Любое число, которое сравнивают с другим числом, набрано моно с `tabular-nums` и выровнено вправо. Даты в таблицах и в легенде графика - тоже моно.

**The System Face Rule.** Шрифты не подгружаются. Иерархию дают вес, размер и регистр подписи, а не гарнитура.

## Layout

Страница во всю ширину окна (`page`: 16px, от `sm` 20px), без `max-width`. Сверху липкая навигация 40px. Основная единица - **стол**: сетка панелей с `gap: 1px` на фоне цвета `line`, обёрнутая одной рамкой с радиусом 4px; серый стол виден только снаружи. Колонки стола - вертикальные стеки, последняя панель колонки растягивается до низа. Страница сайта - стол из двух колонок `minmax(0,1fr) 300px` от `xl`; ниже `xl` правая колонка уходит под основную.

Внутри панели ритм плотный: тело 12px, ячейка таблицы 10px × 6px, шапка панели 36px, вкладка 32px, сегмент 24px. Разбиения внутри панели делаются тем же приёмом - сетка с `gap-px` на `bg-line`, а не отступами.

Первый экран страницы сайта: панель символа (домен, аккаунт, `live HH:MM`, стат-стрип, Refresh справа) → строка таймфреймов → график цена/объём → вкладки → таблица. На мобильном стат-стрип становится сеткой 2×2, кнопки уходят под него, навигация прокручивается горизонтально с маской затухания справа.

**The Joined Desk Rule.** Внутри стола нет щелей: соседние панели делят одну линию в 1px. Исключение одно - плитки дашборда: это отдельные панели в сетке с зазором, каждая со своей рамкой и hover-рамкой `ink-4`.

## Elevation & Depth

Система плоская. Глубина передаётся тоном (стол → панель → утопленная шапка) и линиями. Тень появляется только у того, что всплывает над столом и перекрывает данные: выпадающие меню, модальные окна, липкая панель выделения внизу таблицы.

### Shadow Vocabulary
- **Всплывающее** (`box-shadow: 0 6px 20px -6px rgb(19 23 34 / 0.25)`): выпадающий список, модалка списка, липкая панель действий по выделенным строкам.
- **Модальное** (`box-shadow: 0 12px 40px -12px rgb(19 23 34 / 0.35)`): диалог заказа ссылок.

### Named Rules
**The Flat Desk Rule.** Панели, кнопки, чипы и плитки лежат на столе без тени. Тень означает «это над столом и закроется».

## Shapes

Один радиус - 4px - для панелей, рамки стола, кнопок, полей, сегментов, пунктов навигации. Чипы и бейджи 3px, теги на осях графика 2px. Панели внутри стола теряют радиус и рамку, иначе стыки двоятся. Точка статуса - единственный круг. Метка события на графике - ромб (квадрат 10px, повёрнутый на 45°, с белой обводкой 1.5px); кластер событий - ромб 13px с числом.

## Components

### Buttons
Одна форма, четыре веса; кнопка сообщает важность весом, а не размером.
- **Shape:** слегка скруглённый прямоугольник (4px), высота 28px, поля 12px, текст 12.5px/600, иконка 14px. `sm` - 24px, `lg` - 36px (только кнопка оплаты). Иконочная кнопка квадратная.
- **Primary:** заливка `acc`, белый текст; hover `acc-deep`.
- **Secondary:** белая с рамкой `line`; hover рамка `ink-4`, фон `sunk`.
- **Ghost:** без фона, текст `ink-2`; hover фон `bg`, текст `ink`.
- **Buy:** заливка `up`, белый текст, 36px во всю ширину панели заказа; текст показывает сумму из расчёта.
- **Danger:** белая с рамкой, текст `dn`; hover фон `dn-t`.
- **Disabled:** прозрачность 45%, курсор not-allowed.
- **Button group:** сегменты в одной рамке, разделены 1px линией; может начинаться с утопленной подписи.

**The Button Order Rule.** В ряду слева направо ghost → sec → pri. На зону не больше одной primary. Destructive стоит отдельно от остальных, а не в общем ряду.

**The Row Tray Rule.** Действия строки не занимают колонку. Они живут в трее, который наезжает на конец строки (фон `sunk`, левая линия) при hover, фокусе внутри строки, выделении или свежем статусе строки. На устройствах без hover трей стоит в строке статично.

### Chips и Badges
- **Chip (направление):** mono 11px/600, радиус 3px; `up` на `up-t`, `dn` на `dn-t`, «flat» - просто `ink-3`.
- **Badge (статус):** 11px/500, радиус 3px; ok (`up`), bad (`dn`), warn (`warn`), muted (`ink-2` на `bg`), acc.

### Cards / Containers
- **Corner Style:** 4px снаружи, 0 внутри стола.
- **Background:** `pane` на `bg`.
- **Shadow Strategy:** нет (см. Elevation).
- **Border:** 1px `line`.
- **Pane head:** 36px, нижняя линия, заголовок 11px uppercase `ink-3`, справа приглушённая приписка обычным регистром (счётчик, пояснение). Заголовок панели - это имя окна терминала, а не надзаголовок над текстом.
- **Internal Padding:** 12px.

### Inputs / Fields
- **Style:** 28px, рамка `line`, фон `pane`, радиус 4px, текст 12.5px, плейсхолдер `ink-4`.
- **Focus:** рамка `acc` и кольцо `acc` 15%; глобальный `:focus-visible` - контур 2px `acc` со смещением 1px.
- **Hover:** рамка `ink-4`.

### Segmented control (таймфрейм)
Сегменты 24px, текст 11.5px/600 `ink-2`; активный - `acc` на `acc-t`. Перед группой может стоять подпись 11px uppercase `ink-3` (Period, Sort, Metrics).

### Tabs
Подчёркивающие вкладки 32px над нижней линией; активная - подчёркивание 2px `acc`, текст `ink`/600. Счётчик - тихий моно-суффикс 11px `ink-3`.

### Tables
Плотные: ячейка 10px × 6px, 12.5px. Шапка утоплена (`sunk`), 11px `ink-3`; сортируемые колонки показывают SVG-стрелку `acc` 10px. Строки разделены `line-soft`, hover `sunk`, выделенная `acc-t`/60%, скрытая - 50% прозрачности. Отсутствующее значение - прочерк `ink-4`.

### Navigation
Белая липкая полоса 40px с нижней линией. Слева логотип (синий квадрат с SVG-линией графика) и слово gsc-hub 13px/700; пункты 28px, 12.5px `ink-2`; hover и активный - фон `bg`, активный ещё и 600. Справа ghost-кнопки Blur и выхода, email через разделитель. На узком экране пункты прокручиваются с маской затухания.

### Trend chart (сигнатура)
График сайта в грамматике терминала, на SVG без библиотек:
- **Цена:** клики - линия `acc` 1.6px с градиентной заливкой 14% → 0; шкала справа, моно 10.5px, сетка `line-soft`.
- **Объём:** показы - столбцы `series-impr` 45% в нижней панели на 22% высоты, отделённой линией `line`; наведённый столбец темнеет до `ink-2`.
- **Последнее значение:** точечный уровень `acc` и синий тег на правой оси; тег прячет метку оси под собой.
- **Перекрестие:** пунктир 3/3 `ink-2`, точка с белой обводкой, тёмные (`ink`) теги на обеих осях. Ничего не всплывает поверх данных: легенда сверху читает наведённый день.
- **Легенда:** дата моно слева, пункты-переключатели со свотчем 10px; выключенный - контурный свотч и `ink-4`.
- **Апдейты:** полосы раскатки янтарём 8% с полосой подписи сверху; подписи, которые пересекаются, раскладываются максимум в три дорожки, остальные читаются в легенде. Импакт в подписи окрашен по знаку, идущий апдейт - пунктирный правый край.
- **События:** ромбы `ink` на сплошной волосяной линии (28%); близкие события сливаются в один ромб с числом; подпись на белой плашке показывается, только если не перекрывает соседей.
- **Клавиатура:** стрелки влево/вправо ходят по дням, Escape сбрасывает.

### Symbol header
Имя сайта (Symbol), под ним аккаунт, тип свойства и моно-штамп `live HH:MM`; стат-стрип - колонки с левой линией `line`, подпись 10.5px uppercase над моно-значением; справа ghost «Open» и sec «Refresh».

### Notices
Ошибка - рамка `dn` 25% на `dn-t`; нейтральное уведомление - `sunk` с рамкой; предупреждение - `warn` на `warn-t`; пустое состояние - пунктирная рамка, центрированный текст.

## Do's and Don'ts

### Do:
- **Do** собирать экран как стол: панели в сетке с `gap-px` на `bg-line`, одна внешняя рамка 4px.
- **Do** выравнивать числа вправо и набирать их моно с `tabular-nums`.
- **Do** брать цвета графиков только из `chart-theme.ts`: клики `acc`, показы `series-impr`, позиция и события `ink`, апдейты - семейство `upd`.
- **Do** ставить кнопки в порядке ghost → sec → pri, одна primary на зону, destructive отдельно.
- **Do** прятать действия строки в трей, который появляется по hover, фокусу, выделению или статусу.
- **Do** показывать `live HH:MM` и Refresh на каждом экране с живыми данными GSC.
- **Do** рисовать иконки SVG 16×16 со штрихом 1.5-1.6 и `currentColor`.
- **Do** помечать email, домены и метрики классом `pii`, чтобы Blur их закрывал.

### Don't:
- **Don't** красить зелёным или красным то, у чего нет знака, и не использовать янтарь ни для чего, кроме апдейтов Google.
- **Don't** рисовать события сайта и позицию цветами направления.
- **Don't** оставлять щели между панелями внутри стола и не возвращать сетку карточек с тенями (плитки дашборда - единственные отдельные панели).
- **Don't** ставить тени на то, что лежит на столе.
- **Don't** использовать эмодзи и юникод-глифы как иконки (стрелки, галочки, крестики) - только SVG.
- **Don't** подгружать веб-шрифты и не вводить дисплейную гарнитуру.
- **Don't** ставить вторую primary-кнопку в ту же зону и не заводить колонку под действия строки.
