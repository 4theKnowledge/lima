import { bucket, defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  // Object storage for the DuckDB snapshot (~139 MB). Region is fixed at
  // "sjc" (auto-assigned when created); buckets can't be moved. See
  // notes/SECURITY_TODO.md for hardening options (currently public read).
  const reservedPacket = bucket("reserved-packet", { region: "sjc" });

  // Backend: FastAPI. Snapshot downloaded from SNAPSHOT_URL to /tmp at
  // container startup so the image doesn't need to bake in the 139 MB
  // DuckDB file. Deploys from GitHub on push.
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
      // AWS_ENDPOINT_URL / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
      // AWS_S3_BUCKET_NAME are auto-injected by Railway when the bucket
      // is linked to this service (dashboard: api → Variables → Add Reference
      // → reserved-packet). Don't declare them here.
    },
  });

  return project("lima", {
    resources: [api, reservedPacket],
  });
});
