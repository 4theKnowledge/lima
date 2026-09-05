/**
 * Colour vocabulary — mirrors app/streamlit_app.py's reserved colours plus
 * a switchable perceptual palette (viridis / cividis / plasma).
 *
 * Reserved colours (unchanged across palettes):
 *   EXCLUDED   grey    — Stage 1 hard mask
 *   NO_DATA    teal    — metric is null for this cell
 *   PROCLAIMED / UNPROCLAIMED — binary constraint; swapped for CVD safety
 *                                when the cividis palette is active.
 *
 * The perceptual palette ramps low→high through a 5-stop LUT. Metrics in
 * HIGH_IS_BAD invert the ramp so "worse" always reads as the darker end.
 */

import type { Palette } from "../settings";

export type RGBA = [number, number, number, number];
type RGB = [number, number, number];

export const EXCLUDED_COLOUR: RGBA = [140, 140, 140, 120];
export const NO_DATA_COLOUR: RGBA = [100, 180, 200, 90];

// Categorical (binary) colours. CVD-safe pair (blue/orange) is used when
// the cividis palette is active so red/green colour-blindness doesn't hide
// the water-proclamation distinction.
export const CATEGORICAL_COLOUR: Record<
  Palette,
  { proclaimed: RGBA; unproclaimed: RGBA }
> = {
  viridis: {
    proclaimed: [220, 60, 60, 200], // red
    unproclaimed: [70, 180, 90, 200], // green
  },
  plasma: {
    proclaimed: [220, 60, 60, 200],
    unproclaimed: [70, 180, 90, 200],
  },
  cividis: {
    proclaimed: [230, 130, 30, 210], // orange
    unproclaimed: [60, 130, 210, 210], // blue
  },
};

// 5-stop LUTs sampled from matplotlib / d3-scale-chromatic. Low → high.
const PALETTES: Record<Palette, RGB[]> = {
  viridis: [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ],
  cividis: [
    [0, 32, 76],
    [40, 76, 110],
    [102, 112, 111],
    [175, 165, 108],
    [253, 231, 55],
  ],
  plasma: [
    [13, 8, 135],
    [126, 3, 168],
    [204, 71, 120],
    [248, 149, 64],
    [240, 249, 33],
  ],
};

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function sample(palette: Palette, t: number): RGB {
  const stops = PALETTES[palette];
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const pos = clamped * (stops.length - 1);
  const i = Math.floor(pos);
  const j = Math.min(stops.length - 1, i + 1);
  return lerpRGB(stops[i], stops[j], pos - i);
}

export function gradient(
  value: number | null | undefined,
  vmin: number,
  vmax: number,
  excluded: boolean,
  invert = false,
  palette: Palette = "viridis",
): RGBA {
  if (excluded) return EXCLUDED_COLOUR;
  if (value == null || !Number.isFinite(value) || vmax <= vmin)
    return NO_DATA_COLOUR;
  let t = (value - vmin) / (vmax - vmin);
  if (invert) t = 1 - t;
  const [r, g, b] = sample(palette, t);
  return [r, g, b, 200];
}

export function categorical(
  value: boolean | null | undefined,
  excluded: boolean,
  palette: Palette = "viridis",
): RGBA {
  if (excluded) return EXCLUDED_COLOUR;
  if (value == null) return NO_DATA_COLOUR;
  const c = CATEGORICAL_COLOUR[palette];
  return value ? c.proclaimed : c.unproclaimed;
}

/** Scale the alpha channel of an RGBA — used for the selection spotlight. */
export function dim(c: RGBA, factor: number): RGBA {
  return [c[0], c[1], c[2], Math.round(c[3] * factor)];
}

/**
 * CSS gradient string for the legend swatch. Uses the current palette's
 * five stops so the legend and map agree visually.
 */
export function gradientCss(palette: Palette, invert: boolean): string {
  const stops = PALETTES[palette].map(
    ([r, g, b]) => `rgb(${r},${g},${b})`,
  );
  const seq = invert ? [...stops].reverse() : stops;
  return `linear-gradient(to right, ${seq.join(", ")})`;
}
