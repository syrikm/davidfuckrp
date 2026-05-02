SYNTAX=docker/dockerfile:1.7
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
COPY lib lib
COPY scripts scripts

# Install only what api-server transitively needs.
# --frozen-lockfile: reproducible builds (matches the committed lockfile)
# Trailing "..." after the filter pulls in workspace dependencies of api-server
RUN pnpm install --frozen-lockfile --filter "@workspace/api-server..."

# Now copy source and build
COPY artifacts/api-server artifacts/api-server
RUN pnpm --filter @workspace/api-server run build

# Produce a self-contained directory at /app with only production deps
# resolved (including the few esbuild externals that dist/index.mjs needs).
RUN pnpm --filter @workspace/api-server deploy --prod /app

# ----------------------------------------------------------------------------
FROM node:24-alpine AS runtime

# tini: PID 1 signal handling so SIGTERM from the orchestrator actually
# stops node cleanly instead of being swallowed.
RUN apk add --no-cache tini

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /build/artifacts/api-server/dist ./dist
COPY --from=builder /build/artifacts/api-server/package.json ./package.json

# Persistent data lives here. Mount a volume to /app/data when running with
# STORAGE_BACKEND=local; otherwise set STORAGE_BACKEND=s3 + S3_* env vars.
RUN mkdir -p /app/data && chown -R node:node /app

ENV NODE_ENV=production \
    PORT=8080 \
    STORAGE_BACKEND=local

USER node
EXPOSE 8080

# Lightweight liveness check — the app exposes /api/health (mounted at
# /api by app.ts).  Exits non-zero if the server isn't responding.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
