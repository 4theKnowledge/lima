"""HTTP routes for Lima.

Rules of engagement:
  - Read paths never mutate. Weight/exclusion PUTs re-use the existing
    scoring/exclude.py + scoring/score.py modules verbatim so the semantics
    match the Streamlit app exactly.
  - Bulk /hex is the hot path — served as one big JSON array. We rely on
    factor_* columns being cached so the frontend can re-score client-side
    without another round-trip.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import h3 as h3lib
import httpx
import yaml
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from api.db import connect, snapshot_mtime
from api.schemas import (
    DataSource,
    DataStatus,
    Exclusions,
    GeocodeResult,
    Health,
    HexCell,
    HexDetail,
    ParcelSummary,
    Purpose,
    Sensitivity,
    Weights,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEIGHTS_PATH = PROJECT_ROOT / "scoring" / "weights.yaml"
PURPOSES_PATH = PROJECT_ROOT / "scoring" / "purposes.yaml"
SENSITIVITY_DIR = PROJECT_ROOT / "notes" / "sensitivity"

# Best-effort deploy identifier. Set BUILD_ID (or fall back to Railway's
# RAILWAY_GIT_COMMIT_SHA) in the container env; the frontend polls /health
# and compares this value to detect deploys.
BUILD_ID = os.getenv("BUILD_ID") or os.getenv("RAILWAY_GIT_COMMIT_SHA") or None

router = APIRouter()


HEX_COLUMNS = """
    h3, lga,
    COALESCE(excluded, FALSE) AS excluded,
    exclusion_reasons,
    suitability_score,
    factor_water, factor_rainfall, factor_soil, factor_access, factor_bushfire, factor_scale,
    parcel_count, parcel_area_median_ha,
    gw_proclaimed, sw_proclaimed,
    salinity_idx, bushfire_prone_frac,
    capability_class,
    dist_townsite_km, dist_sealed_road_km,
    dbca_estate_frac,
    gsr_mean_mm, gsr_trend,
    summer_max_temp_c, winter_min_temp_c,
    evap_annual_mm, solar_annual_mj, vp_annual_hpa,
    summer_max_trend_c_per_decade, winter_min_trend_c_per_decade,
    pop_density_per_km2
"""


def _row_to_dict(cursor, row: tuple) -> dict[str, Any]:
    return dict(zip([c[0] for c in cursor.description], row, strict=True))


@router.get("/health", response_model=Health)
def health() -> Health:
    con = connect()
    n = con.execute("SELECT COUNT(*) FROM hex").fetchone()[0]
    con.close()
    return Health(
        ok=True,
        snapshot_mtime=snapshot_mtime(),
        hex_count=n,
        build_id=BUILD_ID,
    )


# Per-source coverage columns. Rows-populated is "how many hex cells have a
# non-null value on this column" — a rough proxy for "did the ingest run".
# source_url is the canonical DataWA/SILO landing page for each dataset, so
# the Data tab can render an outbound link next to each row.
_SOURCE_COLUMNS = [
    (
        "groundwater",
        "Groundwater proclamation (DWER-034)",
        "gw_proclaimed",
        "https://catalogue.data.wa.gov.au/dataset/riwi-act-groundwater-areas-dwer-034",
    ),
    (
        "surface_water",
        "Surface water proclamation (DWER-037)",
        "sw_proclaimed",
        "https://catalogue.data.wa.gov.au/dataset/riwi-act-surface-water-areas-dwer-037",
    ),
    (
        "salinity",
        "Groundwater salinity (DWER-026)",
        "salinity_idx",
        "https://catalogue.data.wa.gov.au/dataset/hydrogeochemistry-groundwater-salinity-statewide-dwer-026",
    ),
    (
        "soils",
        "Soil capability (DPIRD-027)",
        "capability_class",
        "https://catalogue.data.wa.gov.au/dataset/rangeland-land-systems-mapping-dpird-027",
    ),
    (
        "bushfire",
        "Bushfire prone areas (OBRM-024)",
        "bushfire_prone_frac",
        "https://catalogue.data.wa.gov.au/dataset/bushfire-prone-areas-obrm-024",
    ),
    (
        "roads",
        "Sealed roads (LGATE-195)",
        "dist_sealed_road_km",
        "https://catalogue.data.wa.gov.au/dataset/roads-lgate-195",
    ),
    (
        "townsites",
        "Townsites (LGATE-248)",
        "dist_townsite_km",
        "https://catalogue.data.wa.gov.au/dataset/townsites-lgate-248",
    ),
    (
        "dbca",
        "DBCA managed land",
        "dbca_estate_frac",
        "https://catalogue.data.wa.gov.au/dataset/dbca-legislated-lands-and-waters-dbca-011",
    ),
    (
        "rainfall",
        "SILO growing-season rainfall",
        "gsr_mean_mm",
        "https://www.longpaddock.qld.gov.au/silo/gridded-data/",
    ),
    (
        "summer_max_temp",
        "SILO summer max temperature (Dec-Feb)",
        "summer_max_temp_c",
        "https://www.longpaddock.qld.gov.au/silo/gridded-data/",
    ),
    (
        "winter_min_temp",
        "SILO winter min temperature (Jun-Aug)",
        "winter_min_temp_c",
        "https://www.longpaddock.qld.gov.au/silo/gridded-data/",
    ),
    (
        "evap",
        "SILO annual pan evaporation",
        "evap_annual_mm",
        "https://www.longpaddock.qld.gov.au/silo/gridded-data/",
    ),
    (
        "solar",
        "SILO solar radiation",
        "solar_annual_mj",
        "https://www.longpaddock.qld.gov.au/silo/gridded-data/",
    ),
    (
        "vp",
        "SILO vapour pressure",
        "vp_annual_hpa",
        "https://www.longpaddock.qld.gov.au/silo/gridded-data/",
    ),
    (
        "population",
        "Population density (ABS 2021 SA1)",
        "pop_density_per_km2",
        "https://www.abs.gov.au/census/find-census-data/datapacks",
    ),
]


def _last_ingest_iso() -> str | None:
    """Best-effort: the mtime of DATA_LOG.md as a proxy for 'last ingest run'.

    The log is appended on every ingest, so its mtime tracks the freshest
    ingest. Per-source timestamps would require parsing the log — deferred
    until the shape stabilises.
    """
    import datetime as dt
    log = PROJECT_ROOT / "notes" / "DATA_LOG.md"
    if not log.exists():
        return None
    return dt.datetime.fromtimestamp(log.stat().st_mtime).astimezone().isoformat(timespec="seconds")


@router.get("/data-status", response_model=DataStatus)
def data_status() -> DataStatus:
    import datetime as dt

    con = connect()
    hex_count, n_scored, n_excluded = con.execute(
        """
        SELECT COUNT(*),
               SUM(CASE WHEN suitability_score IS NOT NULL THEN 1 ELSE 0 END),
               SUM(CASE WHEN excluded THEN 1 ELSE 0 END)
        FROM hex
        """
    ).fetchone()
    parcel_count = con.execute("SELECT COUNT(*) FROM parcel").fetchone()[0]
    n_lgas = con.execute(
        "SELECT COUNT(DISTINCT lga) FROM hex WHERE lga IS NOT NULL"
    ).fetchone()[0]

    log_iso = _last_ingest_iso()
    sources: list[DataSource] = []
    for key, label, col, source_url in _SOURCE_COLUMNS:
        n = con.execute(
            f"SELECT COUNT(*) FROM hex WHERE {col} IS NOT NULL"
        ).fetchone()[0]
        sources.append(
            DataSource(
                key=key,
                label=label,
                rows_populated=int(n),
                last_ingest=log_iso,
                source_url=source_url,
            )
        )
    con.close()

    mtime = snapshot_mtime()
    return DataStatus(
        snapshot_mtime=mtime,
        snapshot_iso=dt.datetime.fromtimestamp(mtime).astimezone().isoformat(timespec="seconds"),
        hex_count=int(hex_count or 0),
        parcel_count=int(parcel_count or 0),
        n_lgas=int(n_lgas or 0),
        n_scored=int(n_scored or 0),
        n_excluded=int(n_excluded or 0),
        sources=sources,
    )


@router.get("/lgas", response_model=list[str])
def list_lgas() -> list[str]:
    con = connect()
    rows = con.execute(
        "SELECT DISTINCT lga FROM hex WHERE lga IS NOT NULL ORDER BY lga"
    ).fetchall()
    con.close()
    return [r[0] for r in rows]


@router.get("/hex")
def get_hex(
    lgas: list[str] | None = Query(default=None),
) -> Response:
    """Bulk hex slice — the hot path.

    Deliberately does NOT declare response_model=list[HexCell]. Doing so
    forces FastAPI to run jsonable_encoder over ~11k rows on every request,
    which measures at ~200 ms of pure CPU for our payload — an order of
    magnitude more than the SQL itself. The wire shape is identical either
    way (json.dumps on the same dicts), and the schema is fixed by the
    HEX_COLUMNS SELECT list, so runtime validation adds no safety here.
    """
    con = connect()
    if lgas:
        placeholders = ", ".join(["?"] * len(lgas))
        cursor = con.execute(
            f"SELECT {HEX_COLUMNS} FROM hex WHERE lga IN ({placeholders})",
            list(lgas),
        )
    else:
        cursor = con.execute(f"SELECT {HEX_COLUMNS} FROM hex")
    rows = cursor.fetchall()
    cols = [c[0] for c in cursor.description]
    con.close()
    dicts = [dict(zip(cols, r, strict=True)) for r in rows]
    # default=str handles datetime / Decimal / anything else DuckDB might
    # surface; we still control the SELECT list so surprises are limited.
    body = json.dumps(dicts, default=str, separators=(",", ":"))
    return Response(content=body, media_type="application/json")


@router.get("/hex/{h3}", response_model=HexDetail)
def get_hex_detail(h3: str) -> HexDetail:
    con = connect()
    cursor = con.execute(
        f"""
        SELECT {HEX_COLUMNS},
               gw_area_name, salinity_tds_class, capability_confidence,
               lc_graz_raw, lc_dry_cro_raw, lc_ann_hor_raw, lc_per_hor_raw, lc_vines_raw,
               nearest_townsite_name, nearest_sealed_road_name, dbca_category
        FROM hex WHERE h3 = ?
        """,
        [h3],
    )
    row = cursor.fetchone()
    if row is None:
        con.close()
        raise HTTPException(status_code=404, detail=f"hex {h3} not found")
    d = _row_to_dict(cursor, row)
    con.close()
    return HexDetail(**d)


@router.get("/parcels/{h3}/summary", response_model=ParcelSummary)
def parcel_summary(h3: str) -> ParcelSummary:
    con = connect()
    row = con.execute(
        """
        SELECT COUNT(*) AS n,
               AVG(area_ha) AS mean_ha,
               MEDIAN(area_ha) AS median_ha,
               MIN(area_ha) AS min_ha,
               MAX(area_ha) AS max_ha,
               SUM(area_ha) AS total_ha
        FROM parcel WHERE h3 = ?
        """,
        [h3],
    ).fetchone()
    con.close()
    return ParcelSummary(
        n=int(row[0]),
        mean_ha=row[1],
        median_ha=row[2],
        min_ha=row[3],
        max_ha=row[4],
        total_ha=row[5],
    )


def _load_weights_yaml() -> dict:
    with WEIGHTS_PATH.open() as f:
        return yaml.safe_load(f)


@router.get("/weights", response_model=Weights)
def get_weights() -> Weights:
    return Weights(**_load_weights_yaml()["weights"])


@router.get("/exclusions", response_model=Exclusions)
def get_exclusions() -> Exclusions:
    ex = _load_weights_yaml().get("exclusions", {})
    return Exclusions(
        gsr_mean_mm_below=ex.get("gsr_mean_mm_below"),
        capability_class_at_or_above=ex.get("capability_class_at_or_above"),
        salinity_idx_at_or_above=ex.get("salinity_idx_at_or_above"),
        dbca_estate_frac_above=ex.get("dbca_estate_frac_above"),
        summer_max_temp_c_above=ex.get("summer_max_temp_c_above"),
        winter_min_temp_c_below=ex.get("winter_min_temp_c_below"),
        pop_density_per_km2_above=ex.get("pop_density_per_km2_above"),
    )


@router.put("/exclusions", response_model=Exclusions)
def put_exclusions(body: Exclusions) -> Exclusions:
    """Persist thresholds to weights.yaml, then re-run exclude + score.

    Uses ruamel.yaml in round-trip mode so comments and formatting in
    weights.yaml survive the update. Earlier versions used pyyaml.safe_dump
    which flattened both — losing the operator-facing documentation baked
    into the file.

    Publishes a fresh snapshot as a side effect (via scoring modules calling
    db.snapshot.snapshot()), so the next /hex fetch reflects the change.
    """
    from ruamel.yaml import YAML

    ryaml = YAML()          # default is round-trip: preserves comments + style
    ryaml.preserve_quotes = True
    # Match the file's original formatting: sequences under mappings are
    # indented two spaces past the key, with the "- " itself sitting at
    # offset 2 (i.e. `curves:\n  rainfall_level:\n    - [...]`). Without
    # this ruamel dedents the sequences to column 0 and re-flows them.
    ryaml.indent(mapping=2, sequence=4, offset=2)
    with WEIGHTS_PATH.open() as f:
        cfg = ryaml.load(f)

    exclusions = cfg.setdefault("exclusions", {})
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            exclusions[field] = value

    with WEIGHTS_PATH.open("w") as f:
        ryaml.dump(cfg, f)

    from scoring.exclude import apply as apply_exclusions
    from scoring.score import compute as compute_scores

    apply_exclusions()
    compute_scores()
    return get_exclusions()


# ---------------------------------------------------------------------------
# Purposes — named bundles of weights + exclusions + scale curve.
# See scoring/purposes.yaml.
# ---------------------------------------------------------------------------


def _load_purposes_yaml() -> dict:
    with PURPOSES_PATH.open() as f:
        return yaml.safe_load(f)


def _purpose_from_yaml(pid: str, spec: dict) -> Purpose:
    """Materialise a Purpose. Missing exclusion keys fall through to the
    current weights.yaml values (so a Purpose can be opinionated only where
    it needs to be)."""
    cur_ex = _load_weights_yaml().get("exclusions", {})
    ex_yaml = spec.get("exclusions", {}) or {}
    return Purpose(
        id=pid,
        label=spec["label"],
        description=spec.get("description", "").strip(),
        weights=Weights(**spec["weights"]),
        scale_curve=spec["scale_curve"],
        exclusions=Exclusions(
            gsr_mean_mm_below=ex_yaml.get("gsr_mean_mm_below", cur_ex.get("gsr_mean_mm_below")),
            capability_class_at_or_above=ex_yaml.get(
                "capability_class_at_or_above", cur_ex.get("capability_class_at_or_above")
            ),
            salinity_idx_at_or_above=ex_yaml.get(
                "salinity_idx_at_or_above", cur_ex.get("salinity_idx_at_or_above")
            ),
            dbca_estate_frac_above=ex_yaml.get(
                "dbca_estate_frac_above", cur_ex.get("dbca_estate_frac_above")
            ),
            summer_max_temp_c_above=ex_yaml.get(
                "summer_max_temp_c_above", cur_ex.get("summer_max_temp_c_above")
            ),
            winter_min_temp_c_below=ex_yaml.get(
                "winter_min_temp_c_below", cur_ex.get("winter_min_temp_c_below")
            ),
            pop_density_per_km2_above=ex_yaml.get(
                "pop_density_per_km2_above", cur_ex.get("pop_density_per_km2_above")
            ),
        ),
    )


@router.get("/purposes", response_model=list[Purpose])
def list_purposes() -> list[Purpose]:
    """All Purposes defined in scoring/purposes.yaml. Order preserved."""
    doc = _load_purposes_yaml()
    return [_purpose_from_yaml(pid, spec) for pid, spec in doc.items()]


@router.get("/purpose/{pid}", response_model=Purpose)
def get_purpose(pid: str) -> Purpose:
    doc = _load_purposes_yaml()
    if pid not in doc:
        raise HTTPException(status_code=404, detail=f"purpose {pid!r} not found")
    return _purpose_from_yaml(pid, doc[pid])


@router.put("/purpose/{pid}/apply", response_model=Purpose)
def apply_purpose(pid: str) -> Purpose:
    """Apply a Purpose: merge its weights, scale_curve, and (non-null) exclusion
    values into scoring/weights.yaml, then re-run exclude + score.

    Uses ruamel.yaml round-trip so comments and formatting in weights.yaml are
    preserved (same as PUT /exclusions).
    """
    doc = _load_purposes_yaml()
    if pid not in doc:
        raise HTTPException(status_code=404, detail=f"purpose {pid!r} not found")
    spec = doc[pid]

    from ruamel.yaml import YAML

    ryaml = YAML()
    ryaml.preserve_quotes = True
    ryaml.indent(mapping=2, sequence=4, offset=2)
    with WEIGHTS_PATH.open() as f:
        cfg = ryaml.load(f)

    # Weights overwrite in full (Purpose weights sum to 1.0 by contract).
    weights_out = cfg.setdefault("weights", {})
    for k, v in spec["weights"].items():
        weights_out[k] = float(v)

    # Scale curve — top-level key.
    cfg["scale_curve"] = str(spec["scale_curve"])

    # Exclusions merge — only non-null Purpose values override.
    ex_out = cfg.setdefault("exclusions", {})
    for k, v in (spec.get("exclusions") or {}).items():
        if v is not None:
            ex_out[k] = v

    with WEIGHTS_PATH.open("w") as f:
        ryaml.dump(cfg, f)

    from scoring.exclude import apply as apply_exclusions
    from scoring.score import compute as compute_scores

    apply_exclusions()
    compute_scores()
    return _purpose_from_yaml(pid, spec)


@router.get("/sensitivity/latest", response_model=Sensitivity)
def latest_sensitivity() -> Sensitivity:
    import json

    if not SENSITIVITY_DIR.exists():
        return Sensitivity(run_at=None, verdict=None, min_rho_cell=None, min_rho_lga=None)
    files = sorted(SENSITIVITY_DIR.glob("*.json"))
    if not files:
        return Sensitivity(run_at=None, verdict=None, min_rho_cell=None, min_rho_lga=None)
    payload = json.loads(files[-1].read_text())
    return Sensitivity(
        run_at=payload.get("run_at"),
        verdict=payload.get("verdict"),
        min_rho_cell=payload.get("min_rho_cell"),
        min_rho_lga=payload.get("min_rho_lga"),
    )


@router.get("/geocode", response_model=GeocodeResult | None)
def geocode(q: str = Query(min_length=1)) -> GeocodeResult | None:
    """OpenStreetMap Nominatim, AU-biased. Returns None if no match.

    Rate-limited by Nominatim to 1 req/sec; we do a single per-call fetch and
    trust the frontend not to spam it. Move to a caching proxy if that ever
    stops being true.
    """
    r = httpx.get(
        "https://nominatim.openstreetmap.org/search",
        params={"q": q, "format": "jsonv2", "countrycodes": "au", "limit": 1},
        headers={"User-Agent": "lima (personal use)"},
        timeout=15.0,
    )
    r.raise_for_status()
    results = r.json()
    if not results:
        return None
    top = results[0]
    lat, lng = float(top["lat"]), float(top["lon"])
    cfg = _load_weights_yaml()
    resolution = int(cfg.get("h3", {}).get("resolution", 7))
    return GeocodeResult(
        lat=lat,
        lng=lng,
        display_name=top.get("display_name", q),
        h3=h3lib.latlng_to_cell(lat, lng, resolution),
    )
