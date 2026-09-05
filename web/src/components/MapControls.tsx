/**
 * Bottom-right map controls: zoom in, zoom out, reset view. Styled to match
 * the HUD panel so the two floating clusters read as one language.
 *
 * Zoom in/out drive DeckGL's controlled view state via the same `flyTo`
 * store action the chip uses — animated, not a hard cut. Reset view fits
 * the map to the currently-loaded hex bounds (sentinel h3 "__home__").
 */

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useUi } from "../store";
import { useMedia } from "../lib/useMedia";
import { captureMapScreenshot } from "../lib/screenshot";
import { refreshNow } from "../lib/freshness";
import { cn } from "../lib/cn";

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "click", desc: "Select a hex cell" },
  { keys: "shift + click", desc: "Pin as B for compare" },
  { keys: "click again", desc: "Deselect" },
  { keys: "esc", desc: "Clear selection" },
  { keys: "h", desc: "Reset view (fit to data)" },
  { keys: "+ / −", desc: "Zoom in / out" },
  { keys: "r", desc: "Refresh data (or reload if update available)" },
];

export function MapControls() {
  const flyToHex = useUi((s) => s.flyToHex);
  const nudgeZoom = useUi((s) => s.nudgeZoom);
  const panelOpen = useUi((s) => s.panelOpen);
  const updateAvailable = useUi((s) => s.updateAvailable);
  const [helpOpen, setHelpOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const qc = useQueryClient();
  const isMobile = useMedia("(max-width: 640px)");

  // Refresh button behaviour splits on updateAvailable: fresh build → hard
  // reload (only way to pick up new bundle chunks). Otherwise data-only
  // refetch, keeps camera + panel state.
  async function handleRefresh() {
    if (updateAvailable) {
      window.location.reload();
      return;
    }
    setRefreshing(true);
    try {
      await refreshNow(qc);
    } finally {
      setRefreshing(false);
    }
  }
  // On mobile the bottom sheet lives at the bottom edge — controls must
  // float above it. Peek height ≈ 78px; expanded ≈ 75vh. When expanded we
  // just hide the cluster to keep the map tap area clean.
  const mobileHidden = isMobile && panelOpen;

  // Keyboard shortcuts. Ignored while typing in an input/textarea so we
  // don't fight the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        return;
      if (e.key === "h" || e.key === "H") flyToHex("__home__");
      else if (e.key === "?") setHelpOpen((v) => !v);
      else if (e.key === "+" || e.key === "=") nudgeZoom(+1);
      else if (e.key === "-" || e.key === "_") nudgeZoom(-1);
      else if (e.key === "r" || e.key === "R") handleRefresh();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleRefresh depends on qc + updateAvailable but is stable enough
    // that re-binding on every render is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToHex, nudgeZoom, updateAvailable]);

  if (mobileHidden) return null;
  return (
    <div
      className="absolute right-4 z-20 flex flex-col items-end gap-2 transition-[bottom] duration-200"
      style={{ bottom: isMobile ? 88 : 16 }}
    >
      {helpOpen && (
        <div className="panel px-3 py-2.5 w-64 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="panel-title">Shortcuts</div>
            <button
              className="text-panel-muted hover:text-panel-fg text-[10px]"
              onClick={() => setHelpOpen(false)}
              aria-label="Close shortcuts"
            >
              ✕
            </button>
          </div>
          <div className="divide-y divide-white/5">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between py-1">
                <span className="text-panel-muted">{s.desc}</span>
                <kbd className="font-mono text-[10px] rounded bg-white/10 px-1.5 py-0.5 border border-white/10">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="panel flex flex-col p-1 gap-0.5">
        <ControlButton onClick={() => nudgeZoom(+1)} title="Zoom in (+)" aria={"Zoom in"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </ControlButton>
        <ControlButton onClick={() => nudgeZoom(-1)} title="Zoom out (−)" aria={"Zoom out"}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </ControlButton>
        <div className="h-px bg-white/10 my-0.5" />
        <ControlButton
          onClick={() => flyToHex("__home__")}
          title="Reset view (H)"
          aria={"Reset view"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11l9-8 9 8" />
            <path d="M5 10v10h14V10" />
            <path d="M10 20v-6h4v6" />
          </svg>
        </ControlButton>
        <ControlButton
          onClick={() => {
            const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            captureMapScreenshot(`lima-map-${ts}.png`);
          }}
          title="Download map as PNG"
          aria={"Download map as PNG"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7h4l2-3h6l2 3h4v13H3z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </ControlButton>
        <ControlButton
          onClick={handleRefresh}
          title={
            updateAvailable
              ? "New version available — click to reload"
              : refreshing
                ? "Refreshing…"
                : "Refresh data (R)"
          }
          aria={updateAvailable ? "Reload for new version" : "Refresh data"}
          highlight={updateAvailable}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(refreshing && "animate-spin")}
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </ControlButton>
        <ControlButton
          onClick={() => setHelpOpen((v) => !v)}
          title="Shortcuts (?)"
          aria={"Show shortcuts"}
        >
          <span className="text-[13px] font-semibold leading-none">?</span>
        </ControlButton>
      </div>
    </div>
  );
}

function ControlButton({
  onClick,
  title,
  aria,
  highlight,
  children,
}: {
  onClick: () => void;
  title: string;
  aria: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={aria}
      className={cn(
        "h-8 w-8 rounded-md flex items-center justify-center transition",
        highlight
          ? "text-amber-300 bg-amber-500/15 hover:bg-amber-500/25"
          : "text-panel-fg hover:text-emerald-300 hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}

