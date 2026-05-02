# Deploy — AI Proxy Gateway (mother)

Repo: `syrikm/davidfuckrp` · Container entrypoint: `artifacts/api-server`

This service is a **long-running Node.js / Express server**. It needs a real
container runtime — **not** serverless (which would break the in-memory
caches, hot-updater background timer, and SSE streaming above 60 s).

| Platform | Region | Free tier | Scale-to-zero | One-click | Recommended for |
|---|---|---|---|---|---|
| **Render** | US / EU / SG | ✓ (sleeps) | ✓ | ✓ Blueprint | First-time, low traffic |
| **Fly.io** | global edge | ✓ (limited) | manual | CLI | Latency-sensitive, global users |
| **Zeabur** | HK / SG / FRA | ✗ ($5/mo) | ✓ | ✓ Template | Mainland China users |
| **Railway** | US / EU / SG | ✗ ($5/mo) | ✓ | ✓ Template | Simplest GitHub workflow |

> ❌ **Vercel / Netlify / Cloudflare Workers** — serverless, will break long
> AI completions and the background hot-updater. Don't use them for this app.
>
> ❌ **ClawCloud Run** — service shut down 2026; configs removed.

---

## Required environment variables (all platforms)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PROXY_API_KEY` | **yes** | — | Server refuses to start without it. Auth token for `/api/*` admin & `/v1/*` proxy. |
| `PORT` | no | `8080` | HTTP listen port (most platforms inject this). |
| `STORAGE_BACKEND` | no | `local` | `local` / `s3` / `r2` (alias for s3) / `gcs` / `replit`. Use `s3` or `r2` on scale-to-zero platforms without persistent volumes. |
| `STORAGE_S3_BUCKET` `STORAGE_S3_ENDPOINT` `STORAGE_S3_ACCESS_KEY_ID` `STORAGE_S3_SECRET_ACCESS_KEY` | conditional | — | Required when `STORAGE_BACKEND=s3` or `=r2`. |
| `STORAGE_S3_REGION` | no | `auto` | `auto` works for R2; AWS S3 needs the real region. |
| `STORAGE_S3_FORCE_PATH_STYLE` | no | `false` | Set to `true` for MinIO and other path-style S3 servers. |
| `OPENROUTER_API_KEY` | no | — | Default OR backend; can also be configured per-backend via `/api/backends`. |
| `MOTHER_NODE_URL` | no | — | If running as a child reporting up to a mother — leave empty for the mother itself. |

---

## Render (recommended for first deploy)

Repo includes `render.yaml` — Render auto-detects it as a Blueprint.

### One-click

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/syrikm/davidfuckrp)

### Manual

1. Render dashboard → **New → Blueprint** → connect GitHub → select `syrikm/davidfuckrp`
2. Render reads `render.yaml`: creates Web Service (Docker) + 1 GiB persistent disk mounted at `/app/data`
3. Set the only required secret: `PROXY_API_KEY` (any random string, e.g. `openssl rand -hex 32`)
4. Optionally add `OPENROUTER_API_KEY` and / or `S3_*` vars
5. Deploy

Free tier sleeps after 15 min idle (~30 s cold start). Starter plan ($7/mo) stays warm.

---

## Fly.io

Repo includes `fly.toml`. Install `flyctl` once: `curl -L https://fly.io/install.sh | sh`

```bash
fly auth login
fly launch --copy-config --no-deploy --name <your-app-name>
fly volumes create data --size 1 --region sin   # or hkg, nrt, fra, iad, lhr...
fly secrets set PROXY_API_KEY=$(openssl rand -hex 32)
# Optional: fly secrets set OPENROUTER_API_KEY=...
fly deploy
```

Defaults to 1 vCPU / 256 MB RAM in Singapore (`sin`). Edit `fly.toml` to change region or size.

Long-running SSE streams: `fly.toml` already disables idle timeout; no extra config needed.

---

## Zeabur (Mainland China friendly)

Repo's Dockerfile is auto-detected.

### One-click

[![Deployed on Zeabur](https://zeabur.com/button.svg)](https://zeabur.com/templates/deploy?repo=https://github.com/syrikm/davidfuckrp)

### Manual

1. https://zeabur.com → **New Project** → **Deploy from GitHub** → `syrikm/davidfuckrp`
2. Zeabur detects Dockerfile, builds, deploys
3. Add **Volume**: mount `/app/data` (1 GiB)
4. Add **Environment Variables**: `PROXY_API_KEY` (required), others optional
5. **Networking**: expose port `8080`, get a `*.zeabur.app` domain (or bind your own)

Region selectable in project settings — Hong Kong / Singapore / Frankfurt for best latency from China.

---

## Railway

Repo's Dockerfile is auto-detected.

### One-click

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https%3A%2F%2Fgithub.com%2Fsyrikm%2Fdavidfuckrp)

### Manual

1. https://railway.app → **New Project** → **Deploy from GitHub repo** → `syrikm/davidfuckrp`
2. Railway builds the Dockerfile automatically
3. **Variables** tab → add `PROXY_API_KEY` (required)
4. **Settings → Volumes** → add 1 GiB volume mounted at `/app/data`
5. **Settings → Networking** → generate public domain

---

## Local Docker (testing)

```bash
docker build -t davidfuckrp .
docker run -p 8080:8080 \
  -e PROXY_API_KEY=$(openssl rand -hex 32) \
  -v $(pwd)/data:/app/data \
  davidfuckrp
```

`curl http://localhost:8080/api/health` → 200 means it's up.

---

## Persistence notes

`STORAGE_BACKEND=local` writes to `/app/data` (model registry, OR snapshots, response cache, usage stats). The Dockerfile creates this directory and `chown`s it to the `node` user. **Mount a volume there or you lose state on every container restart.**

`STORAGE_BACKEND=s3` (or `r2`, which is just an alias) works with anything S3-compatible — no volume needed:
- AWS S3
- Cloudflare R2 (`STORAGE_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`)
- Backblaze B2 (`STORAGE_S3_ENDPOINT=https://s3.<region>.backblazeb2.com`)
- MinIO self-hosted (also set `STORAGE_S3_FORCE_PATH_STYLE=true`)

Bucket only needs read+write to a single prefix; no public access required.

For a step-by-step Cloudflare R2 walkthrough see the **Cloudflare R2 配置教程** section in [`README.md`](./README.md).

---

## Health check

`GET /api/health` returns 200 with a JSON summary of backend / model counts. The Dockerfile already wires this up as a `HEALTHCHECK` (30 s interval, 20 s start grace).

## Bundle / image size

Final runtime image is ~150 MB (Node 24 alpine + bundled `dist/` + pruned `node_modules` for the few esbuild externals: `@aws-sdk/client-s3`, `google-auth-library`, `drizzle-orm`).
