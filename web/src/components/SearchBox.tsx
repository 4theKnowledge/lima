import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { api } from "../api";
import { useUi } from "../store";
import { InfoTip } from "./InfoTip";
import { SEARCH_TIP } from "../lib/copy";

export function SearchBox() {
  const [q, setQ] = useState("");
  const setSearchResult = useUi((s) => s.setSearchResult);
  const selectHex = useUi((s) => s.selectHex);
  // The last successful geocode label lives in the store so it survives
  // tab-switch unmounts (Panel unmounts inactive TabBody children). This
  // is the "📍 currently pinned" reminder — not the raw input, which
  // stays local because it's transient typing state.
  const searchH3 = useUi((s) => s.searchH3);
  const searchLabel = useUi((s) => s.searchLabel);
  const mut = useMutation({
    mutationFn: (query: string) => api.geocode(query),
    onSuccess: (r) => {
      if (!r) return;
      setSearchResult(r.h3, r.display_name);
      selectHex(r.h3);
    },
  });

  const noMatch = mut.data === null && !mut.isPending;

  function clearSearch() {
    setQ("");
    // selectHex(null) also clears searchH3 + searchLabel via the store's
    // full-clear branch — one action, no orphan state left behind.
    selectHex(null);
    mut.reset();
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <div className="field-label !mb-0">Find a place</div>
        <InfoTip>{SEARCH_TIP}</InfoTip>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) mut.mutate(q.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Boyup Brook, 285 Blackwood Rd..."
          className="flex-1 bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-xs [@media(pointer:coarse)]:text-base placeholder:text-panel-muted focus:outline-none focus:border-emerald-400/40"
        />
        <button className="hud-button-primary" type="submit" disabled={mut.isPending}>
          {mut.isPending ? "…" : "Go"}
        </button>
      </form>
      {noMatch && (
        <div className="mt-2 text-xs text-amber-300">
          No match. Try a broader query (town + shire).
        </div>
      )}
      {searchH3 && searchLabel && (
        <div className="mt-2 flex items-start gap-2 text-xs text-emerald-300 leading-snug">
          <span className="flex-1 min-w-0">📍 {searchLabel}</span>
          <button
            type="button"
            onClick={clearSearch}
            className="shrink-0 text-panel-muted hover:text-red-300 transition"
            aria-label="Clear search"
            title="Clear search"
          >
            ✕
          </button>
        </div>
      )}
      {mut.isError && (
        <div className="mt-2 text-xs text-red-300">
          Search failed: {(mut.error as Error).message}
        </div>
      )}
    </div>
  );
}
