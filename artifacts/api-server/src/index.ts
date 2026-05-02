import app from "./app";
import { logger } from "./lib/logger";
import { initReady, statsReady } from "./routes/proxy";
import { cacheReady } from "./lib/responseCache";
import { startUpdateChecker } from "./lib/updateChecker";
import { startHotUpdateChecker } from "./lib/hotUpdater";

// Fail fast: PROXY_API_KEY is required for all admin/API authentication.
// Without it the gateway runs unauthenticated — reject at startup rather than
// silently accepting any token. (Mirrors child proxy commit 0f47820a safeguard)
if (!process.env["PROXY_API_KEY"]) {
  throw new Error(
    "PROXY_API_KEY environment variable is required but was not provided. " +
    "Set the PROXY_API_KEY environment variable before starting the server.",
  );
}

// PORT defaults to 8080 in container deployments where the orchestrator
// (ClawCloud Run / Render / Fly / Cloud Run / Docker) doesn't always set
// it explicitly. On Replit the workflow injects PORT and overrides this.
const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Wait for disk cache to be restored before accepting requests.
// This prevents false cache misses in the first few seconds after a restart.
await cacheReady;

Promise.all([initReady, statsReady]).then(() => {
  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
    
    // Start legacy update checker (for response header injection)
    startUpdateChecker();
    
    // Start hot update checker (for GitHub release detection and auto-update)
    startHotUpdateChecker();
  });

  // Zero out all Node.js HTTP server timeouts so that long-running AI requests
  // (especially thinking/reasoning models) are never cut by Node itself.
  // Any upstream reverse proxy idle/total cut is handled separately by the SSE
  // keepalive + Leg B wall timer in proxy.ts (configurable via
  // GATEWAY_KEEPALIVE_* / GATEWAY_LEG_B_WALL_MS env vars).
  // These four lines only cover the Node layer.
  server.headersTimeout   = 0;
  server.requestTimeout   = 0;
  server.timeout          = 0;
  server.keepAliveTimeout = 0;
}).catch((err) => {
  logger.error({ err }, "Failed to initialise persisted data");
  process.exit(1);
});