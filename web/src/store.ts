/**
 * UI state — ephemeral, in-memory. Server state lives in TanStack Query.
 *
 * The HUD is a single floating panel on the right edge with three tabs.
 * When collapsed, it becomes a slim vertical rail of tab icons; clicking
 * any tab expands and activates it. Selecting a hex on the map auto-opens
 * the panel to the Inspector tab.
 */

import { create } from "zustand";

import type { Weights } from "./types";
import { FACTOR_ORDER } from "./types";

export type Metric =
  | "suitability_score"
  | "parcel_count"
  | "parcel_area_median_ha"
  | "gw_proclaimed"
  | "sw_proclaimed"
  | "salinity_idx"
  | "bushfire_prone_frac"
  | "capability_class"
  | "dist_townsite_km"
  | "dist_sealed_road_km"
  | "dbca_estate_frac"
  | "gsr_mean_mm"
  | "gsr_trend"
  | "summer_max_temp_c"
  | "winter_min_temp_c"
  | "evap_annual_mm"
  | "solar_annual_mj"
  | "vp_annual_hpa"
  | "summer_max_trend_c_per_decade"
  | "winter_min_trend_c_per_decade"
  | "pop_density_per_km2";

export type MetricOption = {
  value: Metric | string;
  label: string;
  disabled?: boolean;
};

export type MetricGroup = {
  label: string;
  options: MetricOption[];
};

// Grouped for the picker UI. Disabled entries are stubs for datasets not
// yet ingested — they render greyed-out to signal what's on the roadmap
// without breaking the type of `metric` (only enabled values are Metric).
export const METRIC_GROUPS: MetricGroup[] = [
  {
    label: "Overall",
    options: [{ value: "suitability_score", label: "★ Suitability score" }],
  },
  {
    label: "Parcels",
    options: [
      { value: "parcel_count", label: "Parcel count" },
      { value: "parcel_area_median_ha", label: "Median parcel area (ha)" },
    ],
  },
  {
    label: "Water",
    options: [
      { value: "gw_proclaimed", label: "Groundwater: proclaimed?" },
      { value: "sw_proclaimed", label: "Surface water: proclaimed?" },
      { value: "salinity_idx", label: "Salinity: TDS class" },
      { value: "aquifers", label: "Aquifers (soon)", disabled: true },
    ],
  },
  {
    label: "Land & soil",
    options: [
      { value: "capability_class", label: "Soil capability (grazing)" },
      { value: "elevation_m", label: "Elevation (soon)", disabled: true },
      {
        value: "elevation_grade_broadacre",
        label: "Elevation grade — broadacre (soon)",
        disabled: true,
      },
      {
        value: "sea_level_rise_exposure",
        label: "Sea-level rise exposure (soon)",
        disabled: true,
      },
    ],
  },
  {
    label: "Climate — baseline",
    options: [
      { value: "gsr_mean_mm", label: "Rainfall: May-Oct mean (mm)" },
      { value: "summer_max_temp_c", label: "Summer max temp (°C, Dec-Feb)" },
      { value: "winter_min_temp_c", label: "Winter min temp (°C, Jun-Aug)" },
      { value: "evap_annual_mm", label: "Annual evaporation (mm)" },
      { value: "solar_annual_mj", label: "Solar radiation (MJ/m²/day)" },
      { value: "vp_annual_hpa", label: "Vapour pressure (hPa)" },
    ],
  },
  {
    label: "Climate — trends",
    options: [
      { value: "gsr_trend", label: "Rainfall trend since 1970 (mm/decade)" },
      {
        value: "summer_max_trend_c_per_decade",
        label: "Summer max trend since 1970 (°C/decade)",
      },
      {
        value: "winter_min_trend_c_per_decade",
        label: "Winter min trend since 1970 (°C/decade)",
      },
    ],
  },
  {
    label: "Hazards",
    options: [
      { value: "bushfire_prone_frac", label: "Bushfire prone: area fraction" },
      { value: "dbca_estate_frac", label: "DBCA estate: area fraction" },
    ],
  },
  {
    label: "Access & services",
    options: [
      { value: "dist_townsite_km", label: "Distance to nearest town (km)" },
      { value: "dist_sealed_road_km", label: "Distance to sealed road (km)" },
      { value: "dist_poi_km", label: "Distance to places of interest (soon)", disabled: true },
      { value: "dist_school_km", label: "Distance to schools (soon)", disabled: true },
      { value: "dist_hospital_km", label: "Distance to hospitals (soon)", disabled: true },
      { value: "dist_airport_km", label: "Distance to airports (soon)", disabled: true },
      { value: "dist_port_km", label: "Distance to ports (soon)", disabled: true },
      { value: "walkability", label: "Walkability (soon)", disabled: true },
    ],
  },
  {
    label: "Demographics",
    options: [
      { value: "pop_density_per_km2", label: "Population density (people/km²)" },
    ],
  },
];

// Flat list of enabled options — used by RankedTable for label lookup and
// any other consumer that just needs value→label. Derived from METRIC_GROUPS
// so there's a single source of truth.
export const METRIC_OPTIONS: { value: Metric; label: string }[] =
  METRIC_GROUPS.flatMap((g) =>
    g.options
      .filter((o) => !o.disabled)
      .map((o) => ({ value: o.value as Metric, label: o.label })),
  );

// Metrics where high value = worse; ramp inverted so purple always reads
// as "worse". For the SILO climate metrics:
//   summer_max_temp_c              — HIGH is worse (heat stress)
//   winter_min_temp_c              — LOW is worse (frost / heating) — NOT inverted
//   evap_annual_mm                 — HIGH is worse (aridity)
//   solar / vp                     — interpretation depends on Purpose; uncoloured
//   summer_max_trend_c_per_decade  — HIGH (rising) is worse (warming)
//   winter_min_trend_c_per_decade  — ambivalent (higher = fewer frosts /
//                                    for hobby+citrus that's good; also a
//                                    warming signal). Leave OUT of HIGH_IS_BAD;
//                                    operator interprets via Purpose.
export const HIGH_IS_BAD: Set<Metric> = new Set<Metric>([
  "capability_class",
  "salinity_idx",
  "bushfire_prone_frac",
  "dist_townsite_km",
  "dist_sealed_road_km",
  "dbca_estate_frac",
  "summer_max_temp_c",
  "evap_annual_mm",
  "summer_max_trend_c_per_decade",
  // Population density: broadacre/off-grid want low; hobby wants mid.
  // Default the ramp to "high is worse" so purple flags peri-urban cells
  // for the common rural-buyer case. Hobby Purpose reinterprets via copy.
  "pop_density_per_km2",
]);

export const CATEGORICAL_METRICS: Set<Metric> = new Set<Metric>([
  "gw_proclaimed",
  "sw_proclaimed",
]);

export type Tab = "controls" | "inspector" | "ranking" | "data" | "settings";

type UiState = {
  metric: Metric;
  weights: Weights | null; // null until /weights returns
  weightsDirty: boolean;
  selectedH3: string | null;
  compareH3: string | null; // pinned "B" cell for side-by-side compare
  searchH3: string | null;
  // Bumps every time flyTo() is called. Map watches (h3, nonce) so calling
  // flyTo on the currently-flown hex still fires — otherwise re-clicking
  // "go to" for the same cell would be a no-op.
  flyTo: { h3: string; nonce: number } | null;
  // Same pattern for zoom nudges from the map controls cluster. Value is
  // the delta (+1 = zoom in, -1 = zoom out).
  zoomNudge: { delta: number; nonce: number } | null;
  selectedLgas: string[]; // empty = all
  panelOpen: boolean;
  activeTab: Tab;

  // Set by useFreshness when /health reports a different build_id than the
  // one baked into the running bundle. Surfaced as a banner + the map
  // controls' refresh button flips to "reload" mode. Never set by user
  // action.
  updateAvailable: boolean;
  updateBannerDismissed: boolean;
  setUpdateAvailable: (v: boolean) => void;
  dismissUpdateBanner: () => void;

  setMetric: (m: Metric) => void;
  setWeights: (w: Weights) => void;
  setWeight: (k: keyof Weights, v: number) => void;
  resetWeights: (defaults: Weights) => void;
  selectHex: (h3: string | null) => void;
  setCompareH3: (h3: string | null) => void;
  toggleCompare: (h3: string) => void;
  armCompare: () => void; // touch-friendly alternative to shift-click
  compareArmed: boolean;
  setSearchH3: (h3: string | null) => void;
  flyToHex: (h3: string) => void;
  nudgeZoom: (delta: number) => void;
  setLgas: (lgas: string[]) => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setActiveTab: (t: Tab) => void;
};

export const useUi = create<UiState>((set) => ({
  metric: "suitability_score",
  weights: null,
  weightsDirty: false,
  selectedH3: null,
  compareH3: null,
  compareArmed: false,
  searchH3: null,
  flyTo: null,
  zoomNudge: null,
  selectedLgas: [],
  panelOpen: true,
  activeTab: "controls",
  updateAvailable: false,
  updateBannerDismissed: false,

  setMetric: (m) => set({ metric: m }),
  setWeights: (w) => set({ weights: { ...w }, weightsDirty: false }),
  setWeight: (k, v) =>
    set((s) =>
      s.weights
        ? { weights: { ...s.weights, [k]: v }, weightsDirty: true }
        : s,
    ),
  resetWeights: (defaults) =>
    set({ weights: { ...defaults }, weightsDirty: false }),
  selectHex: (h3) =>
    set((s) =>
      h3
        ? {
            selectedH3: h3,
            // Panel is NOT force-opened here. On desktop it's already
            // open; on mobile the peek strip shows the selection header
            // and the user taps to expand into the full-height sheet.
            // Yanking to full-height on every tap kills the map view.
            activeTab: "inspector",
            compareArmed: s.compareArmed,
          }
        : { selectedH3: null, compareH3: null, compareArmed: false },
    ),
  setCompareH3: (h3) => set({ compareH3: h3 }),
  toggleCompare: (h3) =>
    set((s) => {
      // Can't compare a cell with itself. Otherwise toggle: same cell
      // clears, new cell pins. Always disarms the compare intent so a
      // subsequent tap goes back to normal select behaviour.
      if (h3 === s.selectedH3) return { compareArmed: false };
      if (s.compareH3 === h3) return { compareH3: null, compareArmed: false };
      return {
        compareH3: h3,
        compareArmed: false,
        activeTab: "inspector",
      };
    }),
  armCompare: () => set((s) => ({ compareArmed: !s.compareArmed })),
  setSearchH3: (h3) => set({ searchH3: h3 }),
  flyToHex: (h3) =>
    set((s) => ({ flyTo: { h3, nonce: (s.flyTo?.nonce ?? 0) + 1 } })),
  nudgeZoom: (delta) =>
    set((s) => ({
      zoomNudge: { delta, nonce: (s.zoomNudge?.nonce ?? 0) + 1 },
    })),
  setLgas: (lgas) => set({ selectedLgas: lgas }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setActiveTab: (t) => set({ activeTab: t, panelOpen: true }),
  setUpdateAvailable: (v) =>
    set((s) => ({
      updateAvailable: v,
      // If a fresh update was just detected, un-dismiss so the banner shows
      // even if the user dismissed a prior one earlier in the session.
      updateBannerDismissed: v ? false : s.updateBannerDismissed,
    })),
  dismissUpdateBanner: () => set({ updateBannerDismissed: true }),
}));

export function normalisedWeights(w: Weights): Weights {
  const total = FACTOR_ORDER.reduce((acc, k) => acc + w[k], 0);
  if (total <= 0)
    return { water: 0, rainfall: 0, soil: 0, access: 0, bushfire: 0, scale: 0 };
  return {
    water: w.water / total,
    rainfall: w.rainfall / total,
    soil: w.soil / total,
    access: w.access / total,
    bushfire: w.bushfire / total,
    scale: w.scale / total,
  };
}
