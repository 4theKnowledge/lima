# Security & IP protection — TODO

Captured during first Railway deploy (2026-09-05). None of these block the
friends-only demo, but all should be addressed before wider release.

## 1. Snapshot bucket URL is public

**Current state:** `SNAPSHOT_URL` points at a public URL for
`data-bucket/land_read.duckdb`. Anyone who obtains the URL can download
the entire 139 MB DuckDB file — that includes every raw ingested column
(cadastre, groundwater, soils, bushfire, rainfall stats) AND every
computed factor score / weighted total.

**Risk:** Whole methodology + dataset exfiltrated by anyone who inspects
the API container's env vars, a leaked deploy log, or guesses the bucket
URL pattern.

**Options ordered by effort:**

- **Presigned URLs (short-term fix, ~1 hr).** Make bucket private. Generate
  a 24h presigned URL, set as `SNAPSHOT_URL`. Rotate via a scheduled
  Railway routine or a manual weekly script. Downsides: another moving
  part; if regeneration is missed the API cold-starts fail.
- **Backend-signed short-lived URLs (~4 hr).** API service holds bucket
  credentials, downloads snapshot itself using AWS SDK, never exposes a
  URL. Cleanest but requires bucket auth setup + SDK dependency in the
  API image.
- **Snapshot in a Railway Volume, not a bucket at all (~2 hr).** Volume is
  private by definition, mounted only on the API container. Snapshot
  refresh becomes an SCP-equivalent operation instead of a bucket upload.
  Loses the "one HTTPS URL" simplicity but eliminates the URL leak vector.

**Recommendation for next iteration:** Volume. Buckets are the wrong tool
for "data private to my own service."

## 2. Weighting methodology leaks via API responses

**Current state:** The API exposes:

- `GET /weights` — returns the entire `scoring/weights.yaml` verbatim
- `GET /hex` — returns per-factor scores (`factor_*` columns) for every
  cell, revealing exactly how each layer contributes to the composite
- `GET /exclusions` — returns hard-mask thresholds
- `PUT /exclusions` — triggers re-scoring with client-provided thresholds

Anyone past the passcode gate can dump the whole scoring model.

**Options ordered by effort:**

- **Move the frontend re-score to the API (~2 hr).** Frontend currently
  re-scores client-side using the `factor_*` columns, which is why the API
  has to expose them. Instead: send only the final composite score;
  re-score requires a server round-trip. Loses live-slider responsiveness
  but hides the methodology.
- **Aggregate factor scores server-side (~4 hr).** Group related factors
  into opaque "themes" (e.g. "water availability" instead of
  `factor_groundwater + factor_rainfall_level + factor_rainfall_trend`).
  Composite scores stay meaningful; methodology stays opaque.
- **Watermark responses per-user (~1 day).** Add per-user salt to numeric
  scores at ±0.1% noise. Doesn't hide the method but makes republished
  data trivially fingerprintable.

**Recommendation:** Skip `/weights` entirely (return 403), collapse
`factor_*` into themes.

## 3. Passcode is brute-forceable

**Current state:** Single shared passcode (`APP_PASSCODE`), checked in
`api/main.py:passcode_gate` middleware. No rate limiting. No lockout.
Anyone can hammer `/health` with header guesses.

**Options:**

- **Add rate limiting middleware (~30 min).** `slowapi` or FastAPI's own
  patterns. Per-IP throttle to N requests/minute, exponential backoff
  after failed passcode attempts.
- **Rotate to real user accounts (~1 day).** When we add persistence for
  saved analyses. Not urgent otherwise.

## 4. API responses are scrapeable

**Current state:** Once past the passcode, `/hex` returns ~11k rows with
all scores in one call. Trivial to scrape and republish.

**Options:**

- **Per-user access tokens with usage logging.** Requires user accounts.
- **Rate limit /hex specifically.** ~5 calls/hr per IP is enough for
  legitimate map browsing but breaks bulk scraping.
- **Watermarking** (see #2 above).

## Priority order for post-demo work

1. **Move snapshot to Railway Volume** (kills bucket URL leak vector)
2. **Drop `/weights`, collapse `factor_*` into themes** (hides methodology)
3. **Rate limiting middleware** (blunts brute-force + scraping)
4. **Per-user accounts + tokens** (when we add persistence anyway)
