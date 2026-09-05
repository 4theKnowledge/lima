"""Stage 2 — compute per-cell suitability score on cells that survived Stage 1.

Reads all tunables from scoring/weights.yaml. Writes 7 columns per hex:
    factor_water, factor_rainfall, factor_soil, factor_access, factor_bushfire,
    factor_scale
    suitability_score = Σ (weight_i × factor_i)

Rules:
  - Excluded cells (Stage 1 hard mask) get NULL scores. They still show on the
    map (grey) but don't compete in rankings.
  - A cell where any REQUIRED input is missing gets NULL factor for that
    sub-score, and NULL suitability. Coverage is reported so the user knows
    what fraction of the region is scoreable.
  - Sub-scores are stored so the M6 side panel can show decomposition (§7)
    without re-running the whole compute chain.

The active `scale_curve` (which parcel-size curve to apply) is read from
`weights.yaml → scale_curve`. Applying a Purpose via the API rewrites that
value so re-scoring picks up the right shape.

Run:
    uv run python -m scoring.score
"""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

import yaml

from db.bootstrap import connect
from db.snapshot import snapshot

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEIGHTS_PATH = PROJECT_ROOT / "scoring" / "weights.yaml"

# Factor names in the order used for sub-score reporting + the weighted sum.
FACTOR_ORDER = ("water", "rainfall", "soil", "access", "bushfire", "scale")


def _load_config() -> dict:
    with WEIGHTS_PATH.open() as f:
        return yaml.safe_load(f)


def _interp_curve(curve: Sequence[Sequence[float]], x: float | None) -> float | None:
    """Piecewise-linear interpolation of a [[x,y], ...] curve. Clamped at ends."""
    if x is None:
        return None
    if not curve:
        return None
    xs = [p[0] for p in curve]
    ys = [p[1] for p in curve]
    if x <= xs[0]:
        return float(ys[0])
    if x >= xs[-1]:
        return float(ys[-1])
    for i in range(len(xs) - 1):
        if xs[i] <= x <= xs[i + 1]:
            span = xs[i + 1] - xs[i]
            t = (x - xs[i]) / span if span else 0.0
            return float(ys[i] + t * (ys[i + 1] - ys[i]))
    return None  # unreachable


def _water_score(gw_proclaimed: bool | None, sw_proclaimed: bool | None, water_cfg: dict) -> float | None:
    """Combine GW + SW proclamation status.

    MVP proxy (per §6): proclaimed → licence required, unknown headroom.
    We treat 'if either is proclaimed, water access is constrained' as the
    right conservative reading — either could block a rural water source.
    """
    unproclaimed_score = float(water_cfg["unproclaimed"])
    unknown_headroom = float(water_cfg["proclaimed_unknown_headroom"])
    if gw_proclaimed is None and sw_proclaimed is None:
        return None
    # Treat NULL as "not proclaimed" for the missing one, so we still score
    # cells that have partial data.
    gw = bool(gw_proclaimed) if gw_proclaimed is not None else False
    sw = bool(sw_proclaimed) if sw_proclaimed is not None else False
    if gw and sw:
        return unknown_headroom * 0.75    # both constrained → worst case
    if gw or sw:
        return unknown_headroom
    return unproclaimed_score


def _rainfall_score(
    gsr_mean_mm: float | None,
    gsr_trend: float | None,
    level_curve: Sequence[Sequence[float]],
    trend_curve: Sequence[Sequence[float]],
) -> float | None:
    """Level × trend multiplier per §6, capped at 1.0."""
    level = _interp_curve(level_curve, gsr_mean_mm)
    if level is None:
        return None
    if gsr_trend is None:
        return level
    mult = _interp_curve(trend_curve, gsr_trend)
    if mult is None:
        return level
    score = level * mult
    return max(0.0, min(1.0, score))


def _access_score(
    dist_sealed_road_km: float | None,
    dist_townsite_km: float | None,
    road_curve: Sequence[Sequence[float]],
    town_curve: Sequence[Sequence[float]],
) -> float | None:
    """Weighted combo: 60% road, 40% town."""
    road = _interp_curve(road_curve, dist_sealed_road_km)
    town = _interp_curve(town_curve, dist_townsite_km)
    if road is None and town is None:
        return None
    if road is None:
        return town
    if town is None:
        return road
    return 0.6 * road + 0.4 * town


def compute() -> None:
    cfg = _load_config()
    weights = cfg["weights"]
    curves = cfg["curves"]
    trend_curve = cfg["rainfall_trend_penalty"]
    water_cfg = cfg["water_score"]

    # Which scale curve is active? Purposes set this via API. Fallback to
    # scale_broadacre if unset, so the module keeps working after a
    # weights.yaml written by an older tool.
    scale_curve_name = cfg.get("scale_curve", "scale_broadacre")
    scale_curve = curves.get(scale_curve_name)
    if scale_curve is None:
        raise ValueError(
            f"weights.yaml → scale_curve = {scale_curve_name!r} but no such "
            f"curve in curves:. Options: {sorted(k for k in curves if k.startswith('scale_'))}"
        )

    # Sanity: weights must sum to ~1.0 across all FACTOR_ORDER keys.
    missing = [k for k in FACTOR_ORDER if k not in weights]
    if missing:
        raise ValueError(
            f"weights.yaml is missing weights for {missing!r}. "
            f"After adding a new factor you must re-list it in weights: with a value."
        )
    wsum = sum(weights[k] for k in FACTOR_ORDER)
    if abs(wsum - 1.0) > 1e-6:
        raise ValueError(f"weights.yaml `weights` must sum to 1.0 across {FACTOR_ORDER}, got {wsum:.4f}")

    con = connect()
    rows = con.execute(
        """
        SELECT h3,
               COALESCE(excluded, FALSE) AS excluded,
               gw_proclaimed, sw_proclaimed,
               gsr_mean_mm, gsr_trend,
               capability_class,
               dist_sealed_road_km, dist_townsite_km,
               bushfire_prone_frac,
               parcel_area_median_ha
        FROM hex
        """
    ).fetchall()
    print(f"[score] Loaded {len(rows):,} hex cells")
    print(f"[score] Active scale curve: {scale_curve_name}")

    updates: list[tuple] = []
    n_scored = 0
    factor_null_counts = {k: 0 for k in FACTOR_ORDER}

    for (
        h3,
        excluded,
        gw,
        sw,
        rain_mm,
        rain_trend,
        cap_class,
        road_km,
        town_km,
        bpa_frac,
        parcel_ha,
    ) in rows:
        if excluded:
            # Set all sub-scores + suitability to NULL for excluded cells.
            updates.append((None, None, None, None, None, None, None, h3))
            continue

        f_water = _water_score(gw, sw, water_cfg)
        f_rain = _rainfall_score(rain_mm, rain_trend, curves["rainfall_level"], trend_curve)
        f_soil = _interp_curve(curves["soil_capability"], cap_class)
        f_access = _access_score(road_km, town_km, curves["access_road"], curves["access_townsite"])
        f_bpa = _interp_curve(curves["bushfire_inverse"], bpa_frac)
        f_scale = _interp_curve(scale_curve, parcel_ha)

        # Track sub-score coverage.
        for name, val in (
            ("water", f_water), ("rainfall", f_rain), ("soil", f_soil),
            ("access", f_access), ("bushfire", f_bpa), ("scale", f_scale),
        ):
            if val is None:
                factor_null_counts[name] += 1

        # Only compute suitability if all inputs present.
        if None in (f_water, f_rain, f_soil, f_access, f_bpa, f_scale):
            suit = None
        else:
            suit = (
                weights["water"]    * f_water
                + weights["rainfall"] * f_rain
                + weights["soil"]     * f_soil
                + weights["access"]   * f_access
                + weights["bushfire"] * f_bpa
                + weights["scale"]    * f_scale
            )
            suit = max(0.0, min(1.0, suit))
            n_scored += 1

        updates.append((f_water, f_rain, f_soil, f_access, f_bpa, f_scale, suit, h3))

    con.executemany(
        """
        UPDATE hex SET
            factor_water = ?,
            factor_rainfall = ?,
            factor_soil = ?,
            factor_access = ?,
            factor_bushfire = ?,
            factor_scale = ?,
            suitability_score = ?
        WHERE h3 = ?
        """,
        updates,
    )
    con.commit()

    print(f"[score] {n_scored:,} cells with a full suitability score")
    print("[score] Sub-score coverage gaps (cells with NULL for that factor):")
    for name, n in factor_null_counts.items():
        print(f"    {name}: {n}")

    stats = con.execute(
        """
        SELECT MIN(suitability_score), AVG(suitability_score),
               MEDIAN(suitability_score), MAX(suitability_score)
        FROM hex WHERE suitability_score IS NOT NULL
        """
    ).fetchone()
    if stats[0] is not None:
        print(
            f"[score] suitability_score distribution: "
            f"min={stats[0]:.3f} mean={stats[1]:.3f} "
            f"median={stats[2]:.3f} max={stats[3]:.3f}"
        )

    print("[score] Top 10 cells by suitability:")
    top = con.execute(
        """
        SELECT h3, lga, suitability_score,
               factor_water, factor_rainfall, factor_soil,
               factor_access, factor_bushfire, factor_scale
        FROM hex WHERE suitability_score IS NOT NULL
        ORDER BY suitability_score DESC LIMIT 10
        """
    ).fetchall()
    for h, lga, s, fw, fr, fs, fa, fb, fscale in top:
        print(
            f"    {h}  {lga:34s} score={s:.3f}  "
            f"(w={fw:.2f} r={fr:.2f} s={fs:.2f} a={fa:.2f} b={fb:.2f} sc={fscale:.2f})"
        )
    con.close()
    snapshot()


if __name__ == "__main__":
    compute()
