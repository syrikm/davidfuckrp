import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import router from "./routes";
import proxyRouter from "./routes/proxy";
import { logger } from "./lib/logger";
import { safeVersionHeader } from "./routes/update";
import { hotUpdateState, recordActivity } from "./lib/hotUpdater";

const app: Express = express();

// Read version once at startup and cache it as a safe ASCII-only string.
// safeVersionHeader() strips non-ASCII chars (e.g. Greek α β) that would cause
// Node.js ERR_INVALID_CHAR when writing them into an HTTP response header.
const PROXY_VERSION_STATIC: string = (() => {
  const candidates = [
    resolve(process.cwd(), "version.json"),
    resolve(process.cwd(), "../../version.json"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const v = (JSON.parse(readFileSync(p, "utf8")) as { version?: string }).version ?? "unknown";
        return safeVersionHeader(v);
      }
    } catch {}
  }
  return "unknown";
})();

// Stamp every response with the proxy version and update-available flag.
// X-Proxy-Version: static value read at startup (never changes during runtime).
// X-Update-Available: dynamic — set by the hot update checker.
app.use((_req: Request, res: Response, next: NextFunction) => {
  recordActivity();
  // Prefer hotUpdateState.currentVersion once the checker has run;
  // fall back to the static value during the brief startup window.
  const version = hotUpdateState.currentVersion !== "unknown"
    ? safeVersionHeader(hotUpdateState.currentVersion)
    : PROXY_VERSION_STATIC;
  res.setHeader("X-Proxy-Version", version);
  if (hotUpdateState.latestVersion) {
    res.setHeader("X-Update-Available", safeVersionHeader(hotUpdateState.latestVersion));
  }
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    // Browser fetch() can only read response headers that the server explicitly
    // exposes via Access-Control-Expose-Headers.
    // x-resume-token: live-job resume protocol — client JS reads this after a
    //   mid-stream disconnect to reattach to the in-flight job without losing output.
    // X-Proxy-Version / X-Update-Available: surfaced by the portal update badge.
    exposedHeaders: ["x-resume-token", "X-Proxy-Version", "X-Update-Available"],
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ---------------------------------------------------------------------------
// Portal UI (api-portal SPA) — bundled into the same image at build time.
// ---------------------------------------------------------------------------
// Dockerfile builds artifacts/api-portal with `vite build base=/portal/` and
// copies the output to /app/portal-dist. The portal calls the API via
// `${window.location.origin}/api/...`, so serving it from the same origin as
// the API means zero CORS / config friction.
//
// In local dev (no Docker) portal-dist won't exist → portalEnabled stays false
// and `/` falls back to the JSON info response.
// ---------------------------------------------------------------------------
const portalDist = resolve(process.cwd(), "portal-dist");
const portalEnabled = existsSync(join(portalDist, "index.html"));

if (portalEnabled) {
  // Static assets first. fallthrough:true (default) lets the SPA fallback
  // below handle "deep links" like /portal/dashboard that aren't real files.
  app.use(
    "/portal",
    express.static(portalDist, {
      index: "index.html",
      // Hashed bundles in /portal/assets/* are immutable — long cache OK.
      // index.html itself is cached short so users pick up new deploys fast.
      maxAge: "7d",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  // SPA fallback: any unmatched /portal/* request → index.html so client-side
  // routing (wouter) can take over.
  app.use("/portal", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(portalDist, "index.html"));
  });
}

// Root: redirect to portal if bundled, otherwise return JSON info (useful for
// curl / uptime monitors and for builds without the UI compiled in).
app.get("/", (_req: Request, res: Response) => {
  if (portalEnabled) {
    return res.redirect(302, "/portal/");
  }
  res.json({
    name: "davidfuckrp",
    description: "AI proxy gateway (mother).",
    version: hotUpdateState.currentVersion !== "unknown"
      ? hotUpdateState.currentVersion
      : PROXY_VERSION_STATIC,
    portal: "(not bundled in this build)",
    endpoints: {
      health:        "/api/healthz",
      setup_status:  "/api/setup-status",
      list_models:   "/v1/models           (Authorization: Bearer <PROXY_API_KEY>)",
      chat:          "POST /v1/chat/completions",
      messages:      "POST /v1/messages",
      admin_backends:"/api/v1/admin/backends",
      admin_models:  "/api/v1/admin/models",
    },
    docs: "https://github.com/syrikm/davidfuckrp",
  });
});

app.use("/api", router);
app.use(proxyRouter);
app.use("/api", proxyRouter);

export default app;