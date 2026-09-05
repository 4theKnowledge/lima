/**
 * Passcode gate for the deployed app.
 *
 * If VITE_APP_PASSCODE_REQUIRED is not "true", renders children immediately
 * (dev + open deploys). Otherwise checks localStorage for a stored passcode
 * and validates it against /lgas (a cheap authed endpoint). On failure, shows
 * a styled prompt; on success, renders children.
 */

import { useEffect, useState } from "react";

const PASSCODE_KEY = "lima-passcode";
const REQUIRED = import.meta.env.VITE_APP_PASSCODE_REQUIRED === "true";
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

type Status = "checking" | "prompt" | "ok";

async function validate(passcode: string): Promise<boolean> {
  const r = await fetch(`${API_BASE}/lgas`, {
    headers: { "X-Passcode": passcode },
  });
  return r.ok;
}

export function PasscodeGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>(REQUIRED ? "checking" : "ok");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!REQUIRED) return;
    const stored = localStorage.getItem(PASSCODE_KEY);
    if (!stored) {
      setStatus("prompt");
      return;
    }
    validate(stored).then((ok) => {
      if (ok) {
        setStatus("ok");
      } else {
        localStorage.removeItem(PASSCODE_KEY);
        setStatus("prompt");
      }
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const ok = await validate(input);
      if (!ok) {
        setError("Incorrect passcode");
        return;
      }
      localStorage.setItem(PASSCODE_KEY, input);
      setStatus("ok");
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  if (status === "ok") return <>{children}</>;

  if (status === "checking") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-neutral-950 text-neutral-400">
        Checking access…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-950">
      <form
        onSubmit={submit}
        className="w-80 rounded-lg border border-neutral-800 bg-neutral-900 p-6 shadow-xl"
      >
        <h1 className="mb-1 text-lg font-semibold text-neutral-100">
          Lima
        </h1>
        <p className="mb-4 text-sm text-neutral-400">
          Enter the passcode to continue.
        </p>
        <input
          autoFocus
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Passcode"
          className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        />
        {error && (
          <div className="mt-2 text-sm text-red-400">{error}</div>
        )}
        <button
          type="submit"
          disabled={busy || !input}
          className="mt-4 w-full rounded bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
