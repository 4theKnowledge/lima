import { useEffect } from "react";

import { useSensitivity, useWeights } from "../hooks";
import { normalisedWeights, useUi } from "../store";
import { FACTOR_ORDER } from "../types";
import { cn } from "../lib/cn";
import { InfoTip } from "./InfoTip";
import { SENSITIVITY_TIP, WEIGHTS_INTRO, WEIGHT_TIP } from "../lib/copy";

export function WeightsPanel() {
  const { data: defaults } = useWeights();
  const w = useUi((s) => s.weights);
  const setW = useUi((s) => s.setWeights);
  const setWeight = useUi((s) => s.setWeight);
  const resetWeights = useUi((s) => s.resetWeights);
  const dirty = useUi((s) => s.weightsDirty);

  // Seed store from defaults once they arrive.
  useEffect(() => {
    if (defaults && !w) setW(defaults);
  }, [defaults, w, setW]);

  if (!w) return null;

  const total = FACTOR_ORDER.reduce((acc, k) => acc + w[k], 0);
  const norm = normalisedWeights(w);
  const drift = Math.abs(total - 1);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="field-label !mb-0">Weights</div>
          <InfoTip>{WEIGHTS_INTRO}</InfoTip>
        </div>
        {defaults && (
          <button
            className="hud-button text-[10px] py-1"
            onClick={() => resetWeights(defaults)}
            disabled={!dirty}
            title="Restore weights.yaml defaults"
          >
            Reset
          </button>
        )}
      </div>
      {FACTOR_ORDER.map((k) => (
        <div key={k}>
          <div className="flex justify-between text-xs mb-1">
            <span className="capitalize flex items-center gap-1.5">
              {k}
              <InfoTip>{WEIGHT_TIP[k]}</InfoTip>
            </span>
            <span className="font-mono text-panel-muted">
              {w[k].toFixed(2)} · <span className="text-emerald-300">{(norm[k] * 100).toFixed(0)}%</span>
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={w[k]}
            onChange={(e) => setWeight(k, parseFloat(e.target.value))}
          />
        </div>
      ))}
      <div className={cn("text-[11px]", total === 0 ? "text-red-300" : "text-panel-muted")}>
        Sum: {total.toFixed(2)}
        {drift > 0.005 && total > 0 && (
          <span className="ml-1">(auto-normalised, drift {drift.toFixed(2)})</span>
        )}
        {total === 0 && (
          <span className="block text-red-300">All zero — set at least one &gt; 0.</span>
        )}
      </div>
      <SensitivityBadge />
    </section>
  );
}

function SensitivityBadge() {
  const { data: s } = useSensitivity();
  if (!s?.verdict) {
    return (
      <div className="text-[11px] text-panel-muted border-t border-white/5 pt-3 leading-snug">
        No sensitivity check on record. Run{" "}
        <code className="text-panel-fg">uv run python -m scoring.sensitivity</code>.
      </div>
    );
  }
  const tone = s.verdict.startsWith("STABLE")
    ? "text-emerald-300"
    : s.verdict.startsWith("MOSTLY")
      ? "text-sky-300"
      : s.verdict.startsWith("SENSITIVE")
        ? "text-amber-300"
        : "text-red-300";
  return (
    <div className="text-[11px] border-t border-white/5 pt-3 leading-snug space-y-1">
      <div className={cn("font-medium flex items-center gap-1.5", tone)}>
        Ranking stability: {s.verdict}
        <InfoTip>{SENSITIVITY_TIP}</InfoTip>
      </div>
      <div className="text-panel-muted font-mono">
        ρ cells {s.min_rho_cell?.toFixed(3)} · LGAs {s.min_rho_lga?.toFixed(3)}
      </div>
      <div className="text-panel-muted">
        Last check: {s.run_at?.slice(0, 16).replace("T", " ")}
      </div>
    </div>
  );
}
