# syntax=docker/dockerfile:1.7
# FORGE — production image: Next.js standalone server + bundled worker and CLI (one image, three roles).

FROM node:24-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-stage placeholders only (never used at runtime; real secrets come from the environment).
ENV NODE_ENV=production \
    AUTH_SECRET=build-stage-placeholder-not-a-secret-0000000000 \
    ENCRYPTION_KEY=build-stage-placeholder-not-a-secret-0000000000 \
    DATABASE_URL=postgres://build:build@localhost:5432/build
RUN npm run build && npm run build:worker

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    FORGE_MIGRATIONS_DIR=/app/drizzle
RUN addgroup -S forge && adduser -S forge -G forge
COPY --from=build --chown=forge:forge /app/.next/standalone ./
COPY --from=build --chown=forge:forge /app/.next/static ./.next/static
COPY --from=build --chown=forge:forge /app/drizzle ./drizzle
COPY --from=build --chown=forge:forge /app/dist ./dist
USER forge
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
# Web by default. Worker: `node dist/worker.cjs`. CLI: `node dist/cli.cjs migrate|admin:create|first-run`.
CMD ["node", "server.js"]
