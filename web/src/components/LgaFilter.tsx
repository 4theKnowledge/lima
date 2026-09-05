import { useLgas } from "../hooks";
import { useUi } from "../store";
import { cn } from "../lib/cn";
import { InfoTip } from "./InfoTip";
import { LGA_TIP } from "../lib/copy";

export function LgaFilter() {
  const { data: lgas } = useLgas();
  const selected = useUi((s) => s.selectedLgas);
  const setLgas = useUi((s) => s.setLgas);
  if (!lgas) return null;

  const allSelected = selected.length === 0 || selected.length === lgas.length;

  const toggle = (l: string) => {
    const base = selected.length ? selected : lgas;
    const next = base.includes(l) ? base.filter((x) => x !== l) : [...base, l];
    // If the toggle would result in "all", collapse to empty (server treats
    // empty as "no filter" — smaller payload, better cache reuse).
    setLgas(next.length === lgas.length ? [] : next);
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <div className="field-label !mb-0">LGA ({allSelected ? "all" : selected.length})</div>
          <InfoTip>{LGA_TIP}</InfoTip>
        </div>
        <button
          className="hud-button text-[10px] py-1"
          onClick={() =>
            allSelected
              ? // deselect everything except the first LGA — an empty set
                // means "all" server-side, which would be a no-op toggle.
                // Keeping a single LGA gives the operator something to
                // work with and a clear "one selected" state.
                setLgas([lgas[0]])
              : setLgas([])
          }
          title={
            allSelected ? "Deselect all (keeps the first LGA)" : "Select all"
          }
        >
          {allSelected ? "None" : "All"}
        </button>
      </div>
      <div className="max-h-40 overflow-y-auto rounded-md border border-white/5 divide-y divide-white/5">
        {lgas.map((l) => {
          const on = allSelected || selected.includes(l);
          return (
            <button
              key={l}
              onClick={() => toggle(l)}
              className={cn(
                "w-full text-left px-2 py-1.5 text-xs hover:bg-white/5",
                on ? "text-panel-fg" : "text-panel-muted line-through",
              )}
              title={l}
            >
              {shorten(l)}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function shorten(l: string) {
  return l.replace(", SHIRE OF", "").replace(", CITY OF", "").replace(", TOWN OF", "");
}
