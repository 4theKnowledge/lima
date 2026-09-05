# Web service: Vite build → Caddy static serve.
#
# VITE_API_BASE_URL and VITE_APP_PASSCODE_REQUIRED are baked in at build
# time (Vite substitutes them into the bundle). Set both as Railway build
# args / env vars on the web service.

# ---- build stage ----
FROM node:20-alpine AS build

RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_API_BASE_URL
ARG VITE_APP_PASSCODE_REQUIRED=true
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_APP_PASSCODE_REQUIRED=$VITE_APP_PASSCODE_REQUIRED

RUN pnpm build

# ---- serve stage ----
FROM caddy:2-alpine

COPY --from=build /app/dist /usr/share/caddy

# SPA rewrite: unknown paths fall back to index.html so client-side routes
# survive a page refresh. Listens on $PORT (Railway) or 80 locally.
RUN printf '%s\n' \
    ':{$PORT:80} {' \
    '  root * /usr/share/caddy' \
    '  encode gzip' \
    '  try_files {path} /index.html' \
    '  file_server' \
    '}' > /etc/caddy/Caddyfile
