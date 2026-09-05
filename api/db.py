"""Read-only DuckDB helpers for the API.

Mirrors the Streamlit approach: open a fresh connection per request so the
API picks up atomically-swapped snapshots (see db/snapshot.py) without
restart. ~10 ms per connect is fine at this DB size.
"""

from __future__ import annotations

from pathlib import Path

import duckdb

PROJECT_ROOT = Path(__file__).resolve().parents[1]
# In production the snapshot is downloaded to /tmp at container startup (see
# api/main.py lifespan). Locally it lives in db/ from the ingest pipeline.
# Resolve per-call, not at import time — the /tmp file doesn't exist yet
# when this module is first imported.
_LOCAL_DEFAULT = PROJECT_ROOT / "db" / "land_read.duckdb"
_PROD_PATH = Path("/tmp/land_read.duckdb")


def _read_db() -> Path:
    return _PROD_PATH if _PROD_PATH.exists() else _LOCAL_DEFAULT


def connect() -> duckdb.DuckDBPyConnection:
    db = _read_db()
    if not db.exists():
        raise FileNotFoundError(
            f"Read snapshot missing: {db}. Run `uv run python -m db.snapshot` "
            "after any ingest, or run an ingest module (they publish automatically)."
        )
    con = duckdb.connect(str(db), read_only=True)
    con.execute("LOAD spatial;")
    con.execute("LOAD h3;")
    return con


def snapshot_mtime() -> float:
    db = _read_db()
    return db.stat().st_mtime if db.exists() else 0.0
