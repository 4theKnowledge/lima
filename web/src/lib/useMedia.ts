/**
 * matchMedia() bound to a React hook via useSyncExternalStore. No re-render
 * churn from `matchMedia` events — we subscribe once per query string.
 *
 * Common queries:
 *   useMedia("(max-width: 640px)")           — phone-ish
 *   useMedia("(pointer: coarse)")            — touch primary input
 *   useMedia("(prefers-reduced-motion: reduce)")
 */

import { useSyncExternalStore } from "react";

const cache = new Map<
  string,
  { mql: MediaQueryList; subscribe: (l: () => void) => () => void }
>();

function getBinding(query: string) {
  let entry = cache.get(query);
  if (entry) return entry;
  const mql = window.matchMedia(query);
  const listeners = new Set<() => void>();
  mql.addEventListener("change", () => listeners.forEach((l) => l()));
  entry = {
    mql,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  cache.set(query, entry);
  return entry;
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (l) => {
      if (typeof window === "undefined") return () => {};
      return getBinding(query).subscribe(l);
    },
    () => (typeof window === "undefined" ? false : getBinding(query).mql.matches),
    () => false,
  );
}
