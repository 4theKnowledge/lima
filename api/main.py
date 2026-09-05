"""FastAPI entrypoint.

Run:
    uv run uvicorn api.main:app --reload --port 8010

Port 8010 chosen because 8000 is commonly occupied by unrelated services
on this dev machine. The React dev server is expected on http://localhost:5173
(Vite default); CORS is configured for that origin only. Production deploy
should tighten this to whatever origin serves the built frontend.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from api.routes import router

app = FastAPI(
    title="SWWA Land Screener API",
    version="0.1.0",
    description="Thin HTTP layer over the DuckDB snapshot. Read-only except for "
    "weight/exclusion updates, which trigger a re-score.",
)

app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5183",
        "http://127.0.0.1:5183",
        # Kept for anyone running Vite on its default port when it's free.
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["GET", "PUT", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(router)
