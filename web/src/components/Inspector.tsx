/**
 * Cell inspector. Everything an operator needs to reason about a hex —
 * headline suitability, factor decomposition, all raw inputs, parcel stats.
 *
 * When a compare (B) cell is pinned via shift-click, this renders three
 * columns: A, B, and Δ. Δ colouring assumes higher-is-better for
 * suitability + factor sub-scores; other rows just show the raw diff.
 */

import { useHexDetail, useParcelSummary } from "../hooks";
import { normalisedWeights, useUi } from "../store";
import { FACTOR_ORDER } from "../types";
import type { HexDetail } from "../types";
import { liveScore } from "../lib/score";
import { InfoTip } from "./InfoTip";
import { INSPECTOR_TIP, INSPECTOR_TIP_SOURCE } from "../lib/copy";
import { cn } from "../lib/cn";
import {
  areaHelpTip,
  areaTooltip,
  formatArea,
  formatDistance,
  useSettings,
} from "../settings";

export function Inspector() {
  const selectedH3 = useUi((s) => s.selectedH3);
  const compareH3 = useUi((s) => s.compareH3);
  const setCompareH3 = useUi((s) => s.setCompareH3);
  const weights = useUi((s) => s.weights);
  const { units } = useSettings();
  const { data: cellA, isLoading: loadingA } = useHexDetail(selectedH3);
  const { data: cellB } = useHexDetail(compareH3);
  const { data: parcelsA } = useParcelSummary(selectedH3);

  if (!selectedH3) {
    return (
      <div className="text-xs text-panel-muted leading-relaxed">
        Click a hex to inspect. Or search a place from the left panel.
        <div className="mt-2">
          Tip: <span className="font-mono text-panel-fg">shift+click</span>{" "}
          another hex to compare two cells side by side.
        </div>
      </div>
    );
  }

  if (loadingA || !cellA)
    return <div className="text-xs text-panel-muted">Loading…</div>;

  const compareMode = !!(compareH3 && cellB);

  const suitA = weights ? liveScore(cellA, weights) : cellA.suitability_score;
  const suitB = compareMode && cellB && weights ? liveScore(cellB, weights) : null;
  const norm = weights ? normalisedWeights(weights) : null;

  return (
    <div className="space-y-4">
      {/* Compare-mode banner */}
      {compareMode && (
        <div className="flex items-center justify-between rounded-md border border-white/10 bg-amber-500/10 px-2.5 py-1.5 text-[11px]">
          <span>
            <span className="text-white font-medium">A</span> vs{" "}
            <span className="text-amber-300 font-medium">B</span> — Δ shown per row
          </span>
          <button
            className="text-panel-muted hover:text-panel-fg"
            onClick={() => setCompareH3(null)}
            title="Unpin B"
          >
            ✕
          </button>
        </div>
      )}

      {/* Headline suitability */}
      <div>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-panel-muted">
          Suitability
          <InfoTip>{INSPECTOR_TIP.suitability}</InfoTip>
        </div>
        {compareMode && cellB ? (
          <TripleValue
            a={fmtSuit(cellA, suitA)}
            b={fmtSuit(cellB, suitB)}
            delta={deltaFmt(suitA, suitB)}
            deltaTone={deltaTone(suitA, suitB, "higher-better")}
            large
          />
        ) : (
          <>
            <div className="text-3xl font-semibold font-mono">
              {suitA != null ? suitA.toFixed(3) : cellA.excluded ? "—" : "n/a"}
            </div>
            {cellA.excluded && (
              <div className="text-xs text-amber-300 mt-1">
                Excluded: {cellA.exclusion_reasons?.join(", ") ?? "—"}
              </div>
            )}
            {!cellA.excluded && suitA == null && (
              <div className="text-xs text-panel-muted mt-1">
                No score — one or more inputs missing.
              </div>
            )}
          </>
        )}
      </div>

      {/* Score decomposition (A only in compare — B's factors go inline) */}
      {!cellA.excluded && norm && (
        <section>
          <div className="flex items-center gap-1.5 mb-1">
            <div className="field-label !mb-0">Score decomposition</div>
            <InfoTip>{INSPECTOR_TIP.decomposition}</InfoTip>
          </div>
          <div className="space-y-1">
            {FACTOR_ORDER.map((f) => {
              const valA = cellA[`factor_${f}` as const];
              const valB = compareMode && cellB ? cellB[`factor_${f}` as const] : null;
              const weight = norm[f];
              if (compareMode && cellB) {
                return (
                  <TripleRow
                    key={f}
                    label={
                      <span className="capitalize">
                        {f}{" "}
                        <span className="text-panel-muted">
                          · w {(weight * 100).toFixed(0)}%
                        </span>
                      </span>
                    }
                    a={valA != null ? valA.toFixed(2) : "—"}
                    b={valB != null ? valB.toFixed(2) : "—"}
                    delta={deltaFmt(valA, valB)}
                    deltaTone={deltaTone(valA, valB, "higher-better")}
                    mono
                  />
                );
              }
              const contrib = valA != null ? valA * weight : null;
              return (
                <div key={f} className="flex justify-between text-xs">
                  <span className="capitalize">
                    {f}{" "}
                    <span className="text-panel-muted">
                      · w {(weight * 100).toFixed(0)}%
                    </span>
                  </span>
                  <span className="font-mono">
                    {valA != null ? valA.toFixed(2) : "—"}
                    {contrib != null && (
                      <span className="text-emerald-300 ml-2">
                        +{contrib.toFixed(3)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Location */}
      <section className="space-y-1">
        <div className="field-label">Location</div>
        <Row
          label="LGA"
          tip={INSPECTOR_TIP.lga}
          a={cellA.lga ?? "—"}
          b={compareMode && cellB ? cellB.lga ?? "—" : undefined}
        />
        <Row
          label="H3"
          tip={INSPECTOR_TIP.h3}
          a={<span className="font-mono text-[11px]">{cellA.h3}</span>}
          b={
            compareMode && cellB ? (
              <span className="font-mono text-[11px]">{cellB.h3}</span>
            ) : undefined
          }
        />
      </section>

      {/* Water */}
      <section className="space-y-1">
        <div className="field-label">Water</div>
        <Row
          label="Groundwater"
          tip={INSPECTOR_TIP.groundwater}
          source={INSPECTOR_TIP_SOURCE.groundwater}
          a={gwText(cellA)}
          b={compareMode && cellB ? gwText(cellB) : undefined}
        />
        <Row
          label="Surface water"
          tip={INSPECTOR_TIP.surfaceWater}
          source={INSPECTOR_TIP_SOURCE.surfaceWater}
          a={cellA.sw_proclaimed ? "Proclaimed" : "Unproclaimed"}
          b={
            compareMode && cellB
              ? cellB.sw_proclaimed
                ? "Proclaimed"
                : "Unproclaimed"
              : undefined
          }
        />
        <Row
          label="Salinity"
          tip={INSPECTOR_TIP.salinity}
          source={INSPECTOR_TIP_SOURCE.salinity}
          a={salText(cellA)}
          b={compareMode && cellB ? salText(cellB) : undefined}
        />
      </section>

      {/* Land */}
      <section className="space-y-1">
        <div className="field-label">Land</div>
        <Row
          label="Grazing capability"
          tip={INSPECTOR_TIP.capabilityConfidence}
          source={INSPECTOR_TIP_SOURCE.capabilityConfidence}
          a={capText(cellA)}
          b={compareMode && cellB ? capText(cellB) : undefined}
        />
        <Row
          label="Bushfire prone"
          tip={INSPECTOR_TIP.bushfire}
          source={INSPECTOR_TIP_SOURCE.bushfire}
          a={fracText(cellA.bushfire_prone_frac, "of cell")}
          b={
            compareMode && cellB
              ? fracText(cellB.bushfire_prone_frac, "of cell")
              : undefined
          }
        />
        <Row
          label="DBCA estate"
          tip={INSPECTOR_TIP.dbca}
          source={INSPECTOR_TIP_SOURCE.dbca}
          a={dbcaText(cellA)}
          b={compareMode && cellB ? dbcaText(cellB) : undefined}
        />
        <Row
          label="Population density"
          tip={INSPECTOR_TIP.popDensity}
          source={INSPECTOR_TIP_SOURCE.popDensity}
          a={popDensityText(cellA.pop_density_per_km2)}
          b={compareMode && cellB ? popDensityText(cellB.pop_density_per_km2) : undefined}
        />
      </section>

      {/* Access */}
      <section className="space-y-1">
        <div className="field-label">Access</div>
        <Row
          label="Nearest town"
          tip={INSPECTOR_TIP.townDist}
          source={INSPECTOR_TIP_SOURCE.townDist}
          a={distText(cellA.nearest_townsite_name, cellA.dist_townsite_km, units)}
          b={
            compareMode && cellB
              ? distText(
                  cellB.nearest_townsite_name,
                  cellB.dist_townsite_km,
                  units,
                )
              : undefined
          }
        />
        <Row
          label="Nearest sealed road"
          tip={INSPECTOR_TIP.roadDist}
          source={INSPECTOR_TIP_SOURCE.roadDist}
          a={distText(
            cellA.nearest_sealed_road_name,
            cellA.dist_sealed_road_km,
            units,
          )}
          b={
            compareMode && cellB
              ? distText(
                  cellB.nearest_sealed_road_name,
                  cellB.dist_sealed_road_km,
                  units,
                )
              : undefined
          }
        />
      </section>

      {/* Climate */}
      <section className="space-y-1">
        <div className="field-label">Climate</div>
        <Row
          label="Rain (May-Oct 91–20)"
          tip={INSPECTOR_TIP.rainMean}
          source={INSPECTOR_TIP_SOURCE.rainMean}
          a={cellA.gsr_mean_mm != null ? `${cellA.gsr_mean_mm.toFixed(0)} mm` : "—"}
          b={
            compareMode && cellB
              ? cellB.gsr_mean_mm != null
                ? `${cellB.gsr_mean_mm.toFixed(0)} mm`
                : "—"
              : undefined
          }
        />
        <Row
          label="Rain trend (since 1970)"
          tip={INSPECTOR_TIP.rainTrend}
          source={INSPECTOR_TIP_SOURCE.rainTrend}
          a={trendText(cellA.gsr_trend)}
          b={compareMode && cellB ? trendText(cellB.gsr_trend) : undefined}
        />
        <Row
          label="Summer max (Dec-Feb)"
          tip={INSPECTOR_TIP.summerMax}
          source={INSPECTOR_TIP_SOURCE.summerMax}
          a={tempText(cellA.summer_max_temp_c)}
          b={compareMode && cellB ? tempText(cellB.summer_max_temp_c) : undefined}
        />
        <Row
          label="Winter min (Jun-Aug)"
          tip={INSPECTOR_TIP.winterMin}
          source={INSPECTOR_TIP_SOURCE.winterMin}
          a={tempText(cellA.winter_min_temp_c)}
          b={compareMode && cellB ? tempText(cellB.winter_min_temp_c) : undefined}
        />
        <Row
          label="Summer max trend (since 1970)"
          tip={INSPECTOR_TIP.summerMaxTrend}
          source={INSPECTOR_TIP_SOURCE.summerMaxTrend}
          a={tempTrendText(cellA.summer_max_trend_c_per_decade)}
          b={compareMode && cellB ? tempTrendText(cellB.summer_max_trend_c_per_decade) : undefined}
        />
        <Row
          label="Winter min trend (since 1970)"
          tip={INSPECTOR_TIP.winterMinTrend}
          source={INSPECTOR_TIP_SOURCE.winterMinTrend}
          a={tempTrendText(cellA.winter_min_trend_c_per_decade)}
          b={compareMode && cellB ? tempTrendText(cellB.winter_min_trend_c_per_decade) : undefined}
        />
        <Row
          label="Evaporation (annual)"
          tip={INSPECTOR_TIP.evap}
          source={INSPECTOR_TIP_SOURCE.evap}
          a={cellA.evap_annual_mm != null ? `${cellA.evap_annual_mm.toFixed(0)} mm` : "—"}
          b={
            compareMode && cellB
              ? cellB.evap_annual_mm != null
                ? `${cellB.evap_annual_mm.toFixed(0)} mm`
                : "—"
              : undefined
          }
        />
        <Row
          label="Solar radiation"
          tip={INSPECTOR_TIP.solar}
          source={INSPECTOR_TIP_SOURCE.solar}
          a={
            cellA.solar_annual_mj != null
              ? `${cellA.solar_annual_mj.toFixed(1)} MJ/m²/day`
              : "—"
          }
          b={
            compareMode && cellB
              ? cellB.solar_annual_mj != null
                ? `${cellB.solar_annual_mj.toFixed(1)} MJ/m²/day`
                : "—"
              : undefined
          }
        />
        <Row
          label="Vapour pressure"
          tip={INSPECTOR_TIP.vp}
          source={INSPECTOR_TIP_SOURCE.vp}
          a={cellA.vp_annual_hpa != null ? `${cellA.vp_annual_hpa.toFixed(1)} hPa` : "—"}
          b={
            compareMode && cellB
              ? cellB.vp_annual_hpa != null
                ? `${cellB.vp_annual_hpa.toFixed(1)} hPa`
                : "—"
              : undefined
          }
        />
      </section>

      {/* Parcels — kept single-cell for now; B's parcel summary would need
          a second /parcels call, cheap but not doing it in the same round. */}
      {!compareMode && (
        <section className="space-y-1">
          <div className="flex items-center gap-1.5 mb-1">
            <div className="field-label !mb-0">Parcels in cell</div>
            <InfoTip source={INSPECTOR_TIP_SOURCE.parcels}>
              {INSPECTOR_TIP.parcels}
            </InfoTip>
          </div>
          <Row
            label="Count"
            a={cellA.parcel_count?.toString() ?? "—"}
          />
          <Row
            label="Median area"
            a={<AreaValue ha={cellA.parcel_area_median_ha} digits={2} />}
          />
          {parcelsA && (
            <>
              <Row
                label="Total area"
                tip={INSPECTOR_TIP.parcelsTotal}
                a={<AreaValue ha={parcelsA.total_ha} digits={1} />}
              />
              <Row
                label="Range"
                tip={INSPECTOR_TIP.parcelsRange}
                a={
                  parcelsA.min_ha != null && parcelsA.max_ha != null ? (
                    <span className="inline-flex items-center gap-1.5">
                      {formatArea(parcelsA.min_ha, 2, units)}–
                      {formatArea(parcelsA.max_ha, 2, units)}
                      <InfoTip>{areaHelpTip(units)}</InfoTip>
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ---------- helpers ----------

/**
 * Render an area value in the user's chosen units with a ⓘ that expands to
 * the m²/ft² conversion for that specific area. The generic help tip lives
 * on the field label; this one gives the number for this value.
 */
function AreaValue({
  ha,
  digits = 2,
}: {
  ha: number | null | undefined;
  digits?: number;
}) {
  const { units } = useSettings();
  if (ha == null) return <>—</>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {formatArea(ha, digits, units)}
      <InfoTip>{areaTooltip(ha, units)}</InfoTip>
    </span>
  );
}

function fmtSuit(cell: HexDetail, v: number | null | undefined): string {
  if (v != null) return v.toFixed(3);
  if (cell.excluded) return "—";
  return "n/a";
}

function gwText(c: HexDetail): string {
  return c.gw_proclaimed
    ? `Proclaimed${c.gw_area_name ? ` — ${c.gw_area_name}` : ""}`
    : "Unproclaimed";
}
function salText(c: HexDetail): string {
  return c.salinity_tds_class
    ? `${c.salinity_tds_class} mg/L (${c.salinity_idx}/7)`
    : "—";
}
function capText(c: HexDetail): string {
  if (!c.lc_graz_raw) return "—";
  const conf =
    c.capability_confidence != null
      ? ` (${(c.capability_confidence * 100).toFixed(0)}%)`
      : "";
  return `${c.lc_graz_raw}${conf}`;
}
function dbcaText(c: HexDetail): string {
  if (c.dbca_estate_frac == null || c.dbca_estate_frac <= 0) return "—";
  return `${(c.dbca_estate_frac * 100).toFixed(0)}%${c.dbca_category ? ` — ${c.dbca_category}` : ""}`;
}
function fracText(v: number | null | undefined, suffix: string): string {
  return v != null ? `${(v * 100).toFixed(0)}% ${suffix}` : "—";
}
function distText(
  name: string | null,
  km: number | null | undefined,
  units: "metric" | "imperial",
): string {
  return name && km != null ? `${name} (${formatDistance(km, 1, units)})` : "—";
}
function trendText(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)} mm/decade`;
}
function tempText(v: number | null | undefined): string {
  return v != null ? `${v.toFixed(1)} °C` : "—";
}
function tempTrendText(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)} °C/decade`;
}
function popDensityText(v: number | null | undefined): string {
  if (v == null) return "—";
  // Sub-1 needs 2 dp to distinguish rural cells; ≥10 rounds to whole.
  const digits = v >= 10 ? 0 : v >= 1 ? 1 : 2;
  return `${v.toFixed(digits)} /km²`;
}

function deltaFmt(
  a: number | null | undefined,
  b: number | null | undefined,
): string {
  if (a == null || b == null) return "—";
  const d = b - a;
  return `${d >= 0 ? "+" : ""}${d.toFixed(2)}`;
}
function deltaTone(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: "higher-better",
): string {
  if (a == null || b == null) return "text-panel-muted";
  const d = b - a;
  if (Math.abs(d) < 0.005) return "text-panel-muted";
  const better = dir === "higher-better" ? d > 0 : d < 0;
  return better ? "text-emerald-300" : "text-red-300";
}

function Row({
  label,
  tip,
  source,
  a,
  b,
}: {
  label: React.ReactNode;
  tip?: string;
  source?: import("../lib/copy").SourceKey;
  a: React.ReactNode;
  b?: React.ReactNode;
}) {
  if (b === undefined) {
    return (
      <div className="flex justify-between gap-4 text-xs">
        <span className="text-panel-muted flex items-center gap-1.5 min-w-0">
          <span className="truncate">{label}</span>
          {tip && <InfoTip source={source}>{tip}</InfoTip>}
        </span>
        <span className="text-right shrink-0">{a}</span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center text-xs">
      <span className="text-panel-muted flex items-center gap-1.5 min-w-0">
        <span className="truncate">{label}</span>
        {tip && <InfoTip source={source}>{tip}</InfoTip>}
      </span>
      <span className="text-right text-white">{a}</span>
      <span className="text-right text-amber-300">{b}</span>
    </div>
  );
}

function TripleRow({
  label,
  a,
  b,
  delta,
  deltaTone,
  mono,
}: {
  label: React.ReactNode;
  a: string;
  b: string;
  delta: string;
  deltaTone: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center text-xs">
      <span className="text-panel-muted min-w-0 truncate">{label}</span>
      <span className={cn("text-right", mono && "font-mono", "text-white")}>{a}</span>
      <span className={cn("text-right", mono && "font-mono", "text-amber-300")}>
        {b}
      </span>
      <span className={cn("text-right", mono && "font-mono", deltaTone)}>{delta}</span>
    </div>
  );
}

function TripleValue({
  a,
  b,
  delta,
  deltaTone,
  large,
}: {
  a: string;
  b: string;
  delta: string;
  deltaTone: string;
  large?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 items-baseline">
      <div>
        <div className="text-[10px] text-panel-muted">A</div>
        <div className={cn("font-mono font-semibold", large ? "text-2xl" : "text-sm")}>
          {a}
        </div>
      </div>
      <div>
        <div className="text-[10px] text-amber-300">B</div>
        <div className={cn("font-mono font-semibold text-amber-300", large ? "text-2xl" : "text-sm")}>
          {b}
        </div>
      </div>
      <div>
        <div className="text-[10px] text-panel-muted">Δ</div>
        <div className={cn("font-mono font-semibold", large ? "text-2xl" : "text-sm", deltaTone)}>
          {delta}
        </div>
      </div>
    </div>
  );
}
