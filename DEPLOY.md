# Deploy — AI Proxy Gateway (mother)

Repo: `syrikm/davidfuckrp` · Image entrypoint: `artifacts/api-server`

This service is a long-running Node.js / Express server. It needs a real
container runtime — **not** serverless (which would break the in-memory
caches, hot-updater background timer, and SSE streaming above 60 s).

Recommended platforms (any one of them):

| Platform | Fit | Notes |
|---|---|---|
| **ClawCloud Run** | ✓ best | scale-to-zero, low price, supports Dockerfile build from GitHub |
| Google Cloud Run | ✓ | same model, more expensive |
| Render | ✓ | Web Service from Dockerfile |
| Fly.io | ✓ | `fly launch` reads the Dockerfile directly |
| Railway | ✓ | one-click GitHub deploy |
| Vercel | ✗ | serverless, function timeout kills long AI completions |

---

## Required env vars

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PROXY_API_KEY` | **yes** | — | Server refuses to start without it. Auth token for `/api/*` admin & `/v1/*` proxy. |
| `PORT` | no | `8080` | HTTP listen port (most platforms inject this). |
| `STORAGE_BACKEND` | no | `local` | `local` (filesystem), `s3` (S3 / R2 / B2 / MinIO). Use `s3` on serverless / scale-to-zero unless you mount a persistent volume. |
| `S3_ENDPOINT` `S3_REGION` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` | conditional | — | Required when `STORAGE_BACKEND=s3`. |
| `OPENROUTER_API_KEY` | no | — | Default OR backend; can also be configured per-backend via `/api/backends`. |
| `MOTHER_NODE_URL` | no | — | If running as a child reporting up to a mother — leave empty for the mother itself. |

---

## ClawCloud Run — one-click

1. Open https://run.claw.cloud and sign in.
2. **New App → Deploy from GitHub** → paste `https://github.com/syrikm/davidfuckrp`.
3. Settings:
   - **Build type**: Dockerfile (auto-detected — Dockerfile is at repo root)
   - **Port**: `8080`
   - **Persistent storage**: mount `/app/data` (1 GiB is plenty) **OR** skip and use `STORAGE_BACKEND=s3`.
   - **Environment variables**: at minimum `PROXY_API_KEY`. Add `S3_*` if using S3.
4. Deploy. First build is ~3–5 min (pnpm install + esbuild bundle), subsequent builds use Docker layer cache.

ClawCloud Run scales to zero when idle and cold-starts in ~3 s.

---

## Other platforms

### Render

Repo already has the Dockerfile. In the Render dashboard:
- **New → Web Service** → connect GitHub → select repo
- Runtime: Docker; Region: any; Plan: at least Starter (free tier sleeps and breaks long completions)
- Add disk: mount `/app/data` (1 GB) **OR** set `STORAGE_BACKEND=s3`
- Env vars per the table above

### Fly.io

```bash
fly launch --dockerfile Dockerfile --no-deploy
fly volumes create data --size 1
# Edit fly.toml: add [[mounts]] source = "data", destination = "/app/data"
fly secrets set PROXY_API_KEY=...
fly deploy
```

### Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https%3A%2F%2Fgithub.com%2Fsyrikm%2Fdavidfuckrp)

(Repo must be public, or add Railway as a collaborator.)

### Local Docker

```bash
docker build -t davidfuckrp .
docker run -p 8080:8080 \
  -e PROXY_API_KEY=$(openssl rand -hex 32) \
  -v $(pwd)/data:/app/data \
  davidfuckrp
```

Hit `http://localhost:8080/api/health` — should return 200.

---

## Notes about persistence

`STORAGE_BACKEND=local` writes to `/app/data` (model registry, OR snapshots, response cache, usage stats). The image creates this directory and `chown`s it to the `node` user. Mount a volume there or you lose state on every container restart.

`STORAGE_BACKEND=s3` works with anything S3-compatible:
- AWS S3
- Cloudflare R2 (`S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`)
- Backblaze B2 (`S3_ENDPOINT=https://s3.<region>.backblazeb2.com`)
- MinIO self-hosted

Bucket only needs read+write to a single prefix; no public access required.

---

## Health check

`GET /api/health` returns 200 with a JSON body summarising backend / model
counts. Configured in the Dockerfile as a `HEALTHCHECK` (30 s interval,
20 s grace period for cache warm-up).

## Bundle size

Final runtime image is ~150 MB (Node 24 alpine + dist + pruned node_modules
for the few esbuild externals: `@aws-sdk/client-s3`, `google-auth-library`,
`drizzle-orm`).
