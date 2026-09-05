# Data Catalogue for Purposes

Working note: what extra data each **Purpose** needs, whether we already have
it, and where the rest comes from. Companion to `notes/DATA_CATALOGUE.md`
(which describes what's already ingested).

Each Purpose is a bundle of `weights + exclusions + preferred curves + extra
scoring dimensions`. Some Purposes need data we don't have; those gaps are
listed with a source proposal and a difficulty tag.

Difficulty legend:
- **easy** — one download + one ingest module, similar to existing layers
- **medium** — needs a new compute (e.g. distance to N POIs, aggregation)
- **hard** — new data model, expensive processing, or paid data

---

## What we already have

Reusable across all Purposes:

- Cadastre + LGA + hex grid
- Groundwater + surface water proclamation
- Salinity (groundwater TDS)
- Soil capability per enterprise (grazing/cropping/annual-hort/perennial-hort/vineyards)
- Bushfire prone fraction
- DBCA estate fraction + category
- Distance to nearest sealed road
- Distance to nearest townsite
- Rainfall level (1991-2020 May-Oct) + trend (mm/decade since 1970)
- Parcel count + median area per cell (from cadastre aggregation)

## What we already have but don't use yet

- **Per-enterprise soil capability** — `hex.lc_graz_raw`, `lc_dry_cro_raw`,
  `lc_ann_hor_raw`, `lc_per_hor_raw`, `lc_vines_raw` are populated but only
  `lc_graz_raw` feeds the current soil sub-score. A Vineyard-focused Purpose
  should switch to `lc_vines_raw` transparently.
- **Individual parcel geometry + area** — `parcel` table has one row per
  legally-defined block within our AOI. The current tool aggregates to hex;
  Purposes for hobby/personal use want *"filter to parcels between 2 and 20
  ha within this shortlisted cell"*. See `PARCEL_LEVEL_VIEW` below.

---

## Purposes — bundle proposals

### 1. Broadacre farming (baseline; ≥100 ha target)

**Aim:** grazing / dryland cropping on a large freehold block. Water access
and soil productivity dominate.

**Weights:** water 0.30, rainfall 0.25, soil 0.30, access 0.10, bushfire 0.05

**Exclusions:**
- `rainfall < 400 mm` (down from 350 — broadacre needs headroom)
- `soil ≥ B2` (only A/B1 land)
- `salinity_idx ≥ 4` (brackish groundwater blocks stock/irrigation)

**Preferred curves:** current defaults are broadly right; steepen the road
curve past 20 km (heavy farm vehicles don't handle very long unsealed).

**Extra scoring:**
- `parcel_area_median_ha` in cell — reward cells with big blocks. Not
  currently in the score, easy to add via a new `factor_scale` dimension.

**Missing data:** none — current stack already supports this.

---

### 2. Hobby farm / weekender (2–20 ha)

**Aim:** a small block for personal use — hobby livestock, orchard, weekend
retreat. Amenity and access outrank commercial productivity.

**Weights:** access 0.30, bushfire 0.15, rainfall 0.15, soil 0.15,
water 0.15, amenity 0.10 *(new dimension)*

**Exclusions:**
- `dist_sealed_road_km > 15` (kids in the car, not a farm truck)
- `dist_townsite_km > 40`
- `dbca_estate_frac > 0.5` (harder — for a lifestyle block you actively
  *want* to be next to public land, but not inside it)

**Preferred curves:** road/town curves shift left (tighter tolerances);
soil curve flattens (a 2 ha block on B2 land is fine).

**Missing / new data:**

| Item | Source | Difficulty |
|---|---|---|
| **Distance to Perth CBD** (or other major centre) | Compute from cadastre + fixed lat/lng — no download | easy |
| **Distance to schools / GPs / supermarkets** | DoH `myhospitals`, ACARA school locations, ABS Points-of-Interest | medium |
| **Population density** (LGA + SA1 level) | ABS 2021 Census, SA1 geographies | easy (free) |
| **NDVI / vegetation greenness** | Sentinel-2 (Copernicus), or MODIS annual composites | hard |
| **Parcel-level view** for the 2-20 ha filter | We have it; needs UI + parcel-level scoring | medium |

---

### 3. Off-grid retreat / bush retreat

**Aim:** remote, no reticulated services, high privacy. Rainfall for tank
capture, low bushfire risk, distance from towns is actively good.

**Weights:** rainfall 0.30, bushfire 0.20, water 0.20, soil 0.05,
access 0.05, remoteness 0.20 *(new — inverted access)*

**Exclusions:**
- `rainfall < 500 mm` (need enough for roof-captured water)
- `bushfire_prone_frac > 0.9` (extreme risk without services is a killer)
- No exclusion on distance to town or road

**Preferred curves:** access curve **inverted** — being 40 km from town is a
feature, being 5 km is a downside. This is the first Purpose that wants a
*non-monotonic* interpretation of an existing metric; may need a small
change in `scoring/score.py`.

**Missing / new data:**

| Item | Source | Difficulty |
|---|---|---|
| **Rooftop rainfall capture potential** | Derived from `gsr_mean_mm` × assumed roof area — no download | easy |
| **Distance to power grid** | Western Power's HV/LV network — not public in easily-usable form | medium/hard |
| **Distance to mobile coverage** | Telstra/Optus coverage maps aren't published as GIS layers | hard |
| **Slope + aspect** (northerly aspect = better solar) | DEM (GA 1 Second SRTM-derived) | easy |

---

### 4. Vineyard / perennial horticulture (specialist)

**Aim:** small commercial vineyard or orchard. Site character matters —
frost pockets, aspect, water quality, wind exposure.

**Weights:** rainfall 0.20, soil 0.30 (via `lc_vines_raw`), water 0.20,
access 0.10, bushfire 0.05, frost 0.15 *(new)*

**Exclusions:**
- `lc_vines_raw NOT IN ('A1','A2','B1')` — vines are unforgiving on soil
- `salinity_idx ≥ 3` (vines are salt-sensitive)

**Preferred curves:** soil curve uses `lc_vines_raw` not `lc_graz_raw`.

**Missing / new data:**

| Item | Source | Difficulty |
|---|---|---|
| **Frost risk** | Derivable from DEM (cold-air drainage pockets) + BOM minimum-temp climatology | medium |
| **Aspect** (N-facing = warmer) | DEM | easy |
| **Wind climatology** | BOM gridded wind speed — coarse but adequate | easy |
| **Slope** (5-15° optimal for vines) | DEM | easy |

---

## Cross-cutting data adds

### Population density (you asked)

**Source:** ABS 2021 Census, "GCP" (General Community Profile) at SA1 level.
- SA1 = ~200-800 people, ~100k SA1s nationally, ~10k in WA.
- Free download from ABS.stat or as CSV+SHP from data.gov.au.
- Match SA1 polygons to hex cells → area-weighted mean population density
  per cell. Similar shape to how we handled bushfire.
- Also useful: median age, dwelling type mix, income (Purpose 2 amenity).

**Alternative if SA1 is too fine:** SA2 (~5-20k people) is coarser but
sufficient for a screening tool. Every LGA has ~5-20 SA2s.

**Difficulty:** easy. One `ingest/population.py` module, same STRTree pattern
we've used for bushfire/soils. New columns: `pop_density_per_km2`,
`median_age`, `median_household_income`.

**How it feeds Purposes:**
- Broadacre: mild negative (very rural is fine but suddenly-populated cells
  might signal urban encroachment / land-use conflict)
- Hobby: mild positive (like the neighbours-nearby-but-not-crowded band)
- Off-grid: negative (lower density = better)
- Vineyard: neutral

### Distance to points of interest (you asked)

**Perth CBD is a special case** — one fixed point, trivial to compute at
ingest time from `(-31.9505, 115.8605)`. Add `dist_perth_cbd_km` per hex.

**Other cities we'd want the same for:**
- **Bunbury** (regional centre, closest hospital for the SW) — `(-33.3271, 115.6414)`
- **Albany** (south-coast centre) — `(-35.0269, 117.8837)`
- **Margaret River town** (tourism hub) — `(-33.9550, 115.0754)`

**For POIs like schools / hospitals / supermarkets** — that's a general
"distance to nearest of a set of features" pattern, same shape as our
existing townsite/road nearest-neighbour code:
- **Schools:** ACARA `Australian School Locations` dataset, free CSV.
  ~10k rows nationally.
- **Hospitals + GPs:** Department of Health `myhospitals` dataset (public
  hospitals only) + AIHW GP practices (harder — includes private).
- **Supermarkets / retail:** no free authoritative dataset. Best proxy is
  OpenStreetMap `shop=supermarket` — free but data quality varies by shire.

**Design decision to make:** do we hard-code a small set of "cities you might
commute to" as fixed points and just compute distances, or do we build a
general "distance to nearest of dataset X" mechanism? The first is 30 min of
work and satisfies the immediate need. The second is 2-3 hours but pays off
for schools/hospitals later.

**Recommendation:** start with **fixed points** (Perth, Bunbury, Albany,
Margaret River town) — trivial cost, useful for every Purpose. Defer the
generalised POI mechanism until we actually add schools/hospitals.

---

## Parcel-level view (medium)

Currently every metric aggregates to a hex cell. Purpose 2 (hobby farm) and
Purpose 4 (vineyard) really want to *drill into a hex* and see individual
parcels with:
- Area (already have)
- Inherited hex scores (soil, rainfall, water, bushfire)
- Distance to road / town from parcel centroid (not hex centroid)
- Whether the parcel is DBCA / crown reserve (would need paid LGATE-217 or
  spatial subtract)

**Proposal:** add a `/parcels/{h3}` endpoint returning a list of parcels in
the hex with their inherited scores + individual attributes. Inspector gets a
"Parcels" tab showing a filterable table. Cheap to implement — we have all
the geometry already.

---

## Summary — what to add first if we go with Purposes

| Item | Difficulty | Enables |
|---|---|---|
| **Fixed-point distances** (Perth, Bunbury, Albany, Margaret River) | easy | All Purposes; you asked for it |
| **ABS SA2 population density + income** | easy | Hobby, Off-grid Purposes |
| **DEM → slope + aspect** | easy | Vineyard, Off-grid; also fills brief §5 gap |
| **Purpose bundle format** (`personas.yaml` → `purposes.yaml`) | easy | The Purpose selector itself |
| **Parcel-level view + endpoint** | medium | Hobby, Vineyard drill-down |
| **Schools / hospitals** (ACARA + myhospitals) | medium | Hobby, weekender lifestyle |
| **NDVI / vegetation** | hard | Aesthetic scoring; defer |
| **Power / mobile coverage** | hard | Off-grid; defer |

If we commit to just **Purposes + fixed-point distances + population**,
that's a coherent slice — all easy, all high-value, and gives you three
credible Purposes (Broadacre, Hobby, Off-grid) working end-to-end.
