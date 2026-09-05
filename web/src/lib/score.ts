/**
 * Client-side re-scoring — mirrors rescore_suitability() in
 * app/streamlit_app.py. Fast (numpy-style math over ~11k rows).
 *
 * Only re-runs the weighted sum; factor sub-scores come from the DB. Excluded
 * cells keep NULL scores since Stage 1 masking is authoritative.
 */

import type { HexCell, Weights } from "../types";
import { normalisedWeights } from "../store";

export function liveScore(cell: HexCell, w: Weights): number | null {
  if (cell.excluded) return null;
  const {
    factor_water: fw,
    factor_rainfall: fr,
    factor_soil: fs,
    factor_access: fa,
    factor_bushfire: fb,
  } = cell;
  if (fw == null || fr == null || fs == null || fa == null || fb == null)
    return null;
  const n = normalisedWeights(w);
  const s =
    n.water * fw + n.rainfall * fr + n.soil * fs + n.access * fa + n.bushfire * fb;
  return Math.max(0, Math.min(1, s));
}

export function applyLiveScoring(
  cells: HexCell[],
  w: Weights | null,
): HexCell[] {
  if (!w) return cells;
  return cells.map((c) => ({ ...c, suitability_score: liveScore(c, w) }));
}
