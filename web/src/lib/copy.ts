/**
 * Plain-English disambiguation strings, keyed by concept.
 *
 * Rules:
 *   - First clause: no jargon a lay person wouldn't know.
 *   - Follow with the technical detail (units, thresholds, provenance).
 *   - Where the source of truth is BUILD_BRIEF.md or scoring/weights.yaml,
 *     the copy quotes the constraint the operator sees.
 */

import type { Metric } from "../store";
import type { FactorName } from "../types";

export const WEIGHT_TIP: Record<FactorName, string> = {
  water:
    "How much water access matters to you. Cells in proclaimed groundwater or " +
    "surface-water areas need a licence — this factor down-scores them because " +
    "a new licence may be refused. Default 30%.",
  rainfall:
    "How much growing-season rainfall matters. Uses the May–October average " +
    "(1991–2020) and applies a penalty if rainfall has been declining since " +
    "1970 — a big trend in the South West. Default 25%.",
  soil:
    "How much soil quality matters. Uses DPIRD's land capability rating for " +
    "grazing (Class 1 = best, 6 = effectively unusable). Default 20%.",
  access:
    "How much you value being close to a sealed road and a town. Combines " +
    "distance-to-nearest-sealed-road (60%) and distance-to-nearest-town (40%). " +
    "Default 15%.",
  bushfire:
    "How much bushfire risk matters. Uses the DFES bushfire-prone area map — " +
    "a high fraction of the cell inside a prone area lowers the score. Affects " +
    "build cost and insurability. Default 10%.",
};

export const WEIGHTS_INTRO =
  "Adjust how much each factor matters. Weights don't need to sum to 1 — " +
  "they're auto-normalised. Sliders re-score the map instantly (no server hop). " +
  "Reset restores the defaults from scoring/weights.yaml.";

export const EXCLUSIONS_INTRO =
  "Stage 1 hard mask. A cell is excluded outright if it crosses ANY of these " +
  "thresholds — no matter how well it scores on other factors. Excluded cells " +
  "stay on the map (grey) with the reason shown, so you can see what was ruled " +
  "out and why. Applying re-runs the exclusion + scoring pipeline on the server.";

export const EXCLUSION_TIP = {
  gsr_mean_mm_below:
    "Exclude cells drier than this. Uses May–October rainfall averaged over " +
    "1991–2020. Below ~350 mm reliable rain-fed agriculture becomes marginal " +
    "in the South West.",
  capability_class_at_or_above:
    "Exclude cells whose soil capability class is at or above N. DPIRD rates " +
    "land 1 (best) to 6 (worst) for grazing. Set to 7 to disable this rule.",
  salinity_idx_at_or_above:
    "Exclude cells with groundwater above this salinity class. Ordinal 1 = fresh " +
    "(<500 mg/L TDS), 5 = saline (7,000–14,000), 7 = hypersaline (>35,000). " +
    "At 5+ groundwater is unusable for most enterprises. Set to 8 to disable.",
  dbca_estate_frac_above:
    "Exclude cells that are mostly national park, state forest, or nature " +
    "reserve. Value is the fraction of the cell inside DBCA-managed land — " +
    "these areas have effectively no buyable land. Set to 1.0 to disable.",
} as const;

export const METRIC_TIP: Record<Metric, string> = {
  suitability_score:
    "The headline number (0–1). Weighted combination of the five factors. " +
    "NULL for excluded cells or cells missing an input. Higher is better.",
  parcel_count:
    "How many rural parcels have their centroid in this hex cell. Parcels " +
    "under 10 ha are dropped upstream.",
  parcel_area_median_ha:
    "Median parcel size in this cell (hectares). A cell dominated by 20 ha " +
    "hobby farms reads very differently from one of 500 ha grazing runs.",
  gw_proclaimed:
    "Is this cell inside a proclaimed groundwater area? Proclaimed = licence " +
    "required to take water. In the MVP we can't check allocation headroom, " +
    "so proclaimed is treated as a coarse constraint.",
  sw_proclaimed:
    "Is this cell inside a proclaimed surface-water area? Same licencing " +
    "implications as groundwater.",
  salinity_idx:
    "Groundwater salinity, DWER-026 mapping. Ordinal 1 (fresh, <500 mg/L TDS) " +
    "→ 7 (hypersaline, >35,000). Not the same as 'total salinity risk' — it " +
    "describes the groundwater you'd pump.",
  bushfire_prone_frac:
    "Fraction of the hex cell inside a DFES bushfire-prone area (0–1). " +
    "Affects insurability, build cost, and clearing rules — not necessarily " +
    "the risk of ignition.",
  capability_class:
    "Modal DPIRD land capability class for grazing within the cell. 1 = very " +
    "high capability, 6 = effectively unusable. Confidence (shown in the " +
    "inspector) is the fraction of the cell covered by the modal class.",
  dist_townsite_km:
    "Straight-line distance from the cell centre to the nearest gazetted " +
    "townsite (km). Not road distance.",
  dist_sealed_road_km:
    "Straight-line distance from the cell centre to the nearest sealed road " +
    "(km). Roads Simplified dataset, sealed segments only.",
  dbca_estate_frac:
    "Fraction of the cell inside land managed by DBCA — national parks, " +
    "state forests, nature reserves. High values mean there's little private " +
    "land to buy inside the cell.",
  gsr_mean_mm:
    "Average May–October rainfall in millimetres, 1991–2020 baseline. This " +
    "is 'growing-season rainfall' — the rain that reaches crops and pasture.",
  gsr_trend:
    "How much growing-season rainfall has changed since 1970, in mm per " +
    "decade. Negative values (drying) are the norm in the South West.",
};

export const LEGEND_TIP = {
  excluded:
    "Grey means the cell was excluded by a Stage 1 rule (rainfall, soil, " +
    "salinity, or DBCA). The cell stays visible so you can see what was ruled " +
    "out and why — click for the reason.",
  noData:
    "Faint teal means the selected metric has no value for this cell (e.g. " +
    "outside the mapped area, or a layer that hasn't been ingested here).",
  proclaimed:
    "Red means the water source is proclaimed — a licence is required to " +
    "take water. New licences may be refused if the resource is fully " +
    "allocated.",
  unproclaimed:
    "Green means the water source is unproclaimed — no licence needed to " +
    "take water for on-farm use.",
} as const;

export const SEARCH_TIP =
  "Free-text search via OpenStreetMap. Restricted to Australia. The result " +
  "centres the map and picks the hex cell that contains the resolved point.";

export const LGA_TIP =
  "Local Government Area. Filter the map to shires you're actively " +
  "considering — smaller slices load and re-score faster. Click 'All' " +
  "to show every ingested shire.";

export const SENSITIVITY_TIP =
  "Runs the scoring with each weight shifted ±25% and checks whether the " +
  "top-LGA ranking stays the same. STABLE = ranking is data-driven. " +
  "UNSTABLE = the ranking mostly reflects your weight choices, not the data.";

export const INSPECTOR_TIP = {
  suitability:
    "0–1. Weighted sum of the five factor sub-scores. Live-recomputed as " +
    "you move the weight sliders. NULL for excluded cells.",
  decomposition:
    "How each factor contributed to the score. The green number is the " +
    "weighted contribution (factor × normalised weight). Add them up to get " +
    "the total.",
  capabilityConfidence:
    "How much of the hex cell is actually covered by the modal soil class. " +
    "A class assigned on 95% coverage is very different evidence from one on " +
    "12% — treat low-confidence cells with more scepticism.",
  parcels:
    "Rural parcels whose centroid falls inside this hex cell. Parcels under " +
    "10 ha and parcels inside townsites are dropped upstream.",

  // per-row tooltips for the inspector body
  lga:
    "Local Government Area — the shire this cell sits in. Different LGAs " +
    "have different planning rules, so the shire is the operator's decision " +
    "unit.",
  h3:
    "H3 cell identifier at resolution 7 (~5 km² per cell). Copy this if you " +
    "want to reference this exact cell in notes or in the URL.",
  groundwater:
    "'Proclaimed' means the area sits inside an RIWI Act groundwater area — " +
    "you'd need a DWER licence to take water. Unproclaimed = no licence " +
    "needed for on-farm use. In the MVP we can't check whether allocation " +
    "headroom remains, so proclaimed is treated as a coarse constraint.",
  surfaceWater:
    "'Proclaimed' means the area sits inside an RIWI Act surface-water area " +
    "— a licence is required to take water from creeks, rivers, or dams. " +
    "Unproclaimed = no licence needed for on-farm use.",
  salinity:
    "Groundwater salinity (DWER-026). TDS = total dissolved solids in mg/L; " +
    "the ordinal maps ranges 1 (fresh, <500) → 7 (hypersaline, >35,000). At " +
    "≥ 3,000 mg/L usable crops shrink; ≥ 7,000 rules out most enterprises.",
  bushfire:
    "The fraction of this hex cell inside a DFES-designated bushfire-prone " +
    "area. It's a planning designation (affects insurance, build cost, " +
    "clearing rules) rather than a live fire risk score.",
  dbca:
    "The fraction of this hex cell inside land managed by DBCA — national " +
    "parks, state forests, nature reserves. These aren't for sale, so a " +
    "cell that's mostly DBCA has effectively no buyable land.",
  townDist:
    "Straight-line distance from the cell centroid to the nearest gazetted " +
    "townsite. This is the crow-flies distance, not the road drive.",
  roadDist:
    "Straight-line distance from the cell centroid to the nearest sealed " +
    "road. Roads Simplified dataset, sealed segments only — dirt/unsealed " +
    "roads are excluded from this measure.",
  rainMean:
    "Average rainfall in millimetres over the May–October growing season, " +
    "1991–2020 baseline. This is the rain that reaches crops and pasture — " +
    "summer rain in the South West is mostly evaporated.",
  rainTrend:
    "How much growing-season rainfall has changed since 1970, in millimetres " +
    "per decade. Negative values (drying) are the norm in the South West and " +
    "projected to continue — worth weighting heavily.",
  parcelsTotal:
    "Sum of the areas of all parcels whose centroid falls inside this cell " +
    "(hectares).",
  parcelsRange:
    "Smallest and largest parcel area in this cell (hectares). A wide range " +
    "means mixed lot sizes; a tight range suggests a uniform subdivision.",
} as const;

/**
 * Hectare intuition builder. Renders "≈ X m² (Y m × Y m)" so an operator
 * without a feel for hectares can eyeball. Used as a tooltip suffix on
 * every area value that's expressed in hectares.
 *
 * Examples:
 *   1 ha  →   10,000 m² (100 m × 100 m)
 *   40 ha →  400,000 m² (632 m × 632 m)
 *   500 ha → 5,000,000 m² (2,236 m × 2,236 m)
 */
export function hectaresToM2(ha: number): string {
  const m2 = ha * 10_000;
  const side = Math.round(Math.sqrt(m2));
  return `${m2.toLocaleString()} m² (roughly ${side.toLocaleString()} m × ${side.toLocaleString()} m)`;
}

export const HECTARE_TIP =
  "1 hectare = 10,000 m² — a square 100 m × 100 m. A soccer pitch is ~0.7 ha.";
