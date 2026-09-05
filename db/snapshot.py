"""Publish a read-only snapshot of the primary DuckDB for the API/UI.

DuckDB takes an exclusive file lock — any process (even read-only) blocks
writes. Workflow:
  - Ingest modules write to `db/land.duckdb` (the primary).
  - This module opens the primary, forces a CHECKPOINT to drain the WAL
    into the main file, closes, then copies primary → `db/land_read.duckdb`
    atomically (temp file + rename). Consumers never see a half-written file.
  - The API opens `land_read.duckdb` read-only per request.
  - Every ingest module calls `snapshot()` after each variable's write, so
    long multi-var runs publish incrementally.

**Why CHECKPOINT matters.** DuckDB buffers writes to `land.duckdb.wal` and
only merges them into the main `.duckdb` file on checkpoint (which normally
happens at connection close or when the WAL grows past a threshold). If we
just copy the main file we can lose everything since the last checkpoint.
Before the fix, that produced missing columns in the snapshot even when
the ingest had clearly written them.

Idempotent. Safe to call while another process is reading the snapshot —
`os.replace` on the same filesystem is atomic on POSIX.

Run standalone:
    uv run python -m db.snapshot
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

import duckdb

DB_DIR = Path(__file__).parent
PRIMARY = DB_DIR / "land.duckdb"
READ = DB_DIR / "land_read.duckdb"


def snapshot() -> None:
    if not PRIMARY.exists():
        raise FileNotFoundError(f"Primary DB not found: {PRIMARY}")

    # Force a checkpoint so land.duckdb.wal is merged into land.duckdb before
    # we copy. Opening then closing does an implicit checkpoint on shutdown,
    # but we run an explicit CHECKPOINT to be certain — it's cheap and it
    # makes the intent obvious to a reader.
    con = duckdb.connect(str(PRIMARY))
    try:
        con.execute("CHECKPOINT")
    finally:
        con.close()

    tmp = READ.with_suffix(".duckdb.tmp")
    shutil.copy2(PRIMARY, tmp)
    os.replace(tmp, READ)   # atomic on POSIX
    size_mb = READ.stat().st_size / 1024 / 1024
    print(f"[snapshot] Published {READ.name} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    snapshot()
