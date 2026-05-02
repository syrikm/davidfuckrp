import { Router, type IRouter, type Request, type Response } from "express";
import { getProxyApiKey } from "../lib/backendPool";
import { readJson, writeJson } from "../lib/cloudPersist";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Settings persistence — backed by the pluggable storage adapter layer
// (local-fs / S3 / R2 / GCS / Replit App Storage) via cloudPersist.
// File: server_settings.json
//
// Hydration barrier: a single hydrationPromise resolves once the persisted
// value is loaded into in-memory state. The POST handler awaits it before
// mutating + persisting, eliminating the stale-overwrite race where an
// early POST would otherwise be clobbered by a late hydrate. The GET
// handler also awaits so callers see the persisted value (not the default
// `false`) once the process is up.
//
// `getSillyTavernMode()` keeps a sync signature for proxy.ts hot-path
// callers; before hydrate completes it returns the safe default `false`,
// which matches behavior when the file does not yet exist.
// ---------------------------------------------------------------------------

const SETTINGS_FILE = "server_settings.json";

interface ServerSettings {
  sillyTavernMode: boolean;
}

const settings: ServerSettings = { sillyTavernMode: false };

const hydrationPromise: Promise<void> = (async () => {
  try {
    const raw = await readJson<Partial<ServerSettings>>(SETTINGS_FILE);
    if (raw && typeof raw.sillyTavernMode === "boolean") {
      settings.sillyTavernMode = raw.sillyTavernMode;
    }
  } catch (err) {
    console.error(`[settings] failed to hydrate ${SETTINGS_FILE}:`, err);
  }
})();

async function saveSettings(s: ServerSettings): Promise<void> {
  try {
    await writeJson(SETTINGS_FILE, s);
  } catch (err) {
    console.error(`[settings] failed to persist ${SETTINGS_FILE}:`, err);
    throw err;
  }
}

export function getSillyTavernMode(): boolean {
  return settings.sillyTavernMode;
}

// ---------------------------------------------------------------------------
// Auth helper — reuse same auth channels as proxy
// ---------------------------------------------------------------------------

function checkApiKey(req: Request, res: Response): boolean {
  const proxyKey = getProxyApiKey();
  if (!proxyKey) {
    res.status(500).json({ error: { message: "Server API key not configured", type: "server_error" } });
    return false;
  }

  const authHeader = req.headers["authorization"];
  const xApiKey = req.headers["x-api-key"];
  const googApiKey = req.headers["x-goog-api-key"];
  const queryKey = req.query["key"];

  let provided: string | undefined;
  if (authHeader?.startsWith("Bearer ")) provided = authHeader.slice(7);
  else if (typeof googApiKey === "string" && googApiKey) provided = googApiKey;
  else if (typeof xApiKey === "string" && xApiKey) provided = xApiKey;
  else if (typeof queryKey === "string" && queryKey) provided = queryKey;

  if (!provided || provided !== proxyKey) {
    res.status(401).json({
      error: {
        message: "Unauthorized",
        type: "invalid_request_error",
        acceptedAuth: ["Authorization: Bearer <key>", "x-goog-api-key", "x-api-key", "query:key"],
      },
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GET /settings/sillytavern
// ---------------------------------------------------------------------------

router.get("/settings/sillytavern", async (req: Request, res: Response) => {
  if (!checkApiKey(req, res)) return;
  await hydrationPromise;
  res.json({ enabled: settings.sillyTavernMode });
});

// ---------------------------------------------------------------------------
// POST /settings/sillytavern
// ---------------------------------------------------------------------------

router.post("/settings/sillytavern", async (req: Request, res: Response) => {
  if (!checkApiKey(req, res)) return;
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: { message: "enabled 字段必须为 boolean", type: "invalid_request_error" } });
    return;
  }
  // Wait for the on-disk value to land in memory before mutating; otherwise a
  // request that arrives within the first few ms after process start could be
  // overwritten by the late hydrate.
  await hydrationPromise;
  settings.sillyTavernMode = enabled;
  try {
    await saveSettings(settings);
  } catch {
    res.status(500).json({ error: { message: "Failed to persist settings", type: "server_error" } });
    return;
  }
  res.json({ enabled: settings.sillyTavernMode });
});

export default router;
