# MAX Mini App — ИнструментБург

Мини-приложение для MAX Messenger. Клиенты проверяют статус ремонта, просматривают каталог аренды и записываются на ремонт.

## Critical Rules

1. **Секреты в `~/.config/instrumentburg/api-keys.env` / `/home/c50684/instrumentburg.ru/max-api-env/.env`** — НИКОГДА не хардкодить в git-tracked файлах.
2. **Текущий роутинг — BrowserRouter с `basename="/max-app"`**. Старые планы про HashRouter устарели: переход `HashRouter → BrowserRouter` был сделан, чтобы исправить чёрный экран в MAX WebView.
3. **MAX Bridge через `<script>` тег** — НЕ npm-пакет. Глобальный `window.WebApp`.
4. **LiveSklad не имеет lookup by number** — поиск заказа перебирает страницы заказов.
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
| `src/pages/` | React-страницы: Home, OrderStatus, Catalog, CatalogCategory, RepairRequest |
| `src/bridge.ts` | Typed wrapper для MAX `window.WebApp` (initData, haptics, BackButton) |
| `src/api.ts` | Fetch-клиент с `X-Init-Data` header |
| `src/data/catalog.ts` | Статичные данные каталога аренды (9 категорий) |
| `src/styles/` | CSS: global (variables, reset), components, pages |
| `api-php/index.php` | Production PHP API: `/health`, `/order/{number}`, `/repair`, `/bot/webhook`; место для MAX service notifications |
| `api-php/max-ru-ca.pem` | Корневой сертификат Минцифры — нужен `CURLOPT_CAINFO` для запросов к `platform-api2.max.ru` (не в системном trust store) |
| `api/main.py` | Legacy/reference FastAPI backend; не production по текущему deploy-плану |
| `api/livesklad_client.py` | Async LiveSklad client для старого FastAPI-варианта |
| `api/max_auth.py` | Валидация MAX initData (HMAC-SHA256) для старого FastAPI-варианта |

## Key Patterns

**Aesthetic**: "Digital Workshop" — тёмный фон (#111), amber акценты (#F59E0B), Bebas Neue + DM Sans.

**MAX Bridge**: `bridge.ts` экспортирует typed helpers (`getUser()`, `hapticTap()`, `signalReady()`). WebApp может быть `undefined` вне MAX.

**MAX-бот (диалог)**: username `id662337117117_bot`. Диплинк на чат: `https://max.ru/id662337117117_bot?start`; на мини-приложение: `https://max.ru/id662337117117_bot?startapp`. Webhook `POST /bot/webhook` в `api-php/index.php` — клиент присылает номер заказа текстом, бот отвечает статусом + кнопкой `open_app` в мини-приложение. Подписка регистрируется через `POST https://platform-api2.max.ru/subscriptions`.

**API auth**: Frontend шлёт `X-Init-Data` header. Backend валидирует HMAC или пропускает в dev-режиме.

**Order lookup**: LiveSklad номера формата `A023222`. Клиент ищет по `number` полю, перебирая до 250 заказов.

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
