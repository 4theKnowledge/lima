/**
 * Legend HUD — bottom-left of the map on all screen sizes. Three sections
 * stacked in a single translucent panel:
 *
 *   1. Purpose quick-switcher (mirrors PurposePicker, minus the edit UI)
 *   2. Color-by (metric) quick-switcher (mirrors MetricPicker)
 *   3. Colour ramp: gradient bar with vmin/vmax labels for continuous
 *      metrics, or two categorical swatches. A small ⓘ toggle reveals
 *      the reserved colours (Excluded / No data) in a popover.
 *
 * Reads the same store state the map uses, so metric / palette / weight
 * changes propagate here instantly with no extra fetches.
 */

import { useMemo, useState } from "react";

import { useHex, useApplyPurpose, usePurposes, useWeights } from "../hooks";
import { useMedia } from "../lib/useMedia";
import {
  CATEGORICAL_METRICS,
  HIGH_IS_BAD,
  METRIC_GROUPS,
  METRIC_OPTIONS,
  useUi,
  type Metric,
} from "../store";
import type { Purpose, Weights } from "../types";
import { FACTOR_ORDER } from "../types";
import { applyLiveScoring, metricRange } from "../lib/score";
import {
  CATEGORICAL_COLOUR,
  EXCLUDED_COLOUR,
  NO_DATA_COLOUR,
  gradientCss,
  type RGBA,
} from "../lib/color";
import { formatMetricValue } from "../lib/metricValue";
import { useSettings } from "../settings";
import { cn } from "../lib/cn";

export function Legend() {
  const metric = useUi((s) => s.metric);
  const setMetric = useUi((s) => s.setMetric);
  const weights = useUi((s) => s.weights);
  const panelOpen = useUi((s) => s.panelOpen);
  const { palette } = useSettings();
  const { data: rows } = useHex();
  const { data: purposes } = usePurposes();
  const { data: currentWeights } = useWeights();
  const applyPurpose = useApplyPurpose();
  const [reservedOpen, setReservedOpen] = useState(false);
  const isMobile = useMedia("(max-width: 640px)");

  // NOTE: all hooks must be called before any early return, otherwise
  // React throws "rendered fewer hooks" (#310) when isMobile+panelOpen
  // flips. Keep the useMemo/useState calls above the null-guard.
  const cells = useMemo(
    () => (rows ? applyLiveScoring(rows, weights) : []),
    [rows, weights],
  );

  const isCategorical = CATEGORICAL_METRICS.has(metric);
  const invert = HIGH_IS_BAD.has(metric);
  const [vmin, vmax] = useMemo(
    () => (isCategorical ? [0, 1] : metricRange(cells, metric)),
    [cells, metric, isCategorical],
  );

  const activePurposeId = useMemo(
    () => findActivePurpose(purposes, currentWeights)?.id ?? "",
    [purposes, currentWeights],
  );

  const metricLabel =
    METRIC_OPTIONS.find((m) => m.value === metric)?.label ?? metric;

  // On mobile the bottom sheet covers the legend when open. Skip the
  // render entirely (all hooks above have already run).
  if (isMobile && panelOpen) return null;

  return (
    <aside
      className={cn(
        "panel absolute left-4 z-20 max-w-[calc(100vw-2rem)] pointer-events-auto",
        // Tighter footprint on mobile — icons replace the label column
        // and text drops a step, so we can shave ~40px off the width.
        isMobile ? "w-[240px] p-2 space-y-1.5" : "w-[280px] p-2.5 space-y-2",
      )}
      style={{
        // On mobile, clear the sheet peek strip (~110px worst-case with
        // SelectionHeader). On desktop, sit near the map edge.
        bottom: isMobile ? 120 : 16,
      }}
      aria-label="Map legend and layer switcher"
    >
      {/* Purpose row */}
      {purposes && purposes.length > 0 && (
        <Row
          label="Purpose"
          icon={<IconPurpose />}
          compact={isMobile}
          tooltip="Purpose preset"
        >
          <select
            className={cn(
              "min-w-0 flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 truncate",
              isMobile ? "text-[11px]" : "text-xs",
            )}
            value={activePurposeId}
            disabled={applyPurpose.isPending}
            onChange={(e) => {
              const pid = e.target.value;
              if (pid) applyPurpose.mutate(pid);
            }}
          >
            {!activePurposeId && (
              <option value="">Custom (no preset)</option>
            )}
            {purposes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Row>
      )}

      {/* Color-by (metric) row */}
      <Row
        label="Colour"
        icon={<IconPalette />}
        compact={isMobile}
        tooltip="Colour the map by"
      >
        <select
          className={cn(
            "min-w-0 flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 truncate",
            isMobile ? "text-[11px]" : "text-xs",
          )}
          value={metric}
          onChange={(e) => setMetric(e.target.value as Metric)}
        >
          {METRIC_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option
                  key={o.value}
                  value={o.value}
                  disabled={o.disabled}
                >
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Row>

      {/* Colour ramp */}
      <div className="pt-1 border-t border-white/5">
        {isCategorical ? (
          <CategoricalSwatches metric={metric} />
        ) : (
          <ContinuousRamp
            palette={palette}
            invert={invert}
            metric={metric}
            vmin={vmin}
            vmax={vmax}
          />
        )}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {/* Metric label is redundant with the Colour select on mobile
              — save the vertical space. Desktop keeps it as anchor text. */}
          {!isMobile ? (
            <div
              className="text-[10px] text-panel-muted truncate"
              title={metricLabel}
            >
              {metricLabel}
            </div>
          ) : (
            <span aria-hidden />
          )}
          <button
            type="button"
            className="h-5 px-1.5 rounded text-[10px] text-panel-muted hover:text-panel-fg hover:bg-white/10 transition shrink-0"
            onClick={() => setReservedOpen((v) => !v)}
            aria-expanded={reservedOpen}
            aria-label="Show reserved colours"
            title="Reserved colours"
          >
            {reservedOpen ? "hide" : "more"}
          </button>
        </div>
        {reservedOpen && (
          <div className="mt-1.5 pt-1.5 border-t border-white/5 space-y-1">
            <SwatchRow color={EXCLUDED_COLOUR} label="Excluded (Stage 1 mask)" />
            <SwatchRow color={NO_DATA_COLOUR} label="No data for this metric" />
          </div>
        )}
      </div>
    </aside>
  );
}

function Row({
  label,
  icon,
  compact,
  tooltip,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  compact: boolean;
  tooltip: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {compact ? (
        <span
          className="w-4 shrink-0 flex items-center justify-center text-panel-muted"
          title={tooltip}
          aria-label={label}
        >
          {icon}
        </span>
      ) : (
        <div className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-panel-muted">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

function IconPurpose() {
  // Compass/target — the "aim" of the analysis.
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconPalette() {
  // Stacked layers — "the layer painting the map".
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 3 21 8 12 13 3 8 12 3" />
      <polyline points="3 13 12 18 21 13" />
      <polyline points="3 18 12 23 21 18" />
    </svg>
  );
}

function ContinuousRamp({
  palette,
  invert,
  metric,
  vmin,
  vmax,
}: {
  palette: ReturnType<typeof useSettings>["palette"];
  invert: boolean;
  metric: Metric;
  vmin: number;
  vmax: number;
}) {
  const same = vmin === vmax;
  return (
    <div>
      <div
        className="h-2.5 w-full rounded"
        style={{ background: gradientCss(palette, invert) }}
        aria-hidden
      />
      <div className="mt-1 flex items-center justify-between text-[10px] font-mono tabular-nums text-panel-fg">
        <span>{same ? "—" : formatMetricValue(metric, vmin)}</span>
        <span className="text-panel-muted text-[9px]">
          {invert ? "high = worse" : "high = better"}
        </span>
        <span>{same ? "—" : formatMetricValue(metric, vmax)}</span>
      </div>
    </div>
  );
}

function CategoricalSwatches({ metric }: { metric: Metric }) {
  const { palette } = useSettings();
  const c = CATEGORICAL_COLOUR[palette];
  const isGw = metric === "gw_proclaimed";
  const isSw = metric === "sw_proclaimed";
  const which = isGw ? "Groundwater" : isSw ? "Surface water" : "Layer";
  return (
    <div className="space-y-1">
      <SwatchRow color={c.proclaimed} label={`${which}: proclaimed`} />
      <SwatchRow color={c.unproclaimed} label={`${which}: unproclaimed`} />
    </div>
  );
}

function SwatchRow({ color, label }: { color: RGBA; label: string }) {
  const [r, g, b, a] = color;
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-3 w-4 rounded shrink-0 border border-white/10"
        style={{ background: `rgba(${r},${g},${b},${a / 255})` }}
        aria-hidden
      />
      <span className="text-[10px] text-panel-muted truncate">{label}</span>
    </div>
  );
}

/**
 * Which Purpose (if any) matches the currently-applied server config?
 * Compares weights within a tiny epsilon; nothing matches → returns null
 * so the selector shows "Custom".
 */
function findActivePurpose(
  purposes: Purpose[] | undefined,
  weights: Weights | undefined,
): Purpose | null {
  if (!purposes || !weights) return null;
  for (const p of purposes) {
    if (FACTOR_ORDER.every((k) => Math.abs(p.weights[k] - weights[k]) < 1e-6))
      return p;
  }
  return null;
}
