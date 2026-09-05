# Downloads Tracker

Datasets you (the human) need to download manually and drop into
`cache/raw/<subdir>/` before the ingest modules can run. SLIP's protected
endpoints require browser-based OAuth, so we can't script this from Python
in the MVP.

**How to use this file:**
1. Work top-down. Tier 1 items are gated on this data being present.
2. For each item: sign in to SLIP in your browser, click the download link,
   move the file into the target directory, then update the row.
3. Fill in **Downloaded** with `YYYY-MM-DD` and **Filename** with the exact
   filename in `cache/raw/`. Leave **Status** as `TODO` until both are set.

Legend: `TODO` · `IN PROGRESS` · `DONE` · `SKIPPED (reason)`

---

## Tier 1 — required for MVP

### 1. Cadastre (No Attributes) — LGATE-001 *(MVP choice, FREE)*
- **Status:** DONE
- **URL:** https://data-downloads.slip.wa.gov.au/LGATE-001/Geopackage
- **Format:** GeoPackage (`.gpkg`), zipped
- **Target:** `cache/raw/cadastre/`
- **Downloaded:** 2026-09-04
- **Filename:** `Cadastre_No_Attributes_LGATE_001_WA_GDA2020_Public_Geopackage.zip`
  (contains `Cadastre_No_Attributes_LGATE_001_WA_GDA2020_Public.gpkg`, ~848 MB unzipped)
- **Notes:** Free public cadastre. Geometry + polygon ID only, no tenure
  attributes. Sign in to SLIP first (free account is enough — no subscription).
  Expect ~1 GB zipped for statewide. Ingest module filters to Boyup Brook
  LGA via spatial join against LGA boundaries (item 2).

  **Trade-off vs paid LGATE-217:** we lose in-cadastre tenure filters, so
  Crown-reserve / DBCA-estate filtering happens via separate spatial joins
  against items 5 (Crown Reserves) and a DBCA layer. We also lose stable
  parcel IDs (lot-on-plan, PIN) that match Landgate sales reports cleanly
  — this hurts M8 residual precision (locality-centroid match instead of
  exact-parcel match). Both are livable for a screening tool. Upgrade to
  LGATE-217 is tracked as task D.11.

### 2. Local Government Authority (LGA) Boundaries — LGATE-233
- **Status:** DONE
- **URL:** https://data-downloads.slip.wa.gov.au/LGATE-233/Geopackage
- **Format:** GeoPackage (`.gpkg`), GDA2020 variant
- **Target:** `cache/raw/boundaries/`
- **Downloaded:** 2026-09-04
- **Filename:** `LGA_Boundaries_LGATE_233_WA_GDA2020_Public_Geopackage.zip`
  (contains `LGA_Boundaries_LGATE_233_WA_GDA2020_Public.gpkg`, ~5.6 MB unzipped)
- **Notes:** Confirmed via CKAN search. Need this to (a) filter cadastre to
  Boyup Brook LGA, and later (b) chunk ingest by LGA across the whole
  division.

### 3. South West Land Division boundary
- **Status:** SKIPPED (paid — Landgate subscription only)
- **URL:** N/A — verified 2026-09-04 that this dataset is behind the paid
  SLIP subscription tier, not on public downloads
- **Workaround:** Since we already load LGATE-233 (LGA boundaries), the SWLD
  can be reconstructed by taking the geometric union of the ~30 LGAs that
  make up the division. Alternatively, use the union of the LGAs we've
  actually ingested. Neither approach needs a separate download.
- **Notes:** Update `ingest/boundaries.py` to derive the SWLD polygon from
  LGATE-233 when we get to M7 scale-up.

### 4. Townsites — LGATE-248
- **Status:** DONE
- **URL:** https://data-downloads.slip.wa.gov.au/LGATE-248/Geopackage
- **Format:** GeoPackage (`.gpkg`), zipped
- **Target:** `cache/raw/townsites/`
- **Downloaded:** 2026-09-04
- **Filename:** `Townsites_LGATE_248_WA_GDA2020_Public_Geopackage.zip`
- **Notes:** Used for both filtering parcels (drop those inside towns) and
  distance-to-town scoring. Ingest: `ingest/townsites.py` (to be written).

### 5. Crown Reserves
- **Status:** SKIPPED (paid — Landgate subscription only)
- **Notes:** Verified 2026-09-04. The public Crown Reserves layer is behind
  the paid Landgate subscription. **Impact:** we lose one input to the 1.7b
  filter (removing crown reserve parcels from the cadastre). Workaround:
  DBCA-managed land (item 5b) covers most of the reserved land that matters
  in the SW (national parks, nature reserves, state forests) and is free.
  Un-DBCA-managed crown reserves (unallocated crown land, water reserves,
  quarry reserves, etc.) will pass through the cadastre filter and get
  aggregated into hex `parcel_count` — they'll show up as small "parcels"
  that aren't actually buyable, which biases parcel_count slightly upward.
  Acceptable trade-off for the MVP. Upgrade path is D.11 (LGATE-217 paid
  cadastre gives tenure column directly).

### 5b. DBCA Legislated Lands and Waters — DBCA-011
- **Status:** DONE
- **URL:** https://data-downloads.slip.wa.gov.au/DBCA-011/Geopackage
- **Format:** GeoPackage (`.gpkg`), zipped
- **Target:** `cache/raw/dbca_estate/`
- **Downloaded:** 2026-09-04
- **Filename:** `Legislated_Lands_and_Waters_DBCA_011_WA_GDA2020_Public_Geopackage.zip`
- **Notes:** National parks, nature reserves, state forests, conservation
  parks managed by DBCA. With Crown Reserves unavailable (paid), this is
  the main filter we have for "not private land" in the LGATE-001 cadastre
  workflow (task 1.7b).

### 6. RIWI Groundwater Areas — DWER-034
- **Status:** DONE
- **URL:** https://data-downloads.slip.wa.gov.au/DWER-034/Geopackage
- **Format:** GeoPackage (`.gpkg`), zipped
- **Target:** `cache/raw/groundwater/`
- **Downloaded:** 2026-09-04
- **Filename:** `RIWI_Act_Groundwater_Areas_DWER_034_WA_GDA2020_Public_Geopackage.zip`
- **Notes:** 45 proclaimed areas statewide. `status` = 'Proclaimed' for all
  (dataset only contains proclaimed areas by definition). Ingested to
  `hex.gw_proclaimed` + `hex.gw_area_name`.

### 6b. Groundwater Salinity Statewide — DWER-026
- **Status:** DONE
- **URL:** https://data-downloads.slip.wa.gov.au/DWER-026/Geopackage
- **Format:** GeoPackage (`.gpkg`), zipped
- **Target:** `cache/raw/groundwater_salinity/`
- **Downloaded:** 2026-09-04
- **Filename:** `Groundwater_Salinity_Statewide_DWER_026_WA_GDA2020_Public_Geopackage.zip`
- **Notes:** 169 polygons statewide. TDS classes: `<500` (fresh) up to
  `>35000` (hypersaline). The raw `salinity_i` column is a polygon ID, NOT
  a monotone rank — `ingest/salinity.py` maps `tds_mg_l_` string to an
  ordinal 1-7 (fresh→hypersaline). Cells at ordinal ≥5 (7000+ mg/L) are
  hard-excluded per `weights.yaml`.

### 7. RIWI Surface Water Areas + Irrigation Districts — DWER-037
- **Status:** DONE
- **URL:** https://data-downloads.slip.wa.gov.au/DWER-037/Geopackage
- **Format:** GeoPackage (`.gpkg`), zipped
- **Target:** `cache/raw/surface_water/`
- **Downloaded:** 2026-09-04
- **Filename:** `RIWI_Act_Surface_Water_Areas_and_Irrigation_Districts_DWER_037_WA_GDA2020_Public_Geopackage.zip`
- **Notes:** 54 features (40 Surface Water Areas + 14 Irrigation Districts),
  all proclaimed. Populates `hex.sw_proclaimed`. Same MVP proxy as
  groundwater (proclamation = licence required, no headroom info).

### 8. Soil-Landscape Mapping — Best Available — DPIRD-027
- **Status:** DONE
- **URL:** https://data-downloads.slip.wa.gov.au/DPIRD-027/Geopackage
- **Format:** GeoPackage (`.gpkg`), zipped
- **Target:** `cache/raw/soils/`
- **Downloaded:** 2026-09-04
- **Filename:** `Best_Available_DPIRD_027_WA_GDA2020_Public_Geopackage.zip`
  (~310 MB zipped; 147,040 polygons statewide)
- **Notes:** **This ONE dataset covers everything we need for soils AND
  land capability.** It embeds all 5 per-enterprise capability columns
  directly on the polygons using A1/A2/B1/B2/C1/C2 ratings:
  - `lc_graz` (grazing)
  - `lc_dry_cro` (dryland cropping)
  - `lc_ann_hor` (annual horticulture)
  - `lc_per_hor` (perennial horticulture)
  - `lc_vines` (vineyards)

  Plus land-quality columns: `lq_salin_m` (surface salinity), `lq_wa_log_`
  (waterlogging), `lq_ph5080_` (subsoil pH), `lq_wa_sto_` (water storage /
  PAW), `lq_su_aci_` (surface acidity), `lq_wa_ero_` (water erosion), and
  more.

  **So DPIRD-032 (Land Capability Grazing) is NOT needed** — its data is a
  strict subset of DPIRD-027's `lc_graz` column. Also DPIRD-035 (Surface
  Acidity) and DPIRD-041 (Soil Water Storage) can be derived from
  DPIRD-027's `lq_*` columns rather than downloaded separately.

  Ratings: A1 = best (few limitations), A2, B1, B2, C1, C2 = worst
  ("very high" limitations). `NA` = not assessed / not applicable. We map
  A1→1, A2→2, B1→3, B2→4, C1→5, C2→6 in `ingest/soils.py`.

  The brief's `capability_class 1..5` schema is superseded here — the
  underlying data uses 6 classes for each of 5 enterprises. We'll pick
  grazing as the default enterprise (matches SW WA reality — most rural
  land is grazed) and expose per-enterprise scoring as a UI toggle later.

### 9. Bushfire Prone Areas — OBRM-024
- **Status:** DONE
- **URL:** https://data-downloads.slip.wa.gov.au/OBRM-024/Geopackage
- **Format:** GeoPackage (`.gpkg`), zipped
- **Target:** `cache/raw/bushfire/`
- **Downloaded:** 2026-09-04
- **Filename:** `Bush_Fire_Prone_Areas_2025_OBRM_024_WA_GDA2020_Public_Geopackage.zip`
- **Notes:** OBRM (Office of Bushfire Risk Management) 2025 vintage.
  Compute `hex.bushfire_prone_frac` as the fraction of each cell polygon
  that intersects a bushfire-prone polygon.

### 10. Roads (Simplified) — LGATE-195
- **Status:** DONE
- **URL:** https://data-downloads.slip.wa.gov.au/LGATE-195/Geopackage
- **Format:** GeoPackage (`.gpkg`), zipped
- **Target:** `cache/raw/roads/`
- **Downloaded:** 2026-09-04
- **Filename:** `Roads_Simplified_LGATE_195_WA_GDA2020_Public_Geopackage.zip`
- **Notes:** Simplified version chosen over full-detail Road Network. Same
  topology, less noise; loss of precision is negligible at res 7 hex cells.
  We filter to sealed roads only for the access score. Ingest:
  `ingest/roads.py` (to be written).

### 11. Rainfall grid (SILO monthly_rain) — automated
- **Status:** DONE (automated, no manual download)
- **URL:** https://s3-ap-southeast-2.amazonaws.com/silo-open-data/Official/annual/monthly_rain/{year}.monthly_rain.nc
- **Format:** NetCDF (monthly rainfall grids, 1970-2024, 55 files, ~14 MB each)
- **Target:** `cache/raw/rainfall/{year}.monthly_rain.nc`
- **Downloaded:** 2026-09-04 via `ingest/rainfall_download.py`
- **Notes:** SILO is public via direct HTTPS on their S3 bucket — no auth
  needed. Downloader is idempotent (skips files already present). Grabs
  1970-2024 (55 years) = 720 MB. Enough for §6 baseline (1991-2020) and
  trend (since 1970). Refresh by running the downloader again — new years
  are added incrementally.

### 12. DEM (Digital Elevation Model), 20 m or coarser
- **Status:** TODO
- **URL:** Search catalogue.data.wa.gov.au or Geoscience Australia for
  "Digital Elevation Model"; national 1-second SRTM-derived is fine at
  ~30 m and free
- **Format:** GeoTIFF
- **Target:** `cache/raw/dem/`
- **Downloaded:** _yyyy-mm-dd_
- **Filename:** _fill in after download_
- **Notes:** Used for slope% per hex cell.

---

## Manual (paid) — Tier 1 but human-purchased

### 13. Landgate Rural Sales Reports
- **Status:** TODO (defer until after M7)
- **URL:** Purchase per LGA via Landgate; approx AUD $50 each
- **Format:** CSV, PDF, or Excel — depends on report vintage
- **Target:** `cache/manual/rural_sales/`
- **Downloaded:** _yyyy-mm-dd_
- **Filename:** _fill in after download_
- **Notes:** Only needed for M8 (price + residual layer). Buy 3–4 shires
  from the M7 shortlist first, not all of them.

---

## Tier 2 — shortlist only, do not download yet

These are deferred until after M7. Listed here as a checklist for later.

- [ ] 14. Mining Tenements (DMIRS, Tengraph)
- [ ] 15. Aboriginal Heritage Inquiry System (AHIS) exports
- [ ] 16. Contaminated Sites Register (DWER)
- [ ] 17. Native Title Determinations (NNTT)
- [ ] 18. Acid Sulfate Soils risk mapping (DWER)
- [ ] 19. Sentinel-2 imagery (Copernicus) — only for NDVI over shortlist parcels
- [ ] 20. Fine LiDAR DEM (Landgate) — only over shortlist parcels

---

## When you finish a download

After moving a file into `cache/raw/<subdir>/`:

1. Update this file's row: set **Status: DONE**, fill in **Downloaded**
   and **Filename**.
2. Also record it in `notes/DATA_LOG.md` — one line per fetch, so we
   have a chronological audit trail alongside this checklist.
3. Tell Claude the filename so the relevant ingest module can be pointed
   at it.
