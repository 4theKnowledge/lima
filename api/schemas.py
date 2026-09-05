"""Pydantic response schemas.

Kept flat and JSON-friendly. `None` maps to `null` — the frontend treats
that as no-data and renders the reserved teal tint.
"""

from __future__ import annotations

from pydantic import BaseModel


class HexCell(BaseModel):
    h3: str
    lga: str | None
    excluded: bool
    exclusion_reasons: list[str] | None

    # scoring
    suitability_score: float | None
    factor_water: float | None
    factor_rainfall: float | None
    factor_soil: float | None
    factor_access: float | None
    factor_bushfire: float | None

    # raw layers surfaced in the map
    parcel_count: int | None
    parcel_area_median_ha: float | None
    gw_proclaimed: bool | None
    sw_proclaimed: bool | None
    salinity_idx: int | None
    bushfire_prone_frac: float | None
    capability_class: int | None
    dist_townsite_km: float | None
    dist_sealed_road_km: float | None
    dbca_estate_frac: float | None
    gsr_mean_mm: float | None
    gsr_trend: float | None
    summer_max_temp_c: float | None
    winter_min_temp_c: float | None
    evap_annual_mm: float | None
    solar_annual_mj: float | None
    vp_annual_hpa: float | None
    # Defaults to None so the API still works when the columns haven't been
    # ALTERed onto the primary DB yet (e.g. between the schema edit and the
    # ingest that populates them). Once the columns exist the SELECT fills them.
    summer_max_trend_c_per_decade: float | None = None
    winter_min_trend_c_per_decade: float | None = None


class HexDetail(HexCell):
    """Everything the inspector needs. Includes text labels + confidence."""

    gw_area_name: str | None
    salinity_tds_class: str | None
    capability_confidence: float | None
    lc_graz_raw: str | None
    lc_dry_cro_raw: str | None
    lc_ann_hor_raw: str | None
    lc_per_hor_raw: str | None
    lc_vines_raw: str | None
    nearest_townsite_name: str | None
    nearest_sealed_road_name: str | None
    dbca_category: str | None


class ParcelSummary(BaseModel):
    n: int
    mean_ha: float | None
    median_ha: float | None
    min_ha: float | None
    max_ha: float | None
    total_ha: float | None


class Weights(BaseModel):
    water: float
    rainfall: float
    soil: float
    access: float
    bushfire: float


class Exclusions(BaseModel):
    gsr_mean_mm_below: int | None = None
    capability_class_at_or_above: int | None = None
    salinity_idx_at_or_above: int | None = None
    dbca_estate_frac_above: float | None = None
    # Climate — SILO 1991-2020 baseline. Range hints in the UI:
    #   summer_max: ~28-40°C. Excludes at/above (heat stress).
    #   winter_min: ~-2 to 12°C. Excludes at/below (frost sensitivity).
    summer_max_temp_c_above: float | None = None
    winter_min_temp_c_below: float | None = None


class Sensitivity(BaseModel):
    run_at: str | None
    verdict: str | None
    min_rho_cell: float | None
    min_rho_lga: float | None


class GeocodeResult(BaseModel):
    lat: float
    lng: float
    display_name: str
    h3: str


class Health(BaseModel):
    ok: bool
    snapshot_mtime: float
    hex_count: int
    # Best-effort build identifier (git SHA or similar) so the client can
    # detect deploys and prompt for reload. `None` when unset — treated as
    # "unknown, don't compare".
    build_id: str | None = None


class DataSource(BaseModel):
    """Per-source freshness. Populated from what's actually in the DB —
    coverage of key columns — plus the mtime of any raw cache file that
    corresponds to the source. The point isn't to be exact; it's to give
    the operator a "how stale is this?" gut check."""

    key: str            # short id ("cadastre", "rainfall", ...)
    label: str          # UI-facing name
    rows_populated: int  # hex cells with a non-null value on the key column
    last_ingest: str | None  # ISO timestamp, best-effort
    source_url: str | None = None  # canonical landing page (DataWA / SILO)


class DataStatus(BaseModel):
    snapshot_mtime: float
    snapshot_iso: str
    hex_count: int
    parcel_count: int
    n_lgas: int
    n_scored: int
    n_excluded: int
    sources: list[DataSource]
