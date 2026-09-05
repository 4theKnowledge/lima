# Build Brief: South West WA Land Screening Tool (MVP)

## 0. Read this first

You are building a **regional screening tool**, not a property recommender. The output is a
map of hex cells scored for land desirability across the South West of Western Australia,
plus a rough "undervaluation" surface. The human operator uses it to pick 5–8 shires to
investigate, then searches listings manually. Do not build listing scraping in the MVP.

Two rules that override convenience:

1. **Never silently drop or truncate data.** Every ingest step must record how many features
   it expected vs received. A missing shire that produces a plausible-looking map is the
   worst possible failure mode here.
2. **Flag assumptions rather than inventing values.** If a dataset endpoint, column name or
   code lookup doesn't match what this brief says, stop and report it. Do not guess a
   substitute column.

---

## 1. Stack

| Concern | Choice |
|---|---|
| Store | DuckDB, single file, `spatial` + `h3` extensions |
| Ingest | Python 3.11+, `httpx`, `geopandas`, `rioxarray`, `exactextract` |
| UI | Streamlit + pydeck (`H3HexagonLayer`) |
| Inspection | QGIS pointed at the DuckDB file / exported GeoPackage |

```sql
INSTALL spatial; LOAD spatial;
INSTALL h3 FROM community; LOAD h3;
```

No PostGIS, no Docker, no cloud. This must run on a laptop. If DuckDB genuinely can't
handle a step, say so rather than quietly moving to another engine.

### Environment & invocation

Use [`uv`](https://docs.astral.sh/uv/) for Python version, venv, and dependency management.
Python pinned to 3.11+ via `pyproject.toml` (and `.python-version`). `uv sync` sets up the
environment; there is no separate `pip install` step.

All entry points run through `uv run`:

- Ingest modules: `uv run python -m ingest.<source>` (e.g. `uv run python -m ingest.cadastre`)
- Scoring: `uv run python -m scoring.score`
- Sensitivity CLI: `uv run python -m scoring.sensitivity`
- UI: `uv run streamlit run app/streamlit_app.py`

Keep it to `uv run` — no `activate`, no shell hooks. If a wrapper is wanted later, a
`justfile` can front these commands, but don't add one for the MVP.

### Repo layout

```
swwa-land/
  ingest/          one module per source, each idempotent
  cache/raw/       untouched API responses, gitignored
  db/land.duckdb
  scoring/
    weights.yaml   all tunables live here, nothing hardcoded
    score.sql
  app/streamlit_app.py
  notes/DATA_LOG.md   append-only: what was fetched, when, row counts
```

---

## 2. Area of interest

**Boundary:** South West Land Division polygon, from Landgate's administrative boundaries
on DataWA. Use it as the outer container only — the scoring layers do the real narrowing.

**Grid:** H3 resolution 7 (~5 km² per cell, ~66k cells over the division). This is the
regional view. Make resolution a config value so res 8 (~0.75 km², ~340k cells) can be
enabled later, but note res 8 will need server-side filtering before it renders in a browser.

**CRS discipline — get this right before anything else:**

- Source data arrives in GDA2020 geographic, **EPSG:7844**.
- All area, distance and slope maths happens in projected coords: **EPSG:7850** (MGA2020
  Zone 50) west of 120°E, **EPSG:7851** (Zone 51) east of it.
- Store geometry in 7844 for display, compute in the projected CRS, cache computed
  areas/distances as plain columns.

**Acceptance check:** parcel areas you compute must match Landgate's stated hectares for a
sample of 50 parcels to within 1%. If they don't, the CRS handling is wrong. Fix it before
proceeding — every downstream number depends on this.

---

## 3. Data sources

Most layers come from `catalogue.data.wa.gov.au` (CKAN). **Resolve endpoints via the CKAN
API by dataset name, don't hardcode URLs from this brief** — they change. Pattern:

```
https://catalogue.data.wa.gov.au/api/3/action/package_search?q=<name>
```

Then read the WFS/WMS resource URLs from the returned package. Register for a free SLIP
account; some services need it.

### Tier 1 — required for MVP

| Layer | Source | Use |
|---|---|---|
| Cadastre (freehold + Crown parcels) | Landgate, DataWA | Base geometry, parcel areas |
| Administrative boundaries (LGAs, SWLD) | Landgate, DataWA | Chunking, AOI |
| Townsites | Landgate, DataWA | Exclusion + distance-to-town |
| Crown reserves | Landgate, DataWA | Exclusion |
| RIWI Act Groundwater Areas (**DWER-034**, formerly DOW-012) | DWER, DataWA | Proclaimed vs unproclaimed |
| RIWI Act Surface Water Areas | DWER, DataWA | Same, for surface water |
| Soil-landscape mapping + land capability | DPIRD | Capability class per cell |
| Bushfire Prone Areas | DFES / OBRM | Build cost, insurability |
| Road centrelines | Landgate, DataWA | Distance to sealed road |
| Gridded rainfall, 1900–present | SILO (Qld Gov, free) or BOM CDO | Rainfall level **and trend** |
| DEM, 20m or coarser | Landgate | Slope, aspect |

**Note on soils:** DPIRD soil-landscape polygons carry map unit codes, not descriptions. You
need DPIRD's lookup tables to translate them. If you can't source the lookup, report that —
do not invent a mapping from the codes.

### Tier 2 — stub the loaders, don't run them yet

Mining tenements (Tengraph/GeoVIEW), Aboriginal heritage (AHIS), contaminated sites
register, native title determinations, acid sulfate soil risk, Sentinel-2 NDVI history,
fine LiDAR DEM. These run over the shortlist only, not the division.

### Price data (see §6)

Landgate rural sales reports, purchased per LGA. These are **paid and manual** — a human
buys them and drops CSV/Excel into `cache/manual/`. Build the loader to read whatever
columns those exports actually have; don't assume a schema.

---

## 4. Ingest rules

- **Chunk every WFS pull by LGA.** Never request the whole division in one bbox.
- **Cache the raw response to `cache/raw/` before parsing.** Re-parsing is free; re-pulling
  50 shires is not.
- **Page the requests.** These endpoints cap features per response and will truncate
  silently. Compare returned count against `numberMatched` and fail loudly on mismatch.
- **Log every fetch** to `notes/DATA_LOG.md`: source, date, LGA, feature count.
- **Idempotent:** re-running an ingest module replaces its table cleanly.

Parcel filtering on ingest — apply these and record how many were dropped by each:

- Drop parcels < 10 ha (configurable floor)
- Drop parcels intersecting gazetted townsites
- Drop Crown reserves and DBCA estate
- Drop Perth metro LGAs

Expect roughly 100–200k rural freehold parcels to survive. If you get an order of magnitude
outside that, something's wrong — investigate before continuing.

### Raster handling

Rainfall and DEM need zonal stats per hex cell (`exactextract`). Compute once, store as
columns on the hex table. For rainfall, derive **two** values per cell:

- Mean growing-season rainfall (May–Oct), 1991–2020 baseline
- Linear trend in growing-season rainfall since 1970, mm/decade

The trend matters as much as the level in this region — SWWA rainfall has declined
materially since the late 1960s and the decline is projected to continue.

---

## 5. Schema

Hex cell is the primary key for scoring. Parcels attach to cells.

```sql
CREATE TABLE hex (
  h3            VARCHAR PRIMARY KEY,
  geom          GEOMETRY,          -- EPSG:7844
  lga           VARCHAR,
  -- water
  gw_proclaimed BOOLEAN,
  gw_area_name  VARCHAR,
  sw_proclaimed BOOLEAN,
  -- climate
  gsr_mean_mm   DOUBLE,            -- May-Oct mean, 1991-2020
  gsr_trend     DOUBLE,            -- mm/decade since 1970
  -- land
  capability_class    INTEGER,     -- 1 best .. 5 worst, modal within cell
  capability_confidence DOUBLE,    -- fraction of cell covered by modal class
  slope_mean_pct      DOUBLE,
  -- constraints
  bushfire_prone_frac DOUBLE,      -- 0-1 area fraction
  -- access
  dist_sealed_road_km DOUBLE,
  dist_townsite_km    DOUBLE,
  -- parcels
  parcel_count        INTEGER,
  parcel_area_median_ha DOUBLE
);

CREATE TABLE parcel (
  parcel_id     VARCHAR PRIMARY KEY,
  h3            VARCHAR,
  geom          GEOMETRY,
  area_ha       DOUBLE,
  lot_on_plan   VARCHAR,
  tenure        VARCHAR
);

CREATE TABLE price_locality (   -- coarse, from paid sales reports
  locality      VARCHAR,
  lga           VARCHAR,
  median_per_ha DOUBLE,
  n_sales       INTEGER,
  period        VARCHAR
);
```

Store `capability_confidence` and always surface it. A cell scored on a soil polygon that
covers 12% of its area is not the same evidence as one covering 95%, and the UI must not
present them identically.

---

## 6. Scoring

Two stages. Do not collapse them into one weighted sum — a single sum lets a strong score
on one layer paper over a disqualifying flaw on another.

### Stage 1 — hard mask (binary, unweighted)

A cell is excluded outright if **any** of these hold. Store the reason, don't just drop it,
so the UI can show "excluded: rainfall".

```yaml
exclusions:
  gsr_mean_mm_below: 350
  capability_class_at_or_above: 5
  slope_mean_pct_above: 20
  parcel_count_below: 1
```

Groundwater allocation status belongs here too — a cell in a proclaimed area whose resource
has reached its allocation limit should be masked, since a new licence may simply be
refused. The Water Register holds this. **It has no bulk API.** For the MVP: mask on
`gw_proclaimed` as a coarse proxy, flag clearly in the UI that this is a proxy, and leave a
loader stub for manually-entered allocation status per groundwater area.

### Stage 2 — weighted score on survivors

Normalise each factor to 0–1, then weighted sum. All weights in `weights.yaml`.

```yaml
weights:
  water:        0.30    # unproclaimed, or proclaimed with headroom
  rainfall:     0.25    # level and trend combined
  soil:         0.20    # capability class
  access:       0.15    # sealed road + townsite distance
  bushfire:     0.10    # inverse of prone fraction
```

**Use step/curve functions, not linear scaling, where reality has a threshold.** Encode
these in `weights.yaml` as breakpoint lists:

- **Rainfall:** cliff below ~400mm growing-season, near-indifference above ~600mm. Linear
  scaling misrepresents both ends.
- **Distance to sealed road:** 2km and 8km are similar in practice; 8km and 40km are not.
- **Rainfall trend:** treat steeper decline as a penalty on the level score, not a separate
  additive term.

### Sensitivity check — build this, it is not optional

A CLI command that re-runs scoring with each weight shifted ±25% and reports how much the
top-20 LGA ranking changes (rank correlation is fine). If the ranking is stable, the result
reflects the data. If it scrambles, the model is mostly encoding the operator's priors and
the UI should say so.

### The residual layer — the actually interesting output

A suitability surface shows where land is *good*, and good land is already priced that way.
So compute:

```
residual = normalised_suitability − normalised_price_per_ha
```

Join `price_locality` to hex cells by locality. This is coarse and lumpy — rural sales are
sparse, medians rest on few transactions. **Show `n_sales` alongside every residual value
and grey out localities below a threshold (say n < 5).** A confident-looking residual built
on two sales is worse than no residual.

Make this a toggleable map view: suitability / price / residual.

---

## 7. UI

Streamlit, single page. Deliberately basic — this is an inspection tool.

**Map (pydeck `H3HexagonLayer`)**
- Colour by: suitability | price | residual (radio toggle)
- Excluded cells rendered in flat grey, not omitted — the operator needs to see what was
  ruled out and why
- Click a cell → side panel

**Sidebar**
- Weight sliders bound to `weights.yaml` values, live re-score. DuckDB is fast enough to
  recompute the whole surface on slider change; if it isn't, precompute factor scores and
  only recombine.
- Exclusion thresholds as numeric inputs
- LGA multiselect filter
- "Reset to defaults" button

**Side panel on cell click — this is the important part**
- Every raw input value, not just the score
- **Score decomposition: how much each factor contributed.** The operator must be able to
  see *why* a cell scored well. A district that lights up because of one soil polygon
  boundary that's really an old survey line needs to be identifiable as such.
- `capability_confidence` and `n_sales` shown prominently
- Parcel count and median parcel size in the cell

**Ranked table below the map:** top 30 cells, grouped by LGA, exportable to CSV.

---

## 8. Build order

Each milestone must produce something usable on its own.

1. **DuckDB + cadastre for one LGA** (suggest Shire of Boyup Brook — mid-size, rural, not
   pathological). Verify parcel areas against Landgate. *Stop here until areas match.*
2. **H3 grid + parcel→cell aggregation** for that LGA.
3. **Three decisive layers:** groundwater areas, soil capability, bushfire prone. Crude
   scoring. This is already a useful tool.
4. **Rainfall zonal stats,** level and trend.
5. **Streamlit UI** over the single LGA.
6. **Scale to the full division** — loop the ingest over all SWLD LGAs, run overnight,
   check the data log for gaps.
7. **Price layer + residual view,** once sales reports are purchased.
8. Sensitivity check CLI.

---

## 9. Out of scope for MVP

- Listing scraping. realestate.com.au and Domain have no cheap API and scraping breaches
  their terms. The operator will search manually across a 5–8 shire shortlist, which is a
  readable volume, and will ring local agents — much rural WA land moves before it's listed.
- NDVI time-series. Sentinel-2 at 10m over 250,000 km² is a serious compute job for
  little screening value. Tier 2, shortlist only.
- Any automated valuation model. Rural comparables are too sparse and too heterogeneous;
  a hedonic regression on a few dozen sales will produce confident nonsense.

---

## 10. What "done" looks like

The operator opens the app, sees the residual map for the South West Land Division, clicks
a promising hex, understands from the decomposition panel exactly which factors drove the
score and how much evidence sits behind each, adjusts a weight slider to test whether that
holds, and comes away with a list of 5–8 shires worth driving through.

The tool narrows where to look. It does not tell anyone what the country is actually like.
