import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getStorageAdapter } from "../lib/storage";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/setup-status", (_req, res) => {
  const configured = !!process.env.PROXY_API_KEY;
  const friendProxyConfigured = !!process.env.FRIEND_PROXY_URL;

  // storageBackend: informational — exact adapter currently in play
  // (e.g. "local-fs:./data", "s3:my-bucket/config/", "replit-app-storage:...").
  // storageReady semantics (preserved for the SetupWizard): true ONLY when a
  // durable cloud backend is configured — local-fs is treated as not-ready so
  // the wizard can prompt the user to set up R2 / S3 / GCS / Replit App
  // Storage for production-grade persistence. The data layer itself is always
  // functional; this flag is purely a UX hint about durability.
  let storageBackend = "unknown";
  let storageReady = false;
  try {
    storageBackend = getStorageAdapter().displayName;
    storageReady = !storageBackend.startsWith("local-fs:");
  } catch (err) {
    storageBackend = err instanceof Error ? `error: ${err.message}` : "error";
    storageReady = false;
  }

  res.json({ configured, friendProxyConfigured, storageReady, storageBackend });
});

export default router;
