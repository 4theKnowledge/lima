# Web service: Vite build → Caddy static serve.

# ---- build stage ----
FROM node:22-alpine AS build

RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Vite reads VITE_* env vars at build time and inlines them into the bundle.
# Railway exposes service variables as environment variables during the
# Docker build (not as build args), so `pnpm build` sees them directly.
RUN pnpm build

# ---- serve stage ----
FROM caddy:2-alpine

COPY --from=build /app/dist /usr/share/caddy
COPY Caddyfile /etc/caddy/Caddyfile

# Caddy reads $PORT from Railway's runtime env via the Caddyfile.
