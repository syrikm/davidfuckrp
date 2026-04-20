import { logger } from "./logger";
import { readLocalVersion, resolveVersionUrl, compareVersions } from "./versionUtils";

// -- Shared update state (read by app.ts to inject response headers) ----------

export const updateState = {
  currentVersion: "unknown",
  latestVersion: null as string | null,
  updateAvailable: false,
};

// -- Check function -----------------------------------------------------------

const UPDATE_SOURCE_URL = process.env["UPDATE_SOURCE_URL"] ??
  "https://github.com/sayrui/Replit2Api";

async function checkForUpdate(): Promise<void> {
  const local = readLocalVersion();
  updateState.currentVersion = local;

  try {
    const versionUrl = resolveVersionUrl(UPDATE_SOURCE_URL);
    const r = await fetch(versionUrl, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return;
    const body = await r.json() as { current?: { version?: string }; version?: string };
    const remoteVersion = body.current?.version ?? (body as { version?: string }).version ?? null;
    if (!remoteVersion) return;

    updateState.latestVersion = remoteVersion;
    updateState.updateAvailable =
      local !== "unknown" && compareVersions(remoteVersion, local) > 0;

    if (updateState.updateAvailable) {
      logger.warn(
        { currentVersion: local, latestVersion: remoteVersion },
        `[update] New version available: v${local} → v${remoteVersion}. Open the portal to apply.`,
      );
    } else {
      logger.info({ version: local }, "[update] Up to date");
    }
  } catch {
    // Remote check failed — non-fatal
  }
}

// -- Startup + periodic checker -----------------------------------------------

const CHECK_INTERVAL_MS = 60 * 60 * 1_000; // 1 hour

export function startUpdateChecker(): void {
  // Short delay so the server finishes starting before the first network call
  setTimeout(() => { void checkForUpdate(); }, 3_000);
  setInterval(() => { void checkForUpdate(); }, CHECK_INTERVAL_MS);
}
