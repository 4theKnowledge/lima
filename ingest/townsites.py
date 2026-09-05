"""Populate townsite-related fields on `hex` from LGATE-248.

Two things at once:
  - hex.dist_townsite_km  — distance from each cell centroid to nearest townsite
                             polygon, in km, computed in EPSG:7850
  - hex.dist_townsite_name — name of that nearest townsite (for inspector display)

Also feeds the M1.7a parcel filter later ("drop parcels intersecting gazetted
townsites") — that logic lives in ingest/cadastre.py if we re-run cadastre
ingest with townsites available.

Run:
    uv run python -m ingest.townsites
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import geopandas as gpd
import h3
from shapely import STRtree
from shapely.geometry import Point

from db.bootstrap import connect
from db.snapshot import snapshot
from ingest.cadastre import COMPUTE_CRS, DATA_LOG, STORAGE_CRS

PROJECT_ROOT = Path(__file__).resolve().parents[1]
TS_ZIP = (
    PROJECT_ROOT
    / "cache"
    / "raw"
    / "townsites"
    / "Townsites_LGATE_248_WA_GDA2020_Public_Geopackage.zip"
)
TS_INNER = "Townsites_LGATE_248_WA_GDA2020_Public.gpkg"


def _log(line: str) -> None:
    with DATA_LOG.open("a") as f:
        f.write(line.rstrip() + "\n")


def load_townsites() -> gpd.GeoDataFrame:
    src = f"/vsizip/{TS_ZIP}/{TS_INNER}"
    gdf = gpd.read_file(src, columns=["name", "geometry"])
    assert gdf.crs is not None and gdf.crs.to_string() == STORAGE_CRS, (
        f"Townsites CRS mismatch: {gdf.crs}"
    )
    return gdf


def ensure_columns(con) -> None:
    """Add townsite distance columns if not present. Idempotent."""
    cols = {r[1] for r in con.execute('PRAGMA table_info("hex")').fetchall()}
    if "dist_townsite_km" not in cols:
        con.execute("ALTER TABLE hex ADD COLUMN dist_townsite_km DOUBLE")
        print("  Added hex.dist_townsite_km")
    if "nearest_townsite_name" not in cols:
        con.execute("ALTER TABLE hex ADD COLUMN nearest_townsite_name VARCHAR")
        print("  Added hex.nearest_townsite_name")
    con.commit()


def ingest() -> None:
    print("[townsites] Loading LGATE-248")
    towns = load_townsites()
    print(f"[townsites] Loaded {len(towns)} townsite polygons statewide")

    con = connect()
    ensure_columns(con)
    hex_rows = con.execute("SELECT h3 FROM hex").fetchall()
    print(f"[townsites] Computing distance for {len(hex_rows):,} hex cells")

    # Reproject townsites to projected CRS once.
    towns_proj = towns.to_crs(COMPUTE_CRS)
    town_geoms = towns_proj.geometry.values
    town_names = towns_proj["name"].tolist()

    # Build STRTree for nearest-neighbour lookup.
    tree = STRtree(town_geoms)

    # Compute cell centroids in projected CRS.
    from pyproj import Transformer

    transformer = Transformer.from_crs(STORAGE_CRS, COMPUTE_CRS, always_xy=True)

    updates: list[tuple] = []
    for (h,) in hex_rows:
        lat, lng = h3.cell_to_latlng(h)
        x, y = transformer.transform(lng, lat)
        centroid = Point(x, y)
        # Nearest returns an index into town_geoms.
        idx = tree.nearest(centroid)
        nearest_geom = town_geoms[idx]
        dist_m = centroid.distance(nearest_geom)
        updates.append((dist_m / 1000.0, town_names[idx], h))

    con.executemany(
        "UPDATE hex SET dist_townsite_km = ?, nearest_townsite_name = ? WHERE h3 = ?",
        updates,
    )
    con.commit()

    stats = con.execute(
        """
        SELECT MIN(dist_townsite_km), AVG(dist_townsite_km),
               MEDIAN(dist_townsite_km), MAX(dist_townsite_km)
        FROM hex
        """
    ).fetchone()
    print(
        f"[townsites] dist_townsite_km: "
        f"min={stats[0]:.2f} mean={stats[1]:.2f} median={stats[2]:.2f} max={stats[3]:.2f}"
    )

    top_towns = con.execute(
        """
        SELECT nearest_townsite_name, COUNT(*) AS n
        FROM hex WHERE nearest_townsite_name IS NOT NULL
        GROUP BY nearest_townsite_name ORDER BY n DESC LIMIT 10
        """
    ).fetchall()
    print("[townsites] Most-referenced townsites (nearest for how many cells):")
    for name, n in top_towns:
        print(f"    {name}: {n} cells")

    con.close()

    today = dt.date.today().isoformat()
    _log(
        f"{today} | LGATE-248 | townsites | statewide | {len(towns)} polygons | "
        f"nearest distance computed for {len(hex_rows)} cells"
    )
    snapshot()


if __name__ == "__main__":
    ingest()
