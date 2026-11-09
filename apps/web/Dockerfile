# Build context is the repo root (see docker-compose.yml), so the whole workspace is available.

FROM node:22-alpine AS base
# Node 22's bundled corepack has outdated npm signing keys; use a current one.
RUN npm install -g corepack@0.36.0 && corepack enable pnpm
WORKDIR /repo

FROM base AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm install --frozen-lockfile
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time.
ARG NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_WS_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN pnpm turbo run build --filter=@rr/web

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
# `output: "standalone"` bundles the server plus only the node_modules it needs.
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
# If apps/web/public/ is added later, also copy it:
# COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
