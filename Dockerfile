# syntax=docker/dockerfile:1.7
# ============================================================================
# AI Proxy Gateway (mother) — Dockerfile
#
# Multi-stage build:
#   1. builder: pnpm install all workspace deps + esbuild bundle to dist/
#   2. pruner:  pnpm deploy --prod → flat node_modules with only the runtime
#               externals (@aws-sdk/client-s3, google-auth-library, etc.)
#   3. runtime: tiny image, just node + dist + pruned node_modules
#
# Built dist/index.mjs already has everything bundled EXCEPT esbuild
# `external:` entries (see artifacts/api-server/build.mjs). Runtime needs
# those as real node_modules.
#
# Targets ClawCloud Run / Cloud Run / Render / Fly.io / any K8s.
# ============================================================================
FROM node:24-alpine AS builder

WORKDIR /build
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy lockfile + workspace manifest first for better Docker layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
# pnpm needs every workspace package.json present to resolve the graph.
# Globbing all of them keeps the cache layer stable while the source changes.
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/api-portal/package.json artifacts/api-portal/
COPY lib lib
COPY scripts scripts

# Install everything api-server AND api-portal transitively need in one go.
# --frozen-lockfile: reproducible builds (matches the committed lockfile)
# Trailing "..." after each filter pulls in their workspace dependencies.
RUN pnpm install --frozen-lockfile \
      --filter "@workspace/api-server..." \
      --filter "@workspace/api-portal..."

# Build the portal SPA first. vite.config.ts insists on PORT/BASE_PATH being
# present even at build time (it throws otherwise), so we set them inline.
# BASE_PATH=/portal/ → Vite emits asset URLs like /portal/assets/index-abc.js
# which exactly matches where api-server mounts express.static at runtime.
COPY artifacts/api-portal artifacts/api-portal
RUN PORT=8080 BASE_PATH=/portal/ NODE_ENV=production \
    pnpm --filter @workspace/api-portal run build

# Now copy api-server source and build it
COPY artifacts/api-server artifacts/api-server
RUN pnpm --filter @workspace/api-server run build

# Produce a self-contained directory at /app with only production deps
# resolved (including the few esbuild externals that dist/index.mjs needs).
RUN pnpm --filter @workspace/api-server deploy --prod --legacy /app

# ----------------------------------------------------------------------------
FROM node:24-alpine AS runtime

# tini: PID 1 signal handling so SIGTERM from the orchestrator actually
# stops node cleanly instead of being swallowed.
RUN apk add --no-cache tini

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /build/artifacts/api-server/dist ./dist
COPY --from=builder /build/artifacts/api-server/package.json ./package.json
# Builtin model registry — modelRegistry.ts looks for it at
# `${cwd}/lib/models/registry.json` (cwd = /app). Bundling it as a static
# asset would double the dist size, so just copy the file instead.
COPY --from=builder /build/lib/models ./lib/models
# Portal SPA build output — app.ts looks for `${cwd}/portal-dist/index.html`
# and serves it on /portal/* with SPA fallback when present. Vite's outDir
# is artifacts/api-portal/dist/public (see vite.config.ts).
COPY --from=builder /build/artifacts/api-portal/dist/public ./portal-dist

# Persistent data lives here. Mount a volume to /app/data when running with
# STORAGE_BACKEND=local; otherwise set STORAGE_BACKEND=s3 + STORAGE_S3_* env vars.
RUN mkdir -p /app/data && chown -R node:node /app

ENV NODE_ENV=production \
    PORT=8080 \
    STORAGE_BACKEND=local

USER node
EXPOSE 8080

# Lightweight liveness check — health route is /healthz (defined in
# routes/health.ts), mounted under /api by app.ts → /api/healthz.
# Exits non-zero if the server isn't responding.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/api/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
