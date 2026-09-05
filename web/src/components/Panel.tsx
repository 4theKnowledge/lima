/**
 * Single floating HUD panel on the right edge. Three tabs (Controls,
 * Inspector, Ranking) swap the body. When collapsed, only a slim vertical
 * rail of tab-icon buttons remains — one click brings it back open and
 * jumps to that tab.
 *
 * The map underneath stays full-bleed; the panel is a translucent overlay,
 * matching the original floating aesthetic.
 */

import { useEffect, useRef, type PropsWithChildren, type ReactNode } from "react";

import { useUi, type Tab } from "../store";
import { cn } from "../lib/cn";
import { useMedia } from "../lib/useMedia";
import { MiniMap } from "./MiniMap";
import { useHexDetail } from "../hooks";
import { liveScore } from "../lib/score";

type TabDef = {
  id: Tab;
  label: string;
  icon: ReactNode;
  title: string;
};

const TABS: TabDef[] = [
  { id: "controls", label: "Controls", icon: <IconControls />, title: "Controls" },
  { id: "inspector", label: "Inspector", icon: <IconInspector />, title: "Cell inspector" },
  { id: "ranking", label: "Ranking", icon: <IconRanking />, title: "Top-ranked cells" },
  { id: "data", label: "Data", icon: <IconData />, title: "Data freshness" },
  { id: "settings", label: "Settings", icon: <IconSettings />, title: "Settings" },
];

export function HudPanel({
  children,
}: PropsWithChildren) {
  const open = useUi((s) => s.panelOpen);
  const tab = useUi((s) => s.activeTab);
  const setTab = useUi((s) => s.setActiveTab);
  const setOpen = useUi((s) => s.setPanelOpen);
  const compareActive = useUi((s) => s.compareH3 !== null);
  const isMobile = useMedia("(max-width: 640px)");

  // Ranking wants a taller, wider frame than Controls/Inspector so the table
  // has breathing room. Inspector widens in compare mode to fit the A/B/Δ
  // three-column layout. Pin dimensions per tab so the panel doesn't jitter.
  const size =
    tab === "ranking"
      ? { width: 720, height: "min(70vh, 640px)" as const }
      : tab === "inspector" && compareActive
        ? { width: 560, height: "calc(100vh - 5rem)" as const }
        : { width: 380, height: "calc(100vh - 5rem)" as const };

  // Mobile branch — bottom sheet. Kept entirely separate so the desktop
  // rendering is byte-for-byte identical to before this feature landed.
  if (isMobile) {
    return (
      <MobileSheet
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        tab={tab}
        onTabChange={setTab}
      >
        {children}
      </MobileSheet>
    );
  }

  return (
    <>
      {/* Collapsed rail — always mounted, hidden when the panel is open. */}
      <nav
        aria-label="Panels"
        className={cn(
          "panel absolute top-4 right-4 z-20 flex flex-col p-1.5 gap-1 transition-opacity duration-200",
          open ? "opacity-0 pointer-events-none" : "opacity-100",
        )}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setOpen(true);
            }}
            className="p-2 rounded-md text-panel-muted hover:text-emerald-300 hover:bg-white/5 transition"
            aria-label={`Open ${t.label}`}
            title={t.title}
          >
            {t.icon}
          </button>
        ))}
      </nav>

      {/* Expanded panel. */}
      <aside
        className={cn(
          "panel absolute top-4 right-4 z-20 flex flex-col overflow-hidden transition-all duration-200 ease-out",
          open
            ? "opacity-100 translate-x-0"
            : "opacity-0 translate-x-4 pointer-events-none",
        )}
        style={{ width: size.width, height: size.height }}
      >
        <header className="flex items-stretch border-b border-white/5 shrink-0">
          <div role="tablist" className="flex flex-1 min-w-0">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  title={t.title}
                  // Active tab takes the remaining space (flex:2), inactive
                  // tabs share the rest (flex:1). All keep a truncated label
                  // so the header stays readable; the active one gets full
                  // width to show its title in full.
                  className={cn(
                    "flex items-center gap-1.5 min-w-0 px-2 py-3 text-xs font-medium border-b-2 transition",
                    active
                      ? "flex-[2] border-emerald-400 text-emerald-200"
                      : "flex-1 border-transparent text-panel-muted hover:text-panel-fg hover:bg-white/5",
                  )}
                >
                  <span className="shrink-0">{t.icon}</span>
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </div>
          <button
            className="px-3 text-panel-muted hover:text-panel-fg text-sm border-l border-white/5"
            onClick={() => setOpen(false)}
            aria-label="Collapse panel"
            title="Collapse"
          >
            ⇢
          </button>
        </header>
        <div className="flex-1 overflow-hidden">{children}</div>
      </aside>
    </>
  );
}

/**
 * Bottom-sheet variant of HudPanel for narrow viewports. Two modes:
 *
 *   - No selection: peek strip along the bottom (Open button + tabs).
 *     Tapping Open or a tab expands to ~75vh with a translucent backdrop.
 *   - Selection + open: full-height sheet (100dvh) with a mini-map at the
 *     top showing the selected hex in its neighbourhood context. Below
 *     the mini-map: header (LGA + close), tabs, panel content. This
 *     trades map surface for readable content when the user is actually
 *     inspecting a cell — the mini-map preserves spatial anchor.
 *
 * Gestures are deliberately minimal: no swipe. The Open/Close text
 * button + ✕ in the header + backdrop-tap all dismiss.
 */
function MobileSheet({
  open,
  onOpen,
  onClose,
  tab,
  onTabChange,
  children,
}: PropsWithChildren<{
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  tab: Tab;
  onTabChange: (t: Tab) => void;
}>) {
  const selectedH3 = useUi((s) => s.selectedH3);
  const compareH3 = useUi((s) => s.compareH3);
  const fullHeight = open && !!selectedH3;

  // Publish the collapsed sheet's live height as a CSS var so the mobile
  // FAB (and any other bottom-edge overlays) can dock cleanly above it.
  // ResizeObserver picks up changes when the selection toggles the peek
  // strip between "Open" button and the taller SelectionHeader.
  const sheetRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = sheetRef.current;
    if (!el || open) {
      // When the sheet is open (short mode), the FAB is hidden anyway
      // via panelOpen. When full-height, likewise. Only track peek.
      return;
    }
    const publish = () => {
      const h = el.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--sheet-peek-h", `${h}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, selectedH3]);

  return (
    <>
      {/* Non-modal backdrop when open in short-sheet mode. Full-height
          mode covers the map entirely, so no backdrop needed. */}
      {open && !fullHeight && (
        <div
          className="fixed inset-0 z-10 bg-black/20 backdrop-blur-[1px]"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          "panel fixed inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden",
          "rounded-b-none transition-[height] duration-200 ease-out",
        )}
        style={{
          height: fullHeight ? "100dvh" : open ? "min(75vh, 640px)" : "auto",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Full-height mode: mini-map preview + close-header. Short mode:
            plain Open/Close text button. */}
        {fullHeight && selectedH3 ? (
          <>
            <div className="h-[30vh] shrink-0 border-b border-white/10">
              <MiniMap h3={selectedH3} compareH3={compareH3} />
            </div>
            <SelectionHeader h3={selectedH3} onToggle={onClose} open />
          </>
        ) : selectedH3 ? (
          // Collapsed with a selection: header row IS the toggle. Tap
          // anywhere on it to expand into full-height mode.
          <SelectionHeader
            h3={selectedH3}
            onToggle={onOpen}
            open={false}
          />
        ) : (
          <button
            className="w-full py-2.5 text-xs font-medium uppercase tracking-wider text-panel-muted active:bg-white/5 transition"
            onClick={() => (open ? onClose() : onOpen())}
            aria-expanded={open}
          >
            {open ? "Close" : "Open"}
          </button>
        )}
        <header className="flex items-stretch border-b border-white/5 shrink-0">
          {/* Icon-only tabs on mobile: each tab takes an equal share of the
              row so all five fit without horizontal scrolling. Title +
              aria-label carry the semantics that the visible label would;
              the active tab still gets the emerald underline as the
              affordance for "you are here". */}
          <div role="tablist" className="flex flex-1 min-w-0">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  aria-label={t.label}
                  onClick={() => {
                    onTabChange(t.id);
                    onOpen();
                  }}
                  title={t.title}
                  className={cn(
                    "flex-1 flex items-center justify-center px-2 py-3 border-b-2 transition",
                    active
                      ? "border-emerald-400 text-emerald-200"
                      : "border-transparent text-panel-muted",
                  )}
                >
                  {t.icon}
                </button>
              );
            })}
          </div>
        </header>
        {/* Body only rendered when open — keeps the peek strip tight and
            saves a bit of layout work while collapsed. */}
        {open && <div className="flex-1 overflow-hidden">{children}</div>}
      </aside>
    </>
  );
}

/**
 * Header for the mobile sheet when a hex is selected. The entire row is
 * the toggle — tap to expand into full-height view, tap again to collapse
 * back to the peek strip. No icons; the panel's motion is the affordance.
 * To clear the selection entirely, tap the same hex on the map again.
 */
function SelectionHeader({
  h3,
  open,
  onToggle,
}: {
  h3: string;
  open: boolean;
  onToggle: () => void;
}) {
  const weights = useUi((s) => s.weights);
  const compareArmed = useUi((s) => s.compareArmed);
  const { data: cell, isLoading } = useHexDetail(h3);
  const suit =
    cell && weights ? liveScore(cell, weights) : cell?.suitability_score;

  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? "Collapse panel" : "Expand panel"}
      className="w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-white/5 shrink-0 active:bg-white/5 transition"
    >
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-panel-muted leading-tight">
          {compareArmed ? "Tap hex for B" : "Selected"}
        </div>
        {isLoading || !cell ? (
          <div className="mt-0.5 h-4 w-32 rounded bg-white/10 animate-pulse" />
        ) : (
          <div className="text-sm font-medium text-panel-fg truncate leading-tight">
            {cell.lga ?? "—"}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[10px] uppercase tracking-wider text-panel-muted leading-tight">
          Suit
        </div>
        {isLoading || !cell ? (
          <div className="mt-0.5 h-4 w-10 ml-auto rounded bg-white/10 animate-pulse" />
        ) : (
          <div
            className={cn(
              "text-sm font-semibold font-mono leading-none tabular-nums",
              cell.excluded && "text-amber-300",
            )}
          >
            {cell.excluded ? "—" : suit != null ? suit.toFixed(2) : "—"}
          </div>
        )}
      </div>
    </button>
  );
}

export function TabBody({
  tab,
  scroll = true,
  children,
}: PropsWithChildren<{ tab: Tab; scroll?: boolean }>) {
  const active = useUi((s) => s.activeTab);
  if (active !== tab) return null;
  return (
    <div
      className={cn(
        "h-full",
        scroll && "overflow-y-auto px-4 py-4 text-sm space-y-4",
        !scroll && "flex flex-col p-4",
      )}
    >
      {children}
    </div>
  );
}

/* ---------- inline SVG icons (16px, currentColor) ---------- */

function IconControls() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="7" cy="18" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconInspector() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12,3 21,7.5 21,16.5 12,21 3,16.5 3,7.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconRanking() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <line x1="4" y1="19" x2="10" y2="19" />
      <line x1="4" y1="12" x2="14" y2="12" />
      <line x1="4" y1="5" x2="20" y2="5" />
    </svg>
  );
}

function IconData() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" />
      <path d="M5 12v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
