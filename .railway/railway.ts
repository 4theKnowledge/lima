import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  // Backend: FastAPI. Snapshot downloaded from SNAPSHOT_URL (a public
  // URL in the Railway data-bucket) to /tmp at container startup, so the
  // image doesn't need to bake in the 139 MB DuckDB file. Both services
  // now deploy from GitHub — no more `railway up`.
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
    resources: [api],
  });
});
