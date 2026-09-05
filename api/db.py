"""Read-only DuckDB helpers for the API.

Mirrors the Streamlit approach: open a fresh connection per request so the
API picks up atomically-swapped snapshots (see db/snapshot.py) without
restart. ~10 ms per connect is fine at this DB size.
"""

from __future__ import annotations

from pathlib import Path

import duckdb

PROJECT_ROOT = Path(__file__).resolve().parents[1]
# In production the snapshot is downloaded from SNAPSHOT_URL to /tmp at
# startup (see api/main.py lifespan). Locally it lives in db/ from the
# ingest pipeline. SNAPSHOT_LOCAL_PATH lets tests override.
_LOCAL_DEFAULT = PROJECT_ROOT / "db" / "land_read.duckdb"
_PROD_PATH = Path("/tmp/land_read.duckdb")
READ_DB = _PROD_PATH if _PROD_PATH.exists() else _LOCAL_DEFAULT


def connect() -> duckdb.DuckDBPyConnection:
    if not READ_DB.exists():
        raise FileNotFoundError(
            f"Read snapshot missing: {READ_DB}. Run `uv run python -m db.snapshot` "
            "after any ingest, or run an ingest module (they publish automatically)."
        )
    con = duckdb.connect(str(READ_DB), read_only=True)
    con.execute("LOAD spatial;")
    con.execute("LOAD h3;")
    return con


def snapshot_mtime() -> float:
    return READ_DB.stat().st_mtime if READ_DB.exists() else 0.0
