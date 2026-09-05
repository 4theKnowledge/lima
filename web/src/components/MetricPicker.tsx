import { CATEGORICAL_METRICS, HIGH_IS_BAD, METRIC_OPTIONS, useUi } from "../store";
import { InfoTip } from "./InfoTip";
import { LEGEND_TIP, METRIC_TIP } from "../lib/copy";
import { CATEGORICAL_COLOUR, gradientCss } from "../lib/color";
import { useSettings } from "../settings";

function rgbaCss(c: readonly number[]): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(2)})`;
}

export function MetricPicker() {
  const metric = useUi((s) => s.metric);
  const setMetric = useUi((s) => s.setMetric);
  const { palette } = useSettings();
  const cat = CATEGORICAL_COLOUR[palette];
  return (
    <section>
      <div className="flex items-center gap-1.5 mb-1">
        <div className="field-label !mb-0">Colour by</div>
        <InfoTip>{METRIC_TIP[metric]}</InfoTip>
      </div>
      <select
        value={metric}
        onChange={(e) => setMetric(e.target.value as typeof metric)}
        className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-emerald-400/40"
      >
        {METRIC_OPTIONS.map((o) => (
          <option key={o.value} value={o.value} className="bg-neutral-900">
            {o.label}
          </option>
        ))}
      </select>
      <div className="mt-3 space-y-1 text-[11px]">
        <div className="field-label">Legend</div>
        {CATEGORICAL_METRICS.has(metric) ? (
          <>
            <Swatch
              color={rgbaCss(cat.proclaimed)}
              label="Proclaimed (licence required)"
              tip={LEGEND_TIP.proclaimed}
            />
            <Swatch
              color={rgbaCss(cat.unproclaimed)}
              label="Unproclaimed (no licence)"
              tip={LEGEND_TIP.unproclaimed}
            />
          </>
        ) : HIGH_IS_BAD.has(metric) ? (
          <RampSwatch label="Higher = worse" invert />
        ) : (
          <RampSwatch label="Higher = better" />
        )}
        <Swatch color="rgb(140,140,140)" label="Excluded (Stage 1 hard mask)" tip={LEGEND_TIP.excluded} />
        <Swatch color="rgba(100,180,200,0.45)" label="No data" tip={LEGEND_TIP.noData} />
      </div>
    </section>
  );
}

function Swatch({ color, label, tip }: { color: string; label: string; tip?: string }) {
  return (
    <div className="flex items-center gap-2 text-panel-muted">
      <span
        className="inline-block h-3 w-6 rounded shrink-0"
        style={{ background: color }}
      />
      <span className="flex items-center gap-1.5">
        {label}
        {tip && <InfoTip>{tip}</InfoTip>}
      </span>
    </div>
  );
}

function RampSwatch({ label, invert = false }: { label: string; invert?: boolean }) {
  const { palette } = useSettings();
  return (
    <div className="flex items-center gap-2 text-panel-muted">
      <span
        className="inline-block h-3 w-16 rounded shrink-0"
        style={{ background: gradientCss(palette, invert) }}
      />
      <span>{label}</span>
    </div>
  );
}
