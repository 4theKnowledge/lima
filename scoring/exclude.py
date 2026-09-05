"""Stage 1 hard mask — applies exclusions from scoring/weights.yaml.

Populates hex.excluded (bool) and hex.exclusion_reasons (varchar[]) for every
cell in `hex`. Idempotent — recomputes both columns from current data on each
run, so re-running after loading a new layer picks up new exclusions.

Only checks rules for data we've actually ingested. Rules that reference a
column that is all-NULL (layer not yet loaded) are skipped so we don't
exclude every cell for "missing data".

Run:
    uv run python -m scoring.exclude
"""

from __future__ import annotations

from pathlib import Path

import yaml

from db.bootstrap import connect
from db.snapshot import snapshot

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEIGHTS_PATH = PROJECT_ROOT / "scoring" / "weights.yaml"


def load_rules() -> dict:
    with WEIGHTS_PATH.open() as f:
        cfg = yaml.safe_load(f)
    return cfg["exclusions"]


def _column_all_null(con, col: str) -> bool:
    row = con.execute(f"SELECT COUNT(*) FROM hex WHERE {col} IS NOT NULL").fetchone()
    return row[0] == 0


def apply() -> None:
    rules = load_rules()
    con = connect()

    # Build per-rule WHERE clauses + a matching human-readable reason label.
    # Skip any rule whose column is entirely NULL (layer not ingested yet).
    active: list[tuple[str, str, str]] = []   # (col, reason_label, sql_predicate)

    if rules.get("gsr_mean_mm_below") is not None and not _column_all_null(con, "gsr_mean_mm"):
        thresh = rules["gsr_mean_mm_below"]
        active.append(("gsr_mean_mm", f"rainfall<{thresh}mm", f"gsr_mean_mm < {thresh}"))

    if rules.get("capability_class_at_or_above") is not None and not _column_all_null(con, "capability_class"):
        thresh = rules["capability_class_at_or_above"]
        active.append(("capability_class", f"soil>=class{thresh}", f"capability_class >= {thresh}"))

    if rules.get("slope_mean_pct_above") is not None and not _column_all_null(con, "slope_mean_pct"):
        thresh = rules["slope_mean_pct_above"]
        active.append(("slope_mean_pct", f"slope>{thresh}%", f"slope_mean_pct > {thresh}"))

    if rules.get("parcel_count_below") is not None:
        thresh = rules["parcel_count_below"]
        # parcel_count is always populated (M2)
        active.append(("parcel_count", f"parcels<{thresh}", f"COALESCE(parcel_count, 0) < {thresh}"))

    if rules.get("exclude_if_gw_proclaimed"):
        active.append(("gw_proclaimed", "gw_proclaimed", "gw_proclaimed = TRUE"))

    if rules.get("salinity_idx_at_or_above") is not None and not _column_all_null(con, "salinity_idx"):
        thresh = rules["salinity_idx_at_or_above"]
        active.append(("salinity_idx", f"salinity>={thresh}", f"salinity_idx >= {thresh}"))

    if rules.get("dbca_estate_frac_above") is not None and not _column_all_null(con, "dbca_estate_frac"):
        thresh = rules["dbca_estate_frac_above"]
        active.append(("dbca_estate_frac", f"dbca>{thresh:.0%}", f"dbca_estate_frac > {thresh}"))

    if rules.get("summer_max_temp_c_above") is not None and not _column_all_null(con, "summer_max_temp_c"):
        thresh = rules["summer_max_temp_c_above"]
        active.append(("summer_max_temp_c", f"summer>={thresh}C", f"summer_max_temp_c >= {thresh}"))

    if rules.get("winter_min_temp_c_below") is not None and not _column_all_null(con, "winter_min_temp_c"):
        thresh = rules["winter_min_temp_c_below"]
        active.append(("winter_min_temp_c", f"winter<={thresh}C", f"winter_min_temp_c <= {thresh}"))

    if rules.get("pop_density_per_km2_above") is not None and not _column_all_null(con, "pop_density_per_km2"):
        thresh = rules["pop_density_per_km2_above"]
        active.append(("pop_density_per_km2", f"pop>{thresh}/km2", f"pop_density_per_km2 > {thresh}"))

    print(f"[exclude] Active rules ({len(active)}):")
    for _, label, pred in active:
        print(f"    - {label}  [{pred}]")

    # Reset the flags first — idempotent.
    con.execute("UPDATE hex SET excluded = FALSE, exclusion_reasons = NULL")

    # For each active rule, mark matching cells and append the reason.
    for _, label, pred in active:
        con.execute(
            f"""
            UPDATE hex
            SET excluded = TRUE,
                exclusion_reasons = COALESCE(exclusion_reasons, []) || ['{label}']
            WHERE {pred}
            """
        )

    con.commit()

    # Summary
    n_total, n_excluded = con.execute(
        "SELECT COUNT(*), SUM(CASE WHEN excluded THEN 1 ELSE 0 END) FROM hex"
    ).fetchone()
    print(f"[exclude] {n_excluded}/{n_total} cells excluded ({100 * n_excluded / n_total:.1f}%)")

    print("[exclude] Breakdown by reason:")
    rows = con.execute(
        """
        SELECT reason, COUNT(*) AS n
        FROM (SELECT UNNEST(exclusion_reasons) AS reason FROM hex WHERE excluded)
        GROUP BY reason ORDER BY n DESC
        """
    ).fetchall()
    for reason, n in rows:
        print(f"    {reason}: {n} cells")

    con.close()
    snapshot()


if __name__ == "__main__":
    apply()
