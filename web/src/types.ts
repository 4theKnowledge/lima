/**
 * Types mirror the Pydantic schemas in api/schemas.py. Keep them in sync by
 * hand for now — small surface area. A codegen step (openapi-typescript) is
 * fine to add later once the API stabilises.
 */

export type HexCell = {
  h3: string;
  lga: string | null;
  excluded: boolean;
  exclusion_reasons: string[] | null;

  suitability_score: number | null;
  factor_water: number | null;
  factor_rainfall: number | null;
  factor_soil: number | null;
  factor_access: number | null;
  factor_bushfire: number | null;

  parcel_count: number | null;
  parcel_area_median_ha: number | null;
  gw_proclaimed: boolean | null;
  sw_proclaimed: boolean | null;
  salinity_idx: number | null;
  bushfire_prone_frac: number | null;
  capability_class: number | null;
  dist_townsite_km: number | null;
  dist_sealed_road_km: number | null;
  dbca_estate_frac: number | null;
  gsr_mean_mm: number | null;
  gsr_trend: number | null;
};

export type HexDetail = HexCell & {
  gw_area_name: string | null;
  salinity_tds_class: string | null;
  capability_confidence: number | null;
  lc_graz_raw: string | null;
  lc_dry_cro_raw: string | null;
  lc_ann_hor_raw: string | null;
  lc_per_hor_raw: string | null;
  lc_vines_raw: string | null;
  nearest_townsite_name: string | null;
  nearest_sealed_road_name: string | null;
  dbca_category: string | null;
};

export type ParcelSummary = {
  n: number;
  mean_ha: number | null;
  median_ha: number | null;
  min_ha: number | null;
  max_ha: number | null;
  total_ha: number | null;
};

export type Weights = {
  water: number;
  rainfall: number;
  soil: number;
  access: number;
  bushfire: number;
};

export type FactorName = keyof Weights;
export const FACTOR_ORDER: FactorName[] = [
  "water",
  "rainfall",
  "soil",
  "access",
  "bushfire",
];

export type Exclusions = {
  gsr_mean_mm_below: number | null;
  capability_class_at_or_above: number | null;
  salinity_idx_at_or_above: number | null;
  dbca_estate_frac_above: number | null;
};

export type Sensitivity = {
  run_at: string | null;
  verdict: string | null;
  min_rho_cell: number | null;
  min_rho_lga: number | null;
};

export type GeocodeResult = {
  lat: number;
  lng: number;
  display_name: string;
  h3: string;
};

export type Health = {
  ok: boolean;
  snapshot_mtime: number;
  hex_count: number;
};

export type DataSource = {
  key: string;
  label: string;
  rows_populated: number;
  last_ingest: string | null;
};

export type DataStatus = {
  snapshot_mtime: number;
  snapshot_iso: string;
  hex_count: number;
  parcel_count: number;
  n_lgas: number;
  n_scored: number;
  n_excluded: number;
  sources: DataSource[];
};
