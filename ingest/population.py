"""Populate hex.pop_density_per_km2 from ABS 2021 Census SA1 data.

For each cell in `hex`, compute the area-weighted mean population density
(persons per km²) of the SA1s the cell overlaps. Uses the same STRTree
+ per-cell intersection pattern as ingest/bushfire.py.

Input files (manual download → cache/raw/population/):
  1. SA1 boundaries — ABS ASGS Edition 3 (2021), GDA2020.
     https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3/jul2021-jun2026/access-and-downloads/digital-boundary-files
     Filename expected: SA1_2021_AUST_GDA2020.gpkg (or .shp — GeoPandas
     reads both). Contains SA1_CODE_2021, STATE_CODE_2021, AREASQKM21.

  2. Population totals — ABS 2021 Census DataPack G01 (Selected person
     characteristics), SA1 aggregation, AUST pack.
     https://www.abs.gov.au/census/find-census-data/datapacks
     Filename expected: 2021Census_G01_AUST_SA1.csv. Uses column
     `Tot_P_P` (Total persons, both sexes) keyed by `SA1_CODE_2021`.

Area maths in EPSG:7850 (MGA Zone 50) per BUILD_BRIEF.md §2. AREASQKM21
from the source is ignored — we recompute from projected geometry so a
partial-SA1 intersection gets the right density share.

Run:
    uv run python -m ingest.population
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely import STRtree

from db.bootstrap import connect
from db.snapshot import snapshot
from ingest.cadastre import COMPUTE_CRS, DATA_LOG, STORAGE_CRS
from ingest.hex_grid import cell_polygon

PROJECT_ROOT = Path(__file__).resolve().parents[1]
POP_DIR = PROJECT_ROOT / "cache" / "raw" / "population"

SA1_BOUNDARIES_CANDIDATES = (
    "SA1_2021_AUST_GDA2020.gpkg",
    "SA1_2021_AUST_GDA2020.shp",
    # ABS sometimes ships the geopackage inside a zip.
    "SA1_2021_AUST_GDA2020.zip",
)
G01_CANDIDATES = (
    "2021Census_G01_AUST_SA1.csv",
    "2021Census_G01_AUST_SA1_header_line.csv",
)

# Restrict to WA before spatial ops. ABS state code for WA is '5'.
WA_STATE_CODE = "5"


def _log(line: str) -> None:
    with DATA_LOG.open("a") as f:
        f.write(line.rstrip() + "\n")


def _find_file(names: tuple[str, ...]) -> Path:
    for name in names:
        p = POP_DIR / name
        if p.exists():
            return p
    raise FileNotFoundError(
        f"None of {names} found in {POP_DIR}. See module docstring for download links."
    )


def load_sa1_wa() -> gpd.GeoDataFrame:
    """Load SA1 boundaries, filtered to WA and joined with population totals."""
    boundary_path = _find_file(SA1_BOUNDARIES_CANDIDATES)
    g01_path = _find_file(G01_CANDIDATES)

    # /vsizip/ transparently handles the .zip case.
    src = f"/vsizip/{boundary_path}" if boundary_path.suffix == ".zip" else str(boundary_path)
    print(f"[population] Reading SA1 boundaries from {boundary_path.name}")
    sa1 = gpd.read_file(src)

    # ABS column names shift slightly across releases — accept the common
    # variants so a redownload doesn't silently break the ingest.
    code_col = _first_present(sa1.columns, ("SA1_CODE_2021", "SA1_CODE21", "sa1_code_2021"))
    state_col = _first_present(sa1.columns, ("STATE_CODE_2021", "STE_CODE21", "state_code_2021"))
    sa1 = sa1.rename(columns={code_col: "SA1_CODE_2021", state_col: "STATE_CODE_2021"})
    sa1["SA1_CODE_2021"] = sa1["SA1_CODE_2021"].astype(str)
    sa1["STATE_CODE_2021"] = sa1["STATE_CODE_2021"].astype(str)

    n_all = len(sa1)
    sa1 = sa1[sa1["STATE_CODE_2021"] == WA_STATE_CODE].copy()
    print(f"[population] Filtered to WA: {len(sa1):,}/{n_all:,} SA1s")

    if sa1.crs is None:
        raise RuntimeError("SA1 boundaries missing CRS")
    if sa1.crs.to_string() != STORAGE_CRS:
        print(f"[population] Reprojecting {sa1.crs} → {STORAGE_CRS}")
        sa1 = sa1.to_crs(STORAGE_CRS)

    # Load G01 population totals — first column is SA1_CODE_2021, and we
    # want Tot_P_P (total persons, both sexes).
    print(f"[population] Reading population from {g01_path.name}")
    pop = pd.read_csv(g01_path, dtype={"SA1_CODE_2021": str})
    code_col = _first_present(pop.columns, ("SA1_CODE_2021", "SA1_MAINCODE_2021", "SA1_CODE21"))
    pop = pop.rename(columns={code_col: "SA1_CODE_2021"})
    pop["SA1_CODE_2021"] = pop["SA1_CODE_2021"].astype(str)
    if "Tot_P_P" not in pop.columns:
        raise RuntimeError(
            f"G01 CSV missing Tot_P_P column. Got: {list(pop.columns)[:10]}..."
        )
    pop = pop[["SA1_CODE_2021", "Tot_P_P"]]

    merged = sa1.merge(pop, on="SA1_CODE_2021", how="left")
    n_missing = int(merged["Tot_P_P"].isna().sum())
    if n_missing:
        print(f"[population] {n_missing:,} WA SA1s had no G01 row (treating as 0)")
        merged["Tot_P_P"] = merged["Tot_P_P"].fillna(0)
    return merged


def _first_present(cols, candidates: tuple[str, ...]) -> str:
    for c in candidates:
        if c in cols:
            return c
    raise KeyError(f"None of {candidates} present in columns {list(cols)[:10]}...")


def build_hex_gdf(con) -> gpd.GeoDataFrame:
    hex_rows = con.execute("SELECT h3 FROM hex").fetchall()
    return gpd.GeoDataFrame(
        {"h3": [h for (h,) in hex_rows]},
        geometry=[cell_polygon(h) for (h,) in hex_rows],
        crs=STORAGE_CRS,
    )


def ingest() -> None:
    sa1 = load_sa1_wa()

    con = connect()
    hex_gdf = build_hex_gdf(con)
    print(f"[population] Testing {len(hex_gdf):,} hex cells")

    hex_proj = hex_gdf.to_crs(COMPUTE_CRS)
    sa1_proj = sa1.to_crs(COMPUTE_CRS)

    # Repair any invalid SA1 polygons — ABS boundaries are generally clean
    # but a handful of coastal islands come through self-intersecting.
    n_invalid = int((~sa1_proj.geometry.is_valid).sum())
    if n_invalid:
        print(f"[population] Repairing {n_invalid} invalid SA1 polygons")
        sa1_proj["geometry"] = sa1_proj.geometry.make_valid()

    # Clip to AOI bbox + 5 km buffer so we're not testing metro-Perth SA1s
    # against every rural hex. Population per km² is a density, so clipping
    # SA1 geometry to the AOI is safe — we recompute area post-clip.
    aoi_bounds = hex_proj.total_bounds
    from shapely.geometry import box as shapely_box
    aoi_box = shapely_box(*aoi_bounds).buffer(5000)
    n_before = len(sa1_proj)
    sa1_proj = sa1_proj[sa1_proj.intersects(aoi_box)].copy()
    # Density is per unit *original* SA1 area — clipping the polygon would
    # bias low-density cells if we then computed density from the clipped
    # area. Instead we keep the full SA1 geometry and derive density from
    # the source area.
    sa1_proj["sa1_area_m2"] = sa1_proj.geometry.area
    sa1_proj["density_per_m2"] = sa1_proj["Tot_P_P"] / sa1_proj["sa1_area_m2"].replace(0, float("nan"))
    print(f"[population] Clipped to AOI: {len(sa1_proj):,}/{n_before:,} SA1s remain")

    sa1_geoms = list(sa1_proj.geometry.values)
    sa1_density = sa1_proj["density_per_m2"].values
    tree = STRtree(sa1_geoms)

    print(f"[population] Computing per-cell area-weighted density for {len(hex_proj):,} cells")
    values: list[float | None] = []
    n_any = 0
    for hex_geom in hex_proj.geometry.values:
        cand_ix = tree.query(hex_geom, predicate="intersects")
        if len(cand_ix) == 0:
            values.append(None)
            continue
        hex_area = hex_geom.area
        weighted_sum = 0.0    # persons contributed to the cell
        covered_area = 0.0    # m² of hex covered by an SA1
        for i in cand_ix:
            d = sa1_density[i]
            if d != d:   # NaN density (SA1 with zero source area) — skip
                continue
            inter = hex_geom.intersection(sa1_geoms[i])
            if inter.is_empty:
                continue
            a = inter.area
            weighted_sum += d * a
            covered_area += a
        if covered_area <= 0:
            values.append(None)
            continue
        # persons-per-m² averaged over the covered area, converted to per km².
        density_per_m2 = weighted_sum / covered_area
        values.append(density_per_m2 * 1_000_000.0)
        n_any += 1

    import numpy as np

    arr = np.array([v if v is not None else np.nan for v in values])
    n_valid = int(np.isfinite(arr).sum())
    if n_valid:
        print(
            f"[population] {n_valid:,}/{len(values):,} cells populated. "
            f"density_per_km2: min={np.nanmin(arr):.2f} "
            f"median={np.nanmedian(arr):.2f} max={np.nanmax(arr):.2f}"
        )

    updates = [(v, h) for h, v in zip(hex_gdf["h3"].tolist(), values, strict=True)]
    con.executemany(
        "UPDATE hex SET pop_density_per_km2 = ? WHERE h3 = ?",
        updates,
    )
    con.commit()
    con.close()

    today = dt.date.today().isoformat()
    _log(
        f"{today} | ABS-2021 | population | AOI | {len(sa1_proj)} SA1s clipped | "
        f"{n_valid}/{len(values)} cells with density"
    )
    snapshot()


if __name__ == "__main__":
    ingest()
