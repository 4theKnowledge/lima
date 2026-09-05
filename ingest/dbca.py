"""Populate DBCA-estate fields on `hex` from DBCA-011 (Legislated Lands & Waters).

For each cell, compute:
  - hex.dbca_estate_frac  — 0.0 (fully private) to 1.0 (fully inside DBCA estate)
  - hex.dbca_category      — most-represented category name where frac > 0
                              (e.g. 'National Park', 'State Forest', 'Nature Reserve')

DBCA land is not for sale, so this is both a scoring modifier (high frac →
less buyable land per cell) and a diagnostic (explains why parcel counts
are low in NP-heavy cells).

Reuses the bushfire fast-path: repair → simplify → STRTree → per-cell
candidate intersection.

Run:
    uv run python -m ingest.dbca
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
from shapely import STRtree
from shapely.ops import unary_union

from db.bootstrap import connect
from db.snapshot import snapshot
from ingest.cadastre import COMPUTE_CRS, DATA_LOG, STORAGE_CRS
from ingest.hex_grid import cell_polygon

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DBCA_ZIP = (
    PROJECT_ROOT
    / "cache"
    / "raw"
    / "dbca_estate"
    / "Legislated_Lands_and_Waters_DBCA_011_WA_GDA2020_Public_Geopackage.zip"
)
DBCA_INNER = "Legislated_Lands_and_Waters_DBCA_011_WA_GDA2020_Public.gpkg"

SIMPLIFY_TOL_M = 50.0   # ~1% of a 5 km hex cell edge


def _log(line: str) -> None:
    with DATA_LOG.open("a") as f:
        f.write(line.rstrip() + "\n")


def load_dbca() -> gpd.GeoDataFrame:
    src = f"/vsizip/{DBCA_ZIP}/{DBCA_INNER}"
    gdf = gpd.read_file(src, columns=["leg_category", "geometry"])
    assert gdf.crs is not None and gdf.crs.to_string() == STORAGE_CRS, (
        f"DBCA CRS mismatch: {gdf.crs}"
    )
    return gdf


def ensure_columns(con) -> None:
    cols = {r[1] for r in con.execute('PRAGMA table_info("hex")').fetchall()}
    if "dbca_estate_frac" not in cols:
        con.execute("ALTER TABLE hex ADD COLUMN dbca_estate_frac DOUBLE")
        print("  Added hex.dbca_estate_frac")
    if "dbca_category" not in cols:
        con.execute("ALTER TABLE hex ADD COLUMN dbca_category VARCHAR")
        print("  Added hex.dbca_category")
    con.commit()


def build_hex_gdf(con) -> gpd.GeoDataFrame:
    hex_rows = con.execute("SELECT h3 FROM hex").fetchall()
    return gpd.GeoDataFrame(
        {"h3": [h for (h,) in hex_rows]},
        geometry=[cell_polygon(h) for (h,) in hex_rows],
        crs=STORAGE_CRS,
    )


def ingest() -> None:
    print("[dbca] Loading DBCA-011 legislated lands and waters")
    dbca = load_dbca()
    print(f"[dbca] Loaded {len(dbca):,} polygons statewide")

    con = connect()
    ensure_columns(con)
    hex_gdf = build_hex_gdf(con)
    print(f"[dbca] Testing {len(hex_gdf):,} hex cells")

    hex_proj = hex_gdf.to_crs(COMPUTE_CRS)
    dbca_proj = dbca.to_crs(COMPUTE_CRS)

    n_invalid = int((~dbca_proj.geometry.is_valid).sum())
    if n_invalid:
        print(f"[dbca] Repairing {n_invalid} invalid polygons")
        dbca_proj["geometry"] = dbca_proj.geometry.make_valid()

    print(f"[dbca] Simplifying to {SIMPLIFY_TOL_M} m tolerance")
    dbca_proj["geometry"] = dbca_proj.geometry.simplify(
        SIMPLIFY_TOL_M, preserve_topology=True
    )

    dbca_geoms = dbca_proj.geometry.values
    dbca_cats = dbca_proj["leg_category"].tolist()
    tree = STRtree(dbca_geoms)

    print("[dbca] Computing per-cell area fraction + modal category via STRTree")
    updates: list[tuple] = []
    n_any = 0
    for hex_geom, h3 in zip(hex_proj.geometry.values, hex_gdf["h3"], strict=True):
        candidate_ix = tree.query(hex_geom, predicate="intersects")
        if len(candidate_ix) == 0:
            updates.append((0.0, None, h3))
            continue

        cat_area: dict[str, float] = defaultdict(float)
        candidates = [dbca_geoms[i] for i in candidate_ix]
        for i in candidate_ix:
            inter = hex_geom.intersection(dbca_geoms[i])
            if inter.is_empty:
                continue
            cat = dbca_cats[i]
            if cat:
                cat_area[cat] += inter.area

        # Union candidates for overall fraction (handles overlapping DBCA
        # polygons — e.g. Class-A reserve inside a National Park — without
        # double-counting).
        if len(candidates) == 1:
            union_inter = hex_geom.intersection(candidates[0])
        else:
            union_inter = hex_geom.intersection(unary_union(candidates))
        frac = union_inter.area / hex_geom.area if not union_inter.is_empty else 0.0
        frac = max(0.0, min(1.0, frac))

        if frac > 0:
            n_any += 1
        modal_cat = max(cat_area.items(), key=lambda kv: kv[1])[0] if cat_area else None
        updates.append((frac, modal_cat, h3))

    con.executemany(
        "UPDATE hex SET dbca_estate_frac = ?, dbca_category = ? WHERE h3 = ?",
        updates,
    )
    con.commit()

    print(f"[dbca] {n_any:,}/{len(hex_gdf):,} cells touch DBCA estate")
    print("[dbca] Category breakdown across cells (modal category):")
    rows = con.execute(
        """
        SELECT dbca_category, COUNT(*) AS n
        FROM hex WHERE dbca_estate_frac > 0
        GROUP BY dbca_category ORDER BY n DESC
        """
    ).fetchall()
    for cat, n in rows:
        print(f"    {cat}: {n}")

    con.close()

    today = dt.date.today().isoformat()
    _log(
        f"{today} | DBCA-011 | dbca | statewide | {len(dbca):,} polygons | "
        f"{n_any}/{len(hex_gdf)} cells with DBCA overlap"
    )
    snapshot()


if __name__ == "__main__":
    ingest()
