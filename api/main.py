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

    Bucket-linked S3 vars (auto-provided by Railway when a bucket is linked
    to this service). All four must be present to trigger snapshot download
    from the bucket:
        AWS_ENDPOINT_URL         e.g. https://storage.railway.app
        AWS_ACCESS_KEY_ID
        AWS_SECRET_ACCESS_KEY
        AWS_S3_BUCKET_NAME       Railway-assigned bucket ID (not friendly name)
    Optional:
        SNAPSHOT_KEY             Object key in the bucket. Default: "land_read.duckdb"
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from api.routes import router


@asynccontextmanager
async def lifespan(_: FastAPI):
    dest = Path("/tmp/land_read.duckdb")
    if dest.exists():
        yield
        return

    required = ["AWS_ENDPOINT_URL", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_S3_BUCKET_NAME"]
    if not all(os.getenv(v) for v in required):
        # No bucket credentials — assume local dev where the snapshot lives
        # under db/land_read.duckdb (api/db.py handles that path fallback).
        yield
        return

    import boto3

    bucket = os.environ["AWS_S3_BUCKET_NAME"]
    key = os.getenv("SNAPSHOT_KEY", "land_read.duckdb")
    print(f"[startup] downloading s3://{bucket}/{key}", flush=True)

    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ["AWS_ENDPOINT_URL"],
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    )
    tmp = dest.with_suffix(".tmp")
    s3.download_file(bucket, key, str(tmp))
    tmp.rename(dest)
    print(f"[startup] snapshot ready at {dest} ({dest.stat().st_size} bytes)", flush=True)
    yield

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
    lifespan=lifespan,
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
