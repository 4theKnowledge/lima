/**
 * Purpose selector. Dropdown of named presets from scoring/purposes.yaml.
 *
 * Selecting a Purpose fires PUT /purpose/{id}/apply, which rewrites weights,
 * exclusions and the active scale curve server-side, then re-runs Stage 1
 * exclusion + Stage 2 score. On success TanStack Query invalidates the hex
 * slice, weights, exclusions caches → the map re-renders with the new score.
 *
 * The "Custom" badge appears when the operator has drifted from the loaded
 * preset (any weight or exclusion tweaked in-panel). Applying again re-loads
 * the preset, discarding local edits.
 */

import { useMemo } from "react";

import {
  useApplyPurpose,
  useExclusions,
  usePurposes,
  useWeights,
} from "../hooks";
import { useUi } from "../store";
import type { Exclusions, Purpose, Weights } from "../types";
import { FACTOR_ORDER } from "../types";
import { InfoTip } from "./InfoTip";
import { cn } from "../lib/cn";

export function PurposePicker() {
  const { data: purposes } = usePurposes();
  const { data: currentWeights } = useWeights();
  const { data: currentExclusions } = useExclusions();
  const uiWeights = useUi((s) => s.weights);
  const apply = useApplyPurpose();

  const active = useMemo(
    () => findActivePurpose(purposes, currentWeights, currentExclusions),
    [purposes, currentWeights, currentExclusions],
  );

  // "Dirty" here = the UI's weights have drifted from what's in weights.yaml.
  // We can't detect exclusion drift from this component alone; ExclusionsPanel
  // owns its own draft. Weight drift is the main signal the operator has moved
  // away from the preset, which is fine as a starting heuristic.
  const dirty = useMemo(() => {
    if (!uiWeights || !currentWeights) return false;
    return FACTOR_ORDER.some(
      (k) => Math.abs(uiWeights[k] - currentWeights[k]) > 1e-6,
    );
  }, [uiWeights, currentWeights]);

  if (!purposes) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5">
        <div className="field-label !mb-0">Purpose</div>
        <InfoTip>
          A Purpose bundles weights, exclusion thresholds, and the parcel-size
          curve into a preset. Choose one to reload the whole scoring model.
          Tweak weights or exclusions below and it becomes "Custom".
        </InfoTip>
      </div>
      <div className="flex items-center gap-2">
        <select
          className="flex-1 bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-xs"
          value={active?.id ?? ""}
          onChange={(e) => {
            const pid = e.target.value;
            if (pid) apply.mutate(pid);
          }}
          disabled={apply.isPending}
        >
          {active === null && (
            <option value="">Custom — no preset matches</option>
          )}
          {purposes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {dirty && active && (
          <span
            className="text-[10px] uppercase tracking-wider text-amber-300"
            title="Weights in the panel differ from the saved Purpose"
          >
            edited
          </span>
        )}
      </div>
      {active && (
        <p className="text-[11px] text-panel-muted leading-snug">
          {active.description}
        </p>
      )}
      {apply.isPending && (
        <p className="text-[11px] text-panel-muted">
          Applying preset — recomputing scores…
        </p>
      )}
      {apply.isError && (
        <p className="text-[11px] text-red-300">
          Failed to apply: {(apply.error as Error).message}
        </p>
      )}
      <button
        className={cn(
          "hud-button w-full justify-center text-xs",
          !active && "opacity-50",
        )}
        onClick={() => active && apply.mutate(active.id)}
        disabled={!active || apply.isPending || !dirty}
        title={
          dirty
            ? "Reload the current Purpose, discarding local weight edits"
            : "No edits to revert"
        }
      >
        Reload Purpose (discard edits)
      </button>
    </section>
  );
}

/**
 * Which Purpose matches the currently-applied server config? Match on weights
 * (exact within a tiny epsilon) — the strongest signal, and it's what the API
 * PUT overwrites atomically. If nothing matches, returns null → the selector
 * shows "Custom".
 */
function findActivePurpose(
  purposes: Purpose[] | undefined,
  weights: Weights | undefined,
  _exclusions: Exclusions | undefined,
): Purpose | null {
  if (!purposes || !weights) return null;
  for (const p of purposes) {
    if (weightsMatch(p.weights, weights)) return p;
  }
  return null;
}

function weightsMatch(a: Weights, b: Weights): boolean {
  return FACTOR_ORDER.every((k) => Math.abs(a[k] - b[k]) < 1e-6);
}
