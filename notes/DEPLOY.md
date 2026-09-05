# Deploy — Railway

Concise reference for how Lima is deployed. If you're setting up from
scratch, follow the sections in order.

## Architecture

Two services in one Railway project (`lima`):

| Service | Source | What it runs |
|---|---|---|
| `web` | GitHub repo `lima`, auto-deploys on push to `main` | Vite build → Caddy static serve |
| `api` | `railway up` from laptop (no GitHub source) | FastAPI + baked-in DuckDB snapshot |

**Why the split.** The API image needs `db/land_read.duckdb` (~139 MB, gitignored).
GitHub-connected deploys build from the git tree — the snapshot can't ride
along without committing a huge binary. `railway up` uploads the local
working tree (including untracked files), which is the least-friction way
to ship the snapshot without polluting git.

**Shared passcode** (env var `APP_PASSCODE` on api, matched by the passcode
users type into the web gate) protects the whole app.

## Project config

Infrastructure as Code lives in [`.railway/railway.ts`](../.railway/railway.ts).
It declares both services, Dockerfile paths, healthcheck, and env-var slots.
Secrets and public URLs use `preserve()` so they never land in git.

Commands:

```sh
railway config plan     # preview drift, read-only
railway config apply    # apply after confirming
railway config pull     # re-import current state (overwrites the file)
```

## One-time setup (from scratch)

Assumes GitHub repo `lima` exists and the working tree is pushed to it.

```sh
# 1. Install the IaC SDK (needed so railway.ts type-checks against `railway/iac`)
npm install railway

# 2. Create the Railway project
railway init            # name: lima

# 3. Apply the IaC config — this creates both services with the right builders
railway config apply

# 4. Connect the web service to GitHub (dashboard, not CLI):
#      web service → Settings → Source → Connect Repo → lima → branch main
#    Leave the api service as "empty source" so `railway up` works for it.

# 5. Generate public domains
railway link            # pick api
railway domain          # copy the URL

railway link            # pick web
railway domain          # copy the URL

# 6. Set env vars (use the SAME passcode value on both services)
railway link            # api
railway variables --set APP_PASSCODE='pick-a-strong-passcode'
railway variables --set CORS_ORIGINS='https://web-xxx.up.railway.app'

railway link            # web
railway variables --set VITE_API_BASE_URL='https://api-xxx.up.railway.app'
# VITE_APP_PASSCODE_REQUIRED='true' is already set by IaC.

# 7. Deploy the api once (uploads the 139 MB snapshot)
railway link            # api
railway up

# 8. Web deploys automatically on the next git push. To force one now:
git commit --allow-empty -m "trigger deploy"
git push
```

## Env var reference

**On the `api` service:**

| Var | Value | Purpose |
|---|---|---|
| `APP_PASSCODE` | secret | Required header value for every non-`/health` request |
| `CORS_ORIGINS` | `https://<web-domain>` | Comma-separated. Localhost dev origins are always allowed. |
| `PORT` | (Railway-injected) | Uvicorn binds to this. |

**On the `web` service:**

| Var | Value | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `https://<api-domain>` | Baked into the JS bundle at build time. |
| `VITE_APP_PASSCODE_REQUIRED` | `"true"` | Enables the passcode gate. Set by IaC. |
| `PORT` | (Railway-injected) | Caddy binds to this. |

## Data refresh workflow

When the snapshot changes (new ingest run):

```sh
# 1. Rebuild the snapshot locally
uv run python -m ingest.<source>       # updates db/land.duckdb + publishes read snapshot
uv run python -m scoring.exclude
uv run python -m scoring.score

# 2. Redeploy only the api (web is unaffected)
railway link            # api
railway up
```

The web service does NOT need redeploying unless frontend code changes —
the browser hits the API for fresh data on the next request.

## Smoke test after deploy

1. Visit web URL → shows "Enter passcode" screen
2. Type passcode → app loads, map renders
3. Wrong passcode → "Incorrect passcode" error
4. `curl https://<api-domain>/health` → 200 with snapshot mtime
5. `curl https://<api-domain>/lgas` → `401 invalid passcode` (no header)
6. `curl -H "X-Passcode: <passcode>" https://<api-domain>/lgas` → 200 with LGA list

## Local dev

The passcode gate is off by default in dev:

- `APP_PASSCODE` unset on the API → middleware skipped
- `VITE_APP_PASSCODE_REQUIRED` unset in web → gate renders children immediately

To test the gate locally, set both in `web/.env.local` and the API terminal:

```sh
# web/.env.local (gitignored)
VITE_APP_PASSCODE_REQUIRED=true
VITE_API_BASE_URL=http://localhost:8010
```

```sh
# api terminal
APP_PASSCODE=test uv run uvicorn api.main:app --reload --port 8010
```

## Why not use Git LFS to ship the snapshot via GitHub?

- Files >100 MB can't be pushed to GitHub without LFS at all (hard limit).
- LFS has per-user bandwidth quotas (1 GB/month free), then paid.
- Old snapshots pile up in `.git/objects` — every clone pulls them all.
- Data-refresh cadence means dozens of 139 MB blobs over a year.

`railway up` sidesteps all of this. The snapshot never touches git.

## Common gotchas

- **`railway config plan` shows drift after dashboard changes.** Expected —
  the dashboard and IaC file can disagree. Pull to sync (`railway config pull`)
  or apply to overwrite Railway with the file.
- **Web build fails with "cannot resolve VITE_API_BASE_URL".** Env var not
  set on the web service. Set it and redeploy.
- **API returns 401 for `/lgas` when passcode is right.** Check the header
  spelling: `X-Passcode` (case-insensitive), value must match `APP_PASSCODE`
  exactly (no trailing whitespace).
- **CORS error in browser console.** `CORS_ORIGINS` on the api doesn't
  include the web domain, or trailing slash mismatch. Set to exact origin
  with no trailing slash.
