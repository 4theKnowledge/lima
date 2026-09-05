/**
 * Map controls: zoom, home, screenshot, refresh (and help on desktop).
 *
 * Desktop: vertical panel stack pinned bottom-right of the map.
 * Mobile:  rendered INSIDE the bottom-sheet peek strip via
 *          <MapControlsInline/> — no floating element, no iOS
 *          overlap gremlins. When the sheet is open we don't render
 *          controls at all (the map is barely visible anyway).
 *
 * Both surfaces share the same `useMapActions()` hook so behaviour and
 * keyboard shortcuts are defined once.
 *
 * Zoom in/out drive DeckGL's controlled view state via the same `flyTo`
 * store action the chip uses — animated, not a hard cut. Reset view fits
 * the map to the currently-loaded hex bounds (sentinel h3 "__home__").
 */

import { useEffect, useState, type ReactNode } from "react";
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

export type MapAction = {
  id: string;
  title: string;
  aria: string;
  onClick: () => void;
  icon: ReactNode;
  highlight?: boolean;
  /** Excluded from the mobile Toolbar row (kept on desktop). Zoom
   *  buttons and Help fall in this bucket — pinch-zoom is native and
   *  keyboard shortcuts don't apply on touch. */
  mobileHidden?: boolean;
};

/**
 * Shared source of truth for map actions. Both the desktop floating
 * stack and the mobile Toolbar row iterate over this. Callers that also
 * want the keyboard shortcuts (currently just the desktop MapControls)
 * pass `bindKeys: true`; the mobile Toolbar leaves it off to avoid
 * registering the same listener twice.
 */
export function useMapActions({
  bindKeys = false,
}: { bindKeys?: boolean } = {}): {
  actions: MapAction[];
  helpOpen: boolean;
  setHelpOpen: (v: boolean) => void;
  updateAvailable: boolean;
} {
  const flyToHex = useUi((s) => s.flyToHex);
  const nudgeZoom = useUi((s) => s.nudgeZoom);
  const updateAvailable = useUi((s) => s.updateAvailable);
  const [helpOpen, setHelpOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const qc = useQueryClient();

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

  const actions: MapAction[] = [
    {
      id: "zoom-in",
      title: "Zoom in (+)",
      aria: "Zoom in",
      onClick: () => nudgeZoom(+1),
      // Pinch-zoom is native on touch; discrete zoom buttons add clutter
      // without adding capability.
      mobileHidden: true,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      ),
    },
    {
      id: "zoom-out",
      title: "Zoom out (−)",
      aria: "Zoom out",
      onClick: () => nudgeZoom(-1),
      mobileHidden: true,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      ),
    },
    {
      id: "home",
      title: "Reset view (H)",
      aria: "Reset view",
      onClick: () => flyToHex("__home__"),
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 11l9-8 9 8" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-6h4v6" />
        </svg>
      ),
    },
    {
      id: "screenshot",
      title: "Download map as PNG",
      aria: "Download map as PNG",
      onClick: () => {
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        captureMapScreenshot(`lima-map-${ts}.png`);
      },
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7h4l2-3h6l2 3h4v13H3z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      ),
    },
    {
      id: "refresh",
      title: updateAvailable
        ? "New version available — tap to reload"
        : refreshing
          ? "Refreshing…"
          : "Refresh data (R)",
      aria: updateAvailable ? "Reload for new version" : "Refresh data",
      onClick: handleRefresh,
      highlight: updateAvailable,
      icon: (
        <svg
          width="16"
          height="16"
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
      ),
    },
    {
      id: "help",
      title: "Shortcuts (?)",
      aria: "Show shortcuts",
      onClick: () => setHelpOpen((v) => !v),
      mobileHidden: true,
      icon: <span className="text-[14px] font-semibold leading-none">?</span>,
    },
  ];

  useEffect(() => {
    if (!bindKeys) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindKeys, flyToHex, nudgeZoom, updateAvailable]);

  return { actions, helpOpen, setHelpOpen, updateAvailable };
}

/** Desktop floating stack. Renders nothing on mobile. Owns the keyboard
 *  binding since it's always mounted on desktop and never on mobile. */
export function MapControls() {
  const isMobile = useMedia("(max-width: 640px)");
  const { actions, helpOpen, setHelpOpen } = useMapActions({ bindKeys: true });
  if (isMobile) return null;

  return (
    <div className="absolute right-4 bottom-4 z-20 flex flex-col items-end gap-2">
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
        {actions.map((a, i, arr) => {
          const showDividerAfter = a.id === "zoom-out";
          return (
            <div key={a.id} className="contents">
              <ControlButton
                onClick={a.onClick}
                title={a.title}
                aria={a.aria}
                highlight={a.highlight}
              >
                {a.icon}
              </ControlButton>
              {showDividerAfter && i < arr.length - 1 && (
                <div className="h-px bg-white/10 my-0.5" />
              )}
            </div>
          );
        })}
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
        "h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
        "rounded-md flex items-center justify-center transition",
        highlight
          ? "text-amber-300 bg-amber-500/15 hover:bg-amber-500/25"
          : "text-panel-fg hover:text-emerald-300 hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}
