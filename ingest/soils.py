"""Populate soil-capability columns on `hex` from DPIRD-027 (Best Available).

For each hex cell, compute the AREA-WEIGHTED MODAL capability class per
enterprise (grazing, dryland cropping, annual/perennial horticulture,
vineyards). Grazing is treated as the default enterprise: its ordinal is
also written to `hex.capability_class` (with `capability_confidence` = the
fraction of the cell covered by that modal class).

DPIRD-027 uses A1/A2/B1/B2/C1/C2 codings. We map:
    A1 -> 1  (best; few limitations)
    A2 -> 2
    B1 -> 3
    B2 -> 4
    C1 -> 5
    C2 -> 6  (worst; very high limitations)
    NA -> None (not assessed / not applicable — treated as absent, not
                 "very bad", so a cell that is mostly NA does not score badly)

Fast path (learned from bushfire ingest):
  - Simplify polygons to 50 m tolerance in projected CRS
  - STRTree spatial index; per-cell intersection only against candidates
    whose bbox actually touches the cell

Run:
    uv run python -m ingest.soils
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely import STRtree

from db.bootstrap import connect
from db.snapshot import snapshot
from ingest.cadastre import COMPUTE_CRS, DATA_LOG, STORAGE_CRS
from ingest.hex_grid import cell_polygon

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOILS_ZIP = (
    PROJECT_ROOT
    / "cache"
    / "raw"
    / "soils"
    / "Best_Available_DPIRD_027_WA_GDA2020_Public_Geopackage.zip"
)
SOILS_INNER = "Best_Available_DPIRD_027_WA_GDA2020_Public.gpkg"

ENTERPRISES = ["lc_graz", "lc_dry_cro", "lc_ann_hor", "lc_per_hor", "lc_vines"]
DEFAULT_ENTERPRISE = "lc_graz"

CLASS_ORDER = {
    "A1": 1,
    "A2": 2,
    "B1": 3,
    "B2": 4,
    "C1": 5,
    "C2": 6,
}

SIMPLIFY_TOL_M = 50.0   # ~1% of a 5 km hex cell edge; imperceptible at res 7


def _log(line: str) -> None:
    with DATA_LOG.open("a") as f:
        f.write(line.rstrip() + "\n")


def load_soils() -> gpd.GeoDataFrame:
    src = f"/vsizip/{SOILS_ZIP}/{SOILS_INNER}"
    cols = ["geometry", *ENTERPRISES]
    gdf = gpd.read_file(src, columns=cols)
    assert gdf.crs is not None and gdf.crs.to_string() == STORAGE_CRS, (
        f"Soils CRS mismatch: {gdf.crs}"
    )
    # Normalise the enterprise columns — replace 'NA' string / empty with None.
    for col in ENTERPRISES:
        gdf[col] = gdf[col].where(gdf[col].isin(CLASS_ORDER.keys()), other=None)
    return gdf


def build_hex_gdf(con) -> gpd.GeoDataFrame:
    hex_rows = con.execute("SELECT h3 FROM hex").fetchall()
    return gpd.GeoDataFrame(
        {"h3": [h for (h,) in hex_rows]},
        geometry=[cell_polygon(h) for (h,) in hex_rows],
        crs=STORAGE_CRS,
    )


def ingest() -> None:
    print("[soils] Loading DPIRD-027 Best Available soil-landscape polygons")
    soils = load_soils()
    print(f"[soils] Loaded {len(soils):,} polygons statewide")

    con = connect()
    hex_gdf = build_hex_gdf(con)
    print(f"[soils] Testing {len(hex_gdf):,} hex cells")

    # Project both to EPSG:7850 for honest area maths.
    hex_proj = hex_gdf.to_crs(COMPUTE_CRS)
    soils_proj = soils.to_crs(COMPUTE_CRS)

    # Repair any invalid polygons — soil-landscape mapping sometimes has them.
    n_invalid = int((~soils_proj.geometry.is_valid).sum())
    if n_invalid:
        print(f"[soils] Repairing {n_invalid} invalid polygons")
        soils_proj["geometry"] = soils_proj.geometry.make_valid()

    print(f"[soils] Simplifying soil polygons to {SIMPLIFY_TOL_M} m tolerance")
    soils_proj["geometry"] = soils_proj.geometry.simplify(
        SIMPLIFY_TOL_M, preserve_topology=True
    )

    # STRTree over soil polygons.
    soil_geoms = soils_proj.geometry.values
    tree = STRtree(soil_geoms)

    # Cache enterprise codes as tuples aligned with soil_geoms.
    codes_by_ent: dict[str, list] = {
        ent: soils_proj[ent].tolist() for ent in ENTERPRISES
    }

    print("[soils] Computing per-cell modal capability via STRTree")
    updates: list[tuple] = []
    n_hit = 0
    for hex_geom, h3 in zip(hex_proj.geometry.values, hex_gdf["h3"], strict=True):
        candidate_ix = tree.query(hex_geom, predicate="intersects")
        if len(candidate_ix) == 0:
            # No overlapping soil polygon — write NULLs for everything soil-related.
            updates.append((None, None, None, None, None, None, None, h3))
            continue

        # For each candidate polygon compute intersection area, group by
        # each enterprise's class, sum area, pick modal.
        hex_area = hex_geom.area
        per_ent_area: dict[str, dict[str, float]] = {
            ent: defaultdict(float) for ent in ENTERPRISES
        }
        for i in candidate_ix:
            inter = hex_geom.intersection(soil_geoms[i])
            if inter.is_empty:
                continue
            a = inter.area
            for ent in ENTERPRISES:
                cls = codes_by_ent[ent][i]
                if cls is None or (isinstance(cls, float) and pd.isna(cls)):
                    continue
                per_ent_area[ent][cls] += a

        # Modal (max-area) class per enterprise + confidence for the default one.
        modal: dict[str, str | None] = {}
        for ent, area_by_class in per_ent_area.items():
            if not area_by_class:
                modal[ent] = None
            else:
                modal[ent] = max(area_by_class.items(), key=lambda kv: kv[1])[0]

        graz_area_by_class = per_ent_area[DEFAULT_ENTERPRISE]
        graz_modal = modal[DEFAULT_ENTERPRISE]
        if graz_modal is None:
            capability_class = None
            capability_confidence = None
        else:
            capability_class = CLASS_ORDER[graz_modal]
            capability_confidence = graz_area_by_class[graz_modal] / hex_area

        updates.append(
            (
                capability_class,
                capability_confidence,
                modal["lc_graz"],
                modal["lc_dry_cro"],
                modal["lc_ann_hor"],
                modal["lc_per_hor"],
                modal["lc_vines"],
                h3,
            )
        )
        n_hit += 1

    print(f"[soils] {n_hit:,}/{len(hex_gdf):,} cells overlap at least one soil polygon")

    # Write back — reset any existing values so re-runs are idempotent.
    con.executemany(
        """
        UPDATE hex SET
            capability_class = ?,
            capability_confidence = ?,
            lc_graz_raw = ?,
            lc_dry_cro_raw = ?,
            lc_ann_hor_raw = ?,
            lc_per_hor_raw = ?,
            lc_vines_raw = ?
        WHERE h3 = ?
        """,
        updates,
    )
    con.commit()

    # Distribution report for the default enterprise.
    print("[soils] Grazing capability distribution across cells:")
    dist = con.execute(
        """
        SELECT lc_graz_raw AS code, COUNT(*) AS n
        FROM hex GROUP BY lc_graz_raw ORDER BY code
        """
    ).fetchall()
    for code, n in dist:
        print(f"    {code}: {n}")

    con.close()

    today = dt.date.today().isoformat()
    _log(
        f"{today} | DPIRD-027 | soils | statewide | {len(soils):,} polygons | "
        f"{n_hit}/{len(hex_gdf)} cells with soil overlap"
    )
    snapshot()


if __name__ == "__main__":
    ingest()
