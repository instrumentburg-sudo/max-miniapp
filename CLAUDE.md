# MAX Mini App — ИнструментБург

Мини-приложение для MAX Messenger. Клиенты проверяют статус ремонта, просматривают каталог аренды и записываются на ремонт.

## Critical Rules

1. **Секреты в `~/.config/instrumentburg/api-keys.env` / `/home/c50684/instrumentburg.ru/max-api-env/.env`** — НИКОГДА не хардкодить в git-tracked файлах.
2. **Текущий роутинг — BrowserRouter с `basename="/max-app"`**. Старые планы про HashRouter устарели: переход `HashRouter → BrowserRouter` был сделан, чтобы исправить чёрный экран в MAX WebView.
3. **MAX Bridge через `<script>` тег** — НЕ npm-пакет. Глобальный `window.WebApp`.
4. **LiveSklad ищет по номеру: `GET /company/orders?number=A0XXXXX&limit=10`.** Раньше здесь было записано обратное, и поиск листал 5 страниц по 50 — видел только ~250 последних заказов, поэтому заказ от июня не находился ни в мини-аппе, ни у бота (жалоба Антона 25.07). Тот же фильтр давно использует калькулятор (`convex/livesklad.ts:searchOrders`). `pageSize` больше 50 API игнорирует — листать бесполезно.
5. **Production API сейчас PHP**: `api-php/index.php` на NetAngels (`/max-api/*`). `api/main.py` — старый FastAPI-вариант/референс, не считать его production без проверки деплоя.
6. **Ремонтные заявки → Telegram** — LiveSklad не поддерживает создание заказов через API.

## Commands

```bash
# Frontend
npm run dev          # Vite dev server (port 5180)
npm run build        # Production build → dist/
npx tsc --noEmit     # Type check

# Production PHP API check
php -l api-php/index.php

# Legacy FastAPI reference only — не production без отдельного решения
cd api && python main.py   # FastAPI (port 8100)

# Deploy
./deploy.sh                # Всё на NetAngels
./deploy.sh --frontend-only
./deploy.sh --api-only
```

## Architecture

| Path | Purpose |
|------|---------|
| `src/pages/` | React-страницы: Home, OrderStatus, MyOrders, LinkAccount, RepairRequest |
| `src/bridge.ts` | Typed wrapper для MAX `window.WebApp` (initData, haptics, BackButton) |
| `src/api.ts` | Fetch-клиент с `X-Init-Data` header |
| `src/components/` | `Screen` (шапка экрана), `Ticket` (строка талона), `icons.tsx` (штриховые SVG) |
| `src/data/instrumentTypes.ts` | Список типов инструмента для формы заявки |
| `src/styles/` | CSS: global (токены, зерно бумаги), components (талон, штамп, кнопки, поля), pages (раскладки) |
| `api-php/index.php` | Production PHP API: `/health`, `/order/{number}`, `/repair`, `/bot/webhook`; место для MAX service notifications |
| `api-php/max-ru-ca.pem` | Корневой сертификат Минцифры — нужен `CURLOPT_CAINFO` для запросов к `platform-api2.max.ru` (не в системном trust store) |
| `api/main.py` | Legacy/reference FastAPI backend; не production по текущему deploy-плану |
| `api/livesklad_client.py` | Async LiveSklad client для старого FastAPI-варианта |
| `api/max_auth.py` | Валидация MAX initData (HMAC-SHA256) для старого FastAPI-варианта |

## Key Patterns

**Aesthetic**: «Приёмный талон» (редизайн 25.07.2026) — светлая бумага (#E9E3D6), типографская краска (#17150F), сигнальный оранжевый (#E33B00). Шрифты: Alumni Sans (дисплей), Golos Text (текст), Martian Mono (маркировка, номера, кнопки). Прямые углы, жёсткие тени без блюра, пунктирные выноски в талоне, штамп статуса под наклоном, перфорация под шапкой. Эмодзи в интерфейсе запрещены — только штриховые SVG из `src/components/icons.tsx` (эмодзи рендерятся системным набором платформы и разъезжаются между iOS/Android/desktop). Статусы LiveSklad приходят свободным текстом и садятся на базовый `.stamp`, поэтому он обязан читаться на чёрной шапке талона без модификатора.

**MAX Bridge**: `bridge.ts` экспортирует typed helpers (`getUser()`, `hapticTap()`, `signalReady()`). WebApp может быть `undefined` вне MAX.

**MAX-бот (диалог)**: username `id662337117117_bot`. Диплинк на чат: `https://max.ru/id662337117117_bot?start`; на мини-приложение: `https://max.ru/id662337117117_bot?startapp`. Webhook `POST /bot/webhook` в `api-php/index.php` — клиент присылает номер заказа текстом, бот отвечает статусом + кнопкой в мини-приложение. Подписка (`POST https://platform-api2.max.ru/subscriptions`) слушает `message_created` и `bot_started`.

**⚠️ Кнопка mini-app — только `type: link` на `?startapp`.** `type: open_app` принимает `web_app` строкой-URL и резолвит её по своему реестру связанных mini-app; наш URL там не зарегистрирован, и MAX валит ВЕСЬ `POST /messages` с `404 {"code":"not.found", … LinkPK{name='https://instrumentburg.ru/max-app/'}}` — клиент не получает вообще ничего (так бот молчал 23–24.07.2026). Проверенные варианты: `web_app` объектом → 400 «Can't deserialize body», `contact_id` → 400 «Field 'webApp' cannot be null».

**Распознавание номера заказа**: `extract_order_number()` вытаскивает номер из свободного текста («А025121 от 20 07.2026»). С префиксом «A» — 3–10 цифр; без префикса доверяем только длине LiveSklad-номера (5–7 цифр), иначе моделями инструмента и ценами («Bosch GSR 180», «ремонт 1500») забивался бы поиск. Телефоны вырезаются до разбора.

**API auth**: Frontend шлёт `X-Init-Data` header. Backend валидирует HMAC или пропускает в dev-режиме.

**Order lookup**: номера формата `A023222` (A + 6 цифр с ведущим нулём). `order_number_candidates()` строит варианты написания (без префикса, без нуля, кириллическая «А»), каждый уходит в `?number=` — обычно хватает одного запроса, находит заказ любой давности.

**Кэш токена LiveSklad** (по образцу `convex/lib/liveskladAuth.ts` калькулятора): `/auth` жёстко лимитирован, поэтому токен (ttl 900 с) лежит в `/home/c50684/instrumentburg.ru/max-api-env/.livesklad-token.json` (chmod 600, вне `www` — файл с живым токеном не должен отдаваться по HTTP). На 429 туда пишется `banned_until` из `expireDate`, и запросы фейлятся быстро вместо долбёжки API.

**Ошибки различаются**: 404 «заказ не найден» ≠ 429/503 «сервис учёта занят». И бот, и мини-апп говорят про временную недоступность отдельным текстом — иначе клиент идёт сверять правильный номер зря.

**Repair flow**: Форма → POST `/repair` → Telegram notification в чат "ИБ задачи" (`-5208079994`).

## Deploy

- **Хост:** NetAngels (`c50684@h31.netangels.ru`)
- **Фронт:** `/home/c50684/instrumentburg.ru/www/max-app/` (static)
- **Production API:** `/home/c50684/instrumentburg.ru/www/max-api/` или текущий путь deploy-скрипта для `api-php/` (PHP через Apache/.htaccess, без systemd)
- **Секреты API:** `/home/c50684/instrumentburg.ru/max-api-env/.env`
- **URL в MAX:** `https://instrumentburg.ru/max-app/`

## Environment Variables

```bash
LIVESKLAD_LOGIN          # LiveSklad API auth
LIVESKLAD_PASSWORD       # LiveSklad API auth
TELEGRAM_BOT_TOKEN       # Telegram Bot API
TELEGRAM_IB_TASKS_CHAT_ID  # Чат для заявок (-5208079994)
MAX_BOT_TOKEN            # MAX Bot token (валидация initData + отправка сообщений через Bot API)
MAX_WEBHOOK_SECRET       # Секрет для `POST /bot/webhook` — сверяется с заголовком X-Max-Bot-Api-Secret
```

## Tech Stack

React 18, TypeScript, Vite 6, react-router-dom 7, PHP 8.3 API on NetAngels (`api-php`). Legacy FastAPI files remain as reference unless explicitly revived.

## Modular Docs

See `.claude/rules/` for:
- `livesklad.md` — структура заказов, статусы, API quirks
- `deploy.md` — nginx конфиг, systemd service, первый деплой

## Related

- **Monorepo:** `instrumentburg` (родительский проект)
- **LiveSklad client (sync):** `05-automations/onboarding-bot/services/livesklad.py`
- **Design doc:** `docs/plans/2026-03-02-max-miniapp-design.md`
- **Issues:** #45 (MAX бот), #69-73 (MAX интеграция), #34 (кнопки на сайте)
