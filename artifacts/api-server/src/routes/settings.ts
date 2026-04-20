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
  /**
   * Enable local node routing via Replit AI Integrations (AI_INTEGRATIONS_*
   * env vars).  When true, local is added to the backend pool alongside any
   * friend proxy sub-nodes; when false only friend sub-nodes are used.
   * Default: true (if AI_INTEGRATIONS env vars are present, local is used).
   */
  enableLocalNode: boolean;
}

function loadSettings(): ServerSettings {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as Partial<ServerSettings & { localNodeStrictDisable?: boolean }>;
      // Migrate legacy localNodeStrictDisable → enableLocalNode (inverted)
      // Default OFF — local node is opt-in; only true if explicitly saved as true.
      let enableLocal = false;
      if (typeof raw.enableLocalNode === "boolean") {
        enableLocal = raw.enableLocalNode;
      } else if (typeof raw.localNodeStrictDisable === "boolean") {
        // Legacy migration: strictDisable=false → user wanted local enabled → true
        enableLocal = !raw.localNodeStrictDisable;
      }
      return {
        sillyTavernMode: typeof raw.sillyTavernMode === "boolean" ? raw.sillyTavernMode : false,
        enableLocalNode: enableLocal,
      };
    }
  } catch {}
  return { sillyTavernMode: false, enableLocalNode: false };
}

function saveSettings(s: ServerSettings): void {
  try { writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)); } catch {}
}

const settings: ServerSettings = loadSettings();

export function getSillyTavernMode(): boolean {
  return settings.sillyTavernMode;
}

export function getEnableLocalNode(): boolean {
  return settings.enableLocalNode;
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

// ---------------------------------------------------------------------------
// GET /settings/local-node — 读取本地节点启用状态
// ---------------------------------------------------------------------------

router.get("/settings/local-node", (req: Request, res: Response) => {
  if (!checkApiKey(req, res)) return;
  const openaiUrl = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  const anthropicUrl = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
  const geminiUrl = process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"];
  const orUrl = process.env["AI_INTEGRATIONS_OPENROUTER_BASE_URL"];
  const hasIntegrations = !!(openaiUrl || anthropicUrl || geminiUrl || orUrl);
  res.json({
    enabled: settings.enableLocalNode,
    available: hasIntegrations,
    integrations: {
      openai: !!openaiUrl,
      anthropic: !!anthropicUrl,
      gemini: !!geminiUrl,
      openrouter: !!orUrl,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /settings/local-node — 切换本地节点启用
// ---------------------------------------------------------------------------

router.post("/settings/local-node", (req: Request, res: Response) => {
  if (!checkApiKey(req, res)) return;
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: { message: "enabled 字段必须为 boolean", type: "invalid_request_error" } });
    return;
  }
  settings.enableLocalNode = enabled;
  saveSettings(settings);
  res.json({ enabled: settings.enableLocalNode });
});

export default router;
