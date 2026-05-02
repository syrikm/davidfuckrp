import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  NoSuchKey,
} from "@aws-sdk/client-s3";
import type { StorageAdapter } from "./adapter";

/**
 * S3-compatible storage adapter. Works with:
 *   - AWS S3                   (default)
 *   - Cloudflare R2            (free tier, recommended cloud option)
 *   - MinIO / self-hosted
 *   - Backblaze B2 S3-compat
 *   - DigitalOcean Spaces
 *
 * Required env vars:
 *   STORAGE_S3_BUCKET             — bucket name
 *   STORAGE_S3_ACCESS_KEY_ID      — access key
 *   STORAGE_S3_SECRET_ACCESS_KEY  — secret key
 *
 * Optional:
 *   STORAGE_S3_ENDPOINT  — custom endpoint URL (REQUIRED for R2/MinIO/etc.)
 *                          R2 example: https://<account-id>.r2.cloudflarestorage.com
 *   STORAGE_S3_REGION    — region (default "auto" — works for R2; use real region for AWS)
 *   STORAGE_S3_PREFIX    — key prefix (default "config/")
 *   STORAGE_S3_FORCE_PATH_STYLE  — "true" to force path-style URLs (MinIO etc.)
 */
export class S3StorageAdapter implements StorageAdapter {
  readonly displayName: string;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor() {
    const bucket = process.env.STORAGE_S3_BUCKET;
    const accessKeyId = process.env.STORAGE_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.STORAGE_S3_SECRET_ACCESS_KEY;
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "S3 storage backend requires STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID, and STORAGE_S3_SECRET_ACCESS_KEY env vars.",
      );
    }
    this.bucket = bucket;
    this.prefix = process.env.STORAGE_S3_PREFIX ?? "config/";

    const endpoint = process.env.STORAGE_S3_ENDPOINT;
    const region = process.env.STORAGE_S3_REGION ?? "auto";
    const forcePathStyle = process.env.STORAGE_S3_FORCE_PATH_STYLE === "true";

    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
    });

    const target = endpoint ? `${endpoint}/${bucket}` : `s3://${bucket}`;
    this.displayName = `s3:${target}/${this.prefix}`;
  }

  private key(name: string): string {
    return `${this.prefix}${name}`;
  }

  async read<T>(name: string): Promise<T | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(name) }),
      );
      const body = await res.Body?.transformToString("utf8");
      if (!body) return null;
      return JSON.parse(body) as T;
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      const code = (err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }).name
        ?? (err as { Code?: string }).Code;
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (code === "NoSuchKey" || code === "NotFound" || status === 404) return null;
      throw err;
    }
  }

  async write<T>(name: string, data: T): Promise<void> {
    const body = JSON.stringify(data, null, 2);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(name),
        Body: body,
        ContentType: "application/json",
      }),
    );
  }
}
