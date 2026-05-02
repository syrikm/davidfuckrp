import { promises as fs } from "fs";
import { existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import type { StorageAdapter } from "./adapter";

/**
 * Local filesystem storage adapter — the default, requires no credentials and
 * runs anywhere Node.js does. Path overridable via `STORAGE_LOCAL_DIR` env.
 *
 * Writes are atomic: write to `<file>.tmp` then rename to avoid corruption on
 * crashes mid-write.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly displayName: string;
  private readonly baseDir: string;

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
    const tmpPath = `${path}.tmp`;
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmpPath, path);
  }
}
