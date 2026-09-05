"""Populate hex.salinity_idx + hex.salinity_tds_class from DWER-026.

For each cell in `hex`, take the salinity class of the polygon its centroid
falls inside. Cells outside any salinity polygon get NULL (interpret as
"no data / assume fresh" downstream).

Salinity is a soil/land quality modifier — high TDS constrains what crops
and pastures work. Encoded as an ordinal 1 (fresh) .. 10 (hypersaline).
See DWER-026 metadata for exact TDS ranges per ordinal.

Run:
    uv run python -m ingest.salinity
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import geopandas as gpd
import h3
import pandas as pd

from db.bootstrap import connect
from db.snapshot import snapshot
from ingest.cadastre import DATA_LOG, STORAGE_CRS

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SAL_ZIP = (
    PROJECT_ROOT
    / "cache"
    / "raw"
    / "groundwater_salinity"
    / "Groundwater_Salinity_Statewide_DWER_026_WA_GDA2020_Public_Geopackage.zip"
)
SAL_INNER = "Groundwater_Salinity_Statewide_DWER_026_WA_GDA2020_Public.gpkg"


def _log(line: str) -> None:
    with DATA_LOG.open("a") as f:
        f.write(line.rstrip() + "\n")


# Ordinal ranking of the TDS classes (fresh 1 .. hypersaline 7). The raw
# salinity_i column in DWER-026 is a polygon-level ID (values like 123, 130),
# NOT a monotone rank — we compute our own from the human-readable tds_mg_l_
# string.
TDS_ORDER = {
    "<500":         1,   # fresh (drinking-water)
    "500-1000":     2,   # marginal fresh
    "1000-3000":    3,   # brackish, tolerable for stock and some crops
    "3000-7000":    4,   # brackish, limited crops
    "7000-14000":   5,   # saline
    "14000-35000":  6,   # very saline (seawater = ~35000)
    ">35000":       7,   # hypersaline
}


def load_areas() -> gpd.GeoDataFrame:
    src = f"/vsizip/{SAL_ZIP}/{SAL_INNER}"
    gdf = gpd.read_file(src)
    assert gdf.crs is not None and gdf.crs.to_string() == STORAGE_CRS, (
        f"Salinity CRS mismatch: {gdf.crs}"
    )
    keep = gdf[["tds_mg_l_", "geometry"]].rename(
        columns={"tds_mg_l_": "salinity_tds_class"}
    )
    # Blank/whitespace TDS → NULL
    keep["salinity_tds_class"] = keep["salinity_tds_class"].str.strip().replace("", None)
    # Map to our ordinal (1 = fresh .. 7 = hypersaline). NULL if class unknown.
    keep["salinity_idx"] = keep["salinity_tds_class"].map(TDS_ORDER).astype("Int64")
    unmapped = keep[keep["salinity_tds_class"].notna() & keep["salinity_idx"].isna()]
    if not unmapped.empty:
        raise RuntimeError(
            f"Unexpected TDS classes in DWER-026: {sorted(unmapped['salinity_tds_class'].unique())}. "
            f"Update TDS_ORDER in ingest/salinity.py."
        )
    return keep


def ingest() -> None:
    print("[salinity] Loading DWER-026 salinity polygons")
    areas = load_areas()
    print(f"[salinity] Loaded {len(areas)} salinity polygons")
    print(f"[salinity] TDS classes: {sorted(areas['salinity_tds_class'].dropna().unique())}")

    con = connect()
    hex_rows = con.execute("SELECT h3 FROM hex").fetchall()
    print(f"[salinity] Testing {len(hex_rows)} hex cells")

    from shapely.geometry import Point

    centroids = []
    for (h,) in hex_rows:
        lat, lng = h3.cell_to_latlng(h)
        centroids.append({"h3": h, "geometry": Point(lng, lat)})
    hex_gdf = gpd.GeoDataFrame(centroids, crs=STORAGE_CRS)

    joined = gpd.sjoin(hex_gdf, areas, how="left", predicate="within")
    # A cell can theoretically hit >1 salinity polygon at borders — take first.
    joined = joined.drop_duplicates(subset="h3", keep="first")

    n_in_polygon = joined["salinity_idx"].notna().sum()
    print(f"[salinity] Cells inside a salinity polygon: {n_in_polygon}")
    print(f"[salinity] Cells outside (NULL — assume fresh/no data): {len(joined) - n_in_polygon}")

    # Distribution across our hex cells
    print("[salinity] Distribution across hex cells:")
    dist = joined.groupby("salinity_tds_class", dropna=False).size().sort_index()
    for cls, n in dist.items():
        print(f"    {cls if cls else '(no data)'}: {n} cells")

    updates = []
    for row in joined.itertuples(index=False):
        sal_idx = int(row.salinity_idx) if not pd.isna(row.salinity_idx) else None
        sal_cls = row.salinity_tds_class if not pd.isna(row.salinity_tds_class) else None
        updates.append((sal_idx, sal_cls, row.h3))

    con.executemany(
        "UPDATE hex SET salinity_idx = ?, salinity_tds_class = ? WHERE h3 = ?",
        updates,
    )
    con.commit()
    con.close()

    today = dt.date.today().isoformat()
    _log(
        f"{today} | DWER-026 | salinity | statewide | {len(areas)} polygons | "
        f"{n_in_polygon} cells in polygon / {len(joined) - n_in_polygon} outside"
    )
    snapshot()


if __name__ == "__main__":
    ingest()
