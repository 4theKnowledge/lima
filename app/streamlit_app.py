"""Streamlit UI for the SWWA land screening tool.

M6 minimal scaffold: reads the `hex` table from DuckDB, colours cells by a
metric (parcel count or median parcel area today; scoring metrics land in
M3+), shows a side panel per-cell on click, and a ranked table below.

Run:
    uv run streamlit run app/streamlit_app.py
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import h3
import httpx
import pandas as pd
import pydeck as pdk
import streamlit as st
import yaml

PROJECT_ROOT = Path(__file__).resolve().parents[1]
# Read from the snapshot so ingests can run against the primary DB
# without evicting Streamlit's file lock. See db/snapshot.py.
DB_PATH = PROJECT_ROOT / "db" / "land_read.duckdb"
WEIGHTS_PATH = PROJECT_ROOT / "scoring" / "weights.yaml"
SENSITIVITY_DIR = PROJECT_ROOT / "notes" / "sensitivity"

FACTOR_ORDER = ("water", "rainfall", "soil", "access", "bushfire")


@st.cache_data
def default_weights(_mtime: float) -> dict[str, float]:
    """Load weight defaults from weights.yaml. Cached on file mtime so edits reload."""
    with WEIGHTS_PATH.open() as f:
        cfg = yaml.safe_load(f)
    return {k: float(v) for k, v in cfg["weights"].items()}


def _weights_mtime() -> float:
    return WEIGHTS_PATH.stat().st_mtime if WEIGHTS_PATH.exists() else 0.0


def _latest_sensitivity() -> dict | None:
    """Read the most recent sensitivity snapshot, if any."""
    import json
    if not SENSITIVITY_DIR.exists():
        return None
    files = sorted(SENSITIVITY_DIR.glob("*.json"))
    if not files:
        return None
    try:
        return json.loads(files[-1].read_text())
    except Exception:
        return None


def rescore_suitability(df: pd.DataFrame, weights: dict[str, float]) -> pd.Series:
    """Recompute per-cell suitability from cached factor_* columns.

    Fast (numpy math on ~4k rows). NaN for any cell missing a factor.
    Weights auto-normalise to sum 1.0.
    """
    total = sum(weights.values())
    w = {k: v / total for k, v in weights.items()} if total > 0 else weights
    score = (
        w["water"] * df["factor_water"]
        + w["rainfall"] * df["factor_rainfall"]
        + w["soil"] * df["factor_soil"]
        + w["access"] * df["factor_access"]
        + w["bushfire"] * df["factor_bushfire"]
    )
    return score.clip(lower=0.0, upper=1.0)

st.set_page_config(page_title="SWWA Land Screener", layout="wide")


def _connect() -> duckdb.DuckDBPyConnection:
    """Open a fresh read connection.

    We intentionally do NOT cache the connection object. `os.replace` swaps
    the snapshot file atomically, but any pre-existing DuckDB connection is
    pinned to the old file/schema view. Opening fresh each call is ~10 ms
    on this DB size and lets us pick up post-ingest schema/data changes
    without a Streamlit restart.
    """
    con = duckdb.connect(str(DB_PATH), read_only=True)
    con.execute("LOAD spatial;")
    con.execute("LOAD h3;")
    return con


def _snapshot_mtime() -> float:
    """mtime of the read snapshot, used as a cache-invalidation key.

    Every ingest publishes a fresh snapshot via db.snapshot.snapshot(), which
    changes the mtime. When passed as an argument to @st.cache_data functions,
    it forces recomputation on the next re-run after any ingest.
    """
    return DB_PATH.stat().st_mtime if DB_PATH.exists() else 0.0


@st.cache_data
def load_hex(lgas: tuple[str, ...] | None, _mtime: float) -> pd.DataFrame:
    con = _connect()
    base = """
        SELECT h3, lga, parcel_count, parcel_area_median_ha,
               COALESCE(gw_proclaimed, FALSE) AS gw_proclaimed,
               gw_area_name,
               COALESCE(sw_proclaimed, FALSE) AS sw_proclaimed,
               salinity_idx,
               salinity_tds_class,
               bushfire_prone_frac,
               capability_class,
               capability_confidence,
               lc_graz_raw,
               lc_dry_cro_raw,
               lc_ann_hor_raw,
               lc_per_hor_raw,
               lc_vines_raw,
               dist_townsite_km,
               nearest_townsite_name,
               dist_sealed_road_km,
               nearest_sealed_road_name,
               dbca_estate_frac,
               dbca_category,
               gsr_mean_mm,
               gsr_trend,
               suitability_score,
               factor_water,
               factor_rainfall,
               factor_soil,
               factor_access,
               factor_bushfire,
               COALESCE(excluded, FALSE) AS excluded,
               exclusion_reasons
        FROM hex
    """
    if lgas:
        placeholders = ", ".join(["?"] * len(lgas))
        return con.execute(f"{base} WHERE lga IN ({placeholders})", list(lgas)).fetchdf()
    return con.execute(base).fetchdf()


@st.cache_data(ttl=3600, show_spinner=False)
def geocode(query: str) -> tuple[float, float, str] | None:
    """Address / place → (lat, lng, display_name). None if not found.

    Uses OpenStreetMap Nominatim. Free, no auth, rate-limited to 1 req/sec
    for polite use; we cache for an hour so re-searching the same address
    is free. Biased to Australia to keep small-town names in WA disambiguated.
    """
    if not query.strip():
        return None
    r = httpx.get(
        "https://nominatim.openstreetmap.org/search",
        params={
            "q": query,
            "format": "jsonv2",
            "countrycodes": "au",
            "limit": 1,
        },
        headers={"User-Agent": "swwa-land-screener (personal use)"},
        timeout=15.0,
    )
    r.raise_for_status()
    results = r.json()
    if not results:
        return None
    top = results[0]
    return float(top["lat"]), float(top["lon"]), top.get("display_name", query)


@st.cache_data
def list_lgas(_mtime: float) -> list[str]:
    con = _connect()
    return [
        r[0]
        for r in con.execute(
            "SELECT DISTINCT lga FROM hex WHERE lga IS NOT NULL ORDER BY lga"
        ).fetchall()
    ]


@st.cache_data
def parcel_summary(h3_cell: str, _mtime: float) -> dict:
    con = _connect()
    row = con.execute(
        """
        SELECT COUNT(*) AS n,
               AVG(area_ha) AS mean_ha,
               MEDIAN(area_ha) AS median_ha,
               MIN(area_ha) AS min_ha,
               MAX(area_ha) AS max_ha,
               SUM(area_ha) AS total_ha
        FROM parcel
        WHERE h3 = ?
        """,
        [h3_cell],
    ).fetchone()
    keys = ("n", "mean_ha", "median_ha", "min_ha", "max_ha", "total_ha")
    return dict(zip(keys, row, strict=True))


# Reserved colours — each conveys a specific state, not a data value:
#   EXCLUDED_COLOUR — Stage 1 hard mask
#   NO_DATA_COLOUR — the metric being coloured is NULL for this cell
#   PROCLAIMED_COLOUR / UNPROCLAIMED_COLOUR — binary constraint metrics
EXCLUDED_COLOUR = [140, 140, 140, 120]         # muted grey
NO_DATA_COLOUR = [100, 180, 200, 90]           # light desaturated teal, low alpha
PROCLAIMED_COLOUR = [220, 60, 60, 200]         # red
UNPROCLAIMED_COLOUR = [70, 180, 90, 200]       # green


def _color_for(value, vmin: float, vmax: float, excluded: bool, *, invert: bool = False) -> list[int]:
    """Viridis-ish gradient. Excluded → grey, missing → teal.

    invert=True: high value maps to purple (bad) instead of yellow.
    Handles python None, numpy NaN, pandas NA — any missing value renders as
    the reserved no-data teal, distinct from grey (excluded) and red (constraint).
    """
    if excluded:
        return EXCLUDED_COLOUR
    if value is None or pd.isna(value) or vmax <= vmin:
        return NO_DATA_COLOUR
    t = (float(value) - vmin) / (vmax - vmin)
    if t < 0.0:
        t = 0.0
    elif t > 1.0:
        t = 1.0
    if invert:
        t = 1.0 - t
    r = int(68 + t * (253 - 68))
    g = int(1 + t * (231 - 1))
    b = int(84 + t * (37 - 84))
    return [r, g, b, 200]


def _color_categorical(value, excluded: bool) -> list[int]:
    if excluded:
        return EXCLUDED_COLOUR
    # Missing values on a binary metric also render as no-data teal.
    if value is None or pd.isna(value):
        return NO_DATA_COLOUR
    return PROCLAIMED_COLOUR if bool(value) else UNPROCLAIMED_COLOUR


HIGH_IS_BAD = {"capability_class", "salinity_idx", "bushfire_prone_frac", "dist_townsite_km", "dist_sealed_road_km", "dbca_estate_frac"}


def _build_layer(df: pd.DataFrame, metric: str) -> pdk.Layer:
    df = df.copy()
    if metric in ("gw_proclaimed", "sw_proclaimed"):
        df["fill_color"] = [
            _color_categorical(v, ex)
            for v, ex in zip(df[metric], df["excluded"], strict=True)
        ]
    else:
        values = df[metric].astype(float)
        finite = values.dropna()
        vmin = float(finite.min()) if not finite.empty else 0.0
        vmax = float(finite.max()) if not finite.empty else 1.0
        invert = metric in HIGH_IS_BAD
        df["fill_color"] = [
            _color_for(v, vmin, vmax, ex, invert=invert)
            for v, ex in zip(df[metric], df["excluded"], strict=True)
        ]
    return pdk.Layer(
        "H3HexagonLayer",
        data=df,
        get_hexagon="h3",
        get_fill_color="fill_color",
        pickable=True,
        stroked=False,
        extruded=False,
        line_width_min_pixels=0,
        auto_highlight=True,
    )


def main() -> None:
    st.title("South West WA Land Screener")
    st.caption(
        "Regional screening tool. Pick shires to investigate, then search "
        "listings manually. Not a property recommender."
    )

    with st.sidebar:
        st.header("Find a place")
        query = st.text_input(
            "Address, town, or landmark",
            placeholder="e.g. Boyup Brook, 285 Blackwood Rd Balingup",
            help="Free-text search via OpenStreetMap. Focus jumps to the hex cell "
            "that contains the resolved point.",
        )
        search_result = None
        if query:
            try:
                search_result = geocode(query)
            except Exception as e:
                st.error(f"Search failed: {e}")
            if search_result is None:
                st.warning("No match. Try a broader query (e.g. town + shire).")
            else:
                lat, lng, display = search_result
                st.success(f"📍 {display}")

        st.header("Weights")
        defaults = default_weights(_weights_mtime())
        if "weights_state" not in st.session_state:
            st.session_state["weights_state"] = dict(defaults)
        if st.button("Reset to defaults", help="Restore weights.yaml values."):
            st.session_state["weights_state"] = dict(defaults)
        weights: dict[str, float] = {}
        for factor in FACTOR_ORDER:
            weights[factor] = st.slider(
                factor.capitalize(),
                min_value=0.0,
                max_value=1.0,
                value=float(st.session_state["weights_state"].get(factor, defaults[factor])),
                step=0.01,
                key=f"weight_{factor}",
            )
        st.session_state["weights_state"] = weights
        total = sum(weights.values())
        if total > 0:
            normalised = {k: v / total for k, v in weights.items()}
            drift = abs(total - 1.0)
            st.caption(
                f"Sum = {total:.2f}"
                + (f" (auto-normalised — drift {drift:.2f})" if drift > 0.005 else "")
            )
            with st.expander("Effective normalised weights"):
                for k, v in normalised.items():
                    st.write(f"- {k}: {v:.2%}")
        else:
            st.error("All weights are zero — set at least one > 0.")

        # Sensitivity readout — from the last recorded scoring/sensitivity.py run.
        sens = _latest_sensitivity()
        if sens:
            verdict = sens.get("verdict", "")
            rho_cell = sens.get("min_rho_cell")
            rho_lga = sens.get("min_rho_lga")
            ts = sens.get("run_at", "")[:16].replace("T", " ")
            summary = (
                f"**Ranking stability**: {verdict}  \n"
                f"Worst ρ cells: {rho_cell:.3f} · LGAs: {rho_lga:.3f}  \n"
                f"Last check: {ts}"
            )
            if verdict.startswith("STABLE"):
                st.success(summary)
            elif verdict.startswith("MOSTLY"):
                st.info(summary)
            elif verdict.startswith("SENSITIVE"):
                st.warning(summary)
            else:
                st.error(summary)
            st.caption("Re-run `uv run python -m scoring.sensitivity` to refresh.")
        else:
            st.caption(
                "No sensitivity check on record. "
                "Run `uv run python -m scoring.sensitivity` to check ranking stability."
            )

        st.header("Exclusion thresholds")
        st.caption(
            "Stage 1 hard mask. Cells crossing any threshold are excluded from "
            "the score. Applying re-runs `scoring/exclude.py` and re-scores."
        )
        with WEIGHTS_PATH.open() as f:
            _cfg_now = yaml.safe_load(f)
        _ex = _cfg_now.get("exclusions", {})
        excl_state = {
            "gsr_mean_mm_below": st.slider(
                "Rainfall < X mm (May-Oct baseline)",
                min_value=200, max_value=800,
                value=int(_ex.get("gsr_mean_mm_below", 350)),
                step=25,
                help="Exclude cells drier than this.",
            ),
            "capability_class_at_or_above": st.slider(
                "Soil class ≥ N (1=best, 6=worst)",
                min_value=1, max_value=7,
                value=int(_ex.get("capability_class_at_or_above", 5)),
                step=1,
                help="Exclude cells whose modal grazing capability is at or above this. 7 = disable.",
            ),
            "salinity_idx_at_or_above": st.slider(
                "Salinity ordinal ≥ N (1=fresh, 7=hypersaline)",
                min_value=1, max_value=8,
                value=int(_ex.get("salinity_idx_at_or_above", 5)),
                step=1,
                help="Exclude cells with groundwater at or above this salinity class. 8 = disable.",
            ),
            "dbca_estate_frac_above": st.slider(
                "DBCA estate fraction > X",
                min_value=0.0, max_value=1.0,
                value=float(_ex.get("dbca_estate_frac_above", 0.9)),
                step=0.05,
                help="Exclude cells more than this fraction inside DBCA-managed land. 1.0 = disable.",
            ),
        }
        if st.button("Apply exclusions", type="primary"):
            with st.spinner("Re-running exclusion pass + scoring…"):
                # Update weights.yaml in place then invoke both stages.
                cfg = _cfg_now
                cfg.setdefault("exclusions", {})
                for k, v in excl_state.items():
                    cfg["exclusions"][k] = v
                with WEIGHTS_PATH.open("w") as f:
                    yaml.safe_dump(cfg, f, sort_keys=False)
                from scoring.exclude import apply as apply_exclusions
                from scoring.score import compute as compute_scores
                apply_exclusions()
                compute_scores()
                # Bust Streamlit caches so the next re-run picks up the new snapshot.
                st.cache_data.clear()
                st.rerun()

        st.header("Filter")
        mtime = _snapshot_mtime()
        all_lgas = list_lgas(mtime)
        if not all_lgas:
            st.error(
                "No LGAs in `hex` yet. Run `uv run python -m ingest.hex_grid` first."
            )
            st.stop()
        selected = st.multiselect(
            "LGA", options=all_lgas, default=all_lgas, help="Restrict the map to these shires."
        )
        st.header("Colour by")
        metric_label = st.radio(
            "Metric",
            options=[
                "★ Suitability score",
                "Parcel count per cell",
                "Median parcel area (ha)",
                "Groundwater: proclaimed?",
                "Surface water: proclaimed?",
                "Salinity: TDS class",
                "Bushfire prone: area fraction",
                "Soil capability (grazing)",
                "Distance to nearest town (km)",
                "Distance to sealed road (km)",
                "DBCA estate: area fraction",
                "Rainfall: May-Oct mean (mm)",
                "Rainfall: trend since 1970 (mm/decade)",
            ],
            index=0,
        )
        metric = {
            "★ Suitability score": "suitability_score",
            "Parcel count per cell": "parcel_count",
            "Median parcel area (ha)": "parcel_area_median_ha",
            "Groundwater: proclaimed?": "gw_proclaimed",
            "Surface water: proclaimed?": "sw_proclaimed",
            "Salinity: TDS class": "salinity_idx",
            "Bushfire prone: area fraction": "bushfire_prone_frac",
            "Soil capability (grazing)": "capability_class",
            "Distance to nearest town (km)": "dist_townsite_km",
            "Distance to sealed road (km)": "dist_sealed_road_km",
            "DBCA estate: area fraction": "dbca_estate_frac",
            "Rainfall: May-Oct mean (mm)": "gsr_mean_mm",
            "Rainfall: trend since 1970 (mm/decade)": "gsr_trend",
        }[metric_label]

        st.header("Legend")
        if metric in ("gw_proclaimed", "sw_proclaimed"):
            st.markdown("- **Red**: proclaimed (licence required)")
            st.markdown("- **Green**: unproclaimed (no licence required)")
        elif metric in HIGH_IS_BAD:
            st.markdown("- **Yellow → Purple**: better → worse")
        else:
            st.markdown("- **Purple → Yellow**: low → high value")
        st.markdown("- **Grey**: excluded cell (Stage 1 hard mask)")
        st.markdown("- **Faint teal**: no data for this metric in this cell")
        st.caption(
            "More scoring layers (rainfall, access, residual) appear here "
            "as M3+ lands."
        )

    df = load_hex(tuple(selected) if selected else None, mtime)
    if df.empty:
        st.warning("No hex cells match the current filter.")
        st.stop()

    # Live re-score using current slider weights. Overrides the stored
    # suitability_score column so the map, inspector, and ranked table all
    # agree with the sidebar. Excluded cells stay NULL.
    if sum(weights.values()) > 0:
        live = rescore_suitability(df, weights)
        # Preserve exclusion NULLs — an excluded cell has no meaningful score.
        live = live.where(~df["excluded"], other=pd.NA)
        df["suitability_score"] = live

    # If the user searched an address, resolve to a hex cell at res 7 and
    # centre the map there. If the cell exists in df, remember it so the
    # inspector auto-selects it.
    searched_h3: str | None = None
    if search_result is not None:
        lat, lng, _display = search_result
        # Match the ingest resolution used in ingest/hex_grid.py.
        searched_h3 = h3.latlng_to_cell(lat, lng, 7)
        view = pdk.ViewState(latitude=lat, longitude=lng, zoom=11, pitch=0)
        if searched_h3 not in set(df["h3"]):
            st.info(
                f"Location is outside the currently-loaded shires "
                f"(cell {searched_h3}). Map is centred there but no hex data available."
            )
    else:
        lats, lngs = zip(
            *[h3.cell_to_latlng(h) for h in df["h3"].sample(min(len(df), 500), random_state=1)],
            strict=True,
        )
        view = pdk.ViewState(
            latitude=sum(lats) / len(lats),
            longitude=sum(lngs) / len(lngs),
            zoom=9,
            pitch=0,
        )

    layer = _build_layer(df, metric)
    # Give the main layer an id so we can retrieve selections from event_state.
    layer.id = "hexes"
    layers: list[pdk.Layer] = [layer]
    if searched_h3 is not None:
        highlight_df = pd.DataFrame({"h3": [searched_h3]})
        highlight = pdk.Layer(
            "H3HexagonLayer",
            data=highlight_df,
            get_hexagon="h3",
            get_fill_color=[0, 0, 0, 0],       # transparent fill
            get_line_color=[255, 255, 255, 255],
            stroked=True,
            filled=False,
            line_width_min_pixels=3,
            pickable=False,
        )
        layers.append(highlight)
    tooltip = {
        "html": (
            "<b>Suitability score:</b> {suitability_score}<br/>"
            "<b>H3:</b> {h3}<br/>"
            "<b>LGA:</b> {lga}<br/>"
            "<b>Parcels:</b> {parcel_count}<br/>"
            "<b>Median area (ha):</b> {parcel_area_median_ha}<br/>"
            "<b>Grazing capability:</b> {lc_graz_raw}<br/>"
            "<b>GW area:</b> {gw_area_name}<br/>"
            "<b>Salinity (TDS mg/L):</b> {salinity_tds_class}<br/>"
            "<b>Bushfire prone frac:</b> {bushfire_prone_frac}<br/>"
            "<b>Nearest town:</b> {nearest_townsite_name} ({dist_townsite_km} km)<br/>"
            "<b>Nearest sealed road:</b> {nearest_sealed_road_name} ({dist_sealed_road_km} km)<br/>"
            "<b>DBCA:</b> {dbca_category} ({dbca_estate_frac})<br/>"
            "<b>Rain (May-Oct baseline):</b> {gsr_mean_mm} mm<br/>"
            "<b>Rain trend since 1970:</b> {gsr_trend} mm/decade"
        ),
        "style": {"backgroundColor": "#111", "color": "#eee", "fontSize": "12px"},
    }

    left, right = st.columns([3, 1])
    with left:
        st.subheader("Map")
        pydeck_state = st.pydeck_chart(
            pdk.Deck(
                map_style=None,   # avoids Mapbox token requirement
                initial_view_state=view,
                layers=layers,
                tooltip=tooltip,
            ),
            width="stretch",
            selection_mode="single-object",
            on_select="rerun",
            key="map",
        )
        st.caption(
            f"{len(df):,} hex cells shown (metric: {metric_label}). Hover for cell "
            "details, click a hex to open it in the inspector."
        )

    # Extract clicked hex id from the pydeck event state, if any.
    clicked_h3: str | None = None
    try:
        picked = pydeck_state.selection.objects.get("hexes", [])
        if picked:
            clicked_h3 = picked[0].get("h3")
    except (AttributeError, KeyError, IndexError):
        pass
    with right:
        st.subheader("Cell inspector")
        cell_options = df.sort_values(metric, ascending=False)["h3"].head(50).tolist()
        df_h3_set = set(df["h3"])
        # A clicked hex takes priority; searched hex is next.
        preferred_h3: str | None = None
        if clicked_h3 is not None and clicked_h3 in df_h3_set:
            preferred_h3 = clicked_h3
        elif searched_h3 is not None and searched_h3 in df_h3_set:
            preferred_h3 = searched_h3
        default_index = 0
        if preferred_h3 is not None:
            if preferred_h3 not in cell_options:
                cell_options = [preferred_h3] + cell_options
            default_index = cell_options.index(preferred_h3)
        chosen = st.selectbox(
            "Inspect a cell",
            options=cell_options,
            index=default_index,
            help="Top 50 by current metric, plus any clicked/searched cell.",
        )
        if chosen:
            row = df[df["h3"] == chosen].iloc[0]
            # Suitability score + factor decomposition first — this is the
            # headline number per §7.
            suit = row.get("suitability_score")
            if pd.notna(suit):
                st.metric("Suitability score", f"{float(suit):.3f}")
                total = sum(weights.values())
                normalised = {k: (v / total if total > 0 else 0.0) for k, v in weights.items()}
                with st.expander("Score decomposition", expanded=True):
                    for name in FACTOR_ORDER:
                        weight = normalised[name]
                        val = row.get(f"factor_{name}")
                        if pd.notna(val):
                            contrib = float(val) * weight
                            st.write(
                                f"- **{name}** (weight {weight:.0%}): "
                                f"factor {float(val):.2f} → contributes {contrib:.3f}"
                            )
                        else:
                            st.write(f"- **{name}** (weight {weight:.0%}): no data")
            elif bool(row.get("excluded")):
                st.info("Excluded from suitability score (Stage 1 hard mask).")
            else:
                st.warning("No suitability score — one or more inputs are missing for this cell.")

            st.metric("Parcels", int(row["parcel_count"]))
            median_ha = row["parcel_area_median_ha"]
            st.metric(
                "Median parcel area (ha)",
                f"{median_ha:.2f}" if pd.notna(median_ha) else "—",
            )
            st.write("**LGA:**", row["lga"])
            gw_area = row.get("gw_area_name")
            if row["gw_proclaimed"]:
                st.write(
                    "**Groundwater:**",
                    f"Proclaimed — {gw_area}" if pd.notna(gw_area) else "Proclaimed",
                )
            else:
                st.write("**Groundwater:**", "Unproclaimed (no licence needed)")
            st.write(
                "**Surface water:**",
                "Proclaimed (licence required)" if row["sw_proclaimed"]
                else "Unproclaimed",
            )
            tds = row.get("salinity_tds_class")
            sal_idx = row.get("salinity_idx")
            if pd.notna(tds):
                st.write(f"**Salinity:** {tds} mg/L (ord {int(sal_idx)}/7)")
            else:
                st.write("**Salinity:** no data (outside mapped areas)")
            bpa = row.get("bushfire_prone_frac")
            if pd.notna(bpa):
                st.write(f"**Bushfire prone:** {float(bpa):.0%} of cell area")
            else:
                st.write("**Bushfire prone:** no data")
            cap = row.get("lc_graz_raw")
            cap_conf = row.get("capability_confidence")
            if pd.notna(cap):
                conf_txt = f" (conf {float(cap_conf):.0%})" if pd.notna(cap_conf) else ""
                st.write(f"**Grazing capability:** {cap}{conf_txt}")
            else:
                st.write("**Grazing capability:** no data")
            town_km = row.get("dist_townsite_km")
            town_name = row.get("nearest_townsite_name")
            if pd.notna(town_km) and pd.notna(town_name):
                st.write(f"**Nearest town:** {town_name} ({float(town_km):.1f} km)")
            road_km = row.get("dist_sealed_road_km")
            road_name = row.get("nearest_sealed_road_name")
            if pd.notna(road_km) and pd.notna(road_name):
                st.write(f"**Nearest sealed road:** {road_name} ({float(road_km):.1f} km)")
            dbca_frac = row.get("dbca_estate_frac")
            dbca_cat = row.get("dbca_category")
            if pd.notna(dbca_frac) and float(dbca_frac) > 0:
                cat_txt = f" — {dbca_cat}" if pd.notna(dbca_cat) else ""
                st.write(f"**DBCA estate:** {float(dbca_frac):.0%} of cell{cat_txt}")
            rain_mm = row.get("gsr_mean_mm")
            rain_trend = row.get("gsr_trend")
            if pd.notna(rain_mm):
                st.write(f"**Growing-season rainfall (May-Oct, 1991-2020):** {float(rain_mm):.0f} mm")
            if pd.notna(rain_trend):
                st.write(f"**Rainfall trend (since 1970):** {float(rain_trend):+.1f} mm/decade")
            with st.expander("Capability per enterprise"):
                for label, col in [
                    ("Grazing", "lc_graz_raw"),
                    ("Dryland cropping", "lc_dry_cro_raw"),
                    ("Annual horticulture", "lc_ann_hor_raw"),
                    ("Perennial horticulture", "lc_per_hor_raw"),
                    ("Vineyards", "lc_vines_raw"),
                ]:
                    v = row.get(col)
                    st.write(f"- {label}: {v if pd.notna(v) else '—'}")
            st.write("**Excluded:**", bool(row["excluded"]))
            reasons = row.get("exclusion_reasons")
            if reasons is not None and not (isinstance(reasons, float) and pd.isna(reasons)):
                try:
                    if len(reasons) > 0:
                        st.write("**Reasons:**", ", ".join(reasons))
                except TypeError:
                    pass
            summ = parcel_summary(chosen, mtime)
            with st.expander("Parcel-level stats"):
                st.write(f"Total area (ha): {summ['total_ha']:.1f}" if summ["total_ha"] else "—")
                st.write(
                    f"Range: {summ['min_ha']:.2f}–{summ['max_ha']:.2f} ha"
                    if summ["min_ha"] is not None
                    else "—"
                )
                st.write(f"Mean: {summ['mean_ha']:.2f} ha" if summ["mean_ha"] else "—")

    st.subheader(f"Top 30 cells by {metric_label}")
    ascending = metric in HIGH_IS_BAD
    top = (
        df.sort_values(metric, ascending=ascending, na_position="last")
        .head(30)
        [[
            "h3", "lga",
            "suitability_score",
            "factor_water", "factor_rainfall", "factor_soil",
            "factor_access", "factor_bushfire",
            "parcel_count", "parcel_area_median_ha",
            "excluded",
        ]]
    )
    st.dataframe(top, width="stretch", hide_index=True)
    st.download_button(
        "Download shown as CSV",
        data=top.to_csv(index=False).encode(),
        file_name="top_cells.csv",
        mime="text/csv",
    )


if __name__ == "__main__":
    main()
