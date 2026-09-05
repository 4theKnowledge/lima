/**
 * Client-side re-scoring — mirrors rescore_suitability() in
 * app/streamlit_app.py. Fast (numpy-style math over ~11k rows).
 *
 * Only re-runs the weighted sum; factor sub-scores come from the DB. Excluded
 * cells keep NULL scores since Stage 1 masking is authoritative.
 */

import type { HexCell, Weights } from "../types";
import { normalisedWeights, type Metric } from "../store";

export function liveScore(cell: HexCell, w: Weights): number | null {
  if (cell.excluded) return null;
  const {
    factor_water: fw,
    factor_rainfall: fr,
    factor_soil: fs,
    factor_access: fa,
    factor_bushfire: fb,
    factor_scale: fsc,
  } = cell;
  if (
    fw == null || fr == null || fs == null ||
    fa == null || fb == null || fsc == null
  )
    return null;
  const n = normalisedWeights(w);
  const s =
    n.water * fw +
    n.rainfall * fr +
    n.soil * fs +
    n.access * fa +
    n.bushfire * fb +
    n.scale * fsc;
  return Math.max(0, Math.min(1, s));
}

export function applyLiveScoring(
  cells: HexCell[],
  w: Weights | null,
): HexCell[] {
  if (!w) return cells;
  return cells.map((c) => ({ ...c, suitability_score: liveScore(c, w) }));
}

/**
 * Min/max of a numeric metric across the given cells. Returns [0, 1] when
 * there's no data to fall back to a safe default that keeps the colour
 * ramp valid. Used by both the map layer (to drive the fill gradient)
 * and the legend HUD (to label the ramp endpoints).
 */
export function metricRange(
  cells: HexCell[],
  metric: Metric,
): [number, number] {
  if (!cells.length) return [0, 1];
  let mn = Infinity;
  let mx = -Infinity;
  for (const c of cells) {
    const v = c[metric] as number | null | undefined;
    if (v != null && Number.isFinite(v)) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
  }
  return mn === Infinity ? [0, 1] : [mn, mx];
}
