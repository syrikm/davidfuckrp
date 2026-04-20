import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/setup-status", (_req, res) => {
  const configured = !!process.env.PROXY_API_KEY;
  const friendProxyConfigured = !!process.env.FRIEND_PROXY_URL;
  const storageReady = !!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  res.json({ configured, friendProxyConfigured, storageReady });
});

export default router;
