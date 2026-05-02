import { promises as fs } from "fs";
import { existsSync, mkdirSync } from "fs";
import { randomBytes } from "crypto";
import { dirname, resolve } from "path";
import type { StorageAdapter } from "./adapter";

/**
 * Local filesystem storage adapter — the default, requires no credentials and
 * runs anywhere Node.js does. Path overridable via `STORAGE_LOCAL_DIR` env.
 *
 * Concurrency model:
 *   1. Writes are atomic per-call: serialize JSON, write to a UNIQUE temp
 *      file (`<file>.tmp.<pid>.<rand>.<seq>`), then rename onto the target.
 *      Unique temp names prevent two concurrent writers from colliding on a
 *      shared `<file>.tmp` (one rename would otherwise lose its file with
 *      ENOENT, or worse, partially overwrite).
 *   2. Same-key writes are serialized through a per-key in-process mutex
 *      so that within one process the last writer wins deterministically
 *      (rather than the OS deciding the rename order). Cross-process
 *      writes to the same data dir are NOT coordinated — that requires a
 *      single owner of the data dir, which is the expected deployment
 *      model.
 *   3. Stale temp files left by a crash mid-write are harmless (different
 *      name from the canonical file, no read path looks at them).
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly displayName: string;
  private readonly baseDir: string;
  private readonly writeQueues = new Map<string, Promise<void>>();
  private writeSeq = 0;

  constructor(baseDir?: string) {
    this.baseDir = resolve(process.cwd(), baseDir ?? process.env.STORAGE_LOCAL_DIR ?? "data");
    this.displayName = `local-fs:${this.baseDir}`;
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async read<T>(name: string): Promise<T | null> {
    const path = resolve(this.baseDir, name);
    if (!existsSync(path)) return null;
    try {
      const content = await fs.readFile(path, "utf8");
      return JSON.parse(content) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async write<T>(name: string, data: T): Promise<void> {
    const path = resolve(this.baseDir, name);
    const previous = this.writeQueues.get(path) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined) // prior failure shouldn't cancel later writers
      .then(() => this.doWrite(path, data));

    // Track the in-flight write so concurrent calls chain behind it.
    this.writeQueues.set(path, next);

    // Always clean the queue entry once this write settles, but only if
    // we're still the tail (don't clobber a newer queued write).
    next.finally(() => {
      if (this.writeQueues.get(path) === next) {
        this.writeQueues.delete(path);
      }
    }).catch(() => undefined);

    return next;
  }

  private async doWrite<T>(path: string, data: T): Promise<void> {
    const seq = ++this.writeSeq;
    const tmpPath = `${path}.tmp.${process.pid}.${randomBytes(6).toString("hex")}.${seq}`;
    await fs.mkdir(dirname(path), { recursive: true });
    try {
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
      await fs.rename(tmpPath, path);
    } catch (err) {
      // Best-effort cleanup if the rename failed (writeFile succeeded but
      // rename did not); ignore secondary failure.
      await fs.unlink(tmpPath).catch(() => undefined);
      throw err;
    }
  }
}
