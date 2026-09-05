/**
 * Thin fetch wrappers around the FastAPI backend. Routed through Vite's
 * dev proxy (/api → http://localhost:8000).
 */

import type {
  DataStatus,
  Exclusions,
  GeocodeResult,
  Health,
  HexCell,
  HexDetail,
  ParcelSummary,
  Sensitivity,
  Weights,
} from "./types";

const BASE = "/api";

async function j<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const r = await fetch(input, init);
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText}: ${body || "no body"}`);
  }
  return r.json() as Promise<T>;
}

export const api = {
  health: () => j<Health>(`${BASE}/health`),
  dataStatus: () => j<DataStatus>(`${BASE}/data-status`),
  lgas: () => j<string[]>(`${BASE}/lgas`),
  hex: (lgas?: string[]) => {
    const p = new URLSearchParams();
    (lgas ?? []).forEach((l) => p.append("lgas", l));
    const qs = p.toString();
    return j<HexCell[]>(`${BASE}/hex${qs ? `?${qs}` : ""}`);
  },
  hexDetail: (h3: string) => j<HexDetail>(`${BASE}/hex/${h3}`),
  parcelSummary: (h3: string) =>
    j<ParcelSummary>(`${BASE}/parcels/${h3}/summary`),
  weights: () => j<Weights>(`${BASE}/weights`),
  exclusions: () => j<Exclusions>(`${BASE}/exclusions`),
  putExclusions: (body: Exclusions) =>
    j<Exclusions>(`${BASE}/exclusions`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  sensitivity: () => j<Sensitivity>(`${BASE}/sensitivity/latest`),
  geocode: (q: string) =>
    j<GeocodeResult | null>(`${BASE}/geocode?q=${encodeURIComponent(q)}`),
};
