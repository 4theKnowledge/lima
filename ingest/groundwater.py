"""Populate hex.gw_proclaimed + hex.gw_area_name from DWER-034.

For each cell in `hex`, check whether it intersects any RIWI proclaimed
groundwater area polygon. If yes: gw_proclaimed = TRUE, gw_area_name = first
matching area name. If no: gw_proclaimed = FALSE, gw_area_name = NULL.

Per BUILD_BRIEF.md §6, this is the coarse MVP proxy — proclaimed status is a
required-licence flag, not an allocation-headroom flag. The finer allocation
status (per-area headroom) is a Tier 2 manual loader (see D.10 area).

Run:
    uv run python -m ingest.groundwater
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import geopandas as gpd
import h3

from db.bootstrap import connect
from db.snapshot import snapshot
from ingest.cadastre import DATA_LOG, STORAGE_CRS

PROJECT_ROOT = Path(__file__).resolve().parents[1]
GW_ZIP = (
    PROJECT_ROOT
    / "cache"
    / "raw"
    / "groundwater"
    / "RIWI_Act_Groundwater_Areas_DWER_034_WA_GDA2020_Public_Geopackage.zip"
)
GW_INNER = "RIWI_Act_Groundwater_Areas_DWER_034_WA_GDA2020_Public.gpkg"


def _log(line: str) -> None:
    with DATA_LOG.open("a") as f:
        f.write(line.rstrip() + "\n")


def load_areas() -> gpd.GeoDataFrame:
    src = f"/vsizip/{GW_ZIP}/{GW_INNER}"
    gdf = gpd.read_file(src)
    assert gdf.crs is not None and gdf.crs.to_string() == STORAGE_CRS, (
        f"GW areas CRS mismatch: {gdf.crs}"
    )
    return gdf[["name", "geometry"]].rename(columns={"name": "gw_area_name"})


def ingest() -> None:
    print("[groundwater] Loading DWER-034 groundwater areas")
    areas = load_areas()
    print(f"[groundwater] Loaded {len(areas)} proclaimed groundwater areas")

    con = connect()
    hex_rows = con.execute("SELECT h3 FROM hex").fetchall()
    print(f"[groundwater] Testing {len(hex_rows)} hex cells against areas")

    # Turn hex IDs into point geometries at cell centroids for a cheap
    # point-in-polygon test. At res 7 (~5 km² cells) the centroid is a
    # reasonable proxy for "does this cell fall inside a GW area."
    from shapely.geometry import Point

    centroids = []
    for (h,) in hex_rows:
        lat, lng = h3.cell_to_latlng(h)
        centroids.append({"h3": h, "geometry": Point(lng, lat)})
    hex_gdf = gpd.GeoDataFrame(centroids, crs=STORAGE_CRS)

    # Spatial join: which cells fall inside which GW area
    joined = gpd.sjoin(hex_gdf, areas, how="left", predicate="within")

    # A cell can theoretically intersect multiple GW areas at its centroid
    # (nested polygons — rare but real). Take the first match per cell.
    joined = joined.drop_duplicates(subset="h3", keep="first")

    n_proclaimed = joined["gw_area_name"].notna().sum()
    n_unproclaimed = len(joined) - n_proclaimed
    print(f"[groundwater] Cells in proclaimed areas: {n_proclaimed}")
    print(f"[groundwater] Cells unproclaimed:        {n_unproclaimed}")

    # Write back. NULL name → unproclaimed.
    updates = [
        (
            row.gw_area_name is not None and row.gw_area_name == row.gw_area_name,  # not NaN
            row.gw_area_name if row.gw_area_name == row.gw_area_name else None,
            row.h3,
        )
        for row in joined.itertuples(index=False)
    ]
    con.executemany(
        "UPDATE hex SET gw_proclaimed = ?, gw_area_name = ? WHERE h3 = ?",
        updates,
    )
    con.commit()

    # Verify + report distinct area names hit
    hit_names = con.execute(
        "SELECT gw_area_name, COUNT(*) FROM hex WHERE gw_proclaimed = TRUE GROUP BY gw_area_name ORDER BY 2 DESC"
    ).fetchall()
    con.close()

    print("[groundwater] Distinct GW areas hit by our hex cells:")
    for name, n in hit_names:
        print(f"    {name}: {n} cells")

    today = dt.date.today().isoformat()
    _log(
        f"{today} | DWER-034 | groundwater | statewide | {len(areas)} areas | "
        f"{n_proclaimed} cells proclaimed / {n_unproclaimed} unproclaimed"
    )
    snapshot()


if __name__ == "__main__":
    ingest()
