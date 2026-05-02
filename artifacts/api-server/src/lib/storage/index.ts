/**
 * Storage adapter factory.
 *
 * Selection rule (Stage B of make-mother-portable plan):
 *   1. If STORAGE_BACKEND env var is set → use exactly that adapter
 *      Accepted values: "local" | "s3" | "r2" | "gcs" | "replit"
 *      ("r2" is an alias for "s3" — Cloudflare R2 IS S3-compatible)
 *   2. Otherwise, if DEFAULT_OBJECT_STORAGE_BUCKET_ID is set → "replit"
 *      (back-compat with existing Replit deployments)
 *   3. Otherwise → "local" (default; works on any Node.js host)
 *
 * NOTE: The selected adapter is cached in a module-level singleton on first
 * call. Mutating STORAGE_BACKEND or related env vars after the first
 * `getStorageAdapter()` call has no effect — restart the process to switch
 * backends. This is intentional: storage choice should not flip mid-run.
 */

import type { StorageAdapter } from "./adapter";
import { LocalStorageAdapter } from "./local";
import { S3StorageAdapter } from "./s3";
import { GcsStorageAdapter } from "./gcs";
import { ReplitStorageAdapter } from "./replit";

export type StorageBackendKind = "local" | "s3" | "r2" | "gcs" | "replit";

let _adapter: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (_adapter) return _adapter;

  const explicit = (process.env.STORAGE_BACKEND ?? "").trim().toLowerCase();
  const hasReplitBucket = !!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;

  let kind: StorageBackendKind;
  if (explicit) {
    if (!isValidBackendKind(explicit)) {
      throw new Error(
        `Invalid STORAGE_BACKEND="${explicit}" — accepted: local, s3, r2, gcs, replit`,
      );
    }
    kind = explicit;
  } else if (hasReplitBucket) {
    kind = "replit";
  } else {
    kind = "local";
  }

  switch (kind) {
    case "local":
      _adapter = new LocalStorageAdapter();
      break;
    case "s3":
    case "r2":
      _adapter = new S3StorageAdapter();
      break;
    case "gcs":
      _adapter = new GcsStorageAdapter();
      break;
    case "replit":
      _adapter = new ReplitStorageAdapter();
      break;
  }

  console.log(`[storage] using adapter: ${_adapter.displayName} (selected via ${explicit ? "STORAGE_BACKEND env" : hasReplitBucket ? "Replit auto-detect" : "default"})`);
  return _adapter;
}

function isValidBackendKind(value: string): value is StorageBackendKind {
  return value === "local" || value === "s3" || value === "r2" || value === "gcs" || value === "replit";
}

export type { StorageAdapter } from "./adapter";
