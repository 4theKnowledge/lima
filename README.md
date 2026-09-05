# SWWA Land Screener

Regional land-screening tool for the South West of Western Australia. Colour-scored
H3 hex map + inspector, backed by DuckDB with `spatial` + `h3` extensions. See
`BUILD_BRIEF.md` for the full spec and `TASKS.md` for milestones.

## Two frontends

The project ships two UIs against the same data:

| UI | Path | When to use |
|---|---|---|
| React + FastAPI (M10) | `web/` + `api/` | Default going forward. Fullscreen map + slide-out HUD panels. |
| Streamlit (M6) | `app/streamlit_app.py` | Legacy fallback until React reaches full feature parity. |

Both read the same `db/land_read.duckdb` snapshot — you can run either without
disturbing the other.

## Prerequisites

- Python 3.11+ managed by [`uv`](https://docs.astral.sh/uv/) (`uv sync` on first run)
- Node 20+ with `pnpm` (only needed for the React frontend)
- A populated `db/land.duckdb` from the ingest pipeline (see `TASKS.md` M0–M7)

## Run the React app (default)

Two terminals:

```sh
# Terminal 1 — FastAPI backend on http://localhost:8010
uv run uvicorn api.main:app --reload --port 8010

# Terminal 2 — Vite dev server on http://localhost:5183
cd web && pnpm install    # once
cd web && pnpm dev
```

Open http://localhost:5183/. The `/api` prefix on the frontend is proxied through
Vite to the FastAPI port, so no CORS wrangling is needed in dev.

Port choices are deliberate — port 8000 is often occupied by an unrelated Python
service on this dev machine, and 5173 is proxied by Docker Desktop. Override with
`VITE_API_PORT=xxxx` if you need to move the backend port.

## Run the Streamlit app (legacy)

```sh
uv run streamlit run app/streamlit_app.py
```

## Run an ingest

Every ingest module is idempotent and publishes a fresh read-snapshot at the end:

```sh
uv run python -m ingest.<source>       # e.g. ingest.cadastre, ingest.rainfall
uv run python -m scoring.exclude
uv run python -m scoring.score
uv run python -m scoring.sensitivity   # optional but recommended after weight changes
```

Both UIs pick up the new snapshot on their next request — no restart needed for
row-data changes. Schema changes (`ALTER TABLE ADD COLUMN`) still need one restart
of whichever UI is running (see `TASKS.md` X.6).

## Layout

```
swwa-land/
  api/              FastAPI backend (M10) — thin HTTP layer over DuckDB
  web/              React + Vite + deck.gl frontend (M10)
  app/              Legacy Streamlit UI (M6)
  ingest/           One module per source, each idempotent
  scoring/          Stage 1 exclude + Stage 2 weighted score
  db/               DuckDB primary + read-snapshot
  cache/            Raw API responses (gitignored)
  notes/            Data log, sensitivity log, catalogue notes
```
