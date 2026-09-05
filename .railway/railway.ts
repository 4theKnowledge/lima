import { bucket, defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  // Object storage for the DuckDB snapshot (~139 MB). Public read so the
  // api container can HTTPS GET it at startup without needing bucket
  // credentials. Railway auto-generated the name — kept as-is because
  // renaming buckets can lose data. See notes/SECURITY_TODO.md.
  const data = bucket("reserved-packet");

  // Backend: FastAPI. Snapshot downloaded from SNAPSHOT_URL (a public
  // URL in data-bucket) to /tmp at container startup, so the image
  // doesn't need to bake in the 139 MB DuckDB file. Deploys from GitHub
  // on push — no more `railway up`.
  const api = service("api", {
    source: github("4theKnowledge/lima"),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile.api",
    },
    healthcheck: "/health",
    healthcheckTimeout: 60,
    replicas: { sfo: 1 },
    env: {
      APP_PASSCODE: preserve(),
      CORS_ORIGINS: preserve(),
      SNAPSHOT_URL: preserve(),
    },
  });

  return project("lima", {
    resources: [api, data],
  });
});
