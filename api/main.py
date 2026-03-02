"""MAX Mini App API — FastAPI backend.

Endpoints:
  GET  /order/{order_number}  → LiveSklad order status lookup
  POST /repair                → Repair request → Telegram notification
  GET  /health                → Health check
"""

import os
import logging

from dotenv import load_dotenv

load_dotenv(os.path.expanduser("~/.config/instrumentburg/api-keys.env"))

from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from livesklad_client import get_client
from max_auth import validate_init_data

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("max-api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    client = get_client()
    await client.close()


app = FastAPI(title="ИнструментБург MAX API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://instrumentburg.ru",
        "http://localhost:5180",
        "http://localhost:5173",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["X-Init-Data", "Content-Type"],
)


# ─── Models ───


class RepairRequest(BaseModel):
    instrument_type: str
    brand_model: str
    problem: str
    phone: str
    user_name: str | None = None
    max_user_id: int | None = None


class RepairResponse(BaseModel):
    success: bool
    order_number: str | None = None
    message: str


# ─── Endpoints ───


@app.get("/health")
async def health():
    return {"status": "ok", "service": "max-miniapp-api"}


@app.get("/order/{order_number}")
async def get_order_status(
    order_number: str,
    x_init_data: str = Header("", alias="X-Init-Data"),
):
    """Lookup order status in LiveSklad by order number."""
    client = get_client()

    try:
        order = await client.find_order(order_number)
    except Exception as e:
        logger.error("LiveSklad error: %s", e)
        raise HTTPException(status_code=502, detail="Не удалось связаться с системой заказов")

    if not order:
        raise HTTPException(status_code=404, detail="Заказ не найден")

    return client.format_order_status(order)


@app.post("/repair", response_model=RepairResponse)
async def submit_repair(
    data: RepairRequest,
    x_init_data: str = Header("", alias="X-Init-Data"),
):
    """Submit repair request — sends notification to Telegram business chat."""
    # Format message for Telegram
    lines = [
        "🔧 *Новая заявка на ремонт* (MAX Mini App)",
        "",
        f"*Тип:* {_escape_md(data.instrument_type)}",
        f"*Марка/модель:* {_escape_md(data.brand_model)}",
        f"*Проблема:* {_escape_md(data.problem)}",
        f"*Телефон:* {_escape_md(data.phone)}",
    ]

    if data.user_name:
        lines.append(f"*Имя (MAX):* {_escape_md(data.user_name)}")
    if data.max_user_id:
        lines.append(f"*MAX ID:* {data.max_user_id}")

    message = "\n".join(lines)

    # Send to Telegram
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_IB_TASKS_CHAT_ID")

    if not bot_token or not chat_id:
        logger.error("Telegram credentials not configured")
        raise HTTPException(status_code=500, detail="Уведомление не настроено")

    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={
                    "chat_id": chat_id,
                    "text": message,
                    "parse_mode": "Markdown",
                },
            )

            if resp.status_code != 200:
                logger.error("Telegram API error: %s %s", resp.status_code, resp.text)
                return RepairResponse(
                    success=False,
                    message="Не удалось отправить заявку. Позвоните: +7 (343) 226-44-43",
                )

    except Exception as e:
        logger.error("Telegram send error: %s", e)
        return RepairResponse(
            success=False,
            message="Не удалось отправить заявку. Позвоните: +7 (343) 226-44-43",
        )

    return RepairResponse(
        success=True,
        message="Заявка отправлена! Мы свяжемся с вами в ближайшее время.",
    )


# ─── Helpers ───


def _escape_md(text: str) -> str:
    """Escape special Markdown characters for Telegram."""
    for ch in ("_", "*", "`", "["):
        text = text.replace(ch, f"\\{ch}")
    return text


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8100)
