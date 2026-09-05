/**
 * Format a hex cell's value for a given metric, with units and short labels.
 * Used by hover cards, ranking table cells, etc. — the single source of
 * truth for "what does this metric read like as text?" Keeps the units,
 * precision, and boolean labels consistent across surfaces.
 *
 * Returns "—" for null/NaN so callers don't have to guard.
 */

import type { HexCell } from "../types";
import type { Metric } from "../store";

export type MetricValueSpec = {
  label: string;   // short label suitable for tooltip / table header
  format: (cell: HexCell) => string;
};

const dash = "—";

function num(v: number | null | undefined, digits: number, suffix = ""): string {
  if (v == null || !Number.isFinite(v)) return dash;
  return `${v.toFixed(digits)}${suffix}`;
}

function bool(v: boolean | null | undefined, truthy: string, falsy: string): string {
  if (v == null) return dash;
  return v ? truthy : falsy;
}

export const METRIC_VALUE: Record<Metric, MetricValueSpec> = {
  suitability_score: {
    label: "Suitability",
    format: (c) => num(c.suitability_score, 3),
  },
  parcel_count: {
    label: "Parcels",
    format: (c) => (c.parcel_count == null ? dash : c.parcel_count.toString()),
  },
  parcel_area_median_ha: {
    label: "Median parcel",
    format: (c) => num(c.parcel_area_median_ha, 2, " ha"),
  },
  gw_proclaimed: {
    label: "Groundwater",
    format: (c) => bool(c.gw_proclaimed, "Proclaimed", "Unproclaimed"),
  },
  sw_proclaimed: {
    label: "Surface water",
    format: (c) => bool(c.sw_proclaimed, "Proclaimed", "Unproclaimed"),
  },
  salinity_idx: {
    label: "Salinity",
    format: (c) =>
      c.salinity_idx == null ? dash : `ord ${c.salinity_idx}/7`,
  },
  bushfire_prone_frac: {
    label: "Bushfire prone",
    format: (c) =>
      c.bushfire_prone_frac == null
        ? dash
        : `${(c.bushfire_prone_frac * 100).toFixed(0)}% of cell`,
  },
  capability_class: {
    label: "Soil class",
    format: (c) =>
      c.capability_class == null ? dash : `class ${c.capability_class}/6`,
  },
  dist_townsite_km: {
    label: "Nearest town",
    format: (c) => num(c.dist_townsite_km, 1, " km"),
  },
  dist_sealed_road_km: {
    label: "Sealed road",
    format: (c) => num(c.dist_sealed_road_km, 1, " km"),
  },
  dbca_estate_frac: {
    label: "DBCA estate",
    format: (c) =>
      c.dbca_estate_frac == null
        ? dash
        : `${(c.dbca_estate_frac * 100).toFixed(0)}% of cell`,
  },
  gsr_mean_mm: {
    label: "Rain (May–Oct)",
    format: (c) => num(c.gsr_mean_mm, 0, " mm"),
  },
  gsr_trend: {
    label: "Rain trend",
    format: (c) =>
      c.gsr_trend == null
        ? dash
        : `${c.gsr_trend >= 0 ? "+" : ""}${c.gsr_trend.toFixed(1)} mm/decade`,
  },
  summer_max_temp_c: {
    label: "Summer max",
    format: (c) => num(c.summer_max_temp_c, 1, " °C"),
  },
  winter_min_temp_c: {
    label: "Winter min",
    format: (c) => num(c.winter_min_temp_c, 1, " °C"),
  },
  evap_annual_mm: {
    label: "Evaporation",
    format: (c) => num(c.evap_annual_mm, 0, " mm/yr"),
  },
  solar_annual_mj: {
    label: "Solar",
    format: (c) => num(c.solar_annual_mj, 1, " MJ/m²/day"),
  },
  vp_annual_hpa: {
    label: "Vapour pressure",
    format: (c) => num(c.vp_annual_hpa, 1, " hPa"),
  },
  summer_max_trend_c_per_decade: {
    label: "Summer max trend",
    format: (c) =>
      c.summer_max_trend_c_per_decade == null
        ? dash
        : `${c.summer_max_trend_c_per_decade >= 0 ? "+" : ""}${c.summer_max_trend_c_per_decade.toFixed(2)} °C/dec`,
  },
  winter_min_trend_c_per_decade: {
    label: "Winter min trend",
    format: (c) =>
      c.winter_min_trend_c_per_decade == null
        ? dash
        : `${c.winter_min_trend_c_per_decade >= 0 ? "+" : ""}${c.winter_min_trend_c_per_decade.toFixed(2)} °C/dec`,
  },
  pop_density_per_km2: {
    label: "Pop density",
    // <10 /km² is normal rural; show one decimal so the low end reads
    // meaningfully. Townsite cells run into the tens/hundreds — same format.
    format: (c) => num(c.pop_density_per_km2, 1, " /km²"),
  },
};
