import { Storage } from "@google-cloud/storage";
import type { StorageAdapter } from "./adapter";

/**
 * Google Cloud Storage adapter using standard service-account credentials
 * (NOT Replit sidecar — for that, see replit.ts).
 *
 * Required env vars:
 *   STORAGE_GCS_BUCKET          — bucket name
 *
 * Auth (any of):
 *   GOOGLE_APPLICATION_CREDENTIALS  — path to service-account JSON key file
 *   GCS_PROJECT_ID + ambient ADC    — running on GCE/GKE/Cloud Run
 *
 * Optional:
 *   STORAGE_GCS_PREFIX  — object key prefix (default "config/")
 */
export class GcsStorageAdapter implements StorageAdapter {
  readonly displayName: string;
  private readonly storage: Storage;
  private readonly bucketName: string;
  private readonly prefix: string;

  constructor() {
    const bucket = process.env.STORAGE_GCS_BUCKET;
    if (!bucket) {
      throw new Error("GCS storage backend requires STORAGE_GCS_BUCKET env var.");
    }
    this.bucketName = bucket;
    this.prefix = process.env.STORAGE_GCS_PREFIX ?? "config/";
    this.storage = new Storage({
      projectId: process.env.GCS_PROJECT_ID,
    });
    this.displayName = `gcs:${bucket}/${this.prefix}`;
  }

  private key(name: string): string {
    return `${this.prefix}${name}`;
  }

  async read<T>(name: string): Promise<T | null> {
    try {
      const file = this.storage.bucket(this.bucketName).file(this.key(name));
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
    const file = this.storage.bucket(this.bucketName).file(this.key(name));
    await file.save(JSON.stringify(data, null, 2), { contentType: "application/json" });
  }
}
