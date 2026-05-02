import { Router, type IRouter, type Request, type Response } from "express";
import { getProxyApiKey } from "../lib/backendPool";
import { readJson, writeJson } from "../lib/cloudPersist";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Settings persistence — backed by the pluggable storage adapter layer
// (local-fs / S3 / R2 / GCS / Replit App Storage) via cloudPersist.
// File: server_settings.json
//
// Initial in-memory state defaults to safe values; an async hydrate runs at
// module load to overlay persisted values. Same pattern as backendPool and
// manualModelStore — a few-millisecond race with early GETs is acceptable
// (the endpoint just reports the default until hydration completes).
// ---------------------------------------------------------------------------

const SETTINGS_FILE = "server_settings.json";

interface ServerSettings {
  sillyTavernMode: boolean;
}

const settings: ServerSettings = { sillyTavernMode: false };

void (async () => {
  try {
    const raw = await readJson<Partial<ServerSettings>>(SETTINGS_FILE);
    if (raw && typeof raw.sillyTavernMode === "boolean") {
      settings.sillyTavernMode = raw.sillyTavernMode;
    }
  } catch (err) {
    console.error(`[settings] failed to hydrate ${SETTINGS_FILE}:`, err);
  }
})();

function saveSettings(s: ServerSettings): void {
  writeJson(SETTINGS_FILE, s).catch((err) => {
    console.error(`[settings] failed to persist ${SETTINGS_FILE}:`, err);
  });
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

router.get("/settings/sillytavern", (req: Request, res: Response) => {
  if (!checkApiKey(req, res)) return;
  res.json({ enabled: settings.sillyTavernMode });
});

// ---------------------------------------------------------------------------
// POST /settings/sillytavern
// ---------------------------------------------------------------------------

router.post("/settings/sillytavern", (req: Request, res: Response) => {
  if (!checkApiKey(req, res)) return;
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: { message: "enabled 字段必须为 boolean", type: "invalid_request_error" } });
    return;
  }
  settings.sillyTavernMode = enabled;
  saveSettings(settings);
  res.json({ enabled: settings.sillyTavernMode });
});

export default router;
