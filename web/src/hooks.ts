/**
 * TanStack Query hooks. Kept in one place so query keys stay consistent
 * across components — invalidation is one-liner from panels that mutate.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";
import { useUi } from "./store";
import type { Exclusions } from "./types";

export const keys = {
  health: ["health"] as const,
  dataStatus: ["dataStatus"] as const,
  lgas: ["lgas"] as const,
  hex: (lgas: string[]) => ["hex", lgas.slice().sort()] as const,
  hexDetail: (h3: string) => ["hexDetail", h3] as const,
  parcelSummary: (h3: string) => ["parcels", h3, "summary"] as const,
  weights: ["weights"] as const,
  exclusions: ["exclusions"] as const,
  sensitivity: ["sensitivity"] as const,
  geocode: (q: string) => ["geocode", q] as const,
};

export function useHealth() {
  return useQuery({ queryKey: keys.health, queryFn: api.health });
}

export function useDataStatus() {
  return useQuery({ queryKey: keys.dataStatus, queryFn: api.dataStatus });
}

export function useLgas() {
  return useQuery({ queryKey: keys.lgas, queryFn: api.lgas });
}

export function useHex() {
  const lgas = useUi((s) => s.selectedLgas);
  return useQuery({
    queryKey: keys.hex(lgas),
    queryFn: () => api.hex(lgas.length ? lgas : undefined),
  });
}

export function useHexDetail(h3: string | null) {
  return useQuery({
    queryKey: h3 ? keys.hexDetail(h3) : ["hexDetail", "none"],
    queryFn: () => api.hexDetail(h3!),
    enabled: !!h3,
  });
}

export function useParcelSummary(h3: string | null) {
  return useQuery({
    queryKey: h3 ? keys.parcelSummary(h3) : ["parcels", "none"],
    queryFn: () => api.parcelSummary(h3!),
    enabled: !!h3,
  });
}

export function useWeights() {
  return useQuery({ queryKey: keys.weights, queryFn: api.weights });
}

export function useExclusions() {
  return useQuery({ queryKey: keys.exclusions, queryFn: api.exclusions });
}

export function useSensitivity() {
  return useQuery({ queryKey: keys.sensitivity, queryFn: api.sensitivity });
}

export function usePutExclusions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Exclusions) => api.putExclusions(body),
    onSuccess: () => {
      // Exclusions PUT re-runs scoring on the backend → snapshot changes.
      // Blast away hex-slice + detail caches so the map picks up new
      // excluded/score columns.
      qc.invalidateQueries({ queryKey: ["hex"] });
      qc.invalidateQueries({ queryKey: ["hexDetail"] });
      qc.invalidateQueries({ queryKey: ["exclusions"] });
      qc.invalidateQueries({ queryKey: ["health"] });
      qc.invalidateQueries({ queryKey: ["dataStatus"] });
    },
  });
}
