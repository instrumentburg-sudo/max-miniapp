"""MAX initData validation.

MAX Bridge sends initData as a query string with a hash parameter.
Server validates the hash using the bot token as HMAC key.
Spec: https://dev.max.ru/docs/init-data
"""

import hashlib
import hmac
import os
import urllib.parse
from dataclasses import dataclass
from typing import Optional


@dataclass
class MaxUser:
    id: int
    first_name: str
    last_name: Optional[str] = None
    username: Optional[str] = None


def validate_init_data(init_data: str, bot_token: Optional[str] = None) -> Optional[MaxUser]:
    """Validate MAX initData and return user if valid.

    Args:
        init_data: Raw initData string from X-Init-Data header
        bot_token: MAX bot token for HMAC validation

    Returns:
        MaxUser if valid, None if invalid or missing
    """
    if not init_data:
        return None

    bot_token = bot_token or os.getenv("MAX_BOT_TOKEN")

    # In development mode, skip validation if no token
    if not bot_token:
        # Try to parse user from initData without validation
        return _parse_user_unsafe(init_data)

    try:
        params = dict(urllib.parse.parse_qsl(init_data, keep_blank_values=True))
    except Exception:
        return None

    received_hash = params.pop("hash", None)
    if not received_hash:
        return None

    # Build check string: sorted key=value pairs joined with \n
    check_pairs = sorted(params.items())
    check_string = "\n".join(f"{k}={v}" for k, v in check_pairs)

    # HMAC-SHA256(secret_key, check_string)
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    computed_hash = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(computed_hash, received_hash):
        return None

    return _parse_user_unsafe(init_data)


def _parse_user_unsafe(init_data: str) -> Optional[MaxUser]:
    """Parse user from initData without hash validation."""
    import json

    try:
        params = dict(urllib.parse.parse_qsl(init_data, keep_blank_values=True))
        user_json = params.get("user")
        if not user_json:
            return None
        user_data = json.loads(user_json)
        return MaxUser(
            id=user_data.get("id", 0),
            first_name=user_data.get("first_name", ""),
            last_name=user_data.get("last_name"),
            username=user_data.get("username"),
        )
    except (json.JSONDecodeError, KeyError, TypeError):
        return None
