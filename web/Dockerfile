# Web service: Vite build → Caddy static serve.

# ---- build stage ----
FROM node:22-alpine AS build

RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Vite reads env vars at build time. Railway passes service env vars through
# to the Docker build context automatically, so these are picked up without
# needing ARG/--build-arg wiring.
ARG VITE_API_BASE_URL
ARG VITE_APP_PASSCODE_REQUIRED=true
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_APP_PASSCODE_REQUIRED=$VITE_APP_PASSCODE_REQUIRED

RUN pnpm build

# ---- serve stage ----
FROM caddy:2-alpine

COPY --from=build /app/dist /usr/share/caddy
COPY Caddyfile /etc/caddy/Caddyfile

# Caddy reads $PORT from Railway's runtime env via the Caddyfile.
