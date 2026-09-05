"""Read-only DuckDB helpers for the API.

Mirrors the Streamlit approach: open a fresh connection per request so the
API picks up atomically-swapped snapshots (see db/snapshot.py) without
restart. ~10 ms per connect is fine at this DB size.
"""

from __future__ import annotations

from pathlib import Path

import duckdb

PROJECT_ROOT = Path(__file__).resolve().parents[1]
READ_DB = PROJECT_ROOT / "db" / "land_read.duckdb"


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
