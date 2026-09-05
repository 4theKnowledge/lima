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
 * Mobile FAB with a vertical reveal. At rest: single circular button in
 * the bottom-right. Tap to slide up a stacked column of action buttons
 * directly above it. Backdrop scrim tap or FAB tap closes. Each action
 * button is 44px wide/tall (HIG touch target) with a small gap.
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
  return (
    <>
      {open && (
        <button
          className="fixed inset-0 z-20 bg-black/25 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
          aria-label="Close map controls"
        />
      )}

      <div
        className="absolute right-4 z-30"
        style={{
          // Live sheet peek height is published by Panel via a CSS var
          // (ResizeObserver keeps it in sync as selection toggles the
          // header). Fall back to the static estimate on first paint.
          bottom: `calc(var(--sheet-peek-h, ${MOBILE_PEEK_HEIGHT}px) + 12px)`,
        }}
      >
        {/* Action buttons: absolutely stacked above the FAB so the closed
            state stays a single circle (no phantom layout height). Slide-up
            + fade transition, staggered so the stack blossoms rather than
            snapping into place. */}
        <div
          className={cn(
            "absolute bottom-full right-0 mb-2 flex flex-col items-center gap-2",
            open ? "" : "pointer-events-none",
          )}
        >
          {actions.map((a, i) => {
            // Reverse the visual stack so index 0 (Refresh) is nearest
            // the FAB. Stagger the fade from the bottom up on open (so
            // the most-reachable action lands first) and top down on
            // close.
            const rowIndex = actions.length - 1 - i;
            const delayMs = open ? i * 30 : rowIndex * 20;
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
                  "panel h-11 w-11 rounded-full flex items-center justify-center",
                  "transition-[transform,opacity] duration-200 ease-out",
                  open
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-3",
                  a.highlight
                    ? "text-amber-300 bg-amber-500/20 ring-1 ring-amber-400/40"
                    : "text-panel-fg active:bg-white/10",
                )}
                style={{ transitionDelay: `${delayMs}ms`, order: rowIndex }}
              >
                {a.icon}
              </button>
            );
          })}
        </div>

        {/* FAB. Amber ring when a new build is available so the alert
            shows through even at rest. Icon flips + → ✕ when open. */}
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close map controls" : "Open map controls"}
          aria-expanded={open}
          className={cn(
            "panel h-14 w-14 rounded-full flex items-center justify-center",
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
