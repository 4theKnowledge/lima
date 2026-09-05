"""Load cadastre parcels for a single LGA into the DuckDB `parcel` table.

MVP uses LGATE-001 (Cadastre No Attributes, free) filtered to Boyup Brook via
spatial join against LGATE-233 (LGA Boundaries). Both are read from zipped
GeoPackages in `cache/raw/` via GDAL's `/vsizip/` virtual filesystem.

Run:
    uv run python -m ingest.cadastre                 # default: Boyup Brook
    uv run python -m ingest.cadastre --lga "Manjimup"

Per BUILD_BRIEF.md §2, geometry is stored in EPSG:7844 (GDA2020 geographic)
and area is computed in EPSG:7850 (MGA2020 Zone 50, covers all of SWWA).
"""

from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path

import geopandas as gpd

from db.bootstrap import connect
from db.snapshot import snapshot

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CACHE_RAW = PROJECT_ROOT / "cache" / "raw"
DATA_LOG = PROJECT_ROOT / "notes" / "DATA_LOG.md"

CADASTRE_ZIP = (
    CACHE_RAW
    / "cadastre"
    / "Cadastre_No_Attributes_LGATE_001_WA_GDA2020_Public_Geopackage.zip"
)
CADASTRE_GPKG_INNER = "Cadastre_No_Attributes_LGATE_001_WA_GDA2020_Public.gpkg"

LGA_ZIP = (
    CACHE_RAW
    / "boundaries"
    / "LGA_Boundaries_LGATE_233_WA_GDA2020_Public_Geopackage.zip"
)
LGA_GPKG_INNER = "LGA_Boundaries_LGATE_233_WA_GDA2020_Public.gpkg"

STORAGE_CRS = "EPSG:7844"   # GDA2020 geographic — what we persist
COMPUTE_CRS = "EPSG:7850"   # MGA2020 Zone 50 — for area/distance maths in SWWA


def _vsizip(zip_path: Path, inner: str) -> str:
    """Return a GDAL /vsizip/ URI for a file inside a zip archive."""
    return f"/vsizip/{zip_path}/{inner}"


def _slugify(name: str) -> str:
    """LGA name → SQL/URL-safe slug. 'BOYUP BROOK, SHIRE OF' → 'boyup_brook'."""
    base = name.lower().split(",")[0].strip()
    return "_".join(base.split())


def _log(line: str) -> None:
    with DATA_LOG.open("a") as f:
        f.write(line.rstrip() + "\n")


def load_lga(lga_name: str) -> gpd.GeoDataFrame:
    """Read one LGA polygon from LGATE-233 by name."""
    src = _vsizip(LGA_ZIP, LGA_GPKG_INNER)
    # Predicate pushdown via SQL keeps memory small.
    where = f"name = '{lga_name}'"
    gdf = gpd.read_file(src, where=where)
    if gdf.empty:
        raise RuntimeError(
            f"No LGA polygon found for name={lga_name!r} in {LGA_ZIP.name}. "
            f"Names are case-sensitive; check `pyogrio.read_info` or the dataset."
        )
    if len(gdf) > 1:
        # LGAs occasionally have exclave polygons — dissolve to one row.
        gdf = gdf.dissolve(by="name", as_index=False)
    assert gdf.crs is not None and gdf.crs.to_string() == STORAGE_CRS, (
        f"LGA CRS mismatch: expected {STORAGE_CRS}, got {gdf.crs}"
    )
    return gdf


def load_parcels_for_lga(lga_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Read cadastre parcels that intersect the LGA polygon."""
    src = _vsizip(CADASTRE_ZIP, CADASTRE_GPKG_INNER)
    # Use pyogrio's bbox filter to prune before reading full geometries —
    # scans 2M rows without this.
    bbox = tuple(lga_gdf.total_bounds)  # (minx, miny, maxx, maxy) in STORAGE_CRS
    parcels = gpd.read_file(src, bbox=bbox)
    assert parcels.crs is not None and parcels.crs.to_string() == STORAGE_CRS, (
        f"Cadastre CRS mismatch: expected {STORAGE_CRS}, got {parcels.crs}"
    )

    # Refine bbox pre-filter to true intersect with the LGA polygon.
    lga_geom = lga_gdf.geometry.iloc[0]
    parcels = parcels[parcels.geometry.intersects(lga_geom)].copy()
    parcels.reset_index(drop=True, inplace=True)
    return parcels


def compute_area_ha(parcels: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Compute area in hectares in the projected CRS, store back on the GDF.

    Storage geometry stays in EPSG:7844.
    """
    projected = parcels.geometry.to_crs(COMPUTE_CRS)
    parcels = parcels.copy()
    parcels["area_ha"] = projected.area / 10_000.0  # m² -> ha
    return parcels


def write_parcels(parcels: gpd.GeoDataFrame, lga_name: str) -> int:
    """Replace the `parcel` table rows for this LGA. Returns row count written."""
    con = connect()
    # DuckDB spatial can read a WKB blob. Build an ID from row index because
    # LGATE-001 has no stable parcel ID column — synthesise one that's stable
    # per (lga, ordinal) so re-runs are idempotent for the same LGA slice.
    parcels = parcels.copy()
    lga_slug = _slugify(lga_name)
    parcels["parcel_id"] = [f"{lga_slug}::{i}" for i in range(len(parcels))]
    parcels["lot_on_plan"] = None
    parcels["tenure"] = None
    parcels["h3"] = None  # populated later in M2

    # Serialise geometry to WKB for DuckDB.
    wkb = parcels.geometry.to_wkb()
    rows = list(
        zip(
            parcels["parcel_id"],
            parcels["h3"],
            wkb,
            parcels["area_ha"],
            parcels["lot_on_plan"],
            parcels["tenure"],
            strict=True,
        )
    )

    # Idempotent for this LGA: delete this LGA's rows, then insert.
    con.execute("DELETE FROM parcel WHERE parcel_id LIKE ?", [f"{lga_slug}::%"])
    con.executemany(
        """
        INSERT INTO parcel (parcel_id, h3, geom, area_ha, lot_on_plan, tenure)
        VALUES (?, ?, ST_GeomFromWKB(?), ?, ?, ?)
        """,
        rows,
    )
    con.commit()
    count = con.execute(
        "SELECT COUNT(*) FROM parcel WHERE parcel_id LIKE ?",
        [f"{lga_slug}::%"],
    ).fetchone()[0]
    con.close()
    return count


def ingest(lga_name: str) -> None:
    print(f"[cadastre] LGA={lga_name!r}")
    lga_gdf = load_lga(lga_name)
    print(f"[cadastre] LGA polygon loaded: {lga_gdf.geometry.iloc[0].bounds}")

    parcels = load_parcels_for_lga(lga_gdf)
    n_raw = len(parcels)
    print(f"[cadastre] Parcels intersecting LGA: {n_raw}")

    parcels = compute_area_ha(parcels)
    print(
        f"[cadastre] Area computed (EPSG:7850). "
        f"Sum={parcels['area_ha'].sum():.0f} ha, "
        f"median={parcels['area_ha'].median():.2f} ha, "
        f"max={parcels['area_ha'].max():.0f} ha"
    )

    n_written = write_parcels(parcels, lga_name)
    print(f"[cadastre] Wrote {n_written} rows to parcel table")

    today = dt.date.today().isoformat()
    _log(
        f"{today} | LGATE-001 | cadastre | {lga_name} | {n_raw} parcels intersecting | "
        f"{n_written} written | area_sum={parcels['area_ha'].sum():.0f}ha"
    )
    snapshot()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--lga",
        default="BOYUP BROOK, SHIRE OF",
        help="LGA name (must match `name` column in LGATE-233 exactly; e.g. 'BOYUP BROOK, SHIRE OF')",
    )
    args = parser.parse_args()
    ingest(args.lga)
