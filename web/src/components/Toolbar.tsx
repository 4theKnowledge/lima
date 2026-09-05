/**
 * Slim brand chip in the top-left. No panel toggles here anymore — those
 * live in the tab bar / collapsed rail on the right so the toolbar never
 * competes with the panel for space.
 */

import { useHealth, useHex } from "../hooks";

export function Toolbar() {
  const { data: health } = useHealth();
  const { data: rows } = useHex();
  return (
    <div className="panel absolute top-4 left-4 z-20 px-3 py-2 flex items-center gap-2.5">
      <div className="text-emerald-400 text-lg leading-none">◈</div>
      <div className="leading-tight">
        {/* Full brand + hex count on wide screens; below 480px we drop the
            title line and keep the hex count so the map has more room but
            the operator still sees "how much am I looking at". */}
        <div className="text-sm font-medium hidden xs:block">
          SWWA Land Screener
        </div>
        <div className="text-[10px] text-panel-muted mt-0.5">
          {rows
            ? `${rows.length.toLocaleString()} hex cells shown`
            : health
              ? `${health.hex_count.toLocaleString()} total`
              : "loading…"}
        </div>
      </div>
    </div>
  );
}
