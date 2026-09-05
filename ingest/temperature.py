"""Populate SILO climate baseline columns on `hex` — temperature/evap/solar/vp.

Two-tier caching:
  1. Daily NetCDFs from SILO S3 are downloaded to a tempdir (auto-deleted).
     Per-file peak ~420 MB.
  2. From each daily file we derive a small per-year, per-variable monthly
     grid over the AOI bbox and save it as `cache/raw/silo_monthly/<var>/
     <year>.<var>.monthly.npz` (~600 KB each, ~90 MB for 5 vars × 30 years).
  3. Final climatology + hex sampling reads the cached monthly files.

Skips the daily-download + monthly-aggregate step for any year whose monthly
cache already exists — so re-runs after `--force` or a fresh baseline window
are cheap.

Total one-time network transfer: 5 vars × 30 years × 420 MB ≈ 63 GB.
Peak transient disk: ~420 MB (one raw file at a time).
Persistent disk footprint: ~90 MB (per-year monthly caches).

Run:
    uv run python -m ingest.temperature                # all 5 variables
    uv run python -m ingest.temperature --var evap_pan # single variable
    uv run python -m ingest.temperature --from 2010 --to 2020  # smaller test
    uv run python -m ingest.temperature --force        # ignore monthly cache
"""

from __future__ import annotations

import argparse
import datetime as dt
import tempfile
import time
from pathlib import Path

import h3
import httpx
import numpy as np
import xarray as xr

from db.bootstrap import connect
from db.snapshot import snapshot
from ingest.cadastre import DATA_LOG

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MONTHLY_CACHE_DIR = PROJECT_ROOT / "cache" / "raw" / "silo_monthly"

S3_BASE = "https://s3-ap-southeast-2.amazonaws.com/silo-open-data/Official/annual"

DEFAULT_FROM = 1991
DEFAULT_TO = 2020

# For trend metrics we go back further to match rainfall's 1970+ trend window.
# The baseline uses 1991-2020 for consistency with WMO climatological norms.
TREND_FROM = 1970

SUMMER_MONTHS = (12, 1, 2)
WINTER_MONTHS = (6, 7, 8)

# Per-variable spec:
#   hex_col       — column that receives the 1991-2020 baseline value
#   agg           — aggregation function name (see _finalise_climatology)
#   description   — printed in the console header
#   trend_col     — column that receives the °C-per-decade slope (None to skip)
#
# Trend only added for max/min temp per the design discussion: evap/solar/vp
# trends are dominated by other signals (temp for evap+vp, cloud cover for
# solar) and add clutter without independent information.
_SPEC: dict[str, dict[str, object]] = {
    "max_temp": {
        "hex_col":     "summer_max_temp_c",
        "agg":         "mean_of_summer_max",
        "description": "daily max °C, mean of Dec-Feb",
        "trend_col":   "summer_max_trend_c_per_decade",
    },
    "min_temp": {
        "hex_col":     "winter_min_temp_c",
        "agg":         "mean_of_winter_min",
        "description": "daily min °C, mean of Jun-Aug",
        "trend_col":   "winter_min_trend_c_per_decade",
    },
    "evap_pan": {
        "hex_col":     "evap_annual_mm",
        "agg":         "annual_sum",
        "description": "annual pan evaporation mm",
        "trend_col":   None,
    },
    "radiation": {
        "hex_col":     "solar_annual_mj",
        "agg":         "annual_mean",
        "description": "mean daily radiation MJ/m²/day",
        "trend_col":   None,
    },
    "vp": {
        "hex_col":     "vp_annual_hpa",
        "agg":         "annual_mean",
        "description": "mean daily vapour pressure hPa",
        "trend_col":   None,
    },
}


def _log(line: str) -> None:
    with DATA_LOG.open("a") as f:
        f.write(line.rstrip() + "\n")


def hex_bbox(con, buffer_deg: float = 0.5) -> tuple[float, float, float, float]:
    hex_rows = con.execute("SELECT h3 FROM hex").fetchall()
    lats, lngs = [], []
    for (h,) in hex_rows:
        lat, lng = h3.cell_to_latlng(h)
        lats.append(lat)
        lngs.append(lng)
    return (
        min(lngs) - buffer_deg,
        min(lats) - buffer_deg,
        max(lngs) + buffer_deg,
        max(lats) + buffer_deg,
    )


def _download(var: str, year: int, dest: Path, retries: int = 3) -> None:
    """Stream one year's NetCDF into dest. Raises on failure after retries."""
    url = f"{S3_BASE}/{var}/{year}.{var}.nc"
    tmp = dest.with_suffix(".nc.tmp")
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with httpx.stream("GET", url, timeout=300.0, follow_redirects=True) as r:
                r.raise_for_status()
                total = int(r.headers.get("content-length", 0))
                with tmp.open("wb") as f:
                    downloaded = 0
                    for chunk in r.iter_bytes(chunk_size=1 << 20):
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total and downloaded % (100 << 20) < (1 << 20):
                            pct = 100 * downloaded / total
                            print(
                                f"    [{var} {year}] {downloaded / 1e6:6.0f} / "
                                f"{total / 1e6:6.0f} MB ({pct:3.0f}%)",
                                end="\r",
                            )
            tmp.replace(dest)
            print(f"    [{var} {year}] fetched {dest.stat().st_size / 1e6:.0f} MB           ")
            return
        except (httpx.HTTPError, OSError) as e:
            last_exc = e
            wait = 2**attempt
            print(f"    [{var} {year}] attempt {attempt} failed ({e!s}), retrying in {wait}s")
            time.sleep(wait)
    tmp.unlink(missing_ok=True)
    raise RuntimeError(f"Failed to download {var} {year} after {retries} tries: {last_exc}")


def _monthly_stats(
    da: xr.DataArray,
) -> tuple[np.ndarray, np.ndarray]:
    """Reduce (time, lat, lon) → (12, lat, lon) sums + counts by calendar month.

    Excludes NaN pixels from both sum and count so ocean cells stay NaN.
    """
    months = da["time"].dt.month.values
    lat_n, lon_n = da.sizes["lat"], da.sizes["lon"]
    sums = np.zeros((12, lat_n, lon_n), dtype=np.float64)
    counts = np.zeros((12, lat_n, lon_n), dtype=np.int32)
    vals = da.values  # (time, lat, lon)
    for m in range(1, 13):
        mask = months == m
        if not mask.any():
            continue
        slab = vals[mask]
        finite = np.isfinite(slab)
        # Sum only finite values; count only where finite.
        summed = np.where(finite, slab, 0.0).sum(axis=0)
        counted = finite.sum(axis=0)
        sums[m - 1] += summed
        counts[m - 1] += counted
    return sums, counts


def _finalise_climatology(
    sums: np.ndarray,
    counts: np.ndarray,
    agg: str,
) -> np.ndarray:
    """Given accumulated (12, lat, lon) sums+counts, produce a 2D (lat, lon) grid.

    Divide sums by counts to get monthly means, then apply the aggregation.
    """
    with np.errstate(invalid="ignore", divide="ignore"):
        monthly_mean = np.where(counts > 0, sums / counts, np.nan)  # (12, lat, lon)

    if agg == "mean_of_summer_max":
        idx = [m - 1 for m in SUMMER_MONTHS]
        return np.nanmean(monthly_mean[idx], axis=0)
    if agg == "mean_of_winter_min":
        idx = [m - 1 for m in WINTER_MONTHS]
        return np.nanmean(monthly_mean[idx], axis=0)
    if agg == "annual_sum":
        # SILO monthly-mean = mean daily value in that month. Annual total
        # = sum over months of (mean daily × days_in_month).
        days = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
        # broadcast (12,) × (12, lat, lon) → (12, lat, lon), sum over axis 0.
        return np.nansum(monthly_mean * days[:, None, None], axis=0)
    if agg == "annual_mean":
        return np.nanmean(monthly_mean, axis=0)
    raise ValueError(f"unknown agg: {agg!r}")


def _sample_per_hex(
    grid: np.ndarray,
    lats: np.ndarray,
    lons: np.ndarray,
    hex_ids: list[str],
) -> list[float | None]:
    """Nearest-neighbour lookup on (lat, lon) 2D grid for each hex centroid."""
    out: list[float | None] = []
    lat_n = len(lats)
    lon_n = len(lons)
    for h in hex_ids:
        hlat, hlng = h3.cell_to_latlng(h)
        # Nearest index: SILO lat is descending, lon ascending.
        i = int(np.argmin(np.abs(lats - hlat)))
        j = int(np.argmin(np.abs(lons - hlng)))
        if 0 <= i < lat_n and 0 <= j < lon_n:
            v = float(grid[i, j])
            out.append(None if not np.isfinite(v) else v)
        else:
            out.append(None)
    return out


def _monthly_cache_path(var: str, year: int) -> Path:
    return MONTHLY_CACHE_DIR / var / f"{year}.{var}.monthly.npz"


def _ensure_monthly_year(
    var: str,
    year: int,
    bbox: tuple[float, float, float, float],
    force: bool,
) -> Path:
    """Return path to a cached per-year monthly aggregate; download+aggregate if missing.

    The npz holds three arrays: `sums` (12, lat, lon), `counts` (12, lat, lon),
    `lats` (lat,), `lons` (lon,). Storing sums+counts (not means) lets us
    combine years by simple addition and defer the divide, so incomplete-month
    handling stays correct if a year later gains more data.
    """
    dest = _monthly_cache_path(var, year)
    if dest.exists() and not force:
        return dest

    dest.parent.mkdir(parents=True, exist_ok=True)
    min_lon, min_lat, max_lon, max_lat = bbox

    with tempfile.TemporaryDirectory(prefix="silo-") as tmpdir:
        raw = Path(tmpdir) / f"{year}.{var}.nc"
        _download(var, year, raw)
        ds = xr.open_dataset(str(raw))
        clipped = ds.sel(lat=slice(max_lat, min_lat), lon=slice(min_lon, max_lon))
        if clipped.sizes["lat"] == 0:
            clipped = ds.sel(lat=slice(min_lat, max_lat), lon=slice(min_lon, max_lon))
        da = clipped[var].load()
        ds.close()
        raw.unlink(missing_ok=True)

    sums, counts = _monthly_stats(da)
    np.savez_compressed(
        dest,
        sums=sums.astype(np.float32),
        counts=counts.astype(np.int32),
        lats=da["lat"].values.astype(np.float64),
        lons=da["lon"].values.astype(np.float64),
    )
    size_kb = dest.stat().st_size / 1024
    print(f"    [{var} {year}] monthly cache saved ({size_kb:.0f} KB)")
    return dest


def process_var(
    var: str,
    hex_col: str,
    agg: str,
    bbox: tuple[float, float, float, float],
    year_from: int,
    year_to: int,
    hex_ids: list[str],
    con,
    *,
    force: bool = False,
    trend_col: str | None = None,
) -> None:
    """Process one variable end-to-end.

    Always writes the baseline climatology (year_from..year_to) to `hex_col`.
    If `trend_col` is set, ALSO computes a per-hex linear slope over the
    TREND_FROM..year_to window in the aggregated seasonal value per year, and
    writes it as °C-per-decade to `trend_col`. Years outside the baseline
    window (e.g. 1970-1990 when baseline is 1991-2020) are used only for
    the trend series and do NOT contribute to the baseline climatology.
    """
    print(f"\n[temperature] === {var} → hex.{hex_col} ({agg}) ===")

    ref_lats: np.ndarray | None = None
    ref_lons: np.ndarray | None = None
    baseline_sums: np.ndarray | None = None
    baseline_counts: np.ndarray | None = None

    trend_start = TREND_FROM if trend_col else year_from
    trend_years: list[int] = []
    per_year_hex: list[np.ndarray] = []

    cached_years = 0
    fetched_years = 0
    for year in range(trend_start, year_to + 1):
        was_cached = _monthly_cache_path(var, year).exists() and not force
        path = _ensure_monthly_year(var, year, bbox, force=force)
        if was_cached:
            cached_years += 1
        else:
            fetched_years += 1

        with np.load(path) as f:
            y_sums = f["sums"].astype(np.float64)
            y_counts = f["counts"].astype(np.int32)
            lats = f["lats"]
            lons = f["lons"]

        if ref_lats is None:
            ref_lats, ref_lons = lats, lons
            baseline_sums = np.zeros_like(y_sums)
            baseline_counts = np.zeros_like(y_counts)
        else:
            if not (np.array_equal(lats, ref_lats) and np.array_equal(lons, ref_lons)):
                raise RuntimeError(f"{var} {year} monthly grid misaligned with prior years")

        # Baseline: only accumulate years inside the baseline window.
        if year_from <= year <= year_to:
            assert baseline_sums is not None and baseline_counts is not None
            baseline_sums += y_sums
            baseline_counts += y_counts

        # Trend: derive per-year aggregated value at each hex.
        if trend_col:
            year_grid = _finalise_climatology(y_sums, y_counts, agg)
            year_values = _sample_per_hex(year_grid, ref_lats, ref_lons, hex_ids)
            arr = np.array(
                [v if v is not None else np.nan for v in year_values],
                dtype=np.float64,
            )
            per_year_hex.append(arr)
            trend_years.append(year)

    print(
        f"[temperature] years processed: {fetched_years} fresh, {cached_years} from cache"
    )

    assert baseline_sums is not None and baseline_counts is not None
    assert ref_lats is not None and ref_lons is not None

    # --- Baseline write ---
    grid = _finalise_climatology(baseline_sums, baseline_counts, agg)
    print(
        f"[temperature] {hex_col}: min={np.nanmin(grid):.2f} "
        f"mean={np.nanmean(grid):.2f} max={np.nanmax(grid):.2f}"
    )
    values = _sample_per_hex(grid, ref_lats, ref_lons, hex_ids)
    n_valid = sum(1 for v in values if v is not None)
    print(f"[temperature] {n_valid:,}/{len(values):,} cells populated in {hex_col}")
    con.executemany(
        f"UPDATE hex SET {hex_col} = ? WHERE h3 = ?",
        [(v, h) for h, v in zip(hex_ids, values, strict=True)],
    )
    con.commit()

    # --- Trend write ---
    if trend_col and per_year_hex:
        ts = np.stack(per_year_hex, axis=0)          # (n_years, n_hex)
        years_arr = np.array(trend_years, dtype=np.float64)
        slopes = _linear_slope_per_column(years_arr, ts)   # (n_hex,)
        trend_per_decade = slopes * 10.0
        trend_values: list[float | None] = [
            None if not np.isfinite(v) else float(v) for v in trend_per_decade
        ]
        n_trend = sum(1 for v in trend_values if v is not None)
        if n_trend:
            finite = np.array([v for v in trend_values if v is not None])
            print(
                f"[temperature] {trend_col} (n={n_trend}/{len(trend_values)}, "
                f"{trend_years[0]}-{trend_years[-1]}): "
                f"min={finite.min():+.3f} mean={finite.mean():+.3f} "
                f"max={finite.max():+.3f} °C/decade"
            )
        con.executemany(
            f"UPDATE hex SET {trend_col} = ? WHERE h3 = ?",
            [(v, h) for h, v in zip(hex_ids, trend_values, strict=True)],
        )
        con.commit()

    today = dt.date.today().isoformat()
    _log(
        f"{today} | SILO | {var} | AOI | baseline {year_from}-{year_to}"
        f"{f', trend {trend_start}-{year_to}' if trend_col else ''} | "
        f"{n_valid}/{len(values)} in {hex_col}"
        f"{f', trend in {trend_col}' if trend_col else ''}"
    )
    # Publish per-variable so a long multi-var run makes each column visible
    # to the read snapshot as soon as it completes.
    snapshot()


def _linear_slope_per_column(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Vectorised per-column linear regression slope. y is (n_years, n_hex).

    NaN-safe: each column drops its NaN rows independently. Columns with
    fewer than 10 valid years return NaN — regression on that few years
    is dominated by noise.
    """
    n_years, n_hex = y.shape
    assert x.shape == (n_years,)
    x_col = x[:, None]
    valid = np.isfinite(y)
    counts = valid.sum(axis=0)

    x_masked = np.where(valid, x_col, np.nan)
    y_masked = np.where(valid, y, np.nan)
    x_mean = np.nanmean(x_masked, axis=0)
    y_mean = np.nanmean(y_masked, axis=0)
    dx = x_masked - x_mean
    dy = y_masked - y_mean
    num = np.nansum(dx * dy, axis=0)
    den = np.nansum(dx * dx, axis=0)

    with np.errstate(invalid="ignore", divide="ignore"):
        slope = np.where(den > 0, num / den, np.nan)
    slope = np.where(counts >= 10, slope, np.nan)
    return slope


def ingest(
    var_filter: str | None = None,
    year_from: int = DEFAULT_FROM,
    year_to: int = DEFAULT_TO,
    force: bool = False,
) -> None:
    con = connect()
    bbox = hex_bbox(con, buffer_deg=0.5)
    print(f"[temperature] AOI bbox: {bbox}")

    hex_ids = [h for (h,) in con.execute("SELECT h3 FROM hex").fetchall()]
    print(f"[temperature] {len(hex_ids):,} hex cells")

    vars_to_run = [var_filter] if var_filter else list(_SPEC.keys())
    for var in vars_to_run:
        spec = _SPEC[var]
        hex_col = str(spec["hex_col"])
        agg = str(spec["agg"])
        desc = str(spec["description"])
        trend_col = spec["trend_col"]  # str | None
        print(f"\n[temperature] {var}: {desc}")
        process_var(
            var,
            hex_col,
            agg,
            bbox,
            year_from,
            year_to,
            hex_ids,
            con,
            force=force,
            trend_col=trend_col if isinstance(trend_col, str) else None,
        )

    con.close()
    snapshot()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--var", choices=list(_SPEC.keys()), default=None)
    parser.add_argument("--from", dest="year_from", type=int, default=DEFAULT_FROM)
    parser.add_argument("--to", dest="year_to", type=int, default=DEFAULT_TO)
    parser.add_argument("--force", action="store_true", help="Re-download + re-aggregate even if monthly cache exists")
    args = parser.parse_args()
    ingest(
        var_filter=args.var,
        year_from=args.year_from,
        year_to=args.year_to,
        force=args.force,
    )
