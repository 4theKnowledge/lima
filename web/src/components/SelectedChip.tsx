/**
 * Compact selected-hex chip. Sits below the brand chip in the top-left so
 * the operator always sees what's selected without opening the Inspector.
 * Buttons: fly-to (crosshair), open inspector (arrow), compare (A/B icon),
 * clear (✕).
 *
 * Desktop-only. On mobile, LGA/suit live in the bottom sheet header and a
 * "Clear" escape chip lives inside the Toolbar row.
 */

import { useHexDetail } from "../hooks";
import { useUi } from "../store";
import { liveScore } from "../lib/score";
import { cn } from "../lib/cn";
import { useMedia } from "../lib/useMedia";

export function SelectedChip() {
  const selectedH3 = useUi((s) => s.selectedH3);
  const compareH3 = useUi((s) => s.compareH3);
  const compareArmed = useUi((s) => s.compareArmed);
  const armCompare = useUi((s) => s.armCompare);
  const weights = useUi((s) => s.weights);
  const setActiveTab = useUi((s) => s.setActiveTab);
  const selectHex = useUi((s) => s.selectHex);
  const flyToHex = useUi((s) => s.flyToHex);
  const { data: cell } = useHexDetail(selectedH3);
  const isMobile = useMedia("(max-width: 640px)");

  if (isMobile) return null;
  if (!selectedH3) return null;

  const suit = cell && weights ? liveScore(cell, weights) : cell?.suitability_score;

  return (
    <div
      className={cn(
        "panel absolute top-[76px] left-4 z-20 pl-3 pr-1.5 py-2 flex items-center gap-3 max-w-[340px]",
        compareArmed && "ring-2 ring-amber-300/60",
      )}
    >
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-panel-muted">
          {compareArmed ? "Tap a hex for B" : "Selected"}
        </div>
        <div className="text-xs font-medium truncate">
          {cell?.lga ?? "…"}
        </div>
        <div className="text-[10px] text-panel-muted font-mono truncate">
          {selectedH3}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-wider text-panel-muted">
          Suit
        </div>
        <div
          className={cn(
            "text-lg font-semibold font-mono leading-none tabular-nums",
            cell?.excluded && "text-amber-300",
          )}
        >
          {cell?.excluded ? "—" : suit != null ? suit.toFixed(2) : "…"}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <ChipButton
          onClick={() => selectedH3 && flyToHex(selectedH3)}
          label="Fly to selected cell"
          title="Fly to cell"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
          </svg>
        </ChipButton>
        <ChipButton
          onClick={() => setActiveTab("inspector")}
          label="Open inspector"
          title="Open inspector"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </ChipButton>
        <ChipButton
          onClick={armCompare}
          label={compareArmed ? "Cancel compare" : "Compare with another cell"}
          title={
            compareH3
              ? "Compare active — tap to disarm"
              : "Compare (then tap another cell)"
          }
          active={compareArmed || !!compareH3}
        >
          {/* A/B icon: two overlapping squares. */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="7" width="10" height="10" rx="1.5" />
            <rect x="11" y="3" width="10" height="10" rx="1.5" />
          </svg>
        </ChipButton>
        <ChipButton
          onClick={() => selectHex(null)}
          label="Clear selection"
          title="Clear (Esc)"
          danger
        >
          ✕
        </ChipButton>
      </div>
    </div>
  );
}

function ChipButton({
  onClick,
  label,
  title,
  active,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  title: string;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        // 24px hit target on desktop; 32px on touch to hit HIG-ish 44px
        // once combined with padding. Purely a min-size lift on coarse
        // pointers, no change to the visible design elsewhere.
        "h-6 w-6 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8",
        "rounded-md flex items-center justify-center transition",
        active
          ? "text-amber-300 bg-amber-500/15"
          : danger
            ? "text-panel-muted hover:text-red-300 hover:bg-white/10"
            : "text-panel-muted hover:text-emerald-300 hover:bg-white/10",
      )}
      onClick={onClick}
      aria-label={label}
      title={title}
    >
      {children}
    </button>
  );
}
