/**
 * Fullscreen map: MapLibre basemap + deck.gl H3HexagonLayer overlay.
 *
 * All colouring rules mirror the Streamlit implementation exactly so the
 * operator sees the same thing between apps during the parity phase.
 *
 * Extra behaviours on top of the base layer:
 *   - Spotlight: when a hex is selected (click or search), other cells fade
 *     to ~50% alpha so the target reads as the focal point.
 *   - Hover card is clamped away from the HUD panel edge so it never
 *     underlaps the panel — otherwise the operator hovers a rich cell and
 *     the tooltip disappears behind the tab bar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { PathLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import { FlyToInterpolator, type PickingInfo } from "@deck.gl/core";
import { cellToBoundary, cellToLatLng } from "h3-js";
import Map, { type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import { useHex } from "../hooks";
import {
  CATEGORICAL_METRICS,
  HIGH_IS_BAD,
  useUi,
  type Metric,
} from "../store";
import { applyLiveScoring, metricRange } from "../lib/score";
import { categorical, dim, gradient } from "../lib/color";
import { formatArea, useSettings } from "../settings";
import { useMedia } from "../lib/useMedia";
import { METRIC_VALUE } from "../lib/metricValue";
import type { HexCell } from "../types";

const INITIAL_VIEW = {
  latitude: -33.9,
  longitude: 116.4,
  zoom: 7.5,
  pitch: 0,
  bearing: 0,
};

// CartoDB Positron (light) / Dark Matter (dark) — soft basemaps with place
// names (towns, roads, water bodies). Free, no auth. `-nolabels-` variants
// hide labels; keeping labels helps the operator anchor to real places.
// Basemap swaps with the app theme so the hex overlay sits on a matching
// backdrop.
const BASEMAP_STYLE_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const BASEMAP_STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Alpha multiplier for non-selected cells when the operator has picked one.
// 0.35 keeps enough contour to see regional pattern but clearly recedes.
const SPOTLIGHT_DIM = 0.35;

// Right-side HUD panel width + margin. Hover card left/x is clamped to
// avoid crossing this — keeps tooltips readable when hovering cells near
// the panel edge.
const PANEL_RIGHT_MARGIN = 16 + 380 + 24;

export function MapView() {
  const { data: rows } = useHex();
  const metric = useUi((s) => s.metric);
  const weights = useUi((s) => s.weights);
  const selectedH3 = useUi((s) => s.selectedH3);
  const compareH3 = useUi((s) => s.compareH3);
  const compareArmed = useUi((s) => s.compareArmed);
  const selectHex = useUi((s) => s.selectHex);
  const toggleCompare = useUi((s) => s.toggleCompare);
  const searchH3 = useUi((s) => s.searchH3);
  const flyTo = useUi((s) => s.flyTo);
  const zoomNudge = useUi((s) => s.zoomNudge);
  const panelOpen = useUi((s) => s.panelOpen);
  const { palette, theme } = useSettings();
  // Resolve "auto" against the OS preference so the basemap matches what
  // useApplyTheme wrote to <html data-theme>. Kept in-component so the map
  // swaps immediately when Settings changes theme (no reload needed).
  const prefersLight = useMedia("(prefers-color-scheme: light)");
  // Touch devices don't have hover — the deck.gl "hover" event fires on the
  // tap that also triggers select, so the card would sit under the finger
  // and duplicate the inspector. Suppress on coarse pointers.
  const isTouch = useMedia("(pointer: coarse)");
  const isDark =
    theme === "dark" || (theme === "auto" && !prefersLight);
  const basemapStyle = isDark ? BASEMAP_STYLE_DARK : BASEMAP_STYLE_LIGHT;
  const mapRef = useRef<MapRef>(null);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    cell: HexCell;
  } | null>(null);

  // DeckGL is the source of truth for the camera. If we let MapLibre think it
  // owns the view, deck would snap it back on every frame. So we hold view
  // state here and pass it as `viewState` to DeckGL — the MapLibre `<Map>`
  // inside inherits it.
  const [viewState, setViewState] = useState<Record<string, unknown>>(INITIAL_VIEW);
  const onViewStateChange = useCallback(
    (params: { viewState: Record<string, unknown> }) => setViewState(params.viewState),
    [],
  );


  // Re-score client-side on weight changes. Live, no round-trip.
  const cells = useMemo(
    () => (rows ? applyLiveScoring(rows, weights) : []),
    [rows, weights],
  );

  // Continuous metrics need a data-driven vmin/vmax so the ramp uses the
  // full colour space. Recomputed only when data or metric changes.
  const [vmin, vmax] = useMemo(
    () =>
      CATEGORICAL_METRICS.has(metric) ? [0, 1] : metricRange(cells, metric),
    [cells, metric],
  );

  const invert = HIGH_IS_BAD.has(metric);
  const isCategorical = CATEGORICAL_METRICS.has(metric);
  const spotlight = selectedH3 ?? searchH3;
  // When compare is active the spotlight covers both A and B — dim
  // everything else, keep both bright.
  const spotlightExtras = compareH3 ? new Set([compareH3, searchH3]) : null;

  const layers = useMemo(() => {
    const hexLayer = new H3HexagonLayer<HexCell>({
      id: "hexes",
      data: cells,
      pickable: true,
      stroked: false,
      filled: true,
      extruded: false,
      highPrecision: "auto",
      getHexagon: (d) => d.h3,
      getFillColor: (d) => {
        const base = isCategorical
          ? categorical(
              d[metric] as boolean | null | undefined,
              d.excluded,
              palette,
            )
          : gradient(
              d[metric] as number | null,
              vmin,
              vmax,
              d.excluded,
              invert,
              palette,
            );
        // Spotlight: dim everything except the focal cell(s). When compare
        // is active, both A and B stay bright.
        if (
          spotlight &&
          d.h3 !== spotlight &&
          d.h3 !== searchH3 &&
          !(spotlightExtras && spotlightExtras.has(d.h3))
        ) {
          return dim(base, SPOTLIGHT_DIM);
        }
        return base;
      },
      updateTriggers: {
        getFillColor: [
          metric,
          vmin,
          vmax,
          invert,
          isCategorical,
          weights,
          spotlight,
          searchH3,
          compareH3,
          palette,
        ],
      },
      onClick: (info, event) => {
        const c = info.object as HexCell | undefined;
        if (!c) return;
        // Shift-click pins/unpins the compare (B) cell; plain click behaves
        // as before (toggle-selects A). `event.srcEvent` is deck.gl's raw
        // pointer/mouse event. On touch, shift doesn't exist — the compare
        // flow is armed via the SelectedChip's "Compare" button instead.
        const shift =
          (event.srcEvent as MouseEvent | KeyboardEvent | undefined)?.shiftKey ??
          false;
        if ((shift || compareArmed) && selectedH3) {
          toggleCompare(c.h3);
          return;
        }
        selectHex(c.h3 === selectedH3 ? null : c.h3);
      },
      onHover: (info: PickingInfo) => {
        if (isTouch) return;
        const c = info.object as HexCell | undefined;
        if (c) setHover({ x: info.x, y: info.y, cell: c });
        else setHover(null);
      },
    });

    // Thick dashed outline on selected/searched cells. Uses PathLayer +
    // PathStyleExtension because H3HexagonLayer's stroke doesn't support
    // dashes — dash arrays are a Path/Line feature. cellToBoundary returns
    // a ring of [lat, lng] vertices; we close it and swap to [lng, lat].
    //
    // Compare (B) cell gets a different-coloured outline so A vs B is
    // visually unambiguous — matches the A/B labels in the inspector diff.
    type OutlineRow = { h3: string; color: [number, number, number, number] };
    const outlineRows: OutlineRow[] = [
      ...(selectedH3 ? [{ h3: selectedH3, color: [255, 255, 255, 255] as OutlineRow["color"] }] : []),
      ...(compareH3 && compareH3 !== selectedH3
        ? [{ h3: compareH3, color: [253, 224, 71, 255] as OutlineRow["color"] }] // amber-300 for B
        : []),
      ...(searchH3 && searchH3 !== selectedH3 && searchH3 !== compareH3
        ? [{ h3: searchH3, color: [255, 255, 255, 255] as OutlineRow["color"] }]
        : []),
    ];
    // getDashArray / dashJustified are contributed by PathStyleExtension
    // but not typed on PathLayer's props — cast around it.
    const outlineLayer =
      outlineRows.length > 0
        ? new PathLayer<OutlineRow>({
            id: "outline",
            data: outlineRows,
            pickable: false,
            getPath: (d: OutlineRow) => {
              const ring = cellToBoundary(d.h3);
              const closed = [...ring, ring[0]];
              return closed.map(([lat, lng]) => [lng, lat] as [number, number]);
            },
            getColor: (d: OutlineRow) => d.color,
            getWidth: 4,
            widthUnits: "pixels",
            widthMinPixels: 4,
            extensions: [new PathStyleExtension({ dash: true })],
            getDashArray: [4, 3],
            dashJustified: true,
            updateTriggers: {
              getColor: [outlineRows.map((r) => r.color.join(",")).join("|")],
            },
          } as unknown as ConstructorParameters<typeof PathLayer<OutlineRow>>[0])
        : null;

    return outlineLayer ? [hexLayer, outlineLayer] : [hexLayer];
  }, [
    cells,
    metric,
    vmin,
    vmax,
    invert,
    isCategorical,
    selectedH3,
    searchH3,
    compareH3,
    compareArmed,
    spotlight,
    spotlightExtras,
    weights,
    selectHex,
    toggleCompare,
    palette,
    isTouch,
  ]);

  // Fly to a searched cell's centroid when one is set. Because DeckGL owns
  // the camera, we drive the fly-to by animating `viewState` with
  // FlyToInterpolator — calling `map.flyTo` on the underlying MapLibre is
  // fought back to origin on the next deck frame.
  const flyToLatLng = useCallback(
    (lat: number, lng: number, zoom: number, duration: number) => {
      setViewState((prev) => ({
        ...prev,
        longitude: lng,
        latitude: lat,
        zoom,
        transitionDuration: duration,
        transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }),
      }));
    },
    [],
  );

  useEffect(() => {
    if (!searchH3) return;
    try {
      const [lat, lng] = cellToLatLng(searchH3);
      flyToLatLng(lat, lng, 10, 900);
    } catch {
      /* invalid h3 — ignore */
    }
  }, [searchH3, flyToLatLng]);

  // Explicit "go to" requests from the selected-hex chip. Nonce in the
  // store forces this effect to re-fire even if the target h3 is the same
  // as the previous fly-to.
  useEffect(() => {
    if (!flyTo) return;
    // Sentinel "__home__" means fit-to-data instead of a specific cell.
    if (flyTo.h3 === "__home__") {
      const bounds = getBounds(rows);
      if (bounds) {
        const { latitude, longitude, zoom } = fitViewport(bounds);
        flyToLatLng(latitude, longitude, zoom, 900);
      } else {
        flyToLatLng(INITIAL_VIEW.latitude, INITIAL_VIEW.longitude, INITIAL_VIEW.zoom, 900);
      }
      return;
    }
    try {
      const [lat, lng] = cellToLatLng(flyTo.h3);
      flyToLatLng(lat, lng, 11, 800);
    } catch (e) {
      console.warn("[flyTo] failed", e);
    }
  }, [flyTo, flyToLatLng, rows]);

  // Zoom nudges from the map-controls cluster. Short animation so the
  // camera feels responsive but not jarring.
  useEffect(() => {
    if (!zoomNudge) return;
    setViewState((prev) => {
      const current = typeof prev.zoom === "number" ? prev.zoom : INITIAL_VIEW.zoom;
      return {
        ...prev,
        zoom: Math.max(2, Math.min(18, current + zoomNudge.delta)),
        transitionDuration: 300,
        transitionInterpolator: new FlyToInterpolator({ speed: 1.2 }),
      };
    });
  }, [zoomNudge]);

  // Escape → clear selection. Ignored when focus is in an input/textarea so
  // it doesn't fight with typing in the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        return;
      if (selectedH3) selectHex(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedH3, selectHex]);

  return (
    <div className="absolute inset-0">
      <DeckGL
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        controller
        layers={layers}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      >
        <Map
          ref={mapRef}
          mapStyle={basemapStyle}
          reuseMaps
          attributionControl={false}
          // Required for the screenshot button — .toDataURL / drawImage on
          // the maplibre canvas reads a black frame otherwise. Small perf
          // cost, worth it for the "download this view" flow.
          preserveDrawingBuffer
        />
      </DeckGL>
      {hover && !isTouch && (
        <HoverCard
          x={hover.x}
          y={hover.y}
          cell={hover.cell}
          panelOpen={panelOpen}
          metric={metric}
        />
      )}
    </div>
  );
}

function HoverCard({
  x,
  y,
  cell,
  panelOpen,
  metric,
}: {
  x: number;
  y: number;
  cell: HexCell;
  panelOpen: boolean;
  metric: Metric;
}) {
  const HOVER_W = 260;
  const HOVER_H = 130;

  // Reserved rectangles the tooltip must not overlap. Values are rough
  // bounding boxes for the floating HUDs so the tooltip flips to another
  // corner when a hover point would place it under one. Kept as constants
  // here because the HUDs are fixed-position and dimensions are stable.
  const rightBound =
    window.innerWidth - (panelOpen ? PANEL_RIGHT_MARGIN : 12) - HOVER_W;
  const bottomBound = window.innerHeight - 12 - HOVER_H;

  // Top-left cluster: brand chip (Toolbar) + selected chip stack. Height
  // grows when a cell is selected. Overestimate slightly (250) so we
  // don't clip the compare buttons on the SelectedChip.
  const TL_W = 360;
  const TL_H = 250;
  // Bottom-right cluster: MapControls (5 buttons ≈ 200px tall + margin).
  const BR_W = 60;
  const BR_H = 240;
  const brLeft = window.innerWidth - BR_W - 12;
  const brTop = window.innerHeight - BR_H - 12;

  const preferredLeft = x + 14;
  let left =
    preferredLeft > rightBound ? Math.max(12, x - HOVER_W - 14) : preferredLeft;
  const preferredTop = y + 14;
  let top =
    preferredTop > bottomBound ? Math.max(12, y - HOVER_H - 14) : preferredTop;

  // Overlap tests: if the chosen placement would sit under a HUD, nudge
  // by flipping to the opposite side of the cursor. Keeps the tooltip
  // near the hover point instead of doing a full-frame re-solve.
  const overlaps = (
    ax: number,
    ay: number,
    aw: number,
    ah: number,
    bx: number,
    by: number,
    bw: number,
    bh: number,
  ) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

  // Overlap with top-left HUD stack → push tooltip to the right of the cursor
  // and below it.
  if (overlaps(left, top, HOVER_W, HOVER_H, 12, 12, TL_W, TL_H)) {
    left = Math.min(rightBound, x + 14);
    top = Math.min(bottomBound, Math.max(TL_H + 24, y + 14));
  }
  // Overlap with bottom-right controls → push tooltip to the left of the
  // cursor and above.
  if (overlaps(left, top, HOVER_W, HOVER_H, brLeft, brTop, BR_W, BR_H)) {
    left = Math.max(12, x - HOVER_W - 14);
    top = Math.max(12, Math.min(brTop - HOVER_H - 8, y - HOVER_H - 14));
  }

  // Lead with the metric currently driving the map's colour so the tooltip
  // matches what the operator's eyes are already tracking. Suitability +
  // parcels stay below as fixed orientation context — but hide any of those
  // if they're already the leading metric to avoid a duplicate row.
  const spec = METRIC_VALUE[metric];
  const metricValue = spec.format(cell);
  const showSuitBelow = metric !== "suitability_score";
  const showParcelsBelow = metric !== "parcel_count";
  const showMedianBelow = metric !== "parcel_area_median_ha";

  return (
    <div
      className="pointer-events-none absolute z-30 panel px-3 py-2 text-xs leading-relaxed"
      style={{ left, top, width: HOVER_W }}
    >
      <Row label={spec.label} value={metricValue} accent />
      <Row label="LGA" value={cell.lga ?? "—"} />
      {showSuitBelow && (
        <Row label="Suitability" value={fmt(cell.suitability_score, 3)} />
      )}
      {showParcelsBelow && (
        <Row label="Parcels" value={cell.parcel_count?.toString() ?? "—"} />
      )}
      {showMedianBelow && (
        <Row
          label="Median area"
          value={formatArea(cell.parcel_area_median_ha, 2)}
        />
      )}
      {cell.excluded && (
        <div className="mt-1 text-amber-300">
          Excluded: {cell.exclusion_reasons?.join(", ") ?? "—"}
        </div>
      )}
      <div className="mt-1 text-panel-muted">Click to inspect</div>
    </div>
  );
}

function Row({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "flex justify-between gap-4 text-emerald-200"
          : "flex justify-between gap-4"
      }
    >
      <span className={accent ? "" : "text-panel-muted"}>{label}</span>
      <span className={accent ? "font-mono font-semibold" : "font-mono"}>
        {value}
      </span>
    </div>
  );
}

function fmt(v: number | null | undefined, digits = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

/**
 * Approximate lat/lng bounds of a set of hex cells, sampled to keep the
 * cost bounded. Returns null if there's nothing to fit.
 */
function getBounds(
  rows: HexCell[] | undefined,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  if (!rows || rows.length === 0) return null;
  // Sample up to N cells — full-scan of 11k is fine but not needed.
  const step = Math.max(1, Math.floor(rows.length / 500));
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (let i = 0; i < rows.length; i += step) {
    const [lat, lng] = cellToLatLng(rows[i].h3);
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Pick a longitude/latitude/zoom that frames the given bounds inside the
 * viewport. Web Mercator zoom heuristic — no need to be exact; we want
 * "roughly the whole area visible with a bit of margin".
 */
function fitViewport(b: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}): { latitude: number; longitude: number; zoom: number } {
  const latitude = (b.minLat + b.maxLat) / 2;
  const longitude = (b.minLng + b.maxLng) / 2;
  const latSpan = Math.max(0.01, b.maxLat - b.minLat);
  const lngSpan = Math.max(0.01, b.maxLng - b.minLng);
  // ~180 degrees at zoom 0, halved per zoom step. Pick the tighter axis.
  const zoomLat = Math.log2(170 / latSpan);
  const zoomLng = Math.log2(360 / lngSpan);
  const zoom = Math.min(zoomLat, zoomLng) - 0.6; // pad a bit
  return { latitude, longitude, zoom: Math.max(4, Math.min(12, zoom)) };
}
