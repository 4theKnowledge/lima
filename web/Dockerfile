# Web service: Vite build → Caddy static serve.

FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .

# Vite substitutes import.meta.env.VITE_* at build time from process env.
# Railway forwards service env vars as build args ONLY if the Dockerfile
# declares them with ARG — then we promote to ENV so the pnpm build sees
# them. Missing this = frontend built with undefined URLs / flags.
ARG VITE_API_BASE_URL
ARG VITE_APP_PASSCODE_REQUIRED
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_APP_PASSCODE_REQUIRED=$VITE_APP_PASSCODE_REQUIRED

RUN pnpm build

FROM caddy:2-alpine

COPY --from=build /app/dist /usr/share/caddy
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
