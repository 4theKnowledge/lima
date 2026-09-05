import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import App from "./App";
import { PasscodeGate } from "./components/PasscodeGate";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Hex slice is ~11k rows — worth staleTime so the map doesn't re-fetch
      // on every panel toggle. Server data invalidates when snapshot mtime
      // changes (surfaced via /health) — see useHexData.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      // TanStack's default is 3 retries with exponential backoff — a first
      // cold-start failure then hides behind ~20 s of silent waiting.
      // One quick retry catches transient blips without stretching the
      // "app is slow" experience into "app is broken".
      retry: 1,
      retryDelay: 500,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <PasscodeGate>
        <App />
      </PasscodeGate>
    </QueryClientProvider>
  </React.StrictMode>,
);
