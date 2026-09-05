# Data Catalogue

Plain-English guide to every dataset the tool uses, why it matters for finding
good rural land, and where it comes from. Written for someone who is not a
GIS person.

Legend:
- **Tier 1** = required for the MVP screening map
- **Tier 2** = optional; run later, only over the shortlist of shires

---

## Tier 1 — the core layers

### Cadastre (parcels) — *Landgate, LGATE-001 (free, MVP) / LGATE-217 (paid, future)*
Every legally-defined piece of land in WA, with a polygon boundary. This is
the "map of blocks" the whole tool sits on top of. We compute parcel areas
from it and use it to count how many blocks exist in each hex cell. If
cadastre is wrong or missing for a shire, that shire will look empty on the
map — a silent failure we have to guard against.

**MVP uses LGATE-001** — the free "no attributes" version. Geometry and a
polygon ID, nothing else. It's enough for a screening tool: we can count
parcels per cell and compute median size from geometry alone. The trade-off
is that we can't filter Crown reserves and DBCA estate using an in-cadastre
tenure column (we do it via spatial joins against separate layers instead),
and we lose stable parcel IDs that would let us match Landgate sales reports
exactly rather than by locality centroid. Livable for a screener; upgrading
to the paid LGATE-217 would improve the M8 price residual layer's precision.

### Administrative boundaries — *Landgate, DataWA*
The polygon for each Local Government Area (Shire of Boyup Brook, Shire of
Manjimup, etc.) and the South West Land Division boundary as a whole. Used
to chunk downloads (never pull the whole state at once) and to filter results
by shire in the UI.

### Townsites — *Landgate, DataWA*
Gazetted town boundaries. Used for two things: excluding parcels that fall
inside a town (we want rural land, not townhouses) and computing how far each
hex cell is from the nearest town (relevant for services, groceries, hospital).

### Crown reserves — *Landgate, DataWA*
Land held by the Crown for specific public purposes (parks, water catchment,
schools, roads). Not for sale, so we exclude parcels that intersect these.

### Groundwater areas (RIWI Act) — *DWER, DataWA (DWER-034, was DOW-012)*
Areas of WA where taking water from a bore requires a licence from DWER. Two
categories matter: **proclaimed** (licence required, may or may not be
granted depending on how much water is left in the aquifer) and
**unproclaimed** (no licence needed, take what you like within reason). For
rural land in the SW this is often the single biggest constraint — a shire
with rich soil and good rainfall but a closed groundwater allocation is
useless for anything water-hungry.

### Surface water areas (RIWI Act) — *DWER, DataWA*
Same idea but for taking water from rivers, dams, creeks. Less commonly a
binding constraint in the SW, but flagged for completeness.

### Soil-landscape mapping + land capability — *DPIRD*
Polygons across WA classified by soil type, then rated 1 (best agricultural
land) to 5 (worst). The polygons carry codes, not descriptions — we need
DPIRD's lookup tables to translate them into "class 3 loamy earth" or
whatever. **If the lookup tables aren't available, the map's soil layer
becomes meaningless; do not invent codes.**

### Bushfire Prone Areas — *DFES / OBRM*
Areas the state has designated as bushfire-prone. Not a hard exclusion —
plenty of good land is bushfire-prone — but it affects insurance premiums,
building costs (BAL rating requirements) and insurability full stop. We
compute what fraction of each hex cell is bushfire-prone and factor it
into the score.

### Road centrelines — *Landgate, DataWA*
The road network, with a "sealed / unsealed" attribute. We compute distance
from each hex cell to the nearest sealed road. A block 2 km down a dirt
track is different from one 40 km down a dirt track.

### Rainfall grid, 1900–present — *SILO (Qld Gov, free) or BOM CDO*
Daily rainfall interpolated onto a 5 km grid across all of Australia. From
this we compute two things per hex cell:
- **Level:** mean growing-season rainfall (May–Oct), 1991–2020 average
- **Trend:** how fast rainfall has been declining since 1970, mm per decade

Both matter for the SW. Rainfall level is obvious. The trend matters because
SWWA has been drying since the late 1960s and models say the decline
continues — a shire that averaged 600 mm through 1991–2020 but is trending
down 30 mm/decade is not the same investment as one that's stable.

### DEM (elevation) — *Landgate, 20m or coarser*
Digital Elevation Model — height above sea level on a grid. From this we
compute mean slope percentage per hex cell. Steep land is hard to farm, hard
to build on, hard to service.

---

## Tier 2 — shortlist only

These datasets are useful but expensive to process across the whole
division. We only run them over the 5–8 shire shortlist the operator picks
after seeing the Tier 1 map.

### Mining tenements — *DMIRS, Tengraph / GeoVIEW*
Exploration and mining leases. A pending or granted lease over your land
doesn't stop you buying it, but it grants the tenement holder rights to
access, drill, and (with compensation) disturb.

### Aboriginal heritage — *AHIS*
Registered heritage sites and areas of interest. Legal obligations around
disturbance regardless of who owns the land above.

### Contaminated sites register — *DWER*
Sites known to be contaminated (old tips, service stations, industrial
uses). Rare on rural blocks but worth checking on the shortlist.

### Native title determinations — *NNTT*
Areas where native title has been determined to exist, been extinguished,
or is under claim. Relevant for freehold this is largely settled, but
worth mapping.

### Acid sulfate soils — *DWER / DPIRD*
Soils that turn acidic when disturbed and drained. Restricts what you can
do with the land, especially near water.

### Sentinel-2 NDVI history — *Copernicus, free*
Satellite imagery of vegetation "greenness" over time. Can show whether a
paddock has been productive historically, or whether it's been abandoned.
Skipped in MVP — a big compute job for little screening value.

### Fine LiDAR DEM — *Landgate*
Higher-resolution elevation data (1m or 2m) than the base DEM. Useful for
seeing individual dams, drainage lines, building sites on shortlisted
parcels.

---

## The one that costs money

### Landgate rural sales reports — *Landgate, ~$50 per LGA*
Per-LGA reports of every rural land sale, with price, area, and location.
Sold as PDF/CSV/Excel. **A human buys these and drops the exports into
`cache/manual/`.** We use them to build a coarse "median price per hectare
per locality" layer, then compute where suitability is high but price is
still low — the "undervaluation" surface which is the actually interesting
output of this tool.

The catch: rural sales are sparse. A median built on two transactions is
noise, not signal. We surface the sample size (`n_sales`) alongside every
price value and grey out anything below 5 sales.

---

## What we deliberately do NOT use

### Listing scrapes (realestate.com.au, Domain)
Both sites forbid scraping in their terms. The tool is a screener that
narrows down to 5–8 shires; a human can search listings manually across
that many. Much rural WA land also moves off-market via local agents
anyway — a scraper wouldn't see those.

### Automated valuation models (AVMs)
Rural comparables are too sparse and too heterogeneous for a hedonic
regression to be honest. A few dozen sales will produce a confident number
that's mostly noise. We leave valuation to the human.
