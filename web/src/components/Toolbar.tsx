/**
 * Slim brand chip in the top-left. No panel toggles here anymore — those
 * live in the tab bar / collapsed rail on the right so the toolbar never
 * competes with the panel for space.
 *
 * On mobile, when a hex is selected, we render an adjacent "Clear" chip
 * so the operator can drop the selection without opening the sheet. It
 * lives inside this same flex row so heights and spacing stay in sync
 * automatically — no magic offsets.
 */

import { useHealth, useHex } from "../hooks";
import { useUi } from "../store";
import { useMedia } from "../lib/useMedia";

export function Toolbar() {
  const { data: health } = useHealth();
  const { data: rows } = useHex();
  const selectedH3 = useUi((s) => s.selectedH3);
  const selectHex = useUi((s) => s.selectHex);
  const isMobile = useMedia("(max-width: 640px)");

  return (
    <div className="absolute top-4 left-4 z-20 flex items-stretch gap-2">
      <div className="panel px-3 py-2 flex items-center gap-2.5">
        <div className="text-emerald-400 text-lg leading-none">◈</div>
        <div className="leading-tight">
          {/* Full brand + hex count on wide screens; below 480px we drop the
              title line and keep the hex count so the map has more room but
              the operator still sees "how much am I looking at". */}
          <div className="text-sm font-medium hidden xs:block">Lima</div>
          <div className="text-[10px] text-panel-muted mt-0.5">
            {rows
              ? `${rows.length.toLocaleString()} hex cells shown`
              : health
                ? `${health.hex_count.toLocaleString()} total`
                : "loading…"}
          </div>
        </div>
      </div>
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
    </div>
  );
}
