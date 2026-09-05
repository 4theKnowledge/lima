import { useEffect, useMemo, useState } from "react";

import { useExclusions, useHex, usePutExclusions } from "../hooks";
import type { Exclusions } from "../types";
import { InfoTip } from "./InfoTip";
import { EXCLUSIONS_INTRO, EXCLUSION_TIP } from "../lib/copy";
import { computeExclusionPreview } from "../lib/exclusionPreview";

export function ExclusionsPanel() {
  const { data: current } = useExclusions();
  const { data: cells } = useHex();
  const put = usePutExclusions();
  const [draft, setDraft] = useState<Exclusions | null>(null);

  useEffect(() => {
    if (current && !draft) setDraft(current);
  }, [current, draft]);

  const preview = useMemo(() => {
    if (!cells || !current || !draft) return null;
    return computeExclusionPreview(cells, current, draft);
  }, [cells, current, draft]);

  if (!draft) return null;

  const set = <K extends keyof Exclusions>(k: K, v: Exclusions[K]) =>
    setDraft({ ...draft, [k]: v });

  const dirty =
    !!current &&
    (draft.gsr_mean_mm_below !== current.gsr_mean_mm_below ||
      draft.capability_class_at_or_above !== current.capability_class_at_or_above ||
      draft.salinity_idx_at_or_above !== current.salinity_idx_at_or_above ||
      draft.dbca_estate_frac_above !== current.dbca_estate_frac_above ||
      draft.summer_max_temp_c_above !== current.summer_max_temp_c_above ||
      draft.winter_min_temp_c_below !== current.winter_min_temp_c_below ||
      draft.pop_density_per_km2_above !== current.pop_density_per_km2_above);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1.5">
        <div className="field-label !mb-0">Exclusion thresholds</div>
        <InfoTip>{EXCLUSIONS_INTRO}</InfoTip>
      </div>
      <p className="text-[11px] text-panel-muted leading-snug">
        Stage 1 hard mask. Cells crossing any threshold are excluded from the
        score. Apply re-runs exclusion + scoring.
      </p>
      <Slider
        label="Rainfall < X mm (May-Oct)"
        tip={EXCLUSION_TIP.gsr_mean_mm_below}
        min={200}
        max={800}
        step={25}
        value={draft.gsr_mean_mm_below ?? 350}
        onChange={(v) => set("gsr_mean_mm_below", v)}
      />
      <Slider
        label="Soil class ≥ N (1=best, 7=disable)"
        tip={EXCLUSION_TIP.capability_class_at_or_above}
        min={1}
        max={7}
        step={1}
        value={draft.capability_class_at_or_above ?? 5}
        onChange={(v) => set("capability_class_at_or_above", v)}
      />
      <Slider
        label="Salinity ordinal ≥ N (1=fresh, 8=disable)"
        tip={EXCLUSION_TIP.salinity_idx_at_or_above}
        min={1}
        max={8}
        step={1}
        value={draft.salinity_idx_at_or_above ?? 5}
        onChange={(v) => set("salinity_idx_at_or_above", v)}
      />
      <Slider
        label="DBCA estate fraction > X (1.0=disable)"
        tip={EXCLUSION_TIP.dbca_estate_frac_above}
        min={0}
        max={1}
        step={0.05}
        value={draft.dbca_estate_frac_above ?? 0.9}
        onChange={(v) => set("dbca_estate_frac_above", v)}
        precision={2}
      />
      <Slider
        label="Summer max ≥ X °C (40=disable)"
        tip={EXCLUSION_TIP.summer_max_temp_c_above}
        min={28}
        max={40}
        step={0.5}
        value={draft.summer_max_temp_c_above ?? 40}
        onChange={(v) => set("summer_max_temp_c_above", v)}
        precision={1}
      />
      <Slider
        label="Winter min ≤ X °C (-10=disable)"
        tip={EXCLUSION_TIP.winter_min_temp_c_below}
        min={-10}
        max={12}
        step={0.5}
        value={draft.winter_min_temp_c_below ?? -10}
        onChange={(v) => set("winter_min_temp_c_below", v)}
        precision={1}
      />
      <Slider
        label="Pop density > X /km² (10000=disable)"
        tip={EXCLUSION_TIP.pop_density_per_km2_above}
        min={0}
        max={200}
        step={1}
        value={Math.min(draft.pop_density_per_km2_above ?? 10000, 200)}
        onChange={(v) => set("pop_density_per_km2_above", v >= 200 ? 10000 : v)}
        precision={0}
      />
      {dirty && preview && (
        <div className="rounded-md border border-white/5 bg-white/5 px-2.5 py-2 text-[11px] leading-snug space-y-0.5">
          <div className="text-panel-muted uppercase tracking-wider text-[10px]">
            If you apply
          </div>
          {preview.newExcluded > 0 && (
            <div>
              <span className="text-red-300 font-mono">+{preview.newExcluded.toLocaleString()}</span>{" "}
              cells would be newly excluded
            </div>
          )}
          {preview.newIncluded > 0 && (
            <div>
              <span className="text-emerald-300 font-mono">−{preview.newIncluded.toLocaleString()}</span>{" "}
              cells would come back in
            </div>
          )}
          {preview.newExcluded === 0 && preview.newIncluded === 0 && (
            <div className="text-panel-muted">No cells affected.</div>
          )}
        </div>
      )}
      <button
        className="hud-button-primary w-full justify-center"
        disabled={!dirty || put.isPending}
        onClick={() => put.mutate(draft)}
      >
        {put.isPending ? "Applying…" : dirty ? "Apply exclusions" : "No changes"}
      </button>
      {put.isError && (
        <div className="text-xs text-red-300">
          Apply failed: {(put.error as Error).message}
        </div>
      )}
      {put.isSuccess && !dirty && (
        <div className="text-xs text-emerald-300">Applied. Map refreshed.</div>
      )}
    </section>
  );
}

function Slider({
  label,
  tip,
  min,
  max,
  step,
  value,
  onChange,
  precision = 0,
}: {
  label: string;
  tip?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  precision?: number;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="flex items-center gap-1.5">
          {label}
          {tip && <InfoTip>{tip}</InfoTip>}
        </span>
        <span className="font-mono text-panel-muted">
          {value.toFixed(precision)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}
