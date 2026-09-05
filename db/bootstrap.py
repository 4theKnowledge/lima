"""Create db/land.duckdb, load extensions, create empty tables per BUILD_BRIEF.md §5.

Idempotent: safe to re-run. Existing tables are left in place unless --reset is passed.

Run:
    uv run python -m db.bootstrap
    uv run python -m db.bootstrap --reset
"""

from __future__ import annotations

import argparse
from pathlib import Path

import duckdb

DB_PATH = Path(__file__).parent / "land.duckdb"

EXTENSIONS = ("spatial", "h3")

SCHEMA = """
CREATE TABLE IF NOT EXISTS hex (
    h3                    VARCHAR PRIMARY KEY,
    geom                  GEOMETRY,          -- EPSG:7844
    lga                   VARCHAR,

    -- water
    gw_proclaimed         BOOLEAN,
    gw_area_name          VARCHAR,
    sw_proclaimed         BOOLEAN,

    -- climate
    gsr_mean_mm           DOUBLE,            -- May-Oct mean, 1991-2020
    gsr_trend             DOUBLE,            -- mm/decade since 1970

    -- land
    capability_class      INTEGER,           -- 1 best .. 6 worst, modal within cell (default enterprise = grazing)
    capability_confidence DOUBLE,            -- fraction of cell covered by modal class
    lc_graz_raw           VARCHAR,           -- modal DPIRD code for grazing (A1..C2 or NA)
    lc_dry_cro_raw        VARCHAR,           -- modal DPIRD code for dryland cropping
    lc_ann_hor_raw        VARCHAR,           -- modal DPIRD code for annual horticulture
    lc_per_hor_raw        VARCHAR,           -- modal DPIRD code for perennial horticulture
    lc_vines_raw          VARCHAR,           -- modal DPIRD code for vineyards
    slope_mean_pct        DOUBLE,

    -- water quality
    salinity_idx          INTEGER,           -- DWER-026 salinity_i ordinal, 1 (fresh) .. 10 (hypersaline)
    salinity_tds_class    VARCHAR,           -- human-readable TDS range e.g. '<500', '3000-7000'

    -- constraints
    bushfire_prone_frac   DOUBLE,            -- 0..1 area fraction

    -- access
    dist_sealed_road_km   DOUBLE,
    nearest_sealed_road_name VARCHAR,
    dist_townsite_km      DOUBLE,
    nearest_townsite_name VARCHAR,

    -- tenure (DBCA managed land = not for sale)
    dbca_estate_frac      DOUBLE,            -- 0..1 fraction of cell inside DBCA estate
    dbca_category         VARCHAR,           -- modal DBCA category e.g. 'National Park'

    -- parcels
    parcel_count          INTEGER,
    parcel_area_median_ha DOUBLE,

    -- exclusion (Stage 1 hard mask; excluded cells stay in the table)
    excluded              BOOLEAN DEFAULT FALSE,
    exclusion_reasons     VARCHAR[],

    -- Stage 2 scoring output (per scoring/score.py). NULL on excluded cells
    -- or where a required input is missing. Sub-scores stored so the UI can
    -- display decomposition per §7 without recomputing.
    suitability_score     DOUBLE,           -- 0..1 weighted sum on survivors
    factor_water          DOUBLE,           -- 0..1 water sub-score
    factor_rainfall       DOUBLE,           -- 0..1 rainfall level × trend penalty
    factor_soil           DOUBLE,           -- 0..1 soil capability sub-score
    factor_access         DOUBLE,           -- 0..1 combined road + townsite
    factor_bushfire       DOUBLE            -- 0..1 inverse of BPA fraction
);

CREATE TABLE IF NOT EXISTS parcel (
    parcel_id   VARCHAR PRIMARY KEY,
    h3          VARCHAR,
    geom        GEOMETRY,
    area_ha     DOUBLE,
    lot_on_plan VARCHAR,
    tenure      VARCHAR
);

CREATE TABLE IF NOT EXISTS price_locality (
    locality      VARCHAR,
    lga           VARCHAR,
    median_per_ha DOUBLE,
    n_sales       INTEGER,
    period        VARCHAR
);
"""


def connect(db_path: Path = DB_PATH) -> duckdb.DuckDBPyConnection:
    """Open a DuckDB connection with spatial + h3 loaded."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path))
    for ext in EXTENSIONS:
        # h3 lives in the community repo; spatial is core.
        if ext == "h3":
            con.execute("INSTALL h3 FROM community; LOAD h3;")
        else:
            con.execute(f"INSTALL {ext}; LOAD {ext};")
    return con


def bootstrap(reset: bool = False) -> None:
    if reset and DB_PATH.exists():
        DB_PATH.unlink()
        print(f"Removed existing {DB_PATH}")

    con = connect()
    con.execute(SCHEMA)
    tables = [r[0] for r in con.execute("SHOW TABLES").fetchall()]
    print(f"DB ready at {DB_PATH}")
    print(f"Extensions loaded: {', '.join(EXTENSIONS)}")
    print(f"Tables: {', '.join(sorted(tables))}")
    con.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="Delete DB and recreate")
    args = parser.parse_args()
    bootstrap(reset=args.reset)
