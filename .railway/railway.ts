import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  // Frontend: Vite build → Caddy static serve. Auto-deploys from GitHub on
  // every push to main. Dockerfile lives at web/Dockerfile, so rootDirectory
  // scopes the build context to web/.
  const web = service("web", {
    source: github("4theKnowledge/lima"),
    rootDirectory: "web",
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    replicas: { sfo: 1 },
    env: {
      // Baked into the JS bundle at build time. Set via Railway variables.
      VITE_API_BASE_URL: preserve(),
      VITE_APP_PASSCODE_REQUIRED: "true",
    },
  });

  // Backend: FastAPI + baked-in DuckDB snapshot. NOT connected to GitHub —
  // the 139 MB snapshot (db/land_read.duckdb) is gitignored and rides along
  // with `railway up` from a laptop.
  const api = service("api", {
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile.api",
    },
    healthcheck: "/health",
    healthcheckTimeout: 30,
    replicas: { sfo: 1 },
    env: {
      APP_PASSCODE: preserve(),
      CORS_ORIGINS: preserve(),
    },
  });

  return project("lima", {
    resources: [web, api],
  });
});
