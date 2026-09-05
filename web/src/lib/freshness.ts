/**
 * Foreground-refresh + build-stamp check.
 *
 * Why: on iOS home-screen PWAs there's no browser chrome and no reload
 * button, and iOS often resumes a suspended snapshot instead of reloading.
 * Even in plain Safari, a stale `/hex` slice can outlive a snapshot swap
 * on the server because we deliberately keep `refetchOnWindowFocus: false`
 * (the hex slice is ~11k rows — thrashing it on every tab flip is worse
 * than the staleness).
 *
 * What this does when the app comes back to the foreground (visibilitychange
 * → visible, or pageshow with e.persisted):
 *   1. If we've been idle >IDLE_MS, hit /health once.
 *   2. If snapshot_mtime moved, invalidate the queries that depend on it.
 *      This is a data-only refresh — no page reload, no loss of camera or
 *      panel state.
 *   3. If build_id moved and we know our own build_id, flip the store's
 *      `updateAvailable` flag so the banner/refresh button offer a
 *      hard reload. We never auto-reload — that's rude if the user is
 *      mid-slider-drag.
 *
 * The exported `refreshNow()` is what the header refresh button calls: it
 * runs the same check unconditionally (no idle guard).
 */

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { api } from "../api";
import { useUi } from "../store";

const IDLE_MS = 60_000;

// Baked into the bundle at build time. When unset (dev / missing arg) we
// skip build-stamp comparison entirely rather than nag with a false
// "update available" every time.
const OWN_BUILD_ID: string | null =
  (import.meta.env.VITE_BUILD_ID as string | undefined) ?? null;

async function checkFreshness(qc: QueryClient): Promise<void> {
  let health;
  try {
    health = await api.health();
  } catch {
    // Offline / API blip. Fine — we'll try again on the next foreground.
    return;
  }

  // Snapshot moved → server data changed under us. Invalidate the queries
  // that read from the snapshot. Weights/exclusions/lgas are user-config
  // shaped and rarely stale in this way; hex + hexDetail + dataStatus are.
  const prevHealth = qc.getQueryData<{ snapshot_mtime: number }>(["health"]);
  qc.setQueryData(["health"], health);
  if (prevHealth && prevHealth.snapshot_mtime !== health.snapshot_mtime) {
    qc.invalidateQueries({ queryKey: ["hex"] });
    qc.invalidateQueries({ queryKey: ["hexDetail"] });
    qc.invalidateQueries({ queryKey: ["dataStatus"] });
  }

  // Build stamp moved → new deploy. Ask the user, don't yank the page.
  if (OWN_BUILD_ID && health.build_id && health.build_id !== OWN_BUILD_ID) {
    useUi.getState().setUpdateAvailable(true);
  }
}

export function useFreshness(): void {
  const qc = useQueryClient();
  const lastActive = useRef(Date.now());

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      const idle = Date.now() - lastActive.current;
      lastActive.current = Date.now();
      if (idle < IDLE_MS) return;
      checkFreshness(qc);
    }

    // pageshow fires on bfcache restore (iOS Safari back-navigation, some
    // PWA resume paths). visibilitychange covers tab/app switching. We
    // intentionally handle both — either can be the "user returned" event.
    function onPageshow(e: PageTransitionEvent) {
      if (!e.persisted) return;
      lastActive.current = 0; // force the idle guard to pass
      onVisible();
    }

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageshow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageshow);
    };
  }, [qc]);
}

/**
 * Manual refresh — invoked by the header refresh button. Skips the idle
 * guard (the user explicitly asked). Always invalidates hex/hexDetail/
 * dataStatus so "I tapped refresh" reliably re-pulls the visible data,
 * even when snapshot_mtime hasn't moved.
 */
export async function refreshNow(qc: QueryClient): Promise<void> {
  await checkFreshness(qc);
  qc.invalidateQueries({ queryKey: ["hex"] });
  qc.invalidateQueries({ queryKey: ["hexDetail"] });
  qc.invalidateQueries({ queryKey: ["dataStatus"] });
}
