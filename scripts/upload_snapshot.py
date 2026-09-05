"""Upload db/land_read.duckdb to the Railway bucket + restart the api service.

Requires:
  - You've already run: railway link  (pick the api service)
  - boto3 (already in pyproject.toml deps)

Usage:
    uv run python -m scripts.upload_snapshot

Steps:
  1. Fetches fresh S3 credentials for the bucket via `railway bucket credentials`
  2. Uploads db/land_read.duckdb to the key that api's SNAPSHOT_KEY points at
  3. Optionally triggers an api redeploy so the container downloads the new
     snapshot (skip with --no-redeploy if you'll do that separately)
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import boto3

REPO_ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = REPO_ROOT / "db" / "land_read.duckdb"
BUCKET_NAME_CLI = "reserved-packet"
DEFAULT_KEY = "db/land_read.duckdb"


def _railway_bucket_creds() -> dict[str, str]:
    """Shell out to `railway bucket credentials` and parse AWS_* lines."""
    result = subprocess.run(
        ["railway", "bucket", "credentials", "--bucket", BUCKET_NAME_CLI],
        check=True,
        capture_output=True,
        text=True,
    )
    out: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if not line.startswith("AWS_"):
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip()
    required = ["AWS_ENDPOINT_URL", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_S3_BUCKET_NAME"]
    missing = [k for k in required if k not in out]
    if missing:
        sys.exit(f"Bucket credentials missing keys: {missing}")
    return out


def _redeploy_api() -> None:
    """Trigger a redeploy on the currently-linked service (should be api)."""
    subprocess.run(["railway", "redeploy", "--yes"], check=True)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--key", default=DEFAULT_KEY, help=f"Object key in bucket (default: {DEFAULT_KEY})")
    p.add_argument("--no-redeploy", action="store_true", help="Skip triggering api redeploy after upload")
    args = p.parse_args()

    if not SNAPSHOT_PATH.exists():
        sys.exit(f"Snapshot not found at {SNAPSHOT_PATH}. Run ingest first.")

    size_mb = SNAPSHOT_PATH.stat().st_size / (1024 * 1024)
    print(f"Uploading {SNAPSHOT_PATH.name} ({size_mb:.0f} MB) → s3://.../{args.key}")

    creds = _railway_bucket_creds()
    s3 = boto3.client(
        "s3",
        endpoint_url=creds["AWS_ENDPOINT_URL"],
        aws_access_key_id=creds["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=creds["AWS_SECRET_ACCESS_KEY"],
    )
    s3.upload_file(str(SNAPSHOT_PATH), creds["AWS_S3_BUCKET_NAME"], args.key)
    print("Upload complete.")

    if args.no_redeploy:
        print("Skipping redeploy. Restart the api container manually to pick up the new snapshot.")
        return

    print("Triggering api redeploy so the container downloads the new snapshot...")
    _redeploy_api()
    print("Done. New container will download the snapshot on startup (~20s).")


if __name__ == "__main__":
    main()
