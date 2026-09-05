/**
 * Thin fetch wrappers around the FastAPI backend.
 *
 * In dev: BASE defaults to "/api", proxied by Vite to the backend port.
 * In prod: set VITE_API_BASE_URL (build-time) to the deployed API origin.
 *
 * A shared passcode is read from localStorage (key "lima-passcode", set by
 * PasscodeGate) and sent as X-Passcode on every request. A 401 triggers a
 * clear + reload so the gate re-prompts.
 */

import type {
  DataStatus,
  Exclusions,
  GeocodeResult,
  Health,
  HexCell,
  HexDetail,
  ParcelSummary,
  Purpose,
  Sensitivity,
  Weights,
} from "./types";

const BASE = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
const PASSCODE_KEY = "lima-passcode";

function authHeaders(): HeadersInit {
  const p = localStorage.getItem(PASSCODE_KEY);
  return p ? { "X-Passcode": p } : {};
}

async function j<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const headers = { ...(init?.headers ?? {}), ...authHeaders() };
  const r = await fetch(input, { ...init, headers });
  if (r.status === 401) {
    localStorage.removeItem(PASSCODE_KEY);
    window.location.reload();
    throw new Error("401");
  }
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
  purposes: () => j<Purpose[]>(`${BASE}/purposes`),
  applyPurpose: (pid: string) =>
    j<Purpose>(`${BASE}/purpose/${pid}/apply`, { method: "PUT" }),
  geocode: (q: string) =>
    j<GeocodeResult | null>(`${BASE}/geocode?q=${encodeURIComponent(q)}`),
};
