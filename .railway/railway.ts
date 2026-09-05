import { bucket, defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  // Object storage for the DuckDB snapshot (~139 MB). Region is fixed at
  // "sjc" (auto-assigned when created); buckets can't be moved. See
  // notes/SECURITY_TODO.md for hardening options (currently public read).
  const reservedPacket = bucket("reserved-packet", { region: "sjc" });

  // Backend: FastAPI. Snapshot downloaded from the reserved-packet bucket
  // to /tmp at container startup via boto3 using S3-compatible credentials.
  // AWS_* env vars are set out-of-band via `railway variables --set` and
  // preserved here (not declared in IaC) so credentials don't land in git.
  // Deploys from GitHub on push.
  const api = service("api", {
    source: github("4theKnowledge/lima"),
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile.api",
    },
    healthcheck: "/health",
    healthcheckTimeout: 60,
    replicas: { sfo: 1 },
    env: {
      APP_PASSCODE: preserve(),
      CORS_ORIGINS: preserve(),
      // See above comment re AWS_* + SNAPSHOT_KEY — set out-of-band.
    },
  });

  // Frontend: Vite SPA served by Caddy on :8080. Deploys from GitHub on
  // push. rootDirectory scopes the build context to web/. VITE_* vars are
  // baked into the JS bundle at build time; VITE_API_BASE_URL points at
  // the api service's public URL (hardcoded rather than referenced so the
  // build is deterministic — if we change API domains, bump this and push).
  const web = service("web", {
    source: github("4theKnowledge/lima"),
    rootDirectory: "web",
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    replicas: { sfo: 1 },
    env: {
      VITE_API_BASE_URL: "https://api-production-bb1337.up.railway.app",
      VITE_APP_PASSCODE_REQUIRED: "true",
    },
  });

  return project("lima", {
    resources: [api, web, reservedPacket],
  });
});
