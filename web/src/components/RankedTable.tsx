import { useMemo } from "react";

import { useHex } from "../hooks";
import { applyLiveScoring } from "../lib/score";
import { HIGH_IS_BAD, METRIC_OPTIONS, useUi, type Metric } from "../store";
import { cn } from "../lib/cn";
import { useMedia } from "../lib/useMedia";

type Col = {
  k: string;
  label: string;
  mono?: boolean;
  w: string;
  fmt?: number;
};

// Fixed columns always shown. If the currently-sorted metric isn't in this
// list, we inject a synthesised column for it just after LGA so the value
// driving the sort is visible.
const BASE_COLS: Col[] = [
  { k: "h3", label: "H3", mono: true, w: "w-24" },
  { k: "lga", label: "LGA", w: "" },
  { k: "suitability_score", label: "Suit", mono: true, w: "w-16", fmt: 3 },
  { k: "factor_water", label: "W", mono: true, w: "w-12", fmt: 2 },
  { k: "factor_rainfall", label: "R", mono: true, w: "w-12", fmt: 2 },
  { k: "factor_soil", label: "S", mono: true, w: "w-12", fmt: 2 },
  { k: "factor_access", label: "A", mono: true, w: "w-12", fmt: 2 },
  { k: "factor_bushfire", label: "B", mono: true, w: "w-12", fmt: 2 },
  { k: "parcel_count", label: "Parcels", mono: true, w: "w-16" },
];

// Column spec for metrics we might sort by but aren't in BASE_COLS. Short
// labels + fmt digits chosen to fit the narrow ranking panel.
const METRIC_COL_SPEC: Partial<Record<Metric, { label: string; fmt?: number; w?: string }>> = {
  parcel_area_median_ha: { label: "Med ha", fmt: 1, w: "w-16" },
  gw_proclaimed:         { label: "GW", w: "w-14" },
  sw_proclaimed:         { label: "SW", w: "w-14" },
  salinity_idx:          { label: "Sal", fmt: 0, w: "w-12" },
  bushfire_prone_frac:   { label: "BPA", fmt: 2, w: "w-14" },
  capability_class:      { label: "Cap", fmt: 0, w: "w-12" },
  dist_townsite_km:      { label: "Town km", fmt: 1, w: "w-16" },
  dist_sealed_road_km:   { label: "Road km", fmt: 1, w: "w-16" },
  dbca_estate_frac:      { label: "DBCA", fmt: 2, w: "w-14" },
  gsr_mean_mm:           { label: "Rain mm", fmt: 0, w: "w-16" },
  gsr_trend:             { label: "Trend", fmt: 1, w: "w-14" },
  summer_max_temp_c:     { label: "Smr°C", fmt: 1, w: "w-14" },
  winter_min_temp_c:     { label: "Wtr°C", fmt: 1, w: "w-14" },
  evap_annual_mm:        { label: "Evap", fmt: 0, w: "w-16" },
  solar_annual_mj:       { label: "Solar", fmt: 1, w: "w-14" },
  vp_annual_hpa:         { label: "VP", fmt: 1, w: "w-14" },
  summer_max_trend_c_per_decade: { label: "Smr trend", fmt: 2, w: "w-20" },
  winter_min_trend_c_per_decade: { label: "Wtr trend", fmt: 2, w: "w-20" },
  pop_density_per_km2:   { label: "Pop /km²", fmt: 1, w: "w-20" },
};

export function RankedTable() {
  const { data: rows } = useHex();
  const metric = useUi((s) => s.metric);
  const weights = useUi((s) => s.weights);
  const selectHex = useUi((s) => s.selectHex);
  const selectedH3 = useUi((s) => s.selectedH3);
  const isMobile = useMedia("(max-width: 640px)");

  const top = useMemo(() => {
    if (!rows) return [];
    const rescored = applyLiveScoring(rows, weights);
    const asc = HIGH_IS_BAD.has(metric);
    return rescored
      .filter((r) => r[metric] != null)
      .sort((a, b) => {
        const av = a[metric] as number;
        const bv = b[metric] as number;
        return asc ? av - bv : bv - av;
      })
      .slice(0, 30);
  }, [rows, metric, weights]);

  const metricLabel =
    METRIC_OPTIONS.find((m) => m.value === metric)?.label ?? metric;

  // Assemble columns for this render. If the sorted metric already lives in
  // BASE_COLS just highlight the existing header; otherwise inject a new
  // column right after LGA so the number driving the sort is visible.
  const cols = useMemo(() => {
    const inBase = BASE_COLS.some((c) => c.k === metric);
    if (inBase) return BASE_COLS;
    const spec = METRIC_COL_SPEC[metric];
    if (!spec) return BASE_COLS;
    const injected: Col = {
      k: metric,
      label: spec.label,
      mono: true,
      w: spec.w ?? "w-16",
      fmt: spec.fmt,
    };
    // Insert after LGA (index 1).
    return [...BASE_COLS.slice(0, 2), injected, ...BASE_COLS.slice(2)];
  }, [metric]);

  const downloadCsv = () => {
    // Always-included columns + the current sort metric (if not already in
    // the fixed set). Keeps the CSV self-describing about the sort.
    const baseHeaders = [
      "h3",
      "lga",
      "suitability_score",
      "factor_water",
      "factor_rainfall",
      "factor_soil",
      "factor_access",
      "factor_bushfire",
      "parcel_count",
      "parcel_area_median_ha",
      "excluded",
    ];
    const headers = baseHeaders.includes(metric)
      ? baseHeaders
      : [...baseHeaders, metric];
    const lines = [
      headers.join(","),
      ...top.map((r) =>
        headers
          .map((h) => {
            const v = (r as unknown as Record<string, unknown>)[h];
            if (v == null) return "";
            const s = String(v);
            return s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `top_cells_by_${metric}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-1 pb-2">
        <div className="text-xs text-panel-muted">
          Top 30 by <span className="text-panel-fg">{metricLabel}</span> · {top.length} rows
        </div>
        <button className="hud-button" onClick={downloadCsv}>
          Download CSV
        </button>
      </div>
      {isMobile ? (
        <div className="flex-1 overflow-auto rounded-md border border-white/5 divide-y divide-white/5">
          {top.map((r, i) => {
            const sortedVal = r[metric];
            const sortedText =
              sortedVal == null
                ? "—"
                : typeof sortedVal === "number"
                  ? sortedVal.toFixed(
                      METRIC_COL_SPEC[metric]?.fmt ??
                        (metric === "suitability_score" ? 3 : 2),
                    )
                  : String(sortedVal);
            const suit = r.suitability_score;
            const isSuit = metric === "suitability_score";
            return (
              <button
                key={r.h3}
                onClick={() => selectHex(r.h3)}
                className={cn(
                  "w-full text-left px-3 py-2.5 flex items-center gap-3 transition",
                  r.h3 === selectedH3
                    ? "bg-emerald-500/10"
                    : "active:bg-white/5",
                )}
              >
                <div className="w-6 text-panel-muted font-mono text-[11px] tabular-nums shrink-0">
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-panel-fg truncate">
                    {r.lga ?? "—"}
                  </div>
                  <div className="text-[10px] text-panel-muted font-mono truncate">
                    {r.h3}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[10px] uppercase tracking-wider text-panel-muted leading-tight">
                    {isSuit ? "Suit" : metricLabel.split(":")[0].slice(0, 12)}
                  </div>
                  <div className="text-sm font-mono font-semibold text-emerald-200 tabular-nums leading-tight">
                    {sortedText}
                  </div>
                  {!isSuit && suit != null && (
                    <div className="text-[10px] text-panel-muted font-mono tabular-nums">
                      suit {suit.toFixed(2)}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
      <div className="flex-1 overflow-auto rounded-md border border-white/5">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-neutral-900/95 backdrop-blur">
            <tr>
              {cols.map((c) => {
                const isSorted = c.k === metric;
                return (
                  <th
                    key={c.k}
                    className={cn(
                      "px-2 py-1.5 text-left font-medium uppercase tracking-wider text-[10px]",
                      c.w,
                      isSorted
                        ? "text-emerald-200 border-b border-emerald-400/60"
                        : "text-panel-muted",
                    )}
                    title={isSorted ? "Sorted by this column" : undefined}
                  >
                    {c.label}
                    {isSorted && (
                      <span className="ml-0.5 text-emerald-400">
                        {HIGH_IS_BAD.has(metric) ? " ↑" : " ↓"}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr
                key={r.h3}
                onClick={() => selectHex(r.h3)}
                className={cn(
                  "cursor-pointer hover:bg-white/5 border-t border-white/5",
                  r.h3 === selectedH3 && "bg-emerald-500/10",
                )}
              >
                {cols.map((c) => {
                  const v = (r as unknown as Record<string, unknown>)[c.k];
                  let text = "—";
                  if (v != null) {
                    text =
                      typeof v === "number" && c.fmt !== undefined
                        ? v.toFixed(c.fmt)
                        : String(v);
                  }
                  const isSorted = c.k === metric;
                  return (
                    <td
                      key={c.k}
                      className={cn(
                        "px-2 py-1",
                        c.mono && "font-mono",
                        isSorted && "bg-emerald-500/5 text-emerald-100",
                      )}
                      title={text}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
