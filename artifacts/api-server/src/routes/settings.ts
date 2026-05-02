import { Router, type IRouter, type Request, type Response } from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { getProxyApiKey } from "../lib/backendPool";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

const SETTINGS_FILE = resolve(process.cwd(), "server_settings.json");

interface ServerSettings {
  sillyTavernMode: boolean;
}

function loadSettings(): ServerSettings {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as Partial<ServerSettings>;
      return {
        sillyTavernMode: typeof raw.sillyTavernMode === "boolean" ? raw.sillyTavernMode : false,
      };
    }
  } catch {}
  return { sillyTavernMode: false };
}

function saveSettings(s: ServerSettings): void {
  try { writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)); } catch {}
}

const settings: ServerSettings = loadSettings();

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
