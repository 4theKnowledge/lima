/**
 * Bottom-right map controls.
 *
 * Desktop: vertical panel stack of icon buttons — zoom, home, screenshot,
 * refresh, help.
 *
 * Mobile: single FAB in the bottom-right. Tap to fan out the controls in
 * a quarter-arc going up-left. Backdrop tap or FAB tap closes. Help is
 * dropped on mobile (keyboard shortcuts don't apply). When the API
 * reports a new build, the closed FAB inherits the amber "update
 * available" tint so the operator sees the alert without opening.
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

// Height of the collapsed mobile bottom sheet (Open button + tab row +
// border). Shared so MapControls floats above it without a drifting magic
// number.
export const MOBILE_PEEK_HEIGHT = 88;

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "click", desc: "Select a hex cell" },
  { keys: "shift + click", desc: "Pin as B for compare" },
  { keys: "click again", desc: "Deselect" },
  { keys: "esc", desc: "Clear selection" },
  { keys: "h", desc: "Reset view (fit to data)" },
  { keys: "+ / −", desc: "Zoom in / out" },
  { keys: "r", desc: "Refresh data (or reload if update available)" },
];

type Action = {
  id: string;
  title: string;
  aria: string;
  onClick: () => void;
  icon: ReactNode;
  highlight?: boolean;
  /** Hidden from the mobile FAB fan. Desktop always shows all actions. */
  mobileHidden?: boolean;
};

export function MapControls() {
  const flyToHex = useUi((s) => s.flyToHex);
  const nudgeZoom = useUi((s) => s.nudgeZoom);
  const panelOpen = useUi((s) => s.panelOpen);
  const updateAvailable = useUi((s) => s.updateAvailable);
  const [helpOpen, setHelpOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
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

  // Actions are data-driven so desktop stack + mobile fan iterate over the
  // same source. Ordering here defines fan order (first = closest to FAB).
  // Refresh is first so its amber alert is the most prominent when the
  // fan opens.
  const actions: Action[] = [
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
      id: "zoom-out",
      title: "Zoom out (−)",
      aria: "Zoom out",
      onClick: () => nudgeZoom(-1),
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      ),
    },
    {
      id: "zoom-in",
      title: "Zoom in (+)",
      aria: "Zoom in",
      onClick: () => nudgeZoom(+1),
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      ),
    },
    {
      id: "help",
      title: "Shortcuts (?)",
      aria: "Show shortcuts",
      onClick: () => setHelpOpen((v) => !v),
      // Keyboard shortcuts are meaningless on touch. Desktop-only.
      mobileHidden: true,
      icon: <span className="text-[14px] font-semibold leading-none">?</span>,
    },
  ];

  // On mobile the bottom sheet lives at the bottom edge — controls must
  // float above it. When expanded we just hide the cluster to keep the
  // map tap area clean.
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

  if (isMobile) {
    const mobileActions = actions.filter((a) => !a.mobileHidden);
    return (
      <MobileFab
        actions={mobileActions}
        open={fabOpen}
        setOpen={setFabOpen}
        updateAvailable={updateAvailable}
      />
    );
  }

  // Desktop: vertical stack, same as before.
  return (
    <div
      className="absolute right-4 z-20 flex flex-col items-end gap-2"
      style={{ bottom: 16 }}
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
        {/* Desktop order matches the pre-refactor layout: zoom+, zoom-,
            divider, home, screenshot, refresh, help. Actions list is
            fan-ordered (refresh first) so we reindex here. */}
        {reorderForDesktop(actions).map((a, i, arr) => {
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

/** Desktop order = zoom+, zoom−, home, screenshot, refresh, help. */
function reorderForDesktop(actions: Action[]): Action[] {
  const order = ["zoom-in", "zoom-out", "home", "screenshot", "refresh", "help"];
  const byId = new Map(actions.map((a) => [a.id, a]));
  return order.map((id) => byId.get(id)!).filter(Boolean);
}

/**
 * Radial FAB for mobile. Fan actions along a quarter arc going up-left
 * from the FAB when open. Backdrop scrim tap or FAB tap closes.
 *
 * Geometry: buttons distributed evenly on a 92px radius from the FAB
 * center, arc from ~95° (nearly straight up) to ~185° (slightly left of
 * horizontal). Angles chosen so the top action clears the sheet peek
 * and the leftmost stays inside the safe area.
 */
function MobileFab({
  actions,
  open,
  setOpen,
  updateAvailable,
}: {
  actions: Action[];
  open: boolean;
  setOpen: (v: boolean) => void;
  updateAvailable: boolean;
}) {
  const RADIUS = 96;
  const START_DEG = 180; // straight left
  const END_DEG = 270; // straight up (CSS: 270° = -90° = up)
  const n = actions.length;

  return (
    <>
      {/* Backdrop scrim — mounted only when open so the map stays
          interactive at rest. Blurs slightly so the fan pops. */}
      {open && (
        <button
          className="fixed inset-0 z-20 bg-black/25 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
          aria-label="Close map controls"
        />
      )}

      <div
        className="absolute right-4 z-30"
        style={{ bottom: MOBILE_PEEK_HEIGHT + 12 }}
      >
        {/* Fan buttons. Each is absolutely positioned relative to the FAB
            container. When closed they collapse to (0,0) and fade out —
            the transition gives a snappy blossom effect. */}
        {actions.map((a, i) => {
          // Distribute evenly across the arc. When there's only one, park
          // it at the midpoint.
          const t = n === 1 ? 0.5 : i / (n - 1);
          const deg = START_DEG + (END_DEG - START_DEG) * t;
          const rad = (deg * Math.PI) / 180;
          const dx = Math.cos(rad) * RADIUS;
          const dy = Math.sin(rad) * RADIUS;
          // Stagger the fade so the fan blossoms rather than snapping.
          const delayMs = open ? i * 25 : (n - 1 - i) * 15;
          return (
            <button
              key={a.id}
              onClick={() => {
                a.onClick();
                setOpen(false);
              }}
              aria-label={a.aria}
              title={a.title}
              tabIndex={open ? 0 : -1}
              className={cn(
                "panel absolute bottom-0 right-0 h-12 w-12 rounded-full flex items-center justify-center",
                "transition-[transform,opacity] duration-200 ease-out",
                open ? "opacity-100" : "opacity-0 pointer-events-none",
                a.highlight
                  ? "text-amber-300 bg-amber-500/20 ring-1 ring-amber-400/40"
                  : "text-panel-fg active:bg-white/10",
              )}
              style={{
                transform: open
                  ? `translate(${dx}px, ${dy}px)`
                  : "translate(0, 0)",
                transitionDelay: `${delayMs}ms`,
              }}
            >
              {a.icon}
            </button>
          );
        })}

        {/* FAB itself. Amber ring when an update is available so the
            alert is visible without opening the fan. Icon flips between
            + (closed) and ✕ (open). */}
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close map controls" : "Open map controls"}
          aria-expanded={open}
          className={cn(
            "panel relative h-14 w-14 rounded-full flex items-center justify-center",
            "transition-all duration-200 active:scale-95",
            updateAvailable && !open
              ? "text-amber-300 ring-2 ring-amber-400/50"
              : "text-panel-fg",
          )}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            className={cn(
              "transition-transform duration-200",
              open ? "rotate-45" : "rotate-0",
            )}
            aria-hidden
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </>
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
        // 32px on desktop; 44px on coarse pointers to hit HIG touch target.
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
