import { Router, type IRouter, type Request, type Response } from "express";
import { getProxyApiKey } from "../lib/backendPool";
import { readJson, writeJson } from "../lib/cloudPersist";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Settings persistence — backed by the pluggable storage adapter layer
// (local-fs / S3 / R2 / GCS / Replit App Storage) via cloudPersist.
// File: server_settings.json
//
// Hydration uses TOP-LEVEL AWAIT so that any module that imports this file
// (notably routes/proxy.ts via the sync `getSillyTavernMode` export) is
// guaranteed to see the persisted value on first call. This eliminates the
// startup window where the proxy hot-path could observe the default `false`
// while the on-disk value was actually `true`. Both importers are static
// ESM (routes/index.ts, routes/proxy.ts) so there is no deadlock risk; the
// only cost is one storage `read` on cold start (~ms for local-fs, ~tens of
// ms for cloud).
//
// `hydrationPromise` is still exported in spirit (kept resolved by the time
// any handler runs) and the POST handler still calls saveSettings serially.
// ---------------------------------------------------------------------------

const SETTINGS_FILE = "server_settings.json";

interface ServerSettings {
  sillyTavernMode: boolean;
}

const settings: ServerSettings = { sillyTavernMode: false };

try {
  const raw = await readJson<Partial<ServerSettings>>(SETTINGS_FILE);
  if (raw && typeof raw.sillyTavernMode === "boolean") {
    settings.sillyTavernMode = raw.sillyTavernMode;
  }
} catch (err) {
  console.error(`[settings] failed to hydrate ${SETTINGS_FILE}:`, err);
}

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

router.get("/settings/sillytavern", (req: Request, res: Response) => {
  if (!checkApiKey(req, res)) return;
  // Hydration completed via top-level await above; safe to read sync.
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
  settings.sillyTavernMode = enabled;
  // Pass a snapshot so an overlapping POST that mutates `settings` mid-flight
  // can't bleed into this write (the local adapter's per-key mutex serializes
  // the rename, but it serializes whatever value was captured here).
  const snapshot: ServerSettings = { ...settings };
  try {
    await saveSettings(snapshot);
  } catch {
    res.status(500).json({ error: { message: "Failed to persist settings", type: "server_error" } });
    return;
  }
  res.json({ enabled: snapshot.sillyTavernMode });
});

export default router;
