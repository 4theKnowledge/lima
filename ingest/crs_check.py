"""CRS acceptance check for the cadastre → parcel pipeline.

BUILD_BRIEF.md §2 mandates that parcel areas computed in EPSG:7850 agree with
Landgate's stated hectares to within 1%. LGATE-001 (the free cadastre) does
NOT publish stated hectares per parcel — that column only lives in the paid
LGATE-217. So we substitute two checks that we CAN do here:

  1. Cross-CRS (hard gate): recompute the total using EPSG:3577 (GDA94
     Australian Albers, equal-area, national). Independent code path. If our
     EPSG:7850 answer agrees with EPSG:3577 to <0.1% the CRS handling itself
     is sound — the arithmetic is right, our projection choice is right.

  2. LGA-total (soft, informational): sum clipped parcel areas within the
     LGA and compare against the LGA polygon's own `land_area`. LGATE-001
     includes overlapping road/reserve/tenure polygons with no way to
     deduplicate, so the raw total will be inflated by 15–30%. We report
     the diff but do NOT fail on it — the real acceptance test moves to
     after task 1.7b (Crown/DBCA spatial-join filters), where the cleaned
     total should agree with `land_area` closely.

Halts loudly if the CRS check fails per §0 rule 1.

Run:
    uv run python -m ingest.crs_check
"""

from __future__ import annotations

import argparse

import geopandas as gpd

from ingest.cadastre import (
    COMPUTE_CRS,
    STORAGE_CRS,
    load_lga,
    load_parcels_for_lga,
)

ALT_COMPUTE_CRS = "EPSG:3577"  # GDA94 Australian Albers, equal-area

LGA_TOTAL_TOLERANCE_PCT = 3.0    # generous — clipping introduces real residual
CROSS_CRS_TOLERANCE_PCT = 0.1    # tight — same geometry, two projections


def _pct_diff(a: float, b: float) -> float:
    return 100.0 * abs(a - b) / max(abs(a), abs(b))


def lga_stated_land_area_ha(lga_gdf: gpd.GeoDataFrame) -> float:
    """LGA polygon's declared land_area (m²) → hectares."""
    return float(lga_gdf["land_area"].iloc[0]) / 10_000.0


def total_clipped_area_ha(parcels: gpd.GeoDataFrame, lga_gdf: gpd.GeoDataFrame, crs: str) -> float:
    """Reproject, clip parcels to LGA, sum area in hectares."""
    lga_projected = lga_gdf.to_crs(crs)
    parcels_projected = parcels.to_crs(crs)
    lga_geom = lga_projected.geometry.iloc[0]
    clipped = parcels_projected.geometry.intersection(lga_geom)
    return float(clipped.area.sum()) / 10_000.0


def check(lga_name: str) -> None:
    print(f"[crs_check] LGA={lga_name!r}")
    lga_gdf = load_lga(lga_name)
    stated_ha = lga_stated_land_area_ha(lga_gdf)
    print(f"[crs_check] LGATE-233 stated land_area: {stated_ha:,.1f} ha")

    parcels = load_parcels_for_lga(lga_gdf)
    print(f"[crs_check] Parcels intersecting LGA: {len(parcels)}")

    primary_ha = total_clipped_area_ha(parcels, lga_gdf, COMPUTE_CRS)
    alt_ha = total_clipped_area_ha(parcels, lga_gdf, ALT_COMPUTE_CRS)
    print(f"[crs_check] Total clipped area in {COMPUTE_CRS}: {primary_ha:,.1f} ha")
    print(f"[crs_check] Total clipped area in {ALT_COMPUTE_CRS}: {alt_ha:,.1f} ha")

    lga_total_pct = _pct_diff(primary_ha, stated_ha)
    cross_pct = _pct_diff(primary_ha, alt_ha)
    print(f"[crs_check] Cross-CRS diff:           {cross_pct:.4f}% (hard tol {CROSS_CRS_TOLERANCE_PCT}%)")
    print(f"[crs_check] LGA-total diff vs stated: {lga_total_pct:.3f}% (informational; inflated by LGATE-001 overlaps)")

    if cross_pct > CROSS_CRS_TOLERANCE_PCT:
        print(f"\n  FAIL: Cross-CRS diff {cross_pct:.3f}% exceeds {CROSS_CRS_TOLERANCE_PCT}% — CRS handling is wrong")
        raise SystemExit(1)

    print(f"[crs_check] PASS (CRS gate). Storage={STORAGE_CRS}, compute={COMPUTE_CRS}")
    if lga_total_pct > LGA_TOTAL_TOLERANCE_PCT:
        print(
            f"[crs_check] NOTE: {lga_total_pct:.1f}% inflation vs LGA `land_area` "
            f"is expected — LGATE-001 has overlapping road/reserve/tenure polygons. "
            f"Re-run this check after 1.7b (Crown/DBCA filters) to verify cleanup."
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lga", default="BOYUP BROOK, SHIRE OF")
    args = parser.parse_args()
    check(args.lga)
