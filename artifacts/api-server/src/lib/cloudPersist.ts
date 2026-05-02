/**
 * cloudPersist.ts
 *
 * Thin wrapper over the pluggable storage adapter layer (`./storage/`).
 * Selection rule lives in `./storage/index.ts#getStorageAdapter`:
 *   1. STORAGE_BACKEND env var (local | s3 | r2 | gcs | replit)
 *   2. DEFAULT_OBJECT_STORAGE_BUCKET_ID present → replit (back-compat)
 *   3. Otherwise → local (writes to ./data/, no credentials needed)
 *
 * R2 (Cloudflare's free S3-compatible storage) is the recommended cloud option:
 *   STORAGE_BACKEND=r2
 *   STORAGE_S3_BUCKET=<your-bucket>
 *   STORAGE_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
 *   STORAGE_S3_ACCESS_KEY_ID=<r2-access-key>
 *   STORAGE_S3_SECRET_ACCESS_KEY=<r2-secret>
 */

import { getStorageAdapter } from "./storage";

/** Read a JSON config file. Returns `null` if it does not exist yet. */
export async function readJson<T>(name: string): Promise<T | null> {
  try {
    return await getStorageAdapter().read<T>(name);
  } catch (err) {
    console.error(`[cloudPersist] read failed for ${name}:`, err);
    return null;
  }
}

/**
 * Write a JSON config file. Logs **and rethrows** on failure so callers can
 * surface persistence errors to the user (e.g. settings.ts returns 500).
 *
 * All existing callers either chain `.catch()` (fire-and-forget for
 * background flushes in proxy.ts/backendPool) or wrap in try/catch
 * (manualModelStore.ts). New callers that need the legacy "log and ignore"
 * semantics should append `.catch(() => undefined)` themselves — making the
 * intent explicit at the call site rather than swallowing globally.
 */
export async function writeJson<T>(name: string, data: T): Promise<void> {
  try {
    await getStorageAdapter().write(name, data);
  } catch (err) {
    console.error(`[cloudPersist] write failed for ${name}:`, err);
    throw err;
  }
}
