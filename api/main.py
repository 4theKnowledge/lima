"""FastAPI entrypoint.

Run:
    uv run uvicorn api.main:app --reload --port 8010

Port 8010 chosen because 8000 is commonly occupied by unrelated services
on this dev machine. In production, uvicorn binds $PORT (Railway injects it).

Env vars:
    CORS_ORIGINS   Comma-separated extra origins to whitelist (e.g. the
                   deployed frontend domain). localhost dev origins are
                   always included.
    APP_PASSCODE   If set, every request except /health must include an
                   X-Passcode header matching this value. Unset = open.
"""

from __future__ import annotations

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from api.routes import router

_DEV_ORIGINS = [
    "http://localhost:5183",
    "http://127.0.0.1:5183",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
_extra_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
_PASSCODE = os.getenv("APP_PASSCODE", "").strip()

app = FastAPI(
    title="Lima API",
    version="0.1.0",
    description="Thin HTTP layer over the DuckDB snapshot. Read-only except for "
    "weight/exclusion updates, which trigger a re-score.",
)

app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_DEV_ORIGINS + _extra_origins,
    allow_methods=["GET", "PUT", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def passcode_gate(request: Request, call_next):
    # /health is unauthenticated so Railway's healthcheck can hit it without
    # knowing the passcode. CORS preflights must also pass through.
    if not _PASSCODE or request.method == "OPTIONS" or request.url.path == "/health":
        return await call_next(request)
    if request.headers.get("x-passcode", "") != _PASSCODE:
        return JSONResponse({"detail": "invalid passcode"}, status_code=401)
    return await call_next(request)


app.include_router(router)
