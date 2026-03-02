# MAX Mini App — ИнструментБург

Мини-приложение для MAX Messenger. Клиенты проверяют статус ремонта, просматривают каталог аренды и записываются на ремонт.

## Critical Rules

1. **Секреты в `~/.config/instrumentburg/api-keys.env`** — НИКОГДА не хардкодить в git-tracked файлах
2. **HashRouter обязателен** — MAX WebView не поддерживает серверный routing, только `/#/path`
3. **MAX Bridge через `<script>` тег** — НЕ npm-пакет. Глобальный `window.WebApp`
4. **LiveSklad не имеет lookup by number** — `find_order()` перебирает страницы заказов
5. **Ремонтные заявки → Telegram** — LiveSklad не поддерживает создание заказов через API

## Commands

```bash
# Frontend
npm run dev          # Vite dev server (port 5180)
npm run build        # Production build → dist/
npx tsc --noEmit     # Type check

# API (из .venv проекта instrumentburg)
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
| `api/main.py` | FastAPI: `/order/{number}`, `/repair`, `/health` |
| `api/livesklad_client.py` | Async LiveSklad client (поиск заказов, маппинг статусов) |
| `api/max_auth.py` | Валидация MAX initData (HMAC-SHA256) |

## Key Patterns

**Aesthetic**: "Digital Workshop" — тёмный фон (#111), amber акценты (#F59E0B), Bebas Neue + DM Sans.

**MAX Bridge**: `bridge.ts` экспортирует typed helpers (`getUser()`, `hapticTap()`, `signalReady()`). WebApp может быть `undefined` вне MAX.

**API auth**: Frontend шлёт `X-Init-Data` header. Backend валидирует HMAC или пропускает в dev-режиме.

**Order lookup**: LiveSklad номера формата `A023222`. Клиент ищет по `number` полю, перебирая до 250 заказов.

**Repair flow**: Форма → POST `/repair` → Telegram notification в чат "ИБ задачи" (`-5208079994`).

## Deploy

- **Хост:** NetAngels (`c50684@h31.netangels.ru`)
- **Фронт:** `/home/c50684/instrumentburg.ru/www/max-app/` (static)
- **API:** `/home/c50684/instrumentburg.ru/max-api/` (systemd user service, port 8100)
- **nginx:** `/max-app/` → static, `/max-api/` → proxy 8100
- **URL в MAX:** `https://instrumentburg.ru/max-app/`

## Environment Variables

```bash
LIVESKLAD_LOGIN          # LiveSklad API auth
LIVESKLAD_PASSWORD       # LiveSklad API auth
TELEGRAM_BOT_TOKEN       # Telegram Bot API
TELEGRAM_IB_TASKS_CHAT_ID  # Чат для заявок (-5208079994)
MAX_BOT_TOKEN            # MAX Bot token (для валидации initData)
```

## Tech Stack

React 18, TypeScript, Vite 6, react-router-dom 7 (HashRouter), FastAPI, httpx, Python 3.12

## Modular Docs

See `.claude/rules/` for:
- `livesklad.md` — структура заказов, статусы, API quirks
- `deploy.md` — nginx конфиг, systemd service, первый деплой

## Related

- **Monorepo:** `instrumentburg` (родительский проект)
- **LiveSklad client (sync):** `05-automations/onboarding-bot/services/livesklad.py`
- **Design doc:** `docs/plans/2026-03-02-max-miniapp-design.md`
- **Issues:** #45 (MAX бот), #69-73 (MAX интеграция), #34 (кнопки на сайте)
