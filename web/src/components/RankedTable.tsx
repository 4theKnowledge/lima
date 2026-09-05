import { useMemo } from "react";

import { useHex } from "../hooks";
import { applyLiveScoring } from "../lib/score";
import { HIGH_IS_BAD, METRIC_OPTIONS, useUi } from "../store";
import { cn } from "../lib/cn";

type Col = {
  k: string;
  label: string;
  mono?: boolean;
  w: string;
  fmt?: number;
};

const COLS: Col[] = [
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

export function RankedTable() {
  const { data: rows } = useHex();
  const metric = useUi((s) => s.metric);
  const weights = useUi((s) => s.weights);
  const selectHex = useUi((s) => s.selectHex);
  const selectedH3 = useUi((s) => s.selectedH3);

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

  const downloadCsv = () => {
    const headers = [
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
    a.download = "top_cells.csv";
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
      <div className="flex-1 overflow-auto rounded-md border border-white/5">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-neutral-900/95 backdrop-blur">
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.k}
                  className={cn(
                    "px-2 py-1.5 text-left font-medium text-panel-muted uppercase tracking-wider text-[10px]",
                    c.w,
                  )}
                >
                  {c.label}
                </th>
              ))}
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
                {COLS.map((c) => {
                  const v = (r as unknown as Record<string, unknown>)[c.k];
                  let text = "—";
                  if (v != null) {
                    text =
                      typeof v === "number" && c.fmt !== undefined
                        ? v.toFixed(c.fmt)
                        : String(v);
                  }
                  return (
                    <td
                      key={c.k}
                      className={cn("px-2 py-1", c.mono && "font-mono")}
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
    </div>
  );
}
