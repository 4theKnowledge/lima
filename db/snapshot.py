"""Publish a read-only snapshot of the primary DuckDB for Streamlit.

DuckDB takes an exclusive file lock — any process (even read-only) blocks
writes. Workflow:
  - Ingest modules write to `db/land.duckdb` (the primary).
  - This module copies primary → `db/land_read.duckdb` atomically (temp file
    + rename), so Streamlit never sees a half-written file.
  - Streamlit's `_connect` opens `land_read.duckdb` read-only.
  - Every ingest module calls `snapshot()` at the end to publish updates.

Idempotent. Safe to call while another process is reading the snapshot —
`os.replace` on the same filesystem is atomic on POSIX.

Run standalone:
    uv run python -m db.snapshot
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

DB_DIR = Path(__file__).parent
PRIMARY = DB_DIR / "land.duckdb"
READ = DB_DIR / "land_read.duckdb"


def snapshot() -> None:
    if not PRIMARY.exists():
        raise FileNotFoundError(f"Primary DB not found: {PRIMARY}")
    tmp = READ.with_suffix(".duckdb.tmp")
    shutil.copy2(PRIMARY, tmp)
    os.replace(tmp, READ)   # atomic on POSIX
    size_mb = READ.stat().st_size / 1024 / 1024
    print(f"[snapshot] Published {READ.name} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    snapshot()
