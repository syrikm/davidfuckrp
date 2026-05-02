import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
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

// Friendly root response — this is a backend-only API gateway, no UI on `/`.
// Without this people hit the deployed URL and get a bare 404, which looks broken.
// Returns a JSON usage hint with the live endpoint paths.
app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "davidfuckrp",
    description: "AI proxy gateway (mother). Backend-only — no UI on this URL.",
    version: hotUpdateState.currentVersion !== "unknown"
      ? hotUpdateState.currentVersion
      : PROXY_VERSION_STATIC,
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