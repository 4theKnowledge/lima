/**
 * URL <-> store sync. Read on mount, write on change (debounced) so views
 * are shareable and back-button-friendly.
 *
 * Deliberately minimal: no TanStack Router, no history entries per change.
 * We use `history.replaceState` so slider dragging doesn't spam the back
 * stack.
 *
 * Param names are short to keep URLs readable:
 *   h    selectedH3
 *   m    metric
 *   t    activeTab
 *   l    selectedLgas (comma-joined)
 *   w    packed weights "water,rainfall,soil,access,bushfire" (2 dp each)
 */

import { useEffect, useRef } from "react";

import { useUi, type Metric, type Tab } from "../store";
import { FACTOR_ORDER, type Weights } from "../types";

const VALID_TABS = new Set<Tab>(["controls", "inspector", "ranking", "data"]);

function packWeights(w: Weights): string {
  return FACTOR_ORDER.map((k) => w[k].toFixed(2)).join(",");
}

function unpackWeights(s: string): Weights | null {
  const parts = s.split(",").map(Number);
  if (parts.length !== FACTOR_ORDER.length) return null;
  if (parts.some((n) => !Number.isFinite(n))) return null;
  const [water, rainfall, soil, access, bushfire] = parts;
  return { water, rainfall, soil, access, bushfire };
}

/**
 * On mount, hydrate the store from the URL. Runs exactly once so refreshes
 * or shared links restore the view.
 */
export function useHydrateFromUrl() {
  const setMetric = useUi((s) => s.setMetric);
  const selectHex = useUi((s) => s.selectHex);
  const setWeights = useUi((s) => s.setWeights);
  const setLgas = useUi((s) => s.setLgas);
  const setActiveTab = useUi((s) => s.setActiveTab);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const p = new URLSearchParams(window.location.search);
    const h = p.get("h");
    const m = p.get("m") as Metric | null;
    const t = p.get("t") as Tab | null;
    const l = p.get("l");
    const w = p.get("w");
    if (h) selectHex(h);
    if (m) setMetric(m);
    if (t && VALID_TABS.has(t)) setActiveTab(t);
    if (l) setLgas(l.split(",").filter(Boolean));
    if (w) {
      const parsed = unpackWeights(w);
      if (parsed) setWeights(parsed);
    }
  }, [setMetric, selectHex, setWeights, setLgas, setActiveTab]);
}

/**
 * On any state change of interest, write back to the URL. Debounced so
 * slider drags don't hammer history.replaceState. Uses replaceState so we
 * don't spam the back stack — one entry per session is enough.
 */
export function useSyncToUrl() {
  const selectedH3 = useUi((s) => s.selectedH3);
  const metric = useUi((s) => s.metric);
  const activeTab = useUi((s) => s.activeTab);
  const selectedLgas = useUi((s) => s.selectedLgas);
  const weights = useUi((s) => s.weights);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const p = new URLSearchParams();
      if (selectedH3) p.set("h", selectedH3);
      if (metric !== "suitability_score") p.set("m", metric);
      if (activeTab !== "controls") p.set("t", activeTab);
      if (selectedLgas.length) p.set("l", selectedLgas.join(","));
      if (weights) p.set("w", packWeights(weights));
      const qs = p.toString();
      const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(null, "", next);
    }, 200);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [selectedH3, metric, activeTab, selectedLgas, weights]);
}
