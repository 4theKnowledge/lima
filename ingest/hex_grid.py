"""Generate H3 hex cells covering an LGA and aggregate parcel stats per cell.

This is M2: takes an LGA polygon (from LGATE-233) and the parcels already
loaded in `parcel` (from M1), produces rows in the `hex` table.

Aggregation approach:
- Every parcel is assigned to a single H3 cell by the H3 index of its
  centroid. Simpler and cheaper than polygon-in-polygon; the M0 brief's
  aggregation goals (count, median area per cell) don't need per-vertex
  precision at res 7 (~5 km² cells).
- Cells with zero parcels are still emitted so the map shows the whole LGA
  as a coherent surface (not just gruyère holes where nothing lives).

Storage geometry for hex cells is EPSG:7844 (matching the parcel table).

Run:
    uv run python -m ingest.hex_grid                             # default LGA + res
    uv run python -m ingest.hex_grid --lga "MANJIMUP, SHIRE OF" --resolution 7
"""

from __future__ import annotations

import argparse
import datetime as dt

import geopandas as gpd
import h3
import yaml
from shapely.geometry import Polygon

from db.bootstrap import connect
from db.snapshot import snapshot
from ingest.cadastre import (
    DATA_LOG,
    PROJECT_ROOT,
    STORAGE_CRS,
    _slugify,
    load_lga,
)

WEIGHTS_PATH = PROJECT_ROOT / "scoring" / "weights.yaml"


def _log(line: str) -> None:
    with DATA_LOG.open("a") as f:
        f.write(line.rstrip() + "\n")


def _load_resolution(cli_override: int | None) -> int:
    """Resolution defaults from weights.yaml (h3.resolution)."""
    if cli_override is not None:
        return cli_override
    with WEIGHTS_PATH.open() as f:
        cfg = yaml.safe_load(f)
    return int(cfg.get("h3", {}).get("resolution", 7))


def cells_covering_polygon(polygon: Polygon, resolution: int) -> list[str]:
    """Return H3 cell IDs whose interior touches the polygon.

    h3-py 4.x expects GeoJSON-style {type, coordinates} for `polygon_to_cells`.
    """
    geo_polygon = h3.LatLngPoly(
        [(lat, lng) for lng, lat in polygon.exterior.coords],
        *[[(lat, lng) for lng, lat in interior.coords] for interior in polygon.interiors],
    )
    return list(h3.polygon_to_cells(geo_polygon, resolution))


def cell_polygon(cell: str) -> Polygon:
    """H3 cell → shapely Polygon in lon/lat (EPSG:7844-compatible)."""
    # h3 4.x returns [(lat, lng), ...]; shapely wants (lng, lat)
    ring = [(lng, lat) for lat, lng in h3.cell_to_boundary(cell)]
    return Polygon(ring)


def build_grid(lga_name: str, resolution: int) -> gpd.GeoDataFrame:
    """H3 cells covering the LGA, as a GeoDataFrame in EPSG:7844."""
    lga_gdf = load_lga(lga_name)
    lga_geom = lga_gdf.geometry.iloc[0]

    # If the LGA polygon is a MultiPolygon, sweep each part.
    parts = list(lga_geom.geoms) if lga_geom.geom_type == "MultiPolygon" else [lga_geom]
    all_cells: set[str] = set()
    for part in parts:
        all_cells.update(cells_covering_polygon(part, resolution))

    cells = sorted(all_cells)
    geoms = [cell_polygon(c) for c in cells]
    gdf = gpd.GeoDataFrame({"h3": cells}, geometry=geoms, crs=STORAGE_CRS)
    gdf["lga"] = lga_name
    return gdf


def aggregate_parcels_by_cell(lga_slug: str, resolution: int) -> dict[str, dict]:
    """For every parcel in this LGA, assign H3 cell via centroid; return per-cell stats.

    Returns {h3: {'parcel_count': n, 'parcel_area_median_ha': x}}.
    """
    con = connect()
    # DuckDB spatial: ST_Centroid + ST_X/ST_Y in EPSG:7844 (lat/lng)
    rows = con.execute(
        """
        SELECT
            parcel_id,
            area_ha,
            ST_Y(ST_Centroid(geom)) AS lat,
            ST_X(ST_Centroid(geom)) AS lng
        FROM parcel
        WHERE parcel_id LIKE ?
        """,
        [f"{lga_slug}::%"],
    ).fetchall()
    con.close()

    from collections import defaultdict
    from statistics import median

    per_cell_areas: dict[str, list[float]] = defaultdict(list)
    for _pid, area_ha, lat, lng in rows:
        cell = h3.latlng_to_cell(lat, lng, resolution)
        per_cell_areas[cell].append(float(area_ha))

    return {
        cell: {
            "parcel_count": len(areas),
            "parcel_area_median_ha": median(areas),
        }
        for cell, areas in per_cell_areas.items()
    }


def assign_parcel_h3(lga_slug: str, resolution: int) -> int:
    """Populate parcel.h3 for every parcel in this LGA. Returns rows updated."""
    con = connect()
    rows = con.execute(
        """
        SELECT parcel_id, ST_Y(ST_Centroid(geom)) AS lat, ST_X(ST_Centroid(geom)) AS lng
        FROM parcel WHERE parcel_id LIKE ?
        """,
        [f"{lga_slug}::%"],
    ).fetchall()
    updates = [
        (h3.latlng_to_cell(lat, lng, resolution), pid) for pid, lat, lng in rows
    ]
    con.executemany("UPDATE parcel SET h3 = ? WHERE parcel_id = ?", updates)
    con.commit()
    n = con.execute(
        "SELECT COUNT(*) FROM parcel WHERE parcel_id LIKE ? AND h3 IS NOT NULL",
        [f"{lga_slug}::%"],
    ).fetchone()[0]
    con.close()
    return n


def write_hex(grid: gpd.GeoDataFrame, stats: dict[str, dict], lga_name: str) -> int:
    """Replace this LGA's hex rows. Returns row count written.

    Border cells (an H3 hex covered by multiple LGAs) are assigned to the LGA
    whose polygon contains the cell CENTROID. This gives every cell exactly
    one owner LGA and makes the primary key work. If a cell was previously
    owned by a different LGA (e.g. we're ingesting Boyup Brook after Manjimup
    already claimed a border cell), the previous row is left alone — the
    current LGA only writes cells whose centroid falls inside its own polygon.

    Fringe cells (parcel centroids outside the LGA polygon) are written only
    if not already claimed by another LGA.
    """
    con = connect()
    con.execute("DELETE FROM hex WHERE lga = ?", [lga_name])

    lga_gdf = load_lga(lga_name)
    lga_geom = lga_gdf.geometry.iloc[0]

    grid_cells = set(grid["h3"])
    grid_wkb = {row["h3"]: wkb for row, wkb in zip(grid.to_dict(orient="records"),
                                                    grid.geometry.to_wkb(), strict=True)}
    fringe_cells = set(stats.keys()) - grid_cells
    all_cells = sorted(grid_cells | set(stats.keys()))

    # Which cells does the current LGA "own" — centroid falls inside its polygon.
    def _owns(cell: str) -> bool:
        lat, lng = h3.cell_to_latlng(cell)
        from shapely.geometry import Point
        return lga_geom.contains(Point(lng, lat))

    # Cells already claimed by another LGA (from a prior ingest run).
    existing = {
        r[0]: r[1]
        for r in con.execute(
            f"SELECT h3, lga FROM hex WHERE h3 IN ({','.join(['?'] * len(all_cells))})",
            all_cells,
        ).fetchall()
    }

    rows = []
    skipped_owned_elsewhere = 0
    skipped_border = 0
    for cell in all_cells:
        s = stats.get(cell, {"parcel_count": 0, "parcel_area_median_ha": None})
        prior_owner = existing.get(cell)
        if prior_owner is not None and prior_owner != lga_name:
            skipped_owned_elsewhere += 1
            continue
        # For grid cells we do the ownership check; for fringe cells we accept
        # them if unclaimed.
        if cell in grid_cells and not _owns(cell):
            skipped_border += 1
            continue

        if cell in grid_wkb:
            wkb_bytes = grid_wkb[cell]
        else:
            wkb_bytes = cell_polygon(cell).wkb
        rows.append((cell, wkb_bytes, lga_name, s["parcel_count"], s["parcel_area_median_ha"]))

    con.executemany(
        """
        INSERT INTO hex (h3, geom, lga, parcel_count, parcel_area_median_ha)
        VALUES (?, ST_GeomFromWKB(?), ?, ?, ?)
        """,
        rows,
    )
    con.commit()
    n = con.execute("SELECT COUNT(*) FROM hex WHERE lga = ?", [lga_name]).fetchone()[0]
    con.close()
    if fringe_cells:
        print(
            f"[hex_grid] Note: {len(fringe_cells)} fringe cells (parcel centroids "
            f"outside LGA polygon) also considered"
        )
    if skipped_border:
        print(
            f"[hex_grid] Note: {skipped_border} border cells assigned to neighbouring LGA "
            "(centroid falls outside this LGA polygon)"
        )
    if skipped_owned_elsewhere:
        print(
            f"[hex_grid] Note: {skipped_owned_elsewhere} cells left in place — already "
            "owned by another LGA from a prior ingest"
        )
    return n


def ingest(lga_name: str, resolution: int) -> None:
    lga_slug = _slugify(lga_name)
    print(f"[hex_grid] LGA={lga_name!r} slug={lga_slug!r} resolution={resolution}")

    grid = build_grid(lga_name, resolution)
    print(f"[hex_grid] Grid: {len(grid)} cells covering LGA")

    n_updated = assign_parcel_h3(lga_slug, resolution)
    print(f"[hex_grid] Assigned h3 to {n_updated} parcels")

    stats = aggregate_parcels_by_cell(lga_slug, resolution)
    cells_with_parcels = len(stats)
    parcel_total = sum(s["parcel_count"] for s in stats.values())
    print(
        f"[hex_grid] Aggregated: {cells_with_parcels} cells contain parcels, "
        f"{parcel_total} parcels total"
    )

    # Sanity check: aggregated count must equal parcels in this LGA (§8 M2 acceptance).
    con = connect()
    parcels_in_lga = con.execute(
        "SELECT COUNT(*) FROM parcel WHERE parcel_id LIKE ?",
        [f"{lga_slug}::%"],
    ).fetchone()[0]
    con.close()
    if parcel_total != parcels_in_lga:
        raise RuntimeError(
            f"Aggregation sanity check failed: "
            f"{parcel_total} aggregated vs {parcels_in_lga} parcels in LGA"
        )
    print(f"[hex_grid] Sanity: aggregated parcels ({parcel_total}) == LGA parcels ({parcels_in_lga}) ✓")

    n_written = write_hex(grid, stats, lga_name)
    print(f"[hex_grid] Wrote {n_written} hex rows")

    today = dt.date.today().isoformat()
    _log(
        f"{today} | h3 | grid | {lga_name} | resolution={resolution} | "
        f"{n_written} cells | {cells_with_parcels} with parcels | {parcel_total} parcels aggregated"
    )
    snapshot()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lga", default="BOYUP BROOK, SHIRE OF")
    parser.add_argument(
        "--resolution",
        type=int,
        default=None,
        help="H3 resolution (default from scoring/weights.yaml → h3.resolution)",
    )
    args = parser.parse_args()
    resolution = _load_resolution(args.resolution)
    ingest(args.lga, resolution)
