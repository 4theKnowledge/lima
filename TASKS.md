# Tasks: South West WA Land Screening Tool (MVP)

Tasks are grouped by the milestones in `BUILD_BRIEF.md` §8. Each milestone must produce
something usable on its own — do not start milestone N+1 until N is verified.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked / needs decision

---

## M0 — Project setup

- [x] 0.1 Initialise `uv` project: `uv init`, pin Python 3.11+ in `pyproject.toml` and `.python-version`
- [x] 0.2 Add core deps: `duckdb`, `httpx`, `geopandas`, `rioxarray`, `exactextract`, `pyyaml`, `streamlit`, `pydeck`, `h3`, `pyproj`, `shapely`
- [x] 0.3 Add dev deps: `pytest`, `ruff`
- [x] 0.4 Create repo layout per §1: `ingest/`, `cache/raw/`, `cache/manual/`, `db/`, `scoring/`, `app/`, `notes/`
- [x] 0.5 Add `.gitignore` for `cache/`, `db/*.duckdb`, `.venv/`, `__pycache__/`
- [x] 0.6 Create empty `notes/DATA_LOG.md` with append-only header
- [x] 0.7 Create `scoring/weights.yaml` with defaults from §6 (weights, exclusion thresholds, breakpoint curves)
- [x] 0.8 Bootstrap DuckDB: script that creates `db/land.duckdb`, installs+loads `spatial` and `h3` extensions, creates empty tables per §5
- [x] 0.9 Verify `uv run python -c "import duckdb; ..."` loads both extensions

## M1 — Cadastre for one LGA (Boyup Brook)

**Auth pivot:** SLIP's WFS + download portal don't accept plain HTTP Basic Auth
(WFS wants ArcGIS tokens, downloads use browser OAuth). MVP approach: user
manually downloads GeoPackages from SLIP once, drops them into `cache/raw/`,
and the ingest modules read from there. Fully automated WFS access is
deferred; see D.10.

**Dataset pivot:** using the FREE **LGATE-001 (Cadastre No Attributes)**
instead of the paid LGATE-217. Trade-off: no tenure column, so Crown-reserve
and DBCA-estate filtering happens via extra spatial joins against separate
layers, and parcel IDs don't match Landgate sales reports exactly (hurts M8
precision). Upgrade path tracked as D.11.

- [x] 1.1 Register SLIP account for endpoints that require auth
- [x] 1.1a Add `python-dotenv`, `.env.example`, `.gitignore` entry, `ingest/settings.py` with `slip_auth()`
- [x] 1.1b User creates `.env` from `.env.example` with real SLIP creds
- [x] 1.2 Write CKAN resolver helper: given a dataset name, return WFS/WMS resource URLs (`ingest/ckan.py`)
- [x] 1.3 User manually downloads LGATE-001 Cadastre (No Attributes) GeoPackage from `data-downloads.slip.wa.gov.au/LGATE-001/Geopackage` into `cache/raw/cadastre/`
- [x] 1.3a `ingest/cadastre.py`: reads the GeoPackage via `/vsizip/`, logs feature count and source filename to `DATA_LOG.md`
- [x] 1.3b Spatial-join cadastre to LGA boundaries via bbox pre-filter + intersects test — the free cadastre has no LGA attribute
- [x] 1.4 Loaded into `parcel` table with geometry in EPSG:7844 (WKB via `ST_GeomFromWKB`)
- [x] 1.5 Compute parcel areas in EPSG:7850 (Zone 50), store as `area_ha`
- [x] 1.6 **CRS acceptance check** (`ingest/crs_check.py`): PASSED cross-CRS gate (0.075% diff vs EPSG:3577). LGA-total check deferred — LGATE-001 has ~18% inflation from overlapping road/reserve/tenure polygons; re-check after 1.7b to confirm cleanup.
- [ ] 1.7a Apply size + townsite filters and record drop counts: < 10 ha, townsite intersect
- [~] 1.7b DBCA-estate filter partially done at hex-level: `hex.dbca_estate_frac` populated; cells >90% DBCA hard-excluded (1827 cells). Crown Reserves skipped (paid, item 5). Parcel-level cadastral filter not implemented — currently DBCA parcels still land in `parcel_count`; the exclusion happens on the hex frac instead. Acceptable for MVP.
- [x] 1.8 Ingest is idempotent: re-running the module replaces this LGA's rows cleanly (verified via `parcel_id LIKE 'slug::%'` DELETE-then-INSERT)

## M2 — H3 grid + parcel→cell aggregation

- [~] 2.1 Load SWLD boundary + LGA boundaries via `ingest/boundaries.py` — LGA boundaries reused directly from cadastre path (`load_lga`); SWLD boundary deferred until M7
- [x] 2.2 Generate H3 res 7 cells covering Boyup Brook LGA, insert into `hex` with EPSG:7844 geometry (`ingest/hex_grid.py`)
- [x] 2.3 H3 resolution reads from `scoring/weights.yaml → h3.resolution` (default 7)
- [x] 2.4 `hex.lga` populated at write time (single-LGA ingest; SWLD-wide chunking deferred to M7)
- [x] 2.5 Parcel counts + median parcel area per cell → `parcel_count`, `parcel_area_median_ha`
- [x] 2.6 Sanity check enforced in code: aggregated parcels == LGA parcels (raises if mismatch). 5711/5711 for Boyup Brook.
- [x] 2.7 (new) Fringe-cell handling: parcels whose centroid lands outside the LGA polygon still get written; no silent drops per §0 rule 1

## M3 — Three decisive layers + crude scoring

- [x] 3.1 `ingest/groundwater.py`: DWER-034 loaded; 584/4031 cells in proclaimed areas (Blackwood, Busselton-Capel, Collie)
- [x] 3.2 `ingest/surface_water.py`: DWER-037 loaded; 1464/4031 cells in proclaimed SW/irrigation areas (~36%)
- [x] 3.3 `ingest/soils.py`: DPIRD-027 loaded (147,040 polygons, STRTree + 50m simplify fast path). All 5 per-enterprise codes captured; grazing is default.
- [x] 3.4 Modal capability + confidence computed per hex. Grazing distribution: A1=5, A2=41, B1=2678, B2=766, C1=204, C2=107, None=230.
- [x] 3.5 `ingest/bushfire.py`: OBRM-024 loaded via STRTree fast path; 3799/4031 cells with BPA overlap (mean 86% coverage). Naive union_all approach hit 17-min stall on 469 polygons — see X.8.
- [x] 3.6 `excluded BOOLEAN` and `exclusion_reasons VARCHAR[]` columns already in `db/bootstrap.py` schema
- [x] 3.7 `scoring/exclude.py`: Stage 1 hard mask from `weights.yaml`; runs against whatever columns are populated, skips rules where source data isn't loaded yet
- [x] 3.8 `scoring/score.py`: Stage 2 weighted score on survivors, 5 factor sub-scores stored separately. 1,567 cells fully scored across 5 shires. Range 0.43–0.90.
- [ ] 3.9 Export result to GeoPackage for QGIS inspection
- [x] 3.10 (new) `ingest/salinity.py`: DWER-026 loaded; 3750/4031 cells inside a salinity polygon. TDS class mapped to ordinal 1-7 (raw `salinity_i` was a polygon ID, not a monotone rank).
- [x] 3.11 (new) Salinity added to exclusions: cells at TDS ≥7000 mg/L (ordinal ≥5) excluded (201 cells)

## M4 — Rainfall (level + trend)

- [x] 4.1 `ingest/rainfall_download.py` fetches SILO monthly_rain NetCDFs 1970-2024 directly from S3 (no auth, ~720 MB total). Idempotent.
- [x] 4.2 `ingest/rainfall.py` computes per hex cell (nearest-neighbour, not `exactextract` — simpler and fine at res 7):
  - `gsr_mean_mm` — May-Oct mean, 1991-2020 baseline. AOI range: 364-1037 mm.
  - `gsr_trend` — linear regression slope 1970+, mm/decade. AOI range: -45 to +9. Mean -13 (matches published SW drying trend).
- [ ] 4.3 Wire rainfall into scoring: level uses breakpoint curve (cliff < 400mm, indifferent > 600mm); trend penalises level score per formula defined in `weights.yaml`
- [ ] 4.4 Pin the trend-as-penalty formula explicitly (multiplier vs curve shift) — brief gap flagged in review

## M5 — Access layers

- [x] 5.1 `ingest/roads.py`: LGATE-195 Roads Simplified loaded (bbox-clipped to AOI + `roadsurface = 'Sealed'` predicate pushdown; 13,189 sealed segments in AOI vs 120k statewide).
- [x] 5.2 `dist_sealed_road_km` + `nearest_sealed_road_name` computed per cell centroid via STRTree nearest-neighbour. Range 0-31 km, median 3.15 km. Top nearest: South Western Hwy (564 cells), Muir Hwy, Vasse Hwy.
- [x] 5.3 `ingest/townsites.py`: LGATE-248 loaded (636 polygons); populates `hex.dist_townsite_km` + `hex.nearest_townsite_name`
- [x] 5.4 `dist_townsite_km` computed per cell centroid in EPSG:7850 via STRTree nearest-neighbour. Range: 0.0–46.1 km across our 5 shires.
- [ ] 5.5 `ingest/dem.py`: DEM (20m or coarser), compute `slope_mean_pct` per cell via `exactextract`

## M6 — Streamlit UI over single LGA

- [x] 6.1 `app/streamlit_app.py` scaffold with sidebar + map + table layout
- [x] 6.2 pydeck `H3HexagonLayer` bound to `hex` table (client-side hex rendering from H3 IDs, no geometry payload needed)
- [x] 6.3 Metric radio now includes ★ Suitability score (default), all raw layers, and Rainfall/Salinity/etc. Price/residual pending M8.
- [x] 6.4 Excluded cells render flat grey; reason shown in inspector panel
- [x] 6.5 Sidebar: 5 weight sliders (water/rainfall/soil/access/bushfire) default from `weights.yaml`. Slider changes trigger live re-score in-Python from cached `factor_*` columns — no DB round-trip, sub-second refresh at 4k cells. Sum drift is auto-normalised; UI shows effective normalised weights.
- [~] 6.6 Sidebar: address search, weights, "Reset to defaults" button, LGA multiselect, colour metric radio, legend. Exclusion threshold inputs still pending.
- [x] 6.7 Click a hex → inspector jumps to it (Streamlit 1.63+ native `selection_mode='single-object'` + `on_select='rerun'`). Clicked hex takes priority over searched hex.
- [x] 6.8 Ranked table (top 30 by current metric) + CSV download
- [ ] 6.9 Re-score performance budget check (need scoring to test)
- [x] 6.10 (new) Reserved colour vocabulary: grey=excluded, red/green=binary constraint, faint teal=no-data. `HIGH_IS_BAD` metrics invert the viridis ramp so purple always means "worse".
- [x] 6.11 (new) Address search (Nominatim) — resolves free-text to lat/lng → H3 res-7 cell, centres map, highlights hex with a white outline, auto-selects it in the inspector.
- [x] 6.12 (new) Read snapshot pattern (`db/snapshot.py` + `land_read.duckdb`) so Streamlit stays up during ingests. Two-part cache invalidation: (a) `_connect()` is NOT cached — opens fresh so DuckDB picks up the new snapshot file. (b) `@st.cache_data` functions take `_mtime` arg (snapshot mtime) so cached query results re-run on the next Streamlit re-run after any ingest.

## M7 — Scale to full division

- [ ] 7.0 (moved from M2.1) Download + load SWLD boundary for use as the outer AOI container
- [~] 7.1 Ingested 17 shires so far: 5 core SW + 9 adjacent SW + 3 eastern (Mundaring, York, Northam). 11,002 hex cells, 209,853 parcels. Full SWLD + selected wheatbelt shires now covered.
- [ ] 7.2 Run overnight; check `DATA_LOG.md` for gaps (missing LGA = worst-case failure per §0)
- [ ] 7.3 Verify total surviving parcel count is 100–200k; investigate if outside that range
- [ ] 7.4 Re-run M2–M5 pipeline across the full division
- [ ] 7.5 Operator sanity check: pick 2–3 known shires and confirm scores are plausible before proceeding (checkpoint flagged in review)
- [ ] 7.6 Add display-geometry simplification for pydeck if browser rendering is heavy (review gap)

## M8 — Price layer + residual view

- [ ] 8.1 Document manual purchase process for Landgate rural sales reports in `notes/`
- [ ] 8.2 `ingest/prices.py`: read whatever columns the exports actually have from `cache/manual/`, do not assume schema
- [ ] 8.3 Populate `price_locality` table
- [ ] 8.4 Join to hex by locality; compute `residual = norm_suitability − norm_price_per_ha`
- [ ] 8.5 Surface `n_sales` on every residual value; grey out localities with `n_sales < 5` (threshold configurable)
- [ ] 8.6 Enable price + residual toggles in UI colour switcher

## M10 — Fullstack conversion (React + FastAPI)

Move from Streamlit to a fullscreen-map + slide-out HUD UI. Streamlit stays runnable
as a fallback in `app/streamlit_app.py` until the React app reaches feature parity.
Backend reuses `ingest/`, `scoring/`, and the DuckDB snapshot verbatim — the FastAPI
layer is a thin HTTP shell, no logic duplication.

- [x] 10.1 `api/`: FastAPI app over the DuckDB read snapshot. Routes: /health, /lgas,
  /hex (bulk), /hex/{h3}, /parcels/{h3}/summary, /weights, /exclusions (PUT triggers
  re-run of scoring/exclude.py + scoring/score.py), /sensitivity/latest, /geocode
  (Nominatim, AU-biased, H3 res from weights.yaml). Fresh DuckDB connection per
  request so atomically-swapped snapshots are picked up without restart. Gzip on;
  CORS locked to Vite dev origin. Runs on port **8010** (port 8000 is occupied by an
  unrelated service on this machine).
- [x] 10.2 `web/`: Vite + React + TypeScript scaffold. Tailwind for styling, TanStack
  Query for server data, Zustand for UI state, deck.gl + maplibre-gl + h3-js for the
  map. Runs on port **5183** (port 5173 is proxied by Docker Desktop). TanStack Router
  deferred — URL-driven state is item 10.6.
- [x] 10.3 Fullscreen `<Map>` canvas: MapLibre basemap (CartoDB Positron, no token) +
  deck.gl H3HexagonLayer. Viridis + reserved-colour rules preserved (grey excluded,
  faint teal no-data, red/green binary constraint; HIGH_IS_BAD metrics invert the
  ramp). Hover card, click → set selected h3, flyTo on geocode.
- [x] 10.4 HUD panel — single floating tabbed panel on the right edge over a
  full-bleed map. Tried reserved-slot CSS grid first; the shrunken map made regional
  patterns hard to read, so pivoted to one floating panel with tabs. Map is always
  full-bleed; the panel is a translucent overlay.
  - Top-left: brand chip (brand + hex count) + selected-hex chip (LGA + h3 + suit +
    open-inspector arrow + clear ✕) which appears when a cell is selected.
  - Tab: **Controls** — search, metric picker, weights sliders (normalised readout +
    reset), exclusion thresholds (Apply → PUT /exclusions), LGA multiselect
    (All/None smart toggle), legend, sensitivity chip.
  - Tab: **Inspector** — cell suitability + factor decomposition, all raw layer
    values, capability confidence, parcel stats, exclusion reasons. Auto-activates
    when a hex is clicked on the map.
  - Tab: **Ranking** — top-30 table with CSV export. Panel widens/tallens when this
    tab is active so the table has room.
  - Tab: **Data** — snapshot mtime + relative age, hex/parcel/LGA counts, per-source
    coverage bars (green/amber/red), sensitivity verdict. Backed by new
    `GET /data-status` endpoint.
  - Collapse button (⇢) reduces the panel to a slim vertical rail of tab icons;
    clicking any icon expands and jumps to that tab.
- [x] 10.4a **Info tooltips everywhere.** `InfoTip` primitive is a small ⓘ button
  that opens a hover/focus popover portalled to document.body (escapes panel
  overflow, clamped to viewport edges). Plain-English copy in `lib/copy.ts` for
  every slider, dropdown, legend row, and jargon term in the inspector — first
  clause always jargon-free.
- [x] 10.4b **Spotlight on selection.** When a hex is selected (click or search),
  other cells fade to ~35% alpha so the target reads as the focal point. Regional
  contour still visible.
- [x] 10.4c **Basemap labels.** Switched from CartoDB Positron `nolabels-` to the
  labeled variant — place names, roads, water bodies visible.
- [x] 10.4d **Deselection.** Click same hex → toggle off. Escape key → clear.
  Escape ignored while typing in an input.
- [x] 10.4e **Hover card doesn't underlap HUD.** Clamps its x-position so it flips
  left of the pointer when it'd otherwise cross into panel bounds.
- [x] 10.5 Live client-side re-scoring: `lib/score.ts` recombines cached factor_*
  columns in-browser on weight slider changes, no backend hop. Backend hop only for
  exclusion changes (which need Python + a new DB snapshot; TanStack Query invalidates
  hex + detail caches on PUT /exclusions success).
- [ ] 10.6 URL-driven state: h3, metric, weights, LGAs live in query params (TanStack
  Router). Shareable / bookmarkable / back-button-friendly views. Deferred from
  initial cut — everything else works without it.
- [x] 10.7 README rewritten with `uv run uvicorn api.main:app --reload --port 8010`
  + `pnpm dev` side-by-side instructions. Streamlit path preserved as fallback with a
  note that it's legacy until parity is reached. Port choices documented (why 8010
  and 5183).
- [x] 10.8a `.gitignore` updated for the SPA: node_modules, web/dist, .vite cache,
  web/.env*, *.tsbuildinfo, npm/pnpm debug logs, coverage output, editor local
  settings under web/.
- [ ] 10.8 Feature-parity checklist: everything in M6 works in the new UI. Then
  remove Streamlit from `pyproject.toml`, delete `app/streamlit_app.py`.

## M11 — Polish & delight

Post-parity UX work. Ordered by expected impact-per-effort; items marked
**★** are the highest-priority "state of the art" pieces.

### Interaction feel

- [ ] **★ 11.1 Shareable URLs.** Sync `selectedH3`, `metric`, `weights`,
  `selectedLgas`, `activeTab` to URL query params. Read on mount, write on
  change (debounced ~200ms via `history.replaceState`). No TanStack Router
  needed — plain URLSearchParams is enough. Fixes "I found a great cell,
  how do I send it?"
- [ ] **★ 11.2 Compare mode.** Shift-click a second hex to pin it as B; the
  Inspector renders A/B side by side with a diff column (Δ suit, Δ per
  factor, deltas on raw layers). Shift-clicking B again unpins.
- [ ] 11.3 Undo/redo weight changes. ⌘Z / ⌘⇧Z. Small ring buffer (~20
  entries) of weight states + the metric. Helps "what if I care more about
  water?" exploration without losing the earlier setting.

### Data legibility

- [ ] 11.4 Small histogram in the metric picker. Shows the current metric's
  distribution over visible cells with the selected cell's value marked.
  Uses SVG, no chart lib. Answers "is this cell an outlier or typical?"
- [ ] 11.5 Per-shire rollup in the Data tab. Table: LGA, n_scored, mean
  suit, top-cell suit. Sortable. Complements the map view — makes
  shire-level shortlisting numeric.
- [ ] **★ 11.6 Threshold preview counts on exclusion sliders.** While
  dragging (before Apply), compute how many cells the draft rule would
  newly exclude vs re-include. Client-side over the already-loaded hex
  slice. Turns a scary "Apply" into a confident one.

### Trust / provenance

- [ ] 11.7 Colour-blind-safe palette toggle. Add a CVD-safe alt palette
  (cividis + swap the categorical proclaimed/unproclaimed away from
  red/green). Toggle in Controls, persisted to localStorage.
- [ ] 11.8 Human-readable exclusion reasons in the Inspector. Currently
  shows `soil>=class5` — expand to "Modal grazing capability is Class 5
  (C1), which your threshold excludes". Lookup table alongside `copy.ts`.
- [ ] 11.9 Confidence badges. `capability_confidence` and (later) `n_sales`
  get a green/amber/red pill next to the value in the Inspector so the
  operator can't miss low-evidence cells.

### Delight / polish

- [ ] 11.10 Skeleton loading for panels while `/hex` streams in. 11k cells
  has a visible moment on first load / cache miss.
- [ ] 11.11 Command palette (⌘K). Fuzzy list of: LGAs, metrics, actions
  (reset view, reset weights, apply exclusions). Kbar or hand-rolled.
- [ ] 11.12 Screenshot / export map view. Button in the map controls
  cluster that grabs the deck.gl canvas + basemap and downloads a PNG.
  Also copies a share URL to clipboard.
- [ ] 11.13 First-time-open tour. 3–4 arrow-annotated tooltips introducing
  search, weights, tabs, and how to select a cell. `localStorage` flag so
  it only fires once per browser.

### Correctness of the map

- [ ] 11.14 Zoom-adaptive H3 resolution. At zoom >12 the res 7 hexes look
  chunky. Precompute a res 8 layer for zoomed-in views; requires server-
  side viewport-bbox filter to keep payloads sane. Ties to `TASKS.md` D.9.

## M9 — Sensitivity check CLI

- [x] 9.1 `scoring/sensitivity.py`: shifts each of 5 weights ±25% (configurable via `--shift`), renormalises, recomputes suitability, reports Spearman ρ vs baseline.
- [x] 9.2 Reports both cell-level and LGA-level rank correlations. LGA-ρ = 1.0000 across all perturbations, cell-ρ ≥ 0.983. Verdict: STABLE.
- [x] 9.3 Runnable via `uv run python -m scoring.sensitivity`
- [x] 9.4 Sensitivity verdict shown in sidebar (colour-coded: success/info/warning/error). Auto-loaded from the latest snapshot in `notes/sensitivity/`.
- [x] 9.6 (new) Sensitivity logging: appends a Markdown block to `notes/SENSITIVITY_LOG.md` and drops a timestamped JSON snapshot to `notes/sensitivity/`. Compare across runs to spot ranking drift.
- [ ] 9.5 (backlog) LGA-ρ is trivially 1.0 with only 5 LGAs — becomes a meaningful signal once we scale to full SWLD (~30 LGAs). Add a "min N cells per LGA" gate so tiny shires (Bridgetown-Greenbushes: 280 cells) don't dominate the LGA aggregate noisily.

---

## X — Cross-cutting / ongoing

- [ ] X.1 `notes/DATA_LOG.md` appended on every fetch: source, date, LGA, feature count, `numberMatched`
- [ ] X.2 All tunables live in `weights.yaml` — nothing hardcoded in scoring code
- [ ] X.3 Every ingest module is idempotent and independently re-runnable
- [ ] X.4 Every raw response cached to `cache/raw/` before parse
- [ ] X.5 Any endpoint/column/code that doesn't match the brief → stop and report, do not substitute
- [x] X.6 **DB lock caveat:** SOLVED via snapshot pattern. Ingests write to `db/land.duckdb`; Streamlit reads `db/land_read.duckdb`. Each ingest publishes a fresh snapshot at the end via `db.snapshot.snapshot()`. Streamlit no longer needs stopping FOR ROW-DATA CHANGES. **Schema changes (ALTER TABLE ADD COLUMN) still need one Streamlit restart** because Streamlit's cache invalidation via `_mtime` only affects `@st.cache_data` — schema-shaped SQL bound at import time can survive on stale connections. Restart once per schema change; then keep going.
- [ ] X.7 **Border-cell attribution:** an H3 hex covered by multiple LGAs is assigned to whichever LGA's polygon contains its centroid. Parcels whose centroid falls in a border cell "owned" by a neighbouring LGA get counted under that neighbour. Documented in `ingest/hex_grid.py:write_hex`.
- [x] X.8 **Bushfire ingest performance:** rewrote to (a) AOI-clip BPAs first (469 → 306), (b) union clipped BPAs once producing non-overlapping components, (c) STRTree candidates per cell then sum per-part intersections (no per-cell union call). 11k cells in 4m30s. Previously hung at 40+ min.
- [ ] X.9 **Access sub-score split hardcoded:** `scoring/score.py:_access_score` uses road=0.60, town=0.40 inline. Move to `weights.yaml` as `access.road_weight` / `access.town_weight` so it's tunable and appears in the sensitivity check.

## D — Deferred (Tier 2, post-MVP)

- [ ] D.1 Mining tenements (Tengraph/GeoVIEW) loader stub
- [ ] D.2 Aboriginal heritage (AHIS) loader stub
- [ ] D.3 Contaminated sites register loader stub
- [ ] D.4 Native title determinations loader stub
- [ ] D.5 Acid sulfate soil risk loader stub
- [ ] D.6 Sentinel-2 NDVI history loader stub
- [ ] D.7 Fine LiDAR DEM loader stub
- [ ] D.8 Manual groundwater allocation status entry loader (per §6 water register note)
- [ ] D.9 H3 res 8 support with server-side filtering for browser rendering
- [ ] D.10 Automated SLIP access — scriptable via PingFederate form-post login (verified 2026-09-04); revisit only if manual downloads become painful. `pf.username` / `pf.pass` POST to `/as/1pfj4/resume/as/authorization.ping`, then follow OAuth redirects and stream the file. Fragile to Landgate changing their login form.
- [ ] D.11 Upgrade cadastre from LGATE-001 (free, no attrs) to LGATE-217 (paid, full attrs): removes the extra spatial joins in 1.7b, enables exact-parcel matching to Landgate sales reports in M8 (better residual layer precision)
