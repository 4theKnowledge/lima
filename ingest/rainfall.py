"""Populate rainfall fields on `hex` from SILO monthly_rain NetCDFs.

For each hex cell, compute:
  - hex.gsr_mean_mm   — mean growing-season (May-Oct) rainfall, 1991-2020 baseline (mm)
  - hex.gsr_trend      — linear trend in growing-season rainfall since 1970 (mm/decade)

Method per BUILD_BRIEF.md §6:
  Level uses the WMO 30-year climatological baseline (1991-2020).
  Trend uses a linear regression from 1970 to the most recent full year,
  reporting slope in mm/decade. Negative = drying, which is the dominant
  signal in the region since the late 1960s.

Assumes rainfall NetCDFs are already present in cache/raw/rainfall/, one
per year, named `<year>.monthly_rain.nc`. Fetch them with:
    uv run python -m ingest.rainfall_download

Run:
    uv run python -m ingest.rainfall
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import h3
import numpy as np
import xarray as xr

from db.bootstrap import connect
from db.snapshot import snapshot
from ingest.cadastre import DATA_LOG

PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAIN_DIR = PROJECT_ROOT / "cache" / "raw" / "rainfall"

BASELINE_START = 1991
BASELINE_END = 2020
TREND_START = 1970
GROWING_SEASON_MONTHS = (5, 6, 7, 8, 9, 10)   # May-Oct


def _log(line: str) -> None:
    with DATA_LOG.open("a") as f:
        f.write(line.rstrip() + "\n")


def load_annual_growing_season(bbox: tuple[float, float, float, float]) -> xr.DataArray:
    """Read all yearly NetCDFs, clip to bbox, sum May-Oct → (year, lat, lon).

    bbox is (min_lon, min_lat, max_lon, max_lat).
    """
    files = sorted(RAIN_DIR.glob("*.monthly_rain.nc"))
    if not files:
        raise FileNotFoundError(
            f"No rainfall NetCDFs in {RAIN_DIR}. Run `uv run python -m ingest.rainfall_download` first."
        )
    print(f"[rainfall] Opening {len(files)} annual NetCDFs (clip then concat)")

    # Open each file, clip to bbox, then concat. Avoids the dask requirement
    # of open_mfdataset() and keeps memory tiny — 55 files × 12 months × 40×40
    # is ~1 MB total after clip.
    min_lon, min_lat, max_lon, max_lat = bbox
    yearly = []
    for f in files:
        ds_i = xr.open_dataset(str(f))
        clipped = ds_i.sel(lat=slice(max_lat, min_lat), lon=slice(min_lon, max_lon))
        if clipped.sizes["lat"] == 0:
            clipped = ds_i.sel(lat=slice(min_lat, max_lat), lon=slice(min_lon, max_lon))
        yearly.append(clipped.load())
        ds_i.close()
    ds = xr.concat(yearly, dim="time")
    print(f"[rainfall] Clipped grid: {dict(ds.sizes)}")

    rain = ds["monthly_rain"]
    # Filter to growing-season months (May-Oct), sum per calendar year.
    is_growing = rain["time"].dt.month.isin(list(GROWING_SEASON_MONTHS))
    growing = rain.where(is_growing, drop=True)
    annual_gsr = growing.groupby("time.year").sum(dim="time", skipna=False)
    print(
        f"[rainfall] Annual growing-season rainfall: "
        f"years {int(annual_gsr.year.min())}..{int(annual_gsr.year.max())}, "
        f"grid {annual_gsr.sizes['lat']}×{annual_gsr.sizes['lon']}"
    )
    return annual_gsr


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


def _sample_series(annual_gsr: xr.DataArray, lat: float, lng: float) -> np.ndarray:
    """Nearest-neighbour extraction of the annual GSR time series at one point."""
    return annual_gsr.sel(lat=lat, lon=lng, method="nearest").values


def _compute_metrics(series: np.ndarray, years: np.ndarray) -> tuple[float | None, float | None]:
    """
    Returns (gsr_mean_mm, gsr_trend_mm_per_decade).

    gsr_mean_mm: mean over 1991-2020 window (NaNs dropped).
    gsr_trend:   linear slope over TREND_START..latest, converted to mm/decade.
                 None if <10 non-NaN years (untrustable regression).
    """
    baseline_mask = (years >= BASELINE_START) & (years <= BASELINE_END)
    baseline = series[baseline_mask]
    baseline_valid = baseline[~np.isnan(baseline)]
    gsr_mean = float(np.mean(baseline_valid)) if len(baseline_valid) else None

    trend_mask = years >= TREND_START
    trend_y = series[trend_mask]
    trend_x = years[trend_mask].astype(float)
    valid = ~np.isnan(trend_y)
    if valid.sum() < 10:
        gsr_trend = None
    else:
        # Slope in mm/year via least-squares.
        slope, _ = np.polyfit(trend_x[valid], trend_y[valid], 1)
        gsr_trend = float(slope * 10.0)   # mm/decade

    return gsr_mean, gsr_trend


def ingest() -> None:
    con = connect()

    bbox = hex_bbox(con, buffer_deg=0.5)
    print(f"[rainfall] AOI bbox: {bbox}")

    annual_gsr = load_annual_growing_season(bbox)
    years = annual_gsr["year"].values.astype(int)

    hex_rows = con.execute("SELECT h3 FROM hex").fetchall()
    print(f"[rainfall] Sampling {len(hex_rows):,} cells")

    updates: list[tuple] = []
    n_mean_ok = 0
    n_trend_ok = 0
    for (h,) in hex_rows:
        lat, lng = h3.cell_to_latlng(h)
        series = _sample_series(annual_gsr, lat, lng)
        mean_mm, trend = _compute_metrics(series, years)
        updates.append((mean_mm, trend, h))
        if mean_mm is not None:
            n_mean_ok += 1
        if trend is not None:
            n_trend_ok += 1

    con.executemany(
        "UPDATE hex SET gsr_mean_mm = ?, gsr_trend = ? WHERE h3 = ?",
        updates,
    )
    con.commit()

    print(f"[rainfall] Cells with valid gsr_mean_mm: {n_mean_ok}/{len(hex_rows)}")
    print(f"[rainfall] Cells with valid gsr_trend:   {n_trend_ok}/{len(hex_rows)}")

    stats = con.execute(
        """
        SELECT
            MIN(gsr_mean_mm), AVG(gsr_mean_mm), MAX(gsr_mean_mm),
            MIN(gsr_trend),   AVG(gsr_trend),   MAX(gsr_trend)
        FROM hex WHERE gsr_mean_mm IS NOT NULL
        """
    ).fetchone()
    if stats[0] is not None:
        print(
            f"[rainfall] gsr_mean_mm (1991-2020 May-Oct baseline): "
            f"min={stats[0]:.0f} mean={stats[1]:.0f} max={stats[2]:.0f} mm"
        )
        print(
            f"[rainfall] gsr_trend (since {TREND_START}, mm/decade): "
            f"min={stats[3]:+.1f} mean={stats[4]:+.1f} max={stats[5]:+.1f}"
        )
    con.close()

    today = dt.date.today().isoformat()
    _log(
        f"{today} | SILO | rainfall | AOI | monthly_rain 1970-{years.max()} | "
        f"{n_mean_ok}/{len(hex_rows)} cells with baseline, {n_trend_ok} with trend"
    )
    snapshot()


if __name__ == "__main__":
    ingest()
