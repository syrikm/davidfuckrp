import { Storage } from "@google-cloud/storage";
import type { StorageAdapter } from "./adapter";

/**
 * Replit App Storage adapter — uses the Replit sidecar for federated GCS auth.
 * Kept for backward compatibility with existing Replit deployments. New users
 * should prefer R2 (cheaper, S3 adapter) or local-fs.
 *
 * Required env vars (auto-injected by the Replit platform):
 *   DEFAULT_OBJECT_STORAGE_BUCKET_ID  — bucket id
 *
 * Behavior matches the legacy cloudPersist.ts:
 *   - prod (REPLIT_DEPLOYMENT set): prefix "config/"
 *   - dev:                          prefix "config_dev/"
 */

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export class ReplitStorageAdapter implements StorageAdapter {
  readonly displayName: string;
  private readonly storage: Storage;
  private readonly bucketId: string;
  private readonly prefix: string;

  constructor() {
    const bucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucket) {
      throw new Error(
        "Replit App Storage backend requires DEFAULT_OBJECT_STORAGE_BUCKET_ID env var (auto-injected on Replit).",
      );
    }
    this.bucketId = bucket;
    const isProd = !!process.env.REPLIT_DEPLOYMENT;
    this.prefix = isProd ? "config/" : "config_dev/";
    this.displayName = `replit-app-storage:${bucket}/${this.prefix}`;

    this.storage = new Storage({
      credentials: {
        audience: "replit",
        subject_token_type: "access_token",
        token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
        type: "external_account",
        credential_source: {
          url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
          format: { type: "json", subject_token_field_name: "access_token" },
        },
        universe_domain: "googleapis.com",
      } as unknown as { client_email: string; private_key: string },
      projectId: "",
    });
  }

  private key(name: string): string {
    return `${this.prefix}${name}`;
  }

  async read<T>(name: string): Promise<T | null> {
    try {
      const file = this.storage.bucket(this.bucketId).file(this.key(name));
      const [exists] = await file.exists();
      if (!exists) return null;
      const [contents] = await file.download();
      return JSON.parse(contents.toString("utf8")) as T;
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 404) return null;
      throw err;
    }
  }

  async write<T>(name: string, data: T): Promise<void> {
    const file = this.storage.bucket(this.bucketId).file(this.key(name));
    await file.save(JSON.stringify(data, null, 2), { contentType: "application/json" });
  }
}
