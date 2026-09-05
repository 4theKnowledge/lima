/**
 * Client-side preview of what an exclusion draft would do to the loaded
 * hex slice, compared to the currently-applied exclusion state.
 *
 * Mirrors the predicates in `scoring/exclude.py`:
 *   - gsr_mean_mm_below            : gsr_mean_mm < X
 *   - capability_class_at_or_above : capability_class >= X
 *   - salinity_idx_at_or_above     : salinity_idx >= X
 *   - dbca_estate_frac_above       : dbca_estate_frac > X
 *   - summer_max_temp_c_above      : summer_max_temp_c >= X
 *   - winter_min_temp_c_below      : winter_min_temp_c <= X
 *
 * The server also considers `parcel_count_below` and other rules; those
 * aren't editable in the UI right now, so they carry over from whichever
 * exclusion state was applied last (visible as `cell.excluded`).
 *
 * Semantics reported:
 *   - `newExcluded` — cells the draft would exclude that aren't excluded now
 *   - `newIncluded` — cells currently excluded (by the UI-editable rules)
 *     that the draft would let back in. Cells excluded for reasons the UI
 *     doesn't edit stay excluded and are not counted.
 *   - `totalWouldBeExcluded` — the draft's total exclusion count under the
 *     UI-editable rules only. Under-counts if there are non-UI rules also
 *     active (e.g. parcel_count_below); noted in the tooltip copy.
 */

import type { Exclusions, HexCell } from "../types";

export type ExclusionPreview = {
  newExcluded: number;
  newIncluded: number;
  totalDraftExcluded: number;
};

function draftExcludes(cell: HexCell, draft: Exclusions): boolean {
  if (
    draft.gsr_mean_mm_below != null &&
    cell.gsr_mean_mm != null &&
    cell.gsr_mean_mm < draft.gsr_mean_mm_below
  )
    return true;
  if (
    draft.capability_class_at_or_above != null &&
    cell.capability_class != null &&
    cell.capability_class >= draft.capability_class_at_or_above
  )
    return true;
  if (
    draft.salinity_idx_at_or_above != null &&
    cell.salinity_idx != null &&
    cell.salinity_idx >= draft.salinity_idx_at_or_above
  )
    return true;
  if (
    draft.dbca_estate_frac_above != null &&
    cell.dbca_estate_frac != null &&
    cell.dbca_estate_frac > draft.dbca_estate_frac_above
  )
    return true;
  if (
    draft.summer_max_temp_c_above != null &&
    cell.summer_max_temp_c != null &&
    cell.summer_max_temp_c >= draft.summer_max_temp_c_above
  )
    return true;
  if (
    draft.winter_min_temp_c_below != null &&
    cell.winter_min_temp_c != null &&
    cell.winter_min_temp_c <= draft.winter_min_temp_c_below
  )
    return true;
  return false;
}

function currentUiExcludes(cell: HexCell, current: Exclusions): boolean {
  // "Would the *currently-applied* UI-editable rules exclude this cell?"
  // We can't just read cell.excluded because that also reflects rules
  // outside the UI (parcel_count_below). Recompute the UI subset from the
  // applied thresholds so newIncluded is scoped to what the draft can
  // actually flip.
  return draftExcludes(cell, current);
}

export function computeExclusionPreview(
  cells: HexCell[],
  current: Exclusions,
  draft: Exclusions,
): ExclusionPreview {
  let newExcluded = 0;
  let newIncluded = 0;
  let totalDraftExcluded = 0;
  for (const c of cells) {
    const wasUi = currentUiExcludes(c, current);
    const willDraft = draftExcludes(c, draft);
    if (willDraft) totalDraftExcluded += 1;
    if (willDraft && !wasUi) newExcluded += 1;
    if (!willDraft && wasUi) newIncluded += 1;
  }
  return { newExcluded, newIncluded, totalDraftExcluded };
}
