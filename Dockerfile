# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Sparkle Audio — container image
#
# The app is a single Node process that serves BOTH the React SPA (dist/)
# and the Express API (tsx server/index.ts) from one port. A local SQLite
# database (node:sqlite, WAL mode) and uploaded media live on a volume.
#
# Node >= 24 is required: node:sqlite is stable there and WAL is reliable.
# ---------------------------------------------------------------------------

FROM node:24-bookworm-slim AS build
WORKDIR /app

# Install all deps (tsx is a devDependency and is needed to run the TS server).
COPY package.json package-lock.json ./
RUN npm ci

# Build the frontend and copy the rest of the source.
COPY . .
RUN npm run build

# Production image keeps node_modules (incl. tsx) so `npm start` works.
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=4000
# Persisted state lives on a volume mounted at /data.
ENV DATABASE_PATH=/data/open-audio.db
ENV UPLOAD_DIR=/data/uploads
# Hardened defaults for containerized deployments.
ENV COOKIE_SECURE=1
ENV TRUST_PROXY=1
ENV HELMET_CSP=1

WORKDIR /app

# Re-copy only what is needed at runtime.
COPY package.json package-lock.json ./
RUN npm ci
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
COPY scripts ./scripts
COPY vite.config.ts tsconfig.json ./

EXPOSE 4000

# Run as a non-root user.
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin appuser \
  && mkdir -p /data && chown -R appuser:appuser /data /app
USER appuser

ENTRYPOINT ["node", "scripts/docker-entrypoint.mjs"]
