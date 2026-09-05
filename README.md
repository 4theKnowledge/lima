# Lima

Regional land-screening tool. Colour-scored H3 hex map + inspector, backed
by DuckDB with `spatial` + `h3` extensions. Currently covers the South West
of Western Australia; the architecture is region-agnostic so more regions
can be added later. See `BUILD_BRIEF.md` for the full spec and `TASKS.md`
for milestones.

## Prerequisites

- Python 3.11+ managed by [`uv`](https://docs.astral.sh/uv/) (`uv sync` on first run)
- Node 20+ with `pnpm`
- A populated `db/land.duckdb` from the ingest pipeline (see `TASKS.md` M0–M7)

## Run locally

Two terminals:

```sh
# Terminal 1 — FastAPI backend on http://localhost:8010
uv run uvicorn api.main:app --reload --port 8010

# Terminal 2 — Vite dev server on http://localhost:5183
cd web && pnpm install    # once
cd web && pnpm dev
```

Open http://localhost:5183/. The `/api` prefix is proxied through Vite to
FastAPI, so no CORS wrangling is needed in dev.

Port choices are deliberate — 8000 is often occupied by an unrelated Python
service on this dev machine, and 5173 is proxied by Docker Desktop. Override
with `VITE_API_PORT=xxxx` to move the backend port.

## Run an ingest

Every ingest module is idempotent and publishes a fresh read-snapshot at the end:

```sh
uv run python -m ingest.<source>       # e.g. ingest.cadastre, ingest.rainfall
uv run python -m scoring.exclude
uv run python -m scoring.score
uv run python -m scoring.sensitivity   # optional but recommended after weight changes
```

The frontend picks up the new snapshot on its next request — no restart
needed for row-data changes. Schema changes (`ALTER TABLE ADD COLUMN`) need
one restart of the API (see `TASKS.md` X.6).

## Layout

```
lima/
  api/              FastAPI backend — thin HTTP layer over DuckDB
  web/              React + Vite + deck.gl frontend
  ingest/           One module per source, each idempotent
  scoring/          Stage 1 exclude + Stage 2 weighted score
  db/               DuckDB primary + read-snapshot
  cache/            Raw API responses (gitignored)
  notes/            Data log, sensitivity log, catalogue notes
  .railway/         Railway Infrastructure as Code
```

## Deploy to Railway

See [`notes/DEPLOY.md`](notes/DEPLOY.md) for the full deployment reference:
architecture (web via GitHub, api via `railway up`), one-time setup, env
vars, and the data-refresh workflow.

