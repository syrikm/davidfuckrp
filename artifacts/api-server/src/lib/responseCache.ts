import { promises as fsp, mkdirSync } from "fs";
import { join } from "path";
// Import unified cache key generator (shared with vcpfuckcachefork-github)
import { hashRequest, stableReplacer, generateCacheKey } from "./unifiedCacheKey";

// Re-export for backward compatibility
export { hashRequest, stableReplacer, generateCacheKey };

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  ttlMinutes: number;
  enabled: boolean;
  maxEntries: number;
  inflight: number;
  persistent: boolean;
}

export interface CacheEntry {
  data: unknown;
  expiresAt: number;
  model: string;
  chunks?: string[]; // SSE chunks for streaming responses
}

const DEFAULT_TTL_MS = 60 * 60 * 1_000; // 1 hour
const DEFAULT_MAX_ENTRIES = 500;
const GC_INTERVAL_MS = 10 * 60 * 1_000; // 10 minutes

// ---------------------------------------------------------------------------
// Shard-based partitioned cache
// Each shard has its own Map and mutex lock, eliminating contention.
// ---------------------------------------------------------------------------

const SHARD_COUNT = 16;

class ShardMutex {
  private _queue: Array<() => void> = [];
  private _locked = false;

  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this._locked) {
        this._locked = true;
        resolve();
      } else {
        this._queue.push(resolve);
      }
    });
  }

  release(): void {
    if (this._queue.length > 0) {
      const next = this._queue.shift()!;
      next();
    } else {
      this._locked = false;
    }
  }

  async run<T>(fn: () => T): Promise<T> {
    await this.acquire();
    try {
      return fn();
    } finally {
      this.release();
    }
  }
}

interface CacheShard {
  map: Map<string, CacheEntry>;
  mutex: ShardMutex;
}

function shardIndex(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h) + key.charCodeAt(i);
    h |= 0; // Convert to 32bit integer
  }
  return Math.abs(h) % SHARD_COUNT;
}

const shards: CacheShard[] = Array.from({ length: SHARD_COUNT }, () => ({
  map: new Map(),
  mutex: new ShardMutex(),
}));

function getShard(key: string): CacheShard {
  return shards[shardIndex(key)];
}

// Global stats aggregation
let hits = 0;
let misses = 0;
const statsMutex = new ShardMutex();

let ttlMs = DEFAULT_TTL_MS;
let maxEntries = DEFAULT_MAX_ENTRIES;
let enabled = true;

// ---------------------------------------------------------------------------
// Disk persistence
// ---------------------------------------------------------------------------

const CACHE_DIR  = join(process.cwd(), ".cache");
const CACHE_FILE = join(CACHE_DIR, "responses.json");
const CACHE_TMP  = join(CACHE_DIR, "responses.json.tmp");

try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* already exists */ }

let diskWriteTimer: ReturnType<typeof setTimeout> | null = null;
let diskWritePending = false;

function scheduleDiskWrite(): void {
  if (diskWriteTimer) clearTimeout(diskWriteTimer);
  diskWriteTimer = setTimeout(() => {
    diskWriteTimer = null;
    if (diskWritePending) {
      scheduleDiskWrite();
      return;
    }
    diskWritePending = true;
    writeCacheToDisk()
      .catch(() => { /* I/O errors are non-fatal */ })
      .finally(() => { diskWritePending = false; });
  }, 100);
}

async function writeCacheToDisk(): Promise<void> {
  const now = Date.now();
  const snapshot: Record<string, CacheEntry> = {};
  for (const shard of shards) {
    for (const [k, v] of shard.map.entries()) {
      if (now <= v.expiresAt) snapshot[k] = v;
    }
  }
  const json = JSON.stringify(snapshot);
  await fsp.writeFile(CACHE_TMP, json, "utf8");
  await fsp.rename(CACHE_TMP, CACHE_FILE);
}

async function loadCacheFromDisk(): Promise<void> {
  let raw: string;
  try {
    raw = await fsp.readFile(CACHE_FILE, "utf8");
  } catch {
    return;
  }
  let snapshot: Record<string, CacheEntry>;
  try {
    snapshot = JSON.parse(raw) as Record<string, CacheEntry>;
  } catch {
    return;
  }
  const now = Date.now();
  let loaded = 0;
  for (const [k, v] of Object.entries(snapshot)) {
    if (now <= v.expiresAt) {
      const shard = getShard(k);
      shard.map.set(k, v);
      loaded++;
    }
  }
  if (loaded > 0) {
    process.stdout.write(`[cache] Loaded ${loaded} entries from disk\n`);
  }
}

export const cacheReady: Promise<void> = loadCacheFromDisk().catch(() => { /* I/O errors are non-fatal */ });

// ---------------------------------------------------------------------------
// In-flight deduplication
// ---------------------------------------------------------------------------

const inflightRequests = new Map<string, Array<() => void>>();

export function markInflight(key: string): (() => void) | null {
  if (inflightRequests.has(key)) return null;
  inflightRequests.set(key, []);
  return () => {
    const waiters = inflightRequests.get(key) ?? [];
    inflightRequests.delete(key);
    for (const resolve of waiters) resolve();
  };
}

export function waitForInflight(key: string): Promise<boolean> {
  const waiters = inflightRequests.get(key);
  if (!waiters) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    waiters.push(() => resolve(true));
  });
}

// ---------------------------------------------------------------------------
// Periodic GC — async batch processing with setImmediate
// ---------------------------------------------------------------------------

function evictExpired(): void {
  const now = Date.now();
  for (const shard of shards) {
    for (const [k, v] of shard.map.entries()) {
      if (now > v.expiresAt) shard.map.delete(k);
    }
  }
}

async function evictExpiredAsync(): Promise<void> {
  const now = Date.now();
  for (const shard of shards) {
    for (const [k, v] of shard.map.entries()) {
      if (now > v.expiresAt) shard.map.delete(k);
    }
    // Yield to event loop between shards to avoid blocking
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

setInterval(() => { void evictExpiredAsync(); }, GC_INTERVAL_MS).unref();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function cacheGet(key: string): CacheEntry | null {
  if (!enabled) { misses++; return null; }
  const shard = getShard(key);
  const entry = shard.map.get(key);
  if (!entry) { misses++; return null; }
  if (Date.now() > entry.expiresAt) { shard.map.delete(key); misses++; return null; }
  hits++;
  return entry;
}

export function cacheSet(key: string, data: unknown, model: string, chunks?: string[]): void {
  if (!enabled) return;

  const shard = getShard(key);
  if (shard.map.has(key)) {
    shard.map.set(key, { data, expiresAt: Date.now() + ttlMs, model, chunks });
    scheduleDiskWrite();
    return;
  }

  // Check global capacity across all shards
  let totalSize = 0;
  for (const s of shards) totalSize += s.map.size;

  if (totalSize >= maxEntries) {
    evictExpired();
    // Re-count after eviction
    totalSize = 0;
    for (const s of shards) totalSize += s.map.size;
    if (totalSize >= maxEntries) {
      // Evict oldest entry from this shard
      const oldestKey = shard.map.keys().next().value;
      if (oldestKey) shard.map.delete(oldestKey);
    }
  }

  shard.map.set(key, { data, expiresAt: Date.now() + ttlMs, model, chunks });
  scheduleDiskWrite();
}

export async function cacheClear(): Promise<void> {
  for (const shard of shards) shard.map.clear();
  hits = 0;
  misses = 0;
  if (diskWriteTimer) { clearTimeout(diskWriteTimer); diskWriteTimer = null; }
  await fsp.unlink(CACHE_FILE).catch(() => { /* file may not exist */ });
}

export async function getCacheStats(): Promise<CacheStats> {
  await evictExpiredAsync();
  let size = 0;
  for (const shard of shards) size += shard.map.size;

  return {
    hits,
    misses,
    size,
    ttlMinutes: Math.round(ttlMs / 60_000),
    enabled,
    maxEntries,
    inflight: inflightRequests.size,
    persistent: true,
  };
}

// ---------------------------------------------------------------------------
// Configuration setters
// ---------------------------------------------------------------------------

export function setCacheTtl(minutes: number): void {
  ttlMs = Math.max(1, minutes) * 60_000;
}

export function setCacheEnabled(e: boolean): void {
  enabled = e;
}

export function setCacheMaxEntries(n: number): void {
  maxEntries = Math.max(1, n);
}