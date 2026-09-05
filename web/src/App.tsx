/**
 * Fullscreen map with a single floating tabbed HUD panel on the right edge.
 * Everything overlays; the map stays full-bleed regardless of panel state.
 */

import { useHydrateFromUrl, useSyncToUrl } from "./lib/urlState";
import { useApplyTheme } from "./lib/theme";
import { MapView } from "./components/Map";
import { HudPanel, TabBody } from "./components/Panel";
import { Toolbar } from "./components/Toolbar";
import { SelectedChip } from "./components/SelectedChip";
import { MapControls } from "./components/MapControls";
import { SearchBox } from "./components/SearchBox";
import { WeightsPanel } from "./components/WeightsPanel";
import { ExclusionsPanel } from "./components/ExclusionsPanel";
import { LgaFilter } from "./components/LgaFilter";
import { MetricPicker } from "./components/MetricPicker";
import { Inspector } from "./components/Inspector";
import { RankedTable } from "./components/RankedTable";
import { DataStatusPanel } from "./components/DataStatus";
import { SettingsPanel } from "./components/SettingsPanel";

export default function App() {
  useHydrateFromUrl();
  useSyncToUrl();
  useApplyTheme();
  return (
    <div className="relative h-full w-full overflow-hidden bg-neutral-950">
      <MapView />
      <Toolbar />
      <SelectedChip />
      <MapControls />

      <HudPanel>
        <TabBody tab="controls">
          <SearchBox />
          <MetricPicker />
          <WeightsPanel />
          <ExclusionsPanel />
          <LgaFilter />
        </TabBody>
        <TabBody tab="inspector">
          <Inspector />
        </TabBody>
        <TabBody tab="ranking" scroll={false}>
          <RankedTable />
        </TabBody>
        <TabBody tab="data">
          <DataStatusPanel />
        </TabBody>
        <TabBody tab="settings">
          <SettingsPanel />
        </TabBody>
      </HudPanel>
    </div>
  );
}
