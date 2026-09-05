"""Download SILO monthly rainfall NetCDFs to cache/raw/rainfall/.

SILO gridded data is public and on S3 with direct HTTPS access — no AWS CLI
or credentials needed. We fetch monthly_rain (14 MB/year) rather than daily
because we only need May-Oct totals per year, and monthly is already an
official SILO aggregation.

Skips files that already exist unless --force. Retries transient failures.

Run:
    uv run python -m ingest.rainfall_download                    # 1970..2020 (baseline + trend)
    uv run python -m ingest.rainfall_download --from 1970 --to 2025
    uv run python -m ingest.rainfall_download --force            # re-download everything
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import httpx

PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAIN_DIR = PROJECT_ROOT / "cache" / "raw" / "rainfall"
S3_BASE = "https://s3-ap-southeast-2.amazonaws.com/silo-open-data/Official/annual/monthly_rain"

# Years for a 1970-2025 window (spans §6's 1991-2020 baseline + 1970-onwards trend).
DEFAULT_FROM = 1970
DEFAULT_TO = 2025


def _url(year: int) -> str:
    return f"{S3_BASE}/{year}.monthly_rain.nc"


def _local_path(year: int) -> Path:
    return RAIN_DIR / f"{year}.monthly_rain.nc"


def download_year(year: int, *, force: bool = False, retries: int = 3) -> bool:
    """Fetch one year's NetCDF. Returns True if downloaded, False if skipped."""
    dest = _local_path(year)
    if dest.exists() and not force:
        print(f"[rainfall] {dest.name} already present, skipping")
        return False

    tmp = dest.with_suffix(".nc.tmp")
    url = _url(year)
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with httpx.stream("GET", url, timeout=120.0, follow_redirects=True) as r:
                r.raise_for_status()
                total = int(r.headers.get("content-length", 0))
                with tmp.open("wb") as f:
                    downloaded = 0
                    for chunk in r.iter_bytes(chunk_size=1 << 20):   # 1 MB chunks
                        f.write(chunk)
                        downloaded += len(chunk)
                        # sparse progress so 51 years don't spam
                        if total and downloaded % (5 << 20) < (1 << 20):
                            print(f"    [{year}] {downloaded/1e6:5.1f} / {total/1e6:5.1f} MB", end="\r")
            tmp.replace(dest)
            size_mb = dest.stat().st_size / 1e6
            print(f"[rainfall] {dest.name} downloaded ({size_mb:.1f} MB)     ")
            return True
        except (httpx.HTTPError, OSError) as e:
            last_exc = e
            wait = 2 ** attempt
            print(f"[rainfall] {year} attempt {attempt} failed ({e!s}), retrying in {wait}s")
            time.sleep(wait)
    tmp.unlink(missing_ok=True)
    raise RuntimeError(f"Failed to download {year} after {retries} tries: {last_exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="year_from", type=int, default=DEFAULT_FROM)
    parser.add_argument("--to", dest="year_to", type=int, default=DEFAULT_TO)
    parser.add_argument("--force", action="store_true", help="Re-download even if present")
    args = parser.parse_args()

    RAIN_DIR.mkdir(parents=True, exist_ok=True)
    years = list(range(args.year_from, args.year_to + 1))
    print(f"[rainfall] Fetching monthly_rain for {years[0]}..{years[-1]} ({len(years)} files)")
    n_new = 0
    for year in years:
        if download_year(year, force=args.force):
            n_new += 1
    print(f"[rainfall] Done. {n_new} new, {len(years)-n_new} already present.")


if __name__ == "__main__":
    main()
