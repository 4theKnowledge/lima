"""Populate hex.bushfire_prone_frac from OBRM-024.

For each cell in `hex`, compute the fraction of the cell area that intersects
a designated Bush Fire Prone Area (BPA) polygon. Value is 0.0 (no overlap)
through 1.0 (cell entirely within a BPA).

Area maths runs in EPSG:7850 (MGA Zone 50) per BUILD_BRIEF.md §2.

Fast path:
  1. Repair invalid BPA polygons via make_valid, then simplify to 100 m
     tolerance — invisible at res 7 (~5 km cells) but massively fewer vertices.
     Skip the naive union_all() — that produced a giant single MultiPolygon
     that GEOS was choking on for 17+ minutes on 469 features.
  2. Build a STRTree spatial index over BPA polygons. For each hex,
     candidate BPAs come from bbox lookup — typically 0–5 polygons, not 469.
     Union just the candidates, intersect, done.

Run:
    uv run python -m ingest.bushfire
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import geopandas as gpd
from shapely import STRtree
from shapely.ops import unary_union

from db.bootstrap import connect
from db.snapshot import snapshot
from ingest.cadastre import COMPUTE_CRS, DATA_LOG, STORAGE_CRS
from ingest.hex_grid import cell_polygon

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BF_ZIP = (
    PROJECT_ROOT
    / "cache"
    / "raw"
    / "bushfire"
    / "Bush_Fire_Prone_Areas_2025_OBRM_024_WA_GDA2020_Public_Geopackage.zip"
)
BF_INNER = "Bush_Fire_Prone_Areas_2025_OBRM_024_WA_GDA2020_Public.gpkg"

SIMPLIFY_TOL_M = 100.0   # invisible at res 7 (~5 km cells)


def _log(line: str) -> None:
    with DATA_LOG.open("a") as f:
        f.write(line.rstrip() + "\n")


def load_bpa() -> gpd.GeoDataFrame:
    src = f"/vsizip/{BF_ZIP}/{BF_INNER}"
    gdf = gpd.read_file(src)
    assert gdf.crs is not None and gdf.crs.to_string() == STORAGE_CRS, (
        f"BPA CRS mismatch: {gdf.crs}"
    )
    return gdf


def build_hex_gdf(con) -> gpd.GeoDataFrame:
    hex_rows = con.execute("SELECT h3 FROM hex").fetchall()
    return gpd.GeoDataFrame(
        {"h3": [h for (h,) in hex_rows]},
        geometry=[cell_polygon(h) for (h,) in hex_rows],
        crs=STORAGE_CRS,
    )


def ingest() -> None:
    print("[bushfire] Loading OBRM-024 BPA polygons")
    bpa = load_bpa()
    print(f"[bushfire] Loaded {len(bpa)} BPA polygons statewide")

    con = connect()
    hex_gdf = build_hex_gdf(con)
    print(f"[bushfire] Testing {len(hex_gdf)} hex cells")

    # Project both to EPSG:7850 for honest area maths.
    hex_proj = hex_gdf.to_crs(COMPUTE_CRS)
    bpa_proj = bpa.to_crs(COMPUTE_CRS)

    # Repair invalid polygons — OBRM-024 has a few self-intersecting ones.
    n_invalid = int((~bpa_proj.geometry.is_valid).sum())
    if n_invalid:
        print(f"[bushfire] Repairing {n_invalid} invalid BPA polygons")
        bpa_proj["geometry"] = bpa_proj.geometry.make_valid()

    # Simplify aggressively — hex cells are 5 km wide, 100 m tolerance is
    # invisible but cuts vertex count 10-100×. Critical for the union step.
    print(f"[bushfire] Simplifying BPA polygons to {SIMPLIFY_TOL_M} m tolerance")
    bpa_proj["geometry"] = bpa_proj.geometry.simplify(SIMPLIFY_TOL_M, preserve_topology=True)

    # Clip BPAs to the AOI bounding box before union — statewide union blows
    # up because Perth Hills has 30+ densely overlapping BPAs. AOI clip drops
    # 90% of the polygons we don't need.
    aoi_bounds = hex_proj.total_bounds
    from shapely.geometry import box as shapely_box
    aoi_box = shapely_box(*aoi_bounds).buffer(1000)  # 1 km buffer for edge cells
    bpa_proj = bpa_proj[bpa_proj.intersects(aoi_box)].copy()
    bpa_proj["geometry"] = bpa_proj.geometry.intersection(aoi_box)
    print(f"[bushfire] Clipped to AOI: {len(bpa_proj)} BPAs remain")

    # Union all AOI BPAs into one MultiPolygon — done ONCE, so we don't rebuild
    # local unions for every cell. Overlaps are dissolved, so per-cell
    # intersection is unambiguous.
    print("[bushfire] Building single unioned BPA geometry across AOI")
    bpa_union = unary_union(list(bpa_proj.geometry.values))
    # After union, STRTree lets us test cells against the union's components
    # without loading the whole thing per cell.
    union_parts = (
        list(bpa_union.geoms) if bpa_union.geom_type == "MultiPolygon" else [bpa_union]
    )
    print(f"[bushfire] Union produced {len(union_parts)} component polygons")
    tree = STRtree(union_parts)

    print(f"[bushfire] Computing per-cell overlap for {len(hex_proj)} cells")
    fracs: list[float] = []
    for hex_geom in hex_proj.geometry.values:
        candidate_ix = tree.query(hex_geom, predicate="intersects")
        if len(candidate_ix) == 0:
            fracs.append(0.0)
            continue
        # Union parts don't overlap each other by construction, so per-part
        # intersection areas sum cleanly — no need to union candidates.
        area_sum = 0.0
        for i in candidate_ix:
            inter = hex_geom.intersection(union_parts[i])
            if not inter.is_empty:
                area_sum += inter.area
        frac = area_sum / hex_geom.area
        fracs.append(max(0.0, min(1.0, frac)))

    hex_gdf["bushfire_prone_frac"] = fracs

    import numpy as np

    arr = np.array(fracs)
    n_any = int((arr > 0).sum())
    n_full = int((arr >= 0.99).sum())
    n_partial = int(((arr > 0) & (arr < 0.99)).sum())
    print(
        f"[bushfire] Cells with any BPA overlap: {n_any} "
        f"({n_full} ≥99% covered, {n_partial} partial)"
    )
    if n_any:
        print(
            f"[bushfire] Mean frac across overlapping cells: "
            f"{arr[arr > 0].mean():.3f}"
        )

    updates = [
        (float(row.bushfire_prone_frac), row.h3)
        for row in hex_gdf.itertuples(index=False)
    ]
    con.executemany(
        "UPDATE hex SET bushfire_prone_frac = ? WHERE h3 = ?",
        updates,
    )
    con.commit()
    con.close()

    today = dt.date.today().isoformat()
    _log(
        f"{today} | OBRM-024 | bushfire | statewide | {len(bpa)} BPA polygons | "
        f"{n_any}/{len(hex_gdf)} cells with overlap"
    )
    snapshot()


if __name__ == "__main__":
    ingest()
