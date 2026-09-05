"""Populate hex.sw_proclaimed from DWER-037.

Same coarse proxy as groundwater: any cell whose centroid falls inside a
proclaimed Surface Water Area or Irrigation District gets sw_proclaimed = TRUE.
Meaning: taking water from rivers/creeks/dams in that cell requires a DWER
licence.

DWER-037 mixes 'Surface Water Area' and 'Irrigation District'. Both are
licence-required from the buyer's perspective, so we treat them identically
for the hex flag. Full breakdown is in the DATA_LOG entry.

Run:
    uv run python -m ingest.surface_water
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
SW_ZIP = (
    PROJECT_ROOT
    / "cache"
    / "raw"
    / "surface_water"
    / "RIWI_Act_Surface_Water_Areas_and_Irrigation_Districts_DWER_037_WA_GDA2020_Public_Geopackage.zip"
)
SW_INNER = "RIWI_Act_Surface_Water_Areas_and_Irrigation_Districts_DWER_037_WA_GDA2020_Public.gpkg"


def _log(line: str) -> None:
    with DATA_LOG.open("a") as f:
        f.write(line.rstrip() + "\n")


def load_areas() -> gpd.GeoDataFrame:
    src = f"/vsizip/{SW_ZIP}/{SW_INNER}"
    gdf = gpd.read_file(src)
    assert gdf.crs is not None and gdf.crs.to_string() == STORAGE_CRS, (
        f"SW areas CRS mismatch: {gdf.crs}"
    )
    return gdf[["name", "type", "geometry"]]


def ingest() -> None:
    print("[surface_water] Loading DWER-037 surface water areas + irrigation districts")
    areas = load_areas()
    print(f"[surface_water] Loaded {len(areas)} features")
    print(f"[surface_water] Types: {areas['type'].value_counts().to_dict()}")

    con = connect()
    hex_rows = con.execute("SELECT h3 FROM hex").fetchall()
    print(f"[surface_water] Testing {len(hex_rows)} hex cells")

    from shapely.geometry import Point

    centroids = []
    for (h,) in hex_rows:
        lat, lng = h3.cell_to_latlng(h)
        centroids.append({"h3": h, "geometry": Point(lng, lat)})
    hex_gdf = gpd.GeoDataFrame(centroids, crs=STORAGE_CRS)

    # Rename source `name` column to avoid clashing with the pandas itertuples
    # attribute `.name` (reserved) and to be explicit about what we're joining.
    areas = areas.rename(columns={"name": "sw_area_name"})
    joined = gpd.sjoin(hex_gdf, areas, how="left", predicate="within")
    joined = joined.drop_duplicates(subset="h3", keep="first")

    import pandas as pd

    n_proclaimed = int(joined["sw_area_name"].notna().sum())
    print(f"[surface_water] Cells in proclaimed SW/irrigation areas: {n_proclaimed}")
    print(f"[surface_water] Cells unproclaimed:                      {len(joined) - n_proclaimed}")

    updates = [
        (not pd.isna(row.sw_area_name), row.h3)
        for row in joined.itertuples(index=False)
    ]
    con.executemany("UPDATE hex SET sw_proclaimed = ? WHERE h3 = ?", updates)
    con.commit()

    hit_names = con.execute(
        """
        SELECT COUNT(*) AS n
        FROM hex WHERE sw_proclaimed = TRUE
        """
    ).fetchone()
    print(f"[surface_water] Verified: {hit_names[0]} cells now flagged sw_proclaimed=TRUE")
    con.close()

    today = dt.date.today().isoformat()
    _log(
        f"{today} | DWER-037 | surface_water | statewide | {len(areas)} features | "
        f"{n_proclaimed} cells proclaimed / {len(joined) - n_proclaimed} unproclaimed"
    )
    snapshot()


if __name__ == "__main__":
    ingest()
