/**
 * Storage adapter interface for cross-environment JSON persistence.
 *
 * Implementations live in sibling files (local.ts, s3.ts, gcs.ts, replit.ts).
 * The factory in `index.ts` picks one at startup based on `STORAGE_BACKEND` env.
 *
 * Stage B of the "make mother platform-independent" plan: previously cloudPersist
 * was hard-wired to Replit App Storage (GCS via sidecar). Now mother runs on any
 * Node.js host with a pluggable storage backend.
 */

export interface StorageAdapter {
  /** Display name for logs / status, e.g. "local-fs:./data" or "s3:r2/bucket-name". */
  readonly displayName: string;

  /**
   * Read a JSON file. Returns `null` when the named object does not exist
   * (NOT an error). All other failures throw.
   */
  read<T>(name: string): Promise<T | null>;

  /** Persist a JSON object atomically. Throws on failure. */
  write<T>(name: string, data: T): Promise<void>;
}
