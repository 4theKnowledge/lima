import { useDataStatus, useSensitivity } from "../hooks";
import { cn } from "../lib/cn";

export function DataStatusPanel() {
  const { data } = useDataStatus();
  const { data: sens } = useSensitivity();

  if (!data) return <div className="text-xs text-panel-muted">Loading…</div>;

  const snap = new Date(data.snapshot_iso);
  const snapAgo = timeAgo(snap.getTime());

  return (
    <div className="space-y-4">
      <section>
        <div className="field-label">Snapshot</div>
        <div className="space-y-1 text-xs">
          <KV k="Last updated" v={`${snapAgo} ago`} />
          <KV k="At" v={snap.toLocaleString()} mono />
        </div>
      </section>

      <section>
        <div className="field-label">Coverage</div>
        <div className="space-y-1 text-xs">
          <KV k="Hex cells" v={data.hex_count.toLocaleString()} mono />
          <KV
            k="Fully scored"
            v={`${data.n_scored.toLocaleString()} (${pct(data.n_scored, data.hex_count)})`}
            mono
          />
          <KV
            k="Excluded"
            v={`${data.n_excluded.toLocaleString()} (${pct(data.n_excluded, data.hex_count)})`}
            mono
          />
          <KV k="Parcels" v={data.parcel_count.toLocaleString()} mono />
          <KV k="LGAs ingested" v={data.n_lgas.toString()} mono />
        </div>
      </section>

      <section>
        <div className="field-label">Per-source coverage</div>
        <div className="rounded-md border border-white/5 divide-y divide-white/5">
          {data.sources.map((s) => {
            const frac = data.hex_count ? s.rows_populated / data.hex_count : 0;
            return (
              <div key={s.key} className="px-2.5 py-2">
                <div className="flex justify-between text-xs">
                  <span className="text-panel-fg">{s.label}</span>
                  <span
                    className={cn(
                      "font-mono",
                      frac > 0.9
                        ? "text-emerald-300"
                        : frac > 0.5
                          ? "text-amber-300"
                          : "text-red-300",
                    )}
                  >
                    {pct(s.rows_populated, data.hex_count)}
                  </span>
                </div>
                <div className="mt-1.5 h-1 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all",
                      frac > 0.9
                        ? "bg-emerald-400/60"
                        : frac > 0.5
                          ? "bg-amber-400/60"
                          : "bg-red-400/60",
                    )}
                    style={{ width: `${(frac * 100).toFixed(1)}%` }}
                  />
                </div>
                <div className="text-[10px] text-panel-muted mt-1">
                  {s.rows_populated.toLocaleString()} of{" "}
                  {data.hex_count.toLocaleString()} cells
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="field-label">Sensitivity check</div>
        {sens?.verdict ? (
          <div className="text-xs space-y-1">
            <div
              className={cn(
                "font-medium",
                sens.verdict.startsWith("STABLE")
                  ? "text-emerald-300"
                  : sens.verdict.startsWith("MOSTLY")
                    ? "text-sky-300"
                    : sens.verdict.startsWith("SENSITIVE")
                      ? "text-amber-300"
                      : "text-red-300",
              )}
            >
              {sens.verdict}
            </div>
            <div className="text-panel-muted font-mono">
              ρ cells {sens.min_rho_cell?.toFixed(3)} · LGAs {sens.min_rho_lga?.toFixed(3)}
            </div>
            <div className="text-panel-muted">
              Last check:{" "}
              {sens.run_at
                ? new Date(sens.run_at).toLocaleString()
                : "—"}
            </div>
          </div>
        ) : (
          <div className="text-xs text-panel-muted leading-snug">
            No sensitivity check on record. Run{" "}
            <code className="text-panel-fg">
              uv run python -m scoring.sensitivity
            </code>
            .
          </div>
        )}
      </section>

      <p className="text-[10px] text-panel-muted leading-snug">
        Coverage numbers are per-column non-nulls in the hex table — a rough
        proxy for "did the ingest run for this source". Timestamps come from
        the DuckDB snapshot mtime. Run any{" "}
        <code className="text-panel-fg">uv run python -m ingest.&lt;source&gt;</code>{" "}
        to refresh; the API picks up the new snapshot automatically.
      </p>
    </div>
  );
}

function KV({
  k,
  v,
  mono = false,
}: {
  k: string;
  v: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-panel-muted">{k}</span>
      <span className={cn(mono && "font-mono", "text-right")}>{v}</span>
    </div>
  );
}

function pct(n: number, d: number) {
  if (!d) return "0%";
  return `${((100 * n) / d).toFixed(1)}%`;
}

function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
