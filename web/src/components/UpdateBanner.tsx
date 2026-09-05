/**
 * Bottom-center "New version available" banner.
 *
 * Shown when useFreshness detects that the running bundle's build_id no
 * longer matches the one the API reports. We surface a banner rather than
 * auto-reloading — a hard reload mid-interaction (mid-slider-drag, mid-
 * panel-scroll) is worse than a stale bundle for a few more minutes.
 *
 * The refresh button in MapControls flips to an amber "reload" affordance
 * at the same time; the banner is the announcement, the button is the
 * durable control.
 */

import { useUi } from "../store";

export function UpdateBanner() {
  const updateAvailable = useUi((s) => s.updateAvailable);
  const dismissed = useUi((s) => s.updateBannerDismissed);
  const dismiss = useUi((s) => s.dismissUpdateBanner);

  if (!updateAvailable || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="panel absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pl-3 pr-1 py-2 flex items-center gap-2 text-xs shadow-lg ring-1 ring-amber-400/30"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-300 shrink-0" />
      <span className="text-panel-fg">New version available.</span>
      <button
        onClick={() => window.location.reload()}
        className="ml-1 rounded-md px-2 py-1 text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 font-medium transition"
      >
        Reload
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss update banner"
        title="Dismiss"
        className="h-6 w-6 rounded-md text-panel-muted hover:text-panel-fg hover:bg-white/10 flex items-center justify-center transition"
      >
        ✕
      </button>
    </div>
  );
}
