"""Async LiveSklad client for MAX mini-app API.

Adapted from 05-automations/onboarding-bot/services/livesklad.py
Uses httpx.AsyncClient for FastAPI compatibility.
"""

import os
import logging
from datetime import datetime
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Status mapping: LiveSklad status → user-friendly label + code
STATUS_MAP: dict[str, tuple[str, str]] = {
    # type-based
    "new": ("Принят", "received"),
    "inwork": ("В работе", "in_progress"),
    "inWork": ("В работе", "in_progress"),
    "ready": ("Готов к выдаче", "ready"),
    "done": ("Выполнен", "completed"),
    "completed": ("Выполнен", "completed"),
    "closed": ("Выполнен", "completed"),
    # name-based fallbacks
    "принят": ("Принят", "received"),
    "в работе": ("В работе", "in_progress"),
    "диагностика": ("На диагностике", "diagnosing"),
    "ожидает запчасти": ("Ожидает запчасти", "waiting_parts"),
    "ожидание запчастей": ("Ожидает запчасти", "waiting_parts"),
    "готов": ("Готов к выдаче", "ready"),
    "готов к выдаче": ("Готов к выдаче", "ready"),
    "выполнен": ("Выполнен", "completed"),
    "выдан": ("Выполнен", "completed"),
}


class AsyncLiveskladClient:
    """Async HTTP client for LiveSklad REST API."""

    BASE_URL = "https://api.livesklad.com"

    def __init__(self) -> None:
        self.login = os.getenv("LIVESKLAD_LOGIN")
        self.password = os.getenv("LIVESKLAD_PASSWORD")
        self._token: Optional[str] = None
        self._client = httpx.AsyncClient(timeout=30.0)

    async def _get_token(self, force_refresh: bool = False) -> str:
        if self._token and not force_refresh:
            return self._token

        if not self.login or not self.password:
            raise ValueError("LIVESKLAD_LOGIN and LIVESKLAD_PASSWORD not configured")

        response = await self._client.post(
            f"{self.BASE_URL}/auth",
            data={"login": self.login, "password": self.password},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        response.raise_for_status()
        data = response.json()

        if not data.get("token"):
            raise ValueError("No token in auth response")

        self._token = data["token"]
        logger.info("LiveSklad: token obtained, ttl=%ss", data.get("ttl", "?"))
        return self._token

    async def find_order(self, order_number: str) -> Optional[dict]:
        """Find order by number (id or custom number field).

        Searches through recent orders to match by order number.
        LiveSklad doesn't have a direct lookup-by-number endpoint.
        """
        token = await self._get_token()

        # Search up to 5 pages (250 orders)
        for page in range(1, 6):
            response = await self._client.get(
                f"{self.BASE_URL}/company/orders",
                params={"pageSize": 50, "page": page},
                headers={"Authorization": token},
            )

            if response.status_code == 401:
                token = await self._get_token(force_refresh=True)
                response = await self._client.get(
                    f"{self.BASE_URL}/company/orders",
                    params={"pageSize": 50, "page": page},
                    headers={"Authorization": token},
                )

            response.raise_for_status()
            data = response.json()
            orders = data.get("data", data.get("orders", []))

            if not orders:
                break

            for order in orders:
                # LiveSklad fields: number="A023222", id="69a58599..."
                order_num = str(order.get("number", "")).upper()

                # Clean the search input: strip, uppercase, remove # prefix
                search = order_number.strip().upper().lstrip("#")

                if search == order_num or search == order_num.lstrip("A"):
                    return order

            if len(orders) < 50:
                break

        return None

    def format_order_status(self, order: dict) -> dict:
        """Convert LiveSklad order to API response format."""
        # Status
        status_obj = order.get("status", {})
        status_type = status_obj.get("type", "").lower()
        status_name = status_obj.get("name", "").lower()

        # Lookup status
        mapped = STATUS_MAP.get(status_type) or STATUS_MAP.get(status_name)
        if not mapped:
            status_label = status_obj.get("name", "Неизвестно")
            status_code = "received"
        else:
            status_label, status_code = mapped

        # Device name — in LiveSklad it's a plain string field
        device_name = order.get("device", "")
        if not device_name:
            # Fallback to typeDevice
            device_name = order.get("typeDevice", "Не указано")

        # Date
        date_received = order.get("dateCreate", "")
        if date_received:
            try:
                dt = datetime.fromisoformat(date_received.replace("Z", "+00:00"))
                date_received = dt.strftime("%d.%m.%Y")
            except (ValueError, AttributeError):
                pass

        # Cost — LiveSklad uses summ.price and summ.soldPrice
        estimated_cost: Optional[float] = None
        summ = order.get("summ", {})
        sold_price = summ.get("soldPrice", 0) if isinstance(summ, dict) else 0
        price = summ.get("price", 0) if isinstance(summ, dict) else 0
        total = sold_price or price
        if total and float(total) > 0:
            estimated_cost = float(total)

        # Master comment / recommendation
        master_comment = order.get("recommendation") or order.get("masterComment")

        # Order number for display
        order_number = str(order.get("number", order.get("id", "")))

        return {
            "order_number": order_number,
            "status": status_code,
            "status_label": status_label,
            "date_received": date_received,
            "device_name": device_name,
            "estimated_cost": estimated_cost,
            "master_comment": master_comment,
        }

    async def close(self) -> None:
        await self._client.aclose()


# Singleton
_client: Optional[AsyncLiveskladClient] = None


def get_client() -> AsyncLiveskladClient:
    global _client
    if _client is None:
        _client = AsyncLiveskladClient()
    return _client
