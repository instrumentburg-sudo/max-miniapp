# MAX service notifications — 2026-06-13

## Verdict

У ИнструментБурга уже есть MAX-контур, но он сейчас решает mini app-задачи, а не транзакционные уведомления:

- `apps/max-miniapp/` — рабочее MAX mini app: статус заказа, каталог аренды, заявка на ремонт.
- Production API фактически в `api-php/index.php` на NetAngels (`/max-api/*`), не FastAPI.
- `api/main.py` остался как FastAPI-вариант/источник логики, но текущий deploy-план перевёл API на PHP.
- `instrumentburg-responder/src/channels/max.py` — только заглушка будущего канального адаптера, не готовый бот.

Реализовывать уведомления «как у Петровича» надо не в OpenCart-шаблонах сайта, а в MAX-контуре: `apps/max-miniapp/api-php/index.php` + отдельный webhook/notify слой.

## Product target

Сделать сервисные MAX-уведомления для ремонта:

1. Клиент один раз связывает MAX-пользователя с заказом/телефоном.
2. Дальше ИнструментБург сам отправляет статусы ремонта в MAX:
   - заявка/заказ принят;
   - инструмент на диагностике;
   - диагностика готова;
   - согласовать ремонт;
   - ждём запчасти;
   - готово к выдаче;
   - чек/акт/гарантия.
3. Сообщение выглядит как карточка, а не голый текст: Markdown + inline-кнопки.

## Key API facts from current MAX docs

- Send message: `POST https://platform-api.max.ru/messages?user_id={id}` or `?chat_id={id}`.
- Auth: header `Authorization: <MAX_BOT_TOKEN>`; query-token mode is deprecated/unsupported.
- Message body supports:
  - `text` up to 4000 chars;
  - `format: "markdown" | "html"`;
  - `notify: true | false`;
  - `attachments` with `inline_keyboard`, media, files, contact, location, etc.
- Inline keyboard supports button types: `callback`, `link`, `request_contact`, `request_geo_location`, `open_app`, `message`, `clipboard`.
- Production events should use Webhook, not Long Polling.
- `request_contact` returns the MAX-linked phone and `hash`; verify with `HMAC-SHA256(access_token, vcf_info)`.
- `open_app` can open the MAX mini app; `link` can open `https://instrumentburg.ru/max-app/...`.

## Proposed architecture

```text
LiveSklad / calculator / operator action
  -> internal notify call
  -> /max-api/notify/repair-status
  -> MAX Bot API /messages
  -> client in MAX

MAX user starts bot or opens mini app
  -> webhook /max-api/bot/webhook OR miniapp X-Init-Data
  -> bind max_user_id to phone/order
  -> local storage / Convex / CRM mapping
```

## Storage choice

Preferred long-term: Convex tables already planned in calculator docs:

- `client_channel_links`
- `client_notifications`
- `client_consents`

Short MVP if Convex is not wired from PHP yet:

- JSONL append-only file outside web root on NetAngels, e.g. `/home/c50684/instrumentburg.ru/max-api-data/client_links.jsonl`.
- This is acceptable only for MVP/binding tests; production should move to Convex/CRM.

## MVP scope

### M1 — outgoing sender, no storage

Add to `api-php/index.php`:

- `max_api_post($path, $query, $body)`
- `max_send_message($userId, $message)`
- `build_repair_status_message($payload)`
- internal endpoint `POST /notify/repair-status`

Protect endpoint with `MAX_NOTIFY_SECRET` header:

```http
X-Notify-Secret: <secret>
```

Payload:

```json
{
  "user_id": 123456789,
  "order_number": "A023222",
  "status": "diagnostics_ready",
  "device_name": "Bosch GSR 180-LI",
  "cost": 1850,
  "comment": "Износ щёточного узла",
  "approval_url": "https://instrumentburg.ru/max-app/order/A023222",
  "notify": true
}
```

Message example:

```json
{
  "text": "# ИнструментБург\n\n**Заказ A023222**\n\n^^Диагностика готова^^\n\n**Инструмент:** Bosch GSR 180-LI\n**Ремонт:** 1 850 ₽\n**Комментарий:** Износ щёточного узла\n\n> Нажмите кнопку ниже — мастер увидит решение.",
  "format": "markdown",
  "notify": true,
  "attachments": [
    {
      "type": "inline_keyboard",
      "payload": {
        "buttons": [
          [
            {"type": "callback", "text": "✅ Согласовать", "payload": "approve_repair:A023222"},
            {"type": "callback", "text": "❌ Отказаться", "payload": "decline_repair:A023222"}
          ],
          [
            {"type": "link", "text": "Открыть заказ", "url": "https://instrumentburg.ru/max-app/order/A023222"},
            {"type": "clipboard", "text": "Скопировать №", "payload": "A023222"}
          ]
        ]
      }
    }
  ]
}
```

Validation:

- dry-run mode when `MAX_BOT_TOKEN` is missing;
- do not send if `user_id` is missing;
- log MAX API HTTP code/body without exposing token;
- return `{success, max_status, message_id?}`.

### M2 — binding client to MAX

Add bot/webhook path:

- `POST /bot/webhook`
- process events:
  - `bot_started` with `payload=order_A023222`;
  - `message_created` with contact attachment;
  - `message_callback` for approve/decline.

Flow:

1. Receptionist sends/prints deep link:

```text
https://max.ru/<instrumentburg_bot>?start=order_A023222
```

2. Bot sends message with `request_contact` button.
3. User presses «Поделиться телефоном».
4. Backend verifies contact `hash`.
5. Backend stores link:

```json
{
  "phone": "+73432264443",
  "max_user_id": 123456789,
  "order_number": "A023222",
  "source": "request_contact",
  "verified_at": "2026-06-13T..."
}
```

### M3 — repair approval callbacks

On `message_callback`:

- `approve_repair:{order}` → write consent decision to calculator/Convex or Telegram task;
- `decline_repair:{order}` → write rejection / notify manager;
- call `POST /answers` to update message or show one-time notification.

Until LiveSklad write-back target statuses are confirmed, do not directly change LiveSklad statuses from MAX callbacks.

### M4 — LiveSklad/calculator trigger integration

Sources:

- calculator estimate approval flow (`apps/calculator/docs/plans/2026-05-28-estimate-client-approval-status.md`);
- queue/status sync from LiveSklad;
- manual operator button in calculator UI.

Rule: avoid duplicate notifications with native LiveSklad notifications. Start with only one event: `diagnostics_ready` / estimate approval.

## Files to touch first

- `api-php/index.php` — production PHP API and router.
- `CLAUDE.md` — update architecture note: production API is PHP and BrowserRouter is current; current doc still says HashRouter/FastAPI in places.
- optional: `api/main.py` — keep parity only if FastAPI will be revived; otherwise do not expand it.
- optional later: `instrumentburg-responder/src/channels/max.py` — customer-reply bot, separate from service notifications.

## Verification gates

M1:

```bash
php -l api-php/index.php
npm run build
```

For local dry-run:

```bash
curl -X POST http://localhost/max-api/notify/repair-status \
  -H 'Content-Type: application/json' \
  -H 'X-Notify-Secret: test' \
  -d '{"user_id":123,"order_number":"A023222","status":"diagnostics_ready","device_name":"Bosch GSR 180-LI","cost":1850,"comment":"Износ щёточного узла","dry_run":true}'
```

Production send verification:

- first send only to Anton/test MAX user_id;
- inspect actual MAX message rendering;
- verify button payload reaches webhook before enabling callbacks for real clients.

## Non-goals for first pass

- Not trying to get access to shared `@maxnotifications_bot`.
- Not sending by phone directly — public Bot API needs `user_id`/`chat_id`.
- Not replacing all LiveSklad notifications immediately.
- Not writing directly into LiveSklad from callbacks until status mapping is confirmed.
