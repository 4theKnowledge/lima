"""Project settings loaded from .env at the project root.

Fail loudly if a required secret is missing rather than silently making
unauthenticated requests.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")


def _require(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"{name} is not set. Copy .env.example to .env and fill in your SLIP credentials."
        )
    return value


def slip_auth() -> tuple[str, str]:
    """Return (username, password) for SLIP HTTP Basic Auth."""
    return _require("SLIP_USER"), _require("SLIP_PASS")
