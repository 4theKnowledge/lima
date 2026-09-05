/**
 * Non-interactive mini-map preview shown at the top of the mobile
 * full-height panel. Renders the same hex layer + selection outline as the
 * main map, locked to a fixed zoom centered on the selected cell (or
 * between A and B in compare mode).
 *
 * Kept intentionally dumb: no click/pan/zoom, no hover card. The main map
 * is the interactive one; this is spatial context for the panel below.
 */

import { useMemo } from "react";
import DeckGL from "@deck.gl/react";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { PathLayer } from "@deck.gl/layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import { cellToBoundary, cellToLatLng } from "h3-js";
import Map from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import { useHex } from "../hooks";
import { CATEGORICAL_METRICS, HIGH_IS_BAD, useUi } from "../store";
import { applyLiveScoring, metricRange } from "../lib/score";
import { categorical, dim, gradient } from "../lib/color";
import { useSettings } from "../settings";
import { useMedia } from "../lib/useMedia";
import type { HexCell } from "../types";

const BASEMAP_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const BASEMAP_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Fixed zoom for the preview. Chosen so a single H3 res-7 cell (~5km edge)
// dominates the view with ~1 ring of neighbours around it for context.
const PREVIEW_ZOOM = 10.5;

// Same value the main map uses for non-focal cells — keeps the preview
// like-for-like with what the operator sees behind the sheet.
const SPOTLIGHT_DIM = 0.35;

export function MiniMap({ h3, compareH3 }: { h3: string; compareH3?: string | null }) {
  const { data: rows } = useHex();
  const metric = useUi((s) => s.metric);
  const weights = useUi((s) => s.weights);
  const { palette, theme } = useSettings();
  const prefersLight = useMedia("(prefers-color-scheme: light)");
  const isDark = theme === "dark" || (theme === "auto" && !prefersLight);
  const basemapStyle = isDark ? BASEMAP_DARK : BASEMAP_LIGHT;

  const cells = useMemo(
    () => (rows ? applyLiveScoring(rows, weights) : []),
    [rows, weights],
  );

  // Camera: center on A if solo, or midpoint of A/B in compare mode.
  const view = useMemo(() => {
    try {
      const [latA, lngA] = cellToLatLng(h3);
      if (compareH3 && compareH3 !== h3) {
        const [latB, lngB] = cellToLatLng(compareH3);
        return {
          latitude: (latA + latB) / 2,
          longitude: (lngA + lngB) / 2,
          zoom: PREVIEW_ZOOM - 1, // pull out one step so both fit
          pitch: 0,
          bearing: 0,
        };
      }
      return { latitude: latA, longitude: lngA, zoom: PREVIEW_ZOOM, pitch: 0, bearing: 0 };
    } catch {
      return { latitude: -33.9, longitude: 116.4, zoom: PREVIEW_ZOOM, pitch: 0, bearing: 0 };
    }
  }, [h3, compareH3]);

  const invert = HIGH_IS_BAD.has(metric);
  const isCategorical = CATEGORICAL_METRICS.has(metric);

  const [vmin, vmax] = useMemo(
    () => (isCategorical ? [0, 1] : metricRange(cells, metric)),
    [cells, metric, isCategorical],
  );

  const layers = useMemo(() => {
    const hex = new H3HexagonLayer<HexCell>({
      id: "mini-hex",
      data: cells,
      pickable: false,
      stroked: false,
      filled: true,
      extruded: false,
      highPrecision: "auto",
      getHexagon: (d) => d.h3,
      getFillColor: (d) => {
        const base = isCategorical
          ? categorical(d[metric] as boolean | null | undefined, d.excluded, palette)
          : gradient(d[metric] as number | null, vmin, vmax, d.excluded, invert, palette);
        // Spotlight: A (and B in compare mode) stay bright; everything
        // else dims. Same behaviour + factor as the main map.
        if (d.h3 !== h3 && !(compareH3 && d.h3 === compareH3)) {
          return dim(base, SPOTLIGHT_DIM);
        }
        return base;
      },
      updateTriggers: {
        getFillColor: [metric, vmin, vmax, invert, isCategorical, weights, palette, h3, compareH3],
      },
    });

    type OutlineRow = { h3: string; color: [number, number, number, number] };
    const outlineRows: OutlineRow[] = [
      { h3, color: [255, 255, 255, 255] },
      ...(compareH3 && compareH3 !== h3
        ? [{ h3: compareH3, color: [253, 224, 71, 255] as OutlineRow["color"] }]
        : []),
    ];

    const outline = new PathLayer<OutlineRow>({
      id: "mini-outline",
      data: outlineRows,
      pickable: false,
      getPath: (d: OutlineRow) => {
        const ring = cellToBoundary(d.h3);
        const closed = [...ring, ring[0]];
        return closed.map(([lat, lng]) => [lng, lat] as [number, number]);
      },
      getColor: (d: OutlineRow) => d.color,
      getWidth: 3,
      widthUnits: "pixels",
      widthMinPixels: 3,
      extensions: [new PathStyleExtension({ dash: true })],
      getDashArray: [4, 3],
      dashJustified: true,
    } as unknown as ConstructorParameters<typeof PathLayer<OutlineRow>>[0]);

    return [hex, outline];
  }, [cells, metric, vmin, vmax, invert, isCategorical, weights, palette, h3, compareH3]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-neutral-900">
      <DeckGL
        viewState={view}
        controller={false}
        layers={layers}
      >
        <Map
          mapStyle={basemapStyle}
          attributionControl={false}
          interactive={false}
        />
      </DeckGL>
    </div>
  );
}
