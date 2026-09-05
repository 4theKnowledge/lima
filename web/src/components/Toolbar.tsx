/**
 * Top-left HUD row.
 *
 * Always: brand chip with hex count.
 * On mobile only: "Clear" chip (when a hex is selected) + a compact
 * icon-button chip cluster for map actions (home / screenshot / refresh)
 * — sits in the SAME flex row as the brand chip so heights/spacing stay
 * in sync automatically. Zoom is intentionally omitted on mobile since
 * pinch-zoom is native.
 */

import { useHealth, useHex } from "../hooks";
import { useUi } from "../store";
import { useMedia } from "../lib/useMedia";
import { useMapActions } from "./MapControls";
import { cn } from "../lib/cn";

export function Toolbar() {
  const { data: health } = useHealth();
  const { data: rows } = useHex();
  const selectedH3 = useUi((s) => s.selectedH3);
  const selectHex = useUi((s) => s.selectHex);
  const isMobile = useMedia("(max-width: 640px)");
  const { actions } = useMapActions();
  const mobileActions = actions.filter((a) => !a.mobileHidden);

  return (
    <div className="absolute top-4 left-4 right-4 z-20 flex items-stretch gap-2">
      {/* Mobile brand chip: just "◈ Lima". Hex-count metadata is a
          desktop nicety — on mobile the horizontal space is worth more
          than the count. */}
      {isMobile ? (
        <div className="panel px-3 flex items-center gap-2">
          <div className="text-emerald-400 text-lg leading-none">◈</div>
          <div className="text-sm font-medium">Lima</div>
        </div>
      ) : (
        <div className="panel px-3 py-2 flex items-center gap-2.5">
          <div className="text-emerald-400 text-lg leading-none">◈</div>
          <div className="leading-tight">
            <div className="text-sm font-medium">Lima</div>
            <div className="text-[10px] text-panel-muted mt-0.5">
              {rows
                ? `${rows.length.toLocaleString()} hex cells shown`
                : health
                  ? `${health.hex_count.toLocaleString()} total`
                  : "loading…"}
            </div>
          </div>
        </div>
      )}
      {isMobile && selectedH3 && (
        <button
          onClick={() => selectHex(null)}
          aria-label="Clear selection"
          title="Clear selection"
          className="panel px-3 flex items-center gap-1.5 text-xs text-panel-muted active:text-red-300 active:bg-white/5 transition"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
          >
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
          <span>Clear</span>
        </button>
      )}
      {/* Map action chips — home / screenshot / refresh. Docked to the
          right of the row via ml-auto so they hug the right edge and
          don't jitter as the brand chip's hex count changes width. */}
      {isMobile && (
        <div className="panel ml-auto flex items-center gap-0.5 p-1">
          {mobileActions.map((a) => (
            <button
              key={a.id}
              onClick={a.onClick}
              aria-label={a.aria}
              title={a.title}
              className={cn(
                "h-9 w-9 rounded-md flex items-center justify-center transition",
                a.highlight
                  ? "text-amber-300 bg-amber-500/15 active:bg-amber-500/25"
                  : "text-panel-fg active:bg-white/10",
              )}
            >
              {a.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
