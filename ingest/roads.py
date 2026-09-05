"""Populate sealed-road distance fields on `hex` from LGATE-195 (Roads Simplified).

For each cell, compute:
  - hex.dist_sealed_road_km    — km from cell centroid to nearest sealed road
  - hex.nearest_sealed_road_name — name of that road (for inspector display)

'Sealed' is the strict filter — `roadsurface == 'Sealed'`. Roads with
`Unknown` surface are treated as unsealed (conservative for a score where
sealed access is a positive signal).

Optimisation: read only sealed roads inside a bounding box that covers our
loaded hex cells plus a 50 km buffer. LGATE-195 has ~120k sealed lines
statewide — the buffered slice is much smaller.

Run:
    uv run python -m ingest.roads
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
ROADS_ZIP = (
    PROJECT_ROOT
    / "cache"
    / "raw"
    / "roads"
    / "Roads_Simplified_LGATE_195_WA_GDA2020_Public_Geopackage.zip"
)
ROADS_INNER = "Roads_Simplified_LGATE_195_WA_GDA2020_Public.gpkg"

# 50 km around our AOI — well beyond any plausible "nearest road" distance.
BBOX_BUFFER_DEG = 0.5


def _log(line: str) -> None:
    with DATA_LOG.open("a") as f:
        f.write(line.rstrip() + "\n")


def hex_bbox(con) -> tuple[float, float, float, float]:
    """Return (minx, miny, maxx, maxy) covering all hex centroids + buffer."""
    hex_rows = con.execute("SELECT h3 FROM hex").fetchall()
    lats, lngs = [], []
    for (h,) in hex_rows:
        lat, lng = h3.cell_to_latlng(h)
        lats.append(lat)
        lngs.append(lng)
    return (
        min(lngs) - BBOX_BUFFER_DEG,
        min(lats) - BBOX_BUFFER_DEG,
        max(lngs) + BBOX_BUFFER_DEG,
        max(lats) + BBOX_BUFFER_DEG,
    )


def load_sealed_roads(bbox: tuple[float, float, float, float]) -> gpd.GeoDataFrame:
    src = f"/vsizip/{ROADS_ZIP}/{ROADS_INNER}"
    # Push down: bbox filter (fewer features read) + SQL filter for surface.
    gdf = gpd.read_file(
        src,
        bbox=bbox,
        where="roadsurface = 'Sealed'",
        columns=["road_name", "mapclassification", "roadsurface", "geometry"],
    )
    assert gdf.crs is not None and gdf.crs.to_string() == STORAGE_CRS, (
        f"Roads CRS mismatch: {gdf.crs}"
    )
    return gdf


def ensure_columns(con) -> None:
    cols = {r[1] for r in con.execute('PRAGMA table_info("hex")').fetchall()}
    if "nearest_sealed_road_name" not in cols:
        con.execute("ALTER TABLE hex ADD COLUMN nearest_sealed_road_name VARCHAR")
        print("  Added hex.nearest_sealed_road_name")
    con.commit()


def ingest() -> None:
    con = connect()
    ensure_columns(con)

    bbox = hex_bbox(con)
    print(f"[roads] AOI bbox: {bbox} ({BBOX_BUFFER_DEG}° buffer)")
    roads = load_sealed_roads(bbox)
    print(f"[roads] Loaded {len(roads):,} sealed road segments in AOI")

    hex_rows = con.execute("SELECT h3 FROM hex").fetchall()
    print(f"[roads] Computing nearest sealed road for {len(hex_rows):,} cells")

    roads_proj = roads.to_crs(COMPUTE_CRS)
    road_geoms = roads_proj.geometry.values
    road_names = roads_proj["road_name"].fillna("(unnamed)").tolist()

    tree = STRtree(road_geoms)

    from pyproj import Transformer

    transformer = Transformer.from_crs(STORAGE_CRS, COMPUTE_CRS, always_xy=True)

    updates: list[tuple] = []
    for (h,) in hex_rows:
        lat, lng = h3.cell_to_latlng(h)
        x, y = transformer.transform(lng, lat)
        centroid = Point(x, y)
        idx = tree.nearest(centroid)
        nearest_geom = road_geoms[idx]
        dist_m = centroid.distance(nearest_geom)
        updates.append((dist_m / 1000.0, road_names[idx], h))

    con.executemany(
        "UPDATE hex SET dist_sealed_road_km = ?, nearest_sealed_road_name = ? WHERE h3 = ?",
        updates,
    )
    con.commit()

    stats = con.execute(
        """
        SELECT MIN(dist_sealed_road_km), AVG(dist_sealed_road_km),
               MEDIAN(dist_sealed_road_km), MAX(dist_sealed_road_km)
        FROM hex
        """
    ).fetchone()
    print(
        f"[roads] dist_sealed_road_km: "
        f"min={stats[0]:.2f} mean={stats[1]:.2f} median={stats[2]:.2f} max={stats[3]:.2f}"
    )

    top_roads = con.execute(
        """
        SELECT nearest_sealed_road_name, COUNT(*) AS n
        FROM hex WHERE nearest_sealed_road_name IS NOT NULL
        GROUP BY nearest_sealed_road_name ORDER BY n DESC LIMIT 10
        """
    ).fetchall()
    print("[roads] Most-referenced sealed roads (nearest for how many cells):")
    for name, n in top_roads:
        print(f"    {name}: {n} cells")

    con.close()

    today = dt.date.today().isoformat()
    _log(
        f"{today} | LGATE-195 | roads | AOI-clipped | {len(roads):,} sealed segments | "
        f"distance computed for {len(hex_rows)} cells"
    )
    snapshot()


if __name__ == "__main__":
    ingest()
