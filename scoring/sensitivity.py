"""Sensitivity check for the suitability score (BUILD_BRIEF §6).

For each weight in `weights.yaml`, shift by ±25%, renormalise, re-score,
and compare the new ranking against the baseline via Spearman rank
correlation. If the ranking is stable across perturbations, the map
reflects the data. If it scrambles, the model is mostly encoding the
operator's priors — and the UI should say so.

Reads the current per-cell factor sub-scores (computed by scoring/score.py)
and recombines them under different weights — much cheaper than re-running
the full scoring pipeline for each perturbation.

Reports both:
  - CELL-LEVEL: Spearman ρ over every scored cell (tight signal)
  - LGA-LEVEL:  Spearman ρ over shires ordered by mean suitability
                 (the "top-N LGA ranking" the brief specifically calls out)

Run:
    uv run python -m scoring.sensitivity
    uv run python -m scoring.sensitivity --shift 0.5     # ±50%
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from db.bootstrap import connect

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEIGHTS_PATH = PROJECT_ROOT / "scoring" / "weights.yaml"
NOTES_DIR = PROJECT_ROOT / "notes"
LOG_MD = NOTES_DIR / "SENSITIVITY_LOG.md"
LOG_JSON_DIR = NOTES_DIR / "sensitivity"

FACTORS = ("water", "rainfall", "soil", "access", "bushfire", "scale")


def _load_weights() -> dict[str, float]:
    with WEIGHTS_PATH.open() as f:
        cfg = yaml.safe_load(f)
    return {k: float(v) for k, v in cfg["weights"].items()}


def _renormalise(weights: dict[str, float]) -> dict[str, float]:
    s = sum(weights.values())
    return {k: v / s for k, v in weights.items()}


def _load_factor_matrix() -> pd.DataFrame:
    """Load cells that have a full sub-score set.

    Only cells with all 5 factors present participate — matches the
    convention in scoring/score.py where suitability is NULL if any input
    is missing.
    """
    con = connect()
    df = con.execute(
        """
        SELECT h3, lga,
               factor_water, factor_rainfall, factor_soil,
               factor_access, factor_bushfire, factor_scale
        FROM hex
        WHERE excluded = FALSE
          AND factor_water     IS NOT NULL
          AND factor_rainfall  IS NOT NULL
          AND factor_soil      IS NOT NULL
          AND factor_access    IS NOT NULL
          AND factor_bushfire  IS NOT NULL
          AND factor_scale     IS NOT NULL
        """
    ).fetchdf()
    con.close()
    return df


def _score(df: pd.DataFrame, weights: dict[str, float]) -> np.ndarray:
    return (
        weights["water"]    * df["factor_water"]
        + weights["rainfall"] * df["factor_rainfall"]
        + weights["soil"]     * df["factor_soil"]
        + weights["access"]   * df["factor_access"]
        + weights["bushfire"] * df["factor_bushfire"]
        + weights["scale"]    * df["factor_scale"]
    ).to_numpy()


def _spearman(a: np.ndarray, b: np.ndarray) -> float:
    """Spearman rank correlation. numpy-only (avoids scipy dep)."""
    ra = pd.Series(a).rank().to_numpy()
    rb = pd.Series(b).rank().to_numpy()
    # Standard Pearson on ranks = Spearman.
    ra_dev = ra - ra.mean()
    rb_dev = rb - rb.mean()
    num = float(np.sum(ra_dev * rb_dev))
    den = float(np.sqrt(np.sum(ra_dev**2) * np.sum(rb_dev**2)))
    return num / den if den else float("nan")


def _lga_scores(df: pd.DataFrame, scores: np.ndarray) -> pd.Series:
    """Mean suitability per LGA — the level the brief cares about."""
    return pd.Series(scores, index=df["lga"]).groupby(level=0).mean().sort_values(ascending=False)


def _verdict(min_rho_cell: float, min_rho_lga: float) -> str:
    """Judge whether the ranking is data-driven or prior-driven."""
    # LGA-level is the one the brief cares about — it's the operator's
    # decision unit. Cell-level is a supplementary read.
    if min_rho_lga >= 0.95 and min_rho_cell >= 0.90:
        return "STABLE — ranking is data-driven."
    if min_rho_lga >= 0.85:
        return "MOSTLY STABLE — top-LGA ranking robust; individual cells shuffle some."
    if min_rho_lga >= 0.7:
        return "SENSITIVE — ranking depends materially on weight choices; treat as informative, not definitive."
    return "UNSTABLE — the model is mostly encoding your priors, not the data. Do not trust the ranking absolutely."


def run(shift: float = 0.25) -> None:
    baseline = _load_weights()
    print(f"[sensitivity] Baseline weights: {baseline}")
    print(f"[sensitivity] Shift: ±{shift * 100:.0f}%")

    df = _load_factor_matrix()
    print(f"[sensitivity] {len(df):,} fully-scored cells across {df['lga'].nunique()} LGAs")

    baseline_scores = _score(df, baseline)
    baseline_lga = _lga_scores(df, baseline_scores)

    print()
    print(f"{'Weight':<12} {'Shift':<8} {'Sum':<8} {'ρ cells':<10} {'ρ LGAs':<10}")
    print("-" * 52)

    perturbations: list[dict] = []
    for factor in FACTORS:
        for sign, label in [(-1, f"-{shift * 100:.0f}%"), (+1, f"+{shift * 100:.0f}%")]:
            perturbed = dict(baseline)
            perturbed[factor] = max(0.0, baseline[factor] * (1 + sign * shift))
            renorm = _renormalise(perturbed)
            new_scores = _score(df, renorm)
            new_lga = _lga_scores(df, new_scores)
            common = baseline_lga.index.intersection(new_lga.index)
            rho_cell = _spearman(baseline_scores, new_scores)
            rho_lga = _spearman(
                baseline_lga.loc[common].to_numpy(),
                new_lga.loc[common].to_numpy(),
            )
            perturbations.append({
                "factor": factor,
                "shift": sign * shift,
                "label": label,
                "sum_before_renorm": sum(perturbed.values()),
                "rho_cell": rho_cell,
                "rho_lga": rho_lga,
            })
            print(
                f"{factor:<12} {label:<8} {sum(perturbed.values()):<8.4f} "
                f"{rho_cell:<10.4f} {rho_lga:<10.4f}"
            )

    print("-" * 52)
    min_rho_cell = min(p["rho_cell"] for p in perturbations)
    min_rho_lga = min(p["rho_lga"] for p in perturbations)
    verdict = _verdict(min_rho_cell, min_rho_lga)
    print(f"Worst ρ (cells): {min_rho_cell:.4f}")
    print(f"Worst ρ (LGAs):  {min_rho_lga:.4f}")
    print()
    print(f"VERDICT: {verdict}")

    print()
    print("Baseline LGA ranking (mean suitability):")
    for lga, score in baseline_lga.items():
        print(f"    {score:.3f}  {lga}")

    _write_logs(
        baseline=baseline,
        shift=shift,
        n_cells=len(df),
        n_lgas=int(df["lga"].nunique()),
        perturbations=perturbations,
        min_rho_cell=min_rho_cell,
        min_rho_lga=min_rho_lga,
        verdict=verdict,
        baseline_lga=baseline_lga,
    )


def _write_logs(
    *,
    baseline: dict[str, float],
    shift: float,
    n_cells: int,
    n_lgas: int,
    perturbations: list[dict],
    min_rho_cell: float,
    min_rho_lga: float,
    verdict: str,
    baseline_lga: pd.Series,
) -> None:
    """Append a Markdown block and drop a JSON snapshot for this run."""
    NOTES_DIR.mkdir(parents=True, exist_ok=True)
    LOG_JSON_DIR.mkdir(parents=True, exist_ok=True)

    ts = dt.datetime.now().astimezone()
    ts_iso = ts.isoformat(timespec="seconds")
    ts_slug = ts.strftime("%Y%m%dT%H%M%S")

    payload = {
        "run_at": ts_iso,
        "shift_pct": shift * 100,
        "n_cells": n_cells,
        "n_lgas": n_lgas,
        "baseline_weights": baseline,
        "min_rho_cell": min_rho_cell,
        "min_rho_lga": min_rho_lga,
        "verdict": verdict,
        "perturbations": perturbations,
        "baseline_lga_ranking": [
            {"lga": lga, "mean_suitability": float(s)}
            for lga, s in baseline_lga.items()
        ],
    }

    json_path = LOG_JSON_DIR / f"{ts_slug}.json"
    json_path.write_text(json.dumps(payload, indent=2))

    header_exists = LOG_MD.exists()
    with LOG_MD.open("a") as f:
        if not header_exists:
            f.write(
                "# Sensitivity Log\n\n"
                "Append-only log of `scoring/sensitivity.py` runs. Compare across dates "
                "to see whether the ranking got more or less stable as data or weights "
                "changed. Machine-readable JSON per run in `notes/sensitivity/`.\n\n"
                "---\n\n"
            )
        f.write(f"## {ts_iso}\n\n")
        f.write(f"- **Shift**: ±{shift * 100:.0f}%\n")
        f.write(f"- **Scored cells**: {n_cells:,} across {n_lgas} LGAs\n")
        f.write(
            f"- **Baseline weights**: "
            + ", ".join(f"{k}={v:.2f}" for k, v in baseline.items())
            + "\n"
        )
        f.write(f"- **Worst ρ (cells)**: {min_rho_cell:.4f}\n")
        f.write(f"- **Worst ρ (LGAs)**: {min_rho_lga:.4f}\n")
        f.write(f"- **Verdict**: {verdict}\n\n")
        f.write("| Weight | Shift | ρ cells | ρ LGAs |\n")
        f.write("|---|---|---|---|\n")
        for p in perturbations:
            f.write(
                f"| {p['factor']} | {p['label']} | "
                f"{p['rho_cell']:.4f} | {p['rho_lga']:.4f} |\n"
            )
        f.write("\nBaseline LGA ranking:\n\n")
        for lga, s in baseline_lga.items():
            f.write(f"- {float(s):.3f} — {lga}\n")
        f.write(f"\nJSON: `notes/sensitivity/{ts_slug}.json`\n\n---\n\n")

    print()
    print(f"[sensitivity] Logged to {LOG_MD.relative_to(PROJECT_ROOT)}")
    print(f"[sensitivity] Snapshot: {json_path.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--shift",
        type=float,
        default=0.25,
        help="Fractional shift per weight (default 0.25 = ±25%%)",
    )
    args = parser.parse_args()
    run(shift=args.shift)
