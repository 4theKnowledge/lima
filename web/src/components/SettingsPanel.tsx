/**
 * Settings tab. Persistent user preferences — units, theme, palette — plus
 * a shortcuts cheatsheet and a reset button.
 *
 * Persisted via `settings.ts` (localStorage + useSyncExternalStore). Values
 * apply immediately; no "save" button needed.
 */

import {
  resetSettings,
  setSetting,
  useSettings,
  type Palette,
  type Theme,
  type Units,
} from "../settings";
import { InfoTip } from "./InfoTip";
import { gradientCss } from "../lib/color";
import { cn } from "../lib/cn";

export function SettingsPanel() {
  const settings = useSettings();
  return (
    <div className="space-y-5">
      <section>
        <SectionLabel
          label="Units"
          tip="Switches every area (ha ↔ ac) and distance (km ↔ mi) across the app. Rainfall stays in mm regardless."
        />
        <Segmented<Units>
          value={settings.units}
          options={[
            { value: "metric", label: "Metric (ha / km)" },
            { value: "imperial", label: "Imperial (ac / mi)" },
          ]}
          onChange={(v) => setSetting("units", v)}
        />
      </section>

      <section>
        <SectionLabel
          label="Theme"
          tip="Dark is the default. Auto follows your OS setting; light mode is decent for daytime desk work."
        />
        <Segmented<Theme>
          value={settings.theme}
          options={[
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
            { value: "auto", label: "Auto" },
          ]}
          onChange={(v) => setSetting("theme", v)}
        />
      </section>

      <section>
        <SectionLabel
          label="Colour palette"
          tip="Viridis is the default (perceptually uniform). Cividis is safe for red-green colour blindness and swaps the proclaimed/unproclaimed colours to blue/orange. Plasma reads warmer."
        />
        <div className="grid gap-2">
          {(["viridis", "cividis", "plasma"] as Palette[]).map((p) => (
            <button
              key={p}
              onClick={() => setSetting("palette", p)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-xs transition",
                settings.palette === p
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                  : "border-white/10 bg-white/5 text-panel-fg hover:bg-white/10",
              )}
            >
              <span className="capitalize flex items-center gap-2">
                {p}
                {p === "cividis" && (
                  <span className="text-[10px] font-mono text-panel-muted">
                    CVD-safe
                  </span>
                )}
              </span>
              <span
                className="h-3 w-24 rounded shrink-0"
                style={{ background: gradientCss(p, false) }}
              />
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionLabel label="Shortcuts" />
        <div className="rounded-md border border-white/5 divide-y divide-white/5 text-xs">
          <Shortcut keys="click" description="Select a hex cell" />
          <Shortcut keys="shift + click" description="Pin as B for compare" />
          <Shortcut keys="click again" description="Deselect the current hex" />
          <Shortcut keys="esc" description="Clear selection" />
          <Shortcut keys="h" description="Reset view (fit to data)" />
        </div>
      </section>

      <section>
        <button
          onClick={() => {
            if (confirm("Reset all settings to defaults?")) resetSettings();
          }}
          className="hud-button"
        >
          Reset settings to defaults
        </button>
      </section>

      <p className="text-[10px] text-panel-muted leading-snug">
        Preferences are stored in your browser (localStorage). They survive
        reloads and closed tabs.
      </p>
    </div>
  );
}

function SectionLabel({ label, tip }: { label: string; tip?: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <div className="field-label !mb-0">{label}</div>
      {tip && <InfoTip>{tip}</InfoTip>}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      className="grid gap-1 rounded-md border border-white/10 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-sm px-2 py-1.5 text-xs font-medium transition",
              active
                ? "bg-emerald-500/20 text-emerald-100"
                : "text-panel-muted hover:text-panel-fg hover:bg-white/5",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Shortcut({
  keys,
  description,
}: {
  keys: string;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between px-2.5 py-2">
      <span className="text-panel-muted">{description}</span>
      <kbd className="font-mono text-[10px] rounded bg-white/10 px-1.5 py-0.5 border border-white/10">
        {keys}
      </kbd>
    </div>
  );
}
