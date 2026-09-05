import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { api } from "../api";
import { useUi } from "../store";
import { InfoTip } from "./InfoTip";
import { SEARCH_TIP } from "../lib/copy";

export function SearchBox() {
  const [q, setQ] = useState("");
  const setSearchH3 = useUi((s) => s.setSearchH3);
  const selectHex = useUi((s) => s.selectHex);
  const mut = useMutation({
    mutationFn: (query: string) => api.geocode(query),
    onSuccess: (r) => {
      if (!r) return;
      setSearchH3(r.h3);
      selectHex(r.h3);
    },
  });

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
      {mut.data === null && !mut.isPending && (
        <div className="mt-2 text-xs text-amber-300">
          No match. Try a broader query (town + shire).
        </div>
      )}
      {mut.data && (
        <div className="mt-2 text-xs text-emerald-300 leading-snug">
          📍 {mut.data.display_name}
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
