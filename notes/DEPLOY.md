# Deploy — Railway

Live URLs:
- **Web**: https://web-production-aad5bd.up.railway.app/
- **API**: https://api-production-bb1337.up.railway.app/
- **Passcode**: (see Railway dashboard `api` → Variables → `APP_PASSCODE`)

## Architecture

Two services + one bucket, all in the `lima` Railway project:

| Resource | Purpose | Source |
|---|---|---|
| `api` (service) | FastAPI backend | GitHub `4theKnowledge/lima`, auto-deploy on push |
| `web` (service) | Vite SPA served by Caddy on :8080 | GitHub, auto-deploy on push, `rootDirectory: web` |
| `reserved-packet` (bucket) | Holds `db/land_read.duckdb` | Private, S3-compatible. API downloads at container startup via boto3. |

The DuckDB snapshot is NEVER baked into the API image and NEVER committed to
git. It lives only in the bucket + on your laptop for regeneration.

Cross-service env vars use Railway reference syntax (`${{web.RAILWAY_PUBLIC_DOMAIN}}`
etc.) so `CORS_ORIGINS` and `VITE_API_BASE_URL` auto-update if either service's
domain changes.

## IaC (single source of truth)

Project config lives in [`.railway/railway.ts`](../.railway/railway.ts). Commands:

```sh
railway config plan     # preview drift, safe / read-only
railway config apply    # apply changes after confirming
railway config pull     # regenerate the file from current Railway state
```

Rules that saved us pain:
- **Any variable set out-of-band must be declared in IaC with `preserve()`.**
  Otherwise `railway config apply` deletes it. Applies to `APP_PASSCODE`,
  `AWS_*`, `SNAPSHOT_KEY`.
- **Buckets have region locked at creation.** Declare with the correct
  region or you'll get `Bucket region cannot be changed` errors.
- **Deletion is destructive.** `railway config apply` will silently remove
  services/buckets/vars that were previously created outside IaC unless you
  declare them.

## Refreshing the DuckDB snapshot

The end-to-end data-refresh flow, after you've regenerated the snapshot locally:

```sh
cd /Users/tylerbikaun/lima     # or wherever your checkout is
railway link                   # pick: workspace → lima → production → api
uv run python -m scripts.upload_snapshot
```

The script:
1. Fetches fresh S3 credentials via `railway bucket credentials`
2. Uploads `db/land_read.duckdb` to key `db/land_read.duckdb` in the bucket
3. Triggers an api redeploy so the container downloads the new snapshot

Flags:
- `--no-redeploy` — skip the redeploy (do it later, or if you're batching)
- `--key <path>` — upload under a different key (must match `SNAPSHOT_KEY` env var)

The web service does NOT need redeploying when data changes.

## Rotating bucket credentials

If bucket credentials leak (via git, chat, screen share, etc.):

```sh
railway link       # api
railway bucket credentials --bucket reserved-packet --reset --yes

# Refresh the AWS_* env vars on the api service with the new creds:
eval "$(railway bucket credentials --bucket reserved-packet | grep '^AWS_')"
railway variables \
  --set "AWS_ENDPOINT_URL=$AWS_ENDPOINT_URL" \
  --set "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID" \
  --set "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY" \
  --set "AWS_S3_BUCKET_NAME=$AWS_S3_BUCKET_NAME"
unset AWS_ENDPOINT_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_S3_BUCKET_NAME AWS_DEFAULT_REGION AWS_S3_URL_STYLE
```

Env change auto-triggers an api redeploy.

## Rotating the passcode

```sh
NEW='pick-a-strong-one'

railway link       # api
railway variables --set "APP_PASSCODE=$NEW"

# Also tell your friends the new passcode. There's no way to warn active
# sessions — they'll see 401 on their next request, PasscodeGate clears
# localStorage and re-prompts.
```

The passcode is a shared secret. The frontend doesn't know it — users type
it in via `PasscodeGate.tsx` and the API validates against `APP_PASSCODE`.
Only need to set it on the api service.

## First-time setup (if starting from scratch)

Assuming a fresh Railway project + a copy of this repo pushed to GitHub:

```sh
# 1. Install IaC SDK
npm install railway

# 2. Link and apply
railway login
railway init                     # name: lima
railway config apply             # creates api service + reserved-packet bucket + web service

# 3. Connect both services to GitHub in dashboard
#    api service → Settings → Source → Connect Repo → main
#    web service → Settings → Source → Connect Repo → main + rootDirectory=web

# 4. Generate domains
railway link                     # pick api
railway domain                   # copy URL — probably api-production-xxxx

railway link                     # pick web
railway domain                   # copy URL — probably web-production-xxxx

# 5. IMPORTANT — if either URL 404s ("x-railway-fallback: true"), rename
#    it via the dashboard: Settings → Networking → pencil icon → change
#    suffix → save. This is a known Railway routing quirk where new
#    domains sometimes get target_port unset until rename.

# 6. Set env vars via CLI (some cannot be in IaC because they're secrets)
railway link                     # api
railway variables --set "APP_PASSCODE=pick-a-strong-one"

# 7. Bucket credentials for api (see "Rotating bucket credentials" above)
eval "$(railway bucket credentials --bucket reserved-packet | grep '^AWS_')"
railway variables \
  --set "AWS_ENDPOINT_URL=$AWS_ENDPOINT_URL" \
  --set "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID" \
  --set "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY" \
  --set "AWS_S3_BUCKET_NAME=$AWS_S3_BUCKET_NAME" \
  --set "SNAPSHOT_KEY=db/land_read.duckdb"
unset AWS_ENDPOINT_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_S3_BUCKET_NAME AWS_DEFAULT_REGION AWS_S3_URL_STYLE

# 8. Upload snapshot to bucket
uv run python -m scripts.upload_snapshot

# Done. Test:
curl https://<api-url>/health
curl -H "X-Passcode: pick-a-strong-one" https://<api-url>/lgas
# Open https://<web-url>/ in browser
```

## Local dev

The passcode gate is off by default in dev:
- `APP_PASSCODE` unset on the API → middleware skipped
- `VITE_APP_PASSCODE_REQUIRED` unset in web → gate renders children immediately

To test the gate locally, set both:

```sh
# web/.env.local (gitignored)
VITE_APP_PASSCODE_REQUIRED=true
VITE_API_BASE_URL=http://localhost:8010
```

```sh
# API terminal
APP_PASSCODE=test uv run uvicorn api.main:app --reload --port 8010
```

Then type `test` in the browser.

## Gotchas we learned the hard way

- **`railway up` respects `.gitignore`.** Use `--no-gitignore` if you need
  to upload gitignored files, but then `.railwayignore` must re-exclude
  `.venv/`, `cache/`, `node_modules/`, `web/` etc. or the upload balloons
  past Cloudflare's 100 MB limit and gets 413'd.
- **Railway's Dockerfile builder does NOT auto-inject env vars into
  `docker build`.** Only Nixpacks does that. For Dockerfiles you must
  declare each build-time var as `ARG` first, then promote to `ENV`. See
  `web/Dockerfile`.
- **Auto-generated Railway domains sometimes come up with `target_port: -`.**
  Even setting it explicitly via CLI/MCP doesn't always fix the routing.
  The reliable fix is renaming the domain via the dashboard (Settings →
  Networking → pencil icon). That forces Railway to regenerate the edge
  routing table.
- **DuckDB extensions must be `INSTALL`ed with a writable connection.**
  Our runtime opens the snapshot read-only, so extensions need to be
  installed at build time (see `Dockerfile.api`'s `INSTALL spatial +
  h3` line).
- **The snapshot path is resolved per-call, not at import time.** The
  `/tmp/land_read.duckdb` file doesn't exist when `api/db.py` is first
  imported — the download happens later in the FastAPI lifespan. If you
  cache the path at import, `/health` fails forever.

## Security TODO

See [`SECURITY_TODO.md`](SECURITY_TODO.md). None block a friends demo but
all should be addressed before wider release.
