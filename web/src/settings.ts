/**
 * User preferences. Persisted to localStorage so they survive reload.
 * Separate from `store.ts` (which is ephemeral UI state) — settings are
 * long-lived and need a rehydrate-before-render pass.
 *
 * Keep this file dep-free of anything that uses settings so consumers can
 * import the formatters and hooks without a cycle.
 */

import { useSyncExternalStore } from "react";

export type Units = "metric" | "imperial";
export type Theme = "dark" | "light" | "auto";
export type Palette = "viridis" | "cividis" | "plasma";

export type Settings = {
  units: Units;
  theme: Theme;
  palette: Palette;
};

const KEY = "lima.settings.v1";
const DEFAULTS: Settings = {
  units: "metric",
  theme: "dark",
  palette: "viridis",
};

function load(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      units: parsed.units === "imperial" ? "imperial" : "metric",
      theme:
        parsed.theme === "light" || parsed.theme === "auto"
          ? parsed.theme
          : "dark",
      palette:
        parsed.palette === "cividis" || parsed.palette === "plasma"
          ? parsed.palette
          : "viridis",
    };
  } catch {
    return DEFAULTS;
  }
}

// Tiny hand-rolled store using the useSyncExternalStore API. Avoids pulling
// zustand for three flat values and gives us tight control over persistence.
let current: Settings = load();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getSettings(): Settings {
  return current;
}

export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
  if (current[k] === v) return;
  current = { ...current, [k]: v };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* quota / private mode — ignore */
  }
  emit();
}

export function resetSettings() {
  current = { ...DEFAULTS };
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}

// -------- formatters --------

const HA_TO_AC = 2.47105;
const KM_TO_MI = 0.621371;
const M_PER_FT = 0.3048;

/** Format a hectare value under current units. Returns bare "—" if null. */
export function formatArea(
  ha: number | null | undefined,
  digits = 2,
  units: Units = current.units,
): string {
  if (ha == null || !Number.isFinite(ha)) return "—";
  if (units === "imperial") return `${(ha * HA_TO_AC).toFixed(digits)} ac`;
  return `${ha.toFixed(digits)} ha`;
}

/** The short-form unit label — "ha" or "ac". */
export function areaUnit(units: Units = current.units): string {
  return units === "imperial" ? "ac" : "ha";
}

/** Format a km value under current units. */
export function formatDistance(
  km: number | null | undefined,
  digits = 1,
  units: Units = current.units,
): string {
  if (km == null || !Number.isFinite(km)) return "—";
  if (units === "imperial") return `${(km * KM_TO_MI).toFixed(digits)} mi`;
  return `${km.toFixed(digits)} km`;
}

export function distanceUnit(units: Units = current.units): string {
  return units === "imperial" ? "mi" : "km";
}

/**
 * "1 ha = 10,000 m² (100 m × 100 m)" style tooltip for a *specific* area
 * value. Adapts to imperial (acres → ft², side length in ft).
 */
export function areaTooltip(
  ha: number,
  units: Units = current.units,
): string {
  if (units === "imperial") {
    const ac = ha * HA_TO_AC;
    const ft2 = ac * 43560;
    const sideFt = Math.round(Math.sqrt(ft2));
    return `${ft2.toLocaleString(undefined, { maximumFractionDigits: 0 })} ft² (roughly ${sideFt.toLocaleString()} ft × ${sideFt.toLocaleString()} ft)`;
  }
  const m2 = ha * 10_000;
  const sideM = Math.round(Math.sqrt(m2));
  return `${m2.toLocaleString()} m² (roughly ${sideM.toLocaleString()} m × ${sideM.toLocaleString()} m)`;
}

export function areaHelpTip(units: Units = current.units): string {
  if (units === "imperial") {
    return "1 acre ≈ 4,047 m² — a bit smaller than a US football field. A hectare is ~2.47 acres.";
  }
  return "1 hectare = 10,000 m² — a square 100 m × 100 m. A soccer pitch is ~0.7 ha.";
}

// Re-exported for callers that need a raw conversion without formatting.
export { HA_TO_AC, KM_TO_MI, M_PER_FT };
