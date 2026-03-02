---
paths: "api/**/*.py"
---

# LiveSklad API — Заказы

## Авторизация (двухэтапная)

```
POST https://api.livesklad.com/auth
Content-Type: application/x-www-form-urlencoded
Body: login=<LOGIN>&password=<PASSWORD>
→ { "token": "...", "ttl": 900 }
```

Токен живёт 15 минут. При 401 — автоматический refresh в `_get_token(force_refresh=True)`.

## Структура заказа (LiveSklad response)

```python
{
    "id": "69a58599def58969afa5e2d4",   # MongoDB ObjectId
    "number": "A023222",                  # Номер заказа (показывается клиенту)
    "device": "Karcher PUZZI 10/1",       # Строка, НЕ объект!
    "typeDevice": "Моющий Пылесос",       # Тип устройства
    "problem": ["описание проблемы"],     # Список строк
    "status": {
        "type": "new",                    # Код: new, inWork, ready, done, completed
        "name": "Новый",                  # Человекочитаемое имя
        "color": "#007efc"
    },
    "summ": {
        "price": 0,                       # Предварительная стоимость
        "soldPrice": 0                    # Итоговая стоимость
    },
    "dateCreate": "2026-03-02T12:42:01.408Z",
    "counteragent": {
        "name": "Имя клиента",
        "phones": ["+7..."]
    },
    "recommendation": "Комментарий мастера",  # Может быть null
    "typeOrder": { "name": "Ремонт" }         # Тип: Ремонт, Аренда, Выездной ремонт
}
```

## Gotchas

- **`device` — строка**, не объект с `.name`. Это отличие от документации
- **`summ` (два m)**, не `sum`. Содержит `price` и `soldPrice`
- **Нет lookup по номеру** — API даёт только постраничный список `/company/orders`
- **Фильтр по status не работает** — API игнорирует параметр, фильтровать на клиенте
- **Номера с префиксом**: `A` для ремонта. Поиск учитывает оба варианта (`A023222` и `023222`)
- **Токен в header**: `Authorization: <token>` (без Bearer!)

## Маппинг статусов

| LiveSklad type | LiveSklad name | → Код API | → Лейбл |
|---------------|---------------|-----------|----------|
| `new` | Новый | `received` | Принят |
| `inWork` | В работе | `in_progress` | В работе |
| — | Диагностика | `diagnosing` | На диагностике |
| — | Ожидает запчасти | `waiting_parts` | Ожидает запчасти |
| `ready` | Готов | `ready` | Готов к выдаче |
| `done`/`completed` | Выполнен | `completed` | Выполнен |
