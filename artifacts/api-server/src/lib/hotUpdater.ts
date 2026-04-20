import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
  readdirSync, statSync, rmSync, unlinkSync,
} from "fs";
import { resolve, join, dirname, relative } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { logger } from "./logger";
import { compareVersions } from "./versionUtils";
export { compareVersions } from "./versionUtils";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface HotUpdateConfig {
  /** GitHub owner/repo slug */
  githubRepo: string;
  /** GitHub branch (default: "main") */
  branch?: string;
  /** GitHub personal access token */
  githubToken?: string;
  /** Whether to auto-apply updates (default: false) */
  autoUpdate?: boolean;
  /** Base check interval in ms (default: 30 minutes) */
  checkIntervalMs?: number;
  /** Directory to store update backups */
  backupDir?: string;
  /** Whether to perform hot reload (default: false) */
  hotReload?: boolean;
  /** Whether hot update is enabled (default: true) */
  enabled?: boolean;
  /** Max check interval with exponential backoff (default: 120 minutes) */
  maxIntervalMs?: number;
  /** Enable exponential backoff (default: true) */
  exponentialBackoff?: boolean;
  /** Idle timeout before entering sleep (default: 15 minutes) */
  idleTimeoutMs?: number;
  /** Path to persist check cache */
  cachePath?: string;
}

// ---------------------------------------------------------------------------
// Update state
// ---------------------------------------------------------------------------

export interface UpdateState {
  status: "idle" | "checking" | "downloading" | "applying" | "restarting" | "rollback" | "failed" | "sleeping";
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  downloadProgress: number;
  error: string | null;
  backupPath: string | null;
  startTime: number | null;
  completedTime: number | null;
}

export const hotUpdateState: UpdateState = {
  status: "idle",
  currentVersion: "unknown",
  latestVersion: null,
  updateAvailable: false,
  downloadProgress: 0,
  error: null,
  backupPath: null,
  startTime: null,
  completedTime: null,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUNDLE_INCLUDE_DIRS = [
  "artifacts/api-server/src",
  "artifacts/api-portal/src",
  "artifacts/api-server/lib",   // registry.json + other generated assets
];

const BUNDLE_INCLUDE_FILES = [
  "version.json",
  "artifacts/api-portal/index.html",
  "artifacts/api-server/build.mjs",
  "artifacts/api-portal/package.json",
  "artifacts/api-portal/tsconfig.json",
  "artifacts/api-portal/vite.config.ts",
  "artifacts/api-portal/components.json",
  "artifacts/api-server/package.json",
  "artifacts/api-server/tsconfig.json",
  "artifacts/api-server/scripts/regenerate-registry.mjs",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  ".npmrc",
  ".replitignore",
  "README.md",
];

const BUNDLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".css", ".html", ".md", ".yaml", ".yml"]);
const BUNDLE_EXCLUDE = new Set(["node_modules", "dist", ".git", ".cache", ".update-backup"]);
const WORKSPACE_ROOT = resolve(process.cwd(), "../../");

// ---------------------------------------------------------------------------
// Buffer pool for GC optimization
// ---------------------------------------------------------------------------

class BufferPool {
  private pool: Buffer[] = [];
  private maxPoolSize: number;

  constructor(maxPoolSize: number = 4) {
    this.maxPoolSize = maxPoolSize;
  }

  acquire(size: number): Buffer {
    for (let i = 0; i < this.pool.length; i++) {
      if (this.pool[i].length >= size) {
        return this.pool.splice(i, 1)[0].slice(0, size);
      }
    }
    return Buffer.allocUnsafe(size);
  }

  release(buf: Buffer): void {
    if (this.pool.length < this.maxPoolSize) {
      this.pool.push(buf);
    }
  }
}

const bufferPool = new BufferPool(4);

// ---------------------------------------------------------------------------
// Persistent cache for cold start
// ---------------------------------------------------------------------------

interface CheckCache {
  latestVersion: string | null;
  lastCheckTime: number;
  consecutiveNoUpdates: number;
  /** Last commit SHA we successfully applied (40 hex chars). Used by SHA-based detection. */
  appliedSha?: string;
}

const DEFAULT_CACHE_PATH = join(WORKSPACE_ROOT, ".update-cache.json");

function readCheckCache(cachePath: string): CheckCache | null {
  try {
    if (!existsSync(cachePath)) return null;
    return JSON.parse(readFileSync(cachePath, "utf8")) as CheckCache;
  } catch {
    return null;
  }
}

function writeCheckCache(cachePath: string, cache: CheckCache): void {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache), "utf8");
  } catch {
    // Ignore cache write errors
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function githubHeaders(token?: string, etag?: string, lastModified?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Replit2Api-HotUpdater/2.0",
  };
  if (token) h.Authorization = `token ${token}`;
  if (etag) h["If-None-Match"] = etag;
  if (lastModified) h["If-Modified-Since"] = lastModified;
  return h;
}

// ---------------------------------------------------------------------------
// GitHub Release API
// ---------------------------------------------------------------------------

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  tarball_url: string;
  zipball_url: string;
  assets: Array<{
    name: string;
    size: number;
    browser_download_url: string;
  }>;
}

// ---------------------------------------------------------------------------
// Tarball download-and-apply (replaces per-file GitHub Contents API calls)
// Mirrors child proxy commit 0f47820a.
// ---------------------------------------------------------------------------

/**
 * Download the whole branch as a single tarball and extract only the paths in
 * BUNDLE_INCLUDE_DIRS / BUNDLE_INCLUDE_FILES into WORKSPACE_ROOT.
 *
 * One HTTP request replaces the previous N×per-file Contents API calls.
 * GNU tar's --wildcards option handles the `{owner}-{repo}-{sha}/` prefix
 * that GitHub prepends to every path inside the archive.
 */
export async function downloadAndApplyTarball(
  config: HotUpdateConfig,
): Promise<{ success: boolean; writtenFiles: number; error?: string }> {
  const { githubRepo, branch = "main", githubToken } = config;
  const tarUrl = `https://api.github.com/repos/${githubRepo}/tarball/${branch}`;
  const tmpTar = join(tmpdir(), `hot-update-${Date.now()}.tar.gz`);

  try {
    // 1. Download tarball
    const res = await fetch(tarUrl, {
      headers: { ...githubHeaders(githubToken), Accept: "application/vnd.github.v3+json" },
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Tarball fetch failed: HTTP ${res.status}`);
    writeFileSync(tmpTar, Buffer.from(await res.arrayBuffer()));
    hotUpdateState.downloadProgress = 50;

    // 2. Build list of patterns for tar.
    //    GitHub wraps everything in a top-level "{owner}-{repo}-{sha}/" dir;
    //    the '*/' prefix and --strip-components=1 together remove it.
    const patterns = [
      ...BUNDLE_INCLUDE_DIRS.map((d) => `*/${d}`),
      ...BUNDLE_INCLUDE_FILES.map((f) => `*/${f}`),
    ];

    // 3. Extract into workspace root.
    await new Promise<void>((resolve, reject) => {
      const child = spawn("tar", [
        "xzf", tmpTar,
        "--wildcards",
        "--strip-components=1",
        "-C", WORKSPACE_ROOT,
        ...patterns,
      ]);
      const errLines: string[] = [];
      child.stderr?.on("data", (d: Buffer) => errLines.push(d.toString()));
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tar exited ${code}: ${errLines.join("")}`));
      });
      child.on("error", reject);
    });

    hotUpdateState.downloadProgress = 100;
    return { success: true, writtenFiles: patterns.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, writtenFiles: 0, error };
  } finally {
    try { unlinkSync(tmpTar); } catch { /* already gone */ }
  }
}

// ---------------------------------------------------------------------------
// GitHub Commit SHA detection (works without Releases or version.json bumps)
// Mirrors child proxy commit 0f47820a — auto-update fires on every push to main.
// ---------------------------------------------------------------------------

/**
 * Returns the latest commit SHA on a branch using the lightweight
 * "Accept: application/vnd.github.v3.sha" header — body is just the 40-char
 * hex SHA (~40 bytes), much cheaper than fetching a release or full commit JSON.
 * `repo` is in "owner/name" form (matches fetchLatestRelease signature).
 */
export async function fetchLatestCommitSha(
  repo: string,
  branch: string,
  token?: string,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${repo}/commits/${branch}`;
  try {
    const res = await fetch(url, {
      headers: {
        ...githubHeaders(token),
        Accept: "application/vnd.github.v3.sha",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const sha = (await res.text()).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export async function fetchLatestRelease(
  repo: string,
  token?: string,
): Promise<GitHubRelease | null> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  try {
    const res = await fetch(url, {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`GitHub API returned ${res.status}`);
    }
    return (await res.json()) as GitHubRelease;
  } catch (err) {
    logger.warn({ err }, "[hot-update] Failed to fetch latest release");
    return null;
  }
}

export async function fetchRemoteVersion(
  repo: string,
  branch: string,
  token?: string,
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/version.json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = await res.json() as { version?: string };
    return body.version ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Backup & Rollback
// ---------------------------------------------------------------------------

function getBackupDir(config: HotUpdateConfig): string {
  return join(WORKSPACE_ROOT, config.backupDir ?? ".update-backup");
}

export function createBackup(config: HotUpdateConfig): string | null {
  const backupDir = getBackupDir(config);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `backup-${timestamp}`);

  try {
    mkdirSync(backupPath, { recursive: true });

    for (const dir of BUNDLE_INCLUDE_DIRS) {
      const srcDir = join(WORKSPACE_ROOT, dir);
      const destDir = join(backupPath, dir);
      if (existsSync(srcDir)) copyDirSync(srcDir, destDir);
    }

    for (const rel of BUNDLE_INCLUDE_FILES) {
      const srcFile = join(WORKSPACE_ROOT, rel);
      const destFile = join(backupPath, rel);
      if (existsSync(srcFile)) {
        mkdirSync(dirname(destFile), { recursive: true });
        writeFileSync(destFile, readFileSync(srcFile));
      }
    }

    const versionFile = join(WORKSPACE_ROOT, "version.json");
    if (existsSync(versionFile)) {
      writeFileSync(join(backupPath, "version.json"), readFileSync(versionFile));
    }

    logger.info({ backupPath }, "[hot-update] Backup created");
    return backupPath;
  } catch (err) {
    logger.error({ err }, "[hot-update] Failed to create backup");
    return null;
  }
}

function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (BUNDLE_EXCLUDE.has(entry)) continue;
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      const ext = entry.slice(entry.lastIndexOf("."));
      if (BUNDLE_EXTENSIONS.has(ext)) {
        writeFileSync(destPath, readFileSync(srcPath));
      }
    }
  }
}

export async function rollbackFromBackup(
  backupPath: string,
  config: HotUpdateConfig,
): Promise<boolean> {
  try {
    logger.info({ backupPath }, "[hot-update] Starting rollback");

    for (const dir of BUNDLE_INCLUDE_DIRS) {
      const srcDir = join(backupPath, dir);
      const destDir = join(WORKSPACE_ROOT, dir);
      if (existsSync(srcDir)) {
        if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
        copyDirSync(srcDir, destDir);
      }
    }

    for (const rel of BUNDLE_INCLUDE_FILES) {
      const srcFile = join(backupPath, rel);
      const destFile = join(WORKSPACE_ROOT, rel);
      if (existsSync(srcFile)) {
        mkdirSync(dirname(destFile), { recursive: true });
        writeFileSync(destFile, readFileSync(srcFile));
      }
    }

    const versionFile = join(backupPath, "version.json");
    if (existsSync(versionFile)) {
      writeFileSync(join(WORKSPACE_ROOT, "version.json"), readFileSync(versionFile));
    }

    logger.info("[hot-update] Rollback completed");
    return true;
  } catch (err) {
    logger.error({ err }, "[hot-update] Rollback failed");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Download & Apply Update
// ---------------------------------------------------------------------------

export async function downloadAndApply(
  config: HotUpdateConfig,
  currentVersion: string,
): Promise<{ success: boolean; writtenFiles: number; error?: string }> {
  const { githubRepo, branch = "main", githubToken, hotReload = false } = config;

  hotUpdateState.status = "downloading";
  hotUpdateState.downloadProgress = 0;
  hotUpdateState.error = null;

  const backupPath = createBackup(config);
  hotUpdateState.backupPath = backupPath;

  if (!backupPath) {
    hotUpdateState.status = "failed";
    hotUpdateState.error = "Failed to create backup before update";
    return { success: false, writtenFiles: 0, error: hotUpdateState.error };
  }

  try {
    const treeUrl = `https://api.github.com/repos/${githubRepo}/git/trees/${branch}?recursive=1`;
    const treeRes = await fetch(treeUrl, {
      headers: githubHeaders(githubToken),
      signal: AbortSignal.timeout(30_000),
    });

    if (!treeRes.ok) throw new Error(`Failed to fetch GitHub tree: HTTP ${treeRes.status}`);

    const treeData = await treeRes.json() as {
      tree: Array<{ path: string; type: string; sha: string }>;
    };

    const bundleFilesSet = new Set(BUNDLE_INCLUDE_FILES);
    const filesToFetch = treeData.tree.filter((item) => {
      if (item.type !== "blob") return false;
      if (bundleFilesSet.has(item.path)) return true;
      return BUNDLE_INCLUDE_DIRS.some((dir) => item.path.startsWith(dir + "/"));
    });

    hotUpdateState.downloadProgress = 20;

    let writtenFiles = 0;
    let contentBuffer: Buffer | null = null;

    for (let i = 0; i < filesToFetch.length; i++) {
      const file = filesToFetch[i];
      try {
        const contentUrl = `https://api.github.com/repos/${githubRepo}/contents/${file.path}?ref=${branch}`;
        const r = await fetch(contentUrl, {
          headers: githubHeaders(githubToken),
          signal: AbortSignal.timeout(30_000),
        });

        if (!r.ok) {
          logger.warn(`[hot-update] skip ${file.path}: HTTP ${r.status}`);
          continue;
        }

        const data = await r.json() as { content: string; sha: string };
        
        // Use buffer pool for GC optimization
        const rawBuf = Buffer.from(data.content.replace(/\n/g, ""), "base64");
        const content = rawBuf.toString("utf8");
        contentBuffer = rawBuf;

        const fullPath = join(WORKSPACE_ROOT, file.path);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content, "utf8");

        writtenFiles++;
        hotUpdateState.downloadProgress = 20 + Math.floor((i / filesToFetch.length) * 70);
      } catch (err) {
        logger.warn({ err, file: file.path }, "[hot-update] Failed to download file");
      }
    }

    // Release buffer reference
    contentBuffer = null;

    hotUpdateState.downloadProgress = 100;

    const versionFile = join(WORKSPACE_ROOT, "version.json");
    if (existsSync(versionFile)) {
      try {
        const newVersion = JSON.parse(readFileSync(versionFile, "utf8")).version;
        if (compareVersions(newVersion, currentVersion) > 0) {
          logger.info({ oldVersion: currentVersion, newVersion }, "[hot-update] Version updated");
        }
      } catch {
        // version.json might be malformed
      }
    }

    if (hotReload) {
      logger.info("[hot-update] Hot reload mode enabled - triggering module refresh");
      await clearRequireCache();
    }

    hotUpdateState.status = "idle";
    return { success: true, writtenFiles };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    hotUpdateState.status = "failed";
    hotUpdateState.error = error;
    logger.error({ err }, "[hot-update] Download and apply failed");
    return { success: false, writtenFiles: 0, error };
  }
}

async function clearRequireCache(): Promise<void> {
  const keysToClear: string[] = [];
  for (const key of Object.keys(require.cache)) {
    if (key.includes("api-server/src") || key.includes("api-portal/src")) {
      keysToClear.push(key);
    }
  }

  for (const key of keysToClear.reverse()) {
    try {
      if (require.cache[key]) delete require.cache[key];
    } catch {
      // Ignore
    }
  }

  logger.info({ clearedCount: keysToClear.length }, "[hot-update] Cleared require cache");

  // Trigger GC if available
  if (typeof global.gc === "function") {
    global.gc();
  }
}

// ---------------------------------------------------------------------------
// Graceful Restart
// ---------------------------------------------------------------------------

export function gracefulRestart(delayMs: number = 1000): void {
  hotUpdateState.status = "restarting";
  logger.info({ delayMs }, "[hot-update] Scheduling graceful restart");
  setTimeout(() => process.exit(0), delayMs);
}

// ---------------------------------------------------------------------------
// Cleanup old backups
// ---------------------------------------------------------------------------

export function cleanupOldBackups(config: HotUpdateConfig, maxBackups: number = 5): void {
  const backupDir = getBackupDir(config);
  if (!existsSync(backupDir)) return;

  try {
    const backups = readdirSync(backupDir).filter((n) => n.startsWith("backup-")).sort().reverse();
    for (let i = maxBackups; i < backups.length; i++) {
      rmSync(join(backupDir, backups[i]), { recursive: true, force: true });
    }
  } catch (err) {
    logger.warn({ err }, "[hot-update] Failed to cleanup old backups");
  }
}

// ---------------------------------------------------------------------------
// Update check
// ---------------------------------------------------------------------------

export async function checkForUpdate(config: HotUpdateConfig): Promise<{
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseInfo: { name?: string; body?: string; publishedAt?: string; htmlUrl?: string } | null;
}> {
  hotUpdateState.status = "checking";
  hotUpdateState.startTime = Date.now();

  try {
    const versionFile = join(WORKSPACE_ROOT, "version.json");
    let currentVersion = "unknown";
    if (existsSync(versionFile)) {
      const parsed = JSON.parse(readFileSync(versionFile, "utf8")) as { version?: string };
      currentVersion = parsed.version ?? "unknown";
    }
    hotUpdateState.currentVersion = currentVersion;

    // ---- SHA-based detection (primary, mirrors child commit 0f47820a) ----
    // Triggers on every push to main, even without a Release or version.json bump.
    // Falls through to release/version.json detection if SHA fetch fails.
    const branch = config.branch ?? "main";
    const cachePathForSha = config.cachePath ?? DEFAULT_CACHE_PATH;
    const cacheForSha = readCheckCache(cachePathForSha);
    const latestSha = await fetchLatestCommitSha(config.githubRepo, branch, config.githubToken);
    if (latestSha) {
      const appliedSha = cacheForSha?.appliedSha ?? null;
      if (!appliedSha) {
        // First check after deploying SHA-aware code: seed the cache without
        // triggering a phantom update.
        writeCheckCache(cachePathForSha, {
          latestVersion: cacheForSha?.latestVersion ?? null,
          lastCheckTime: Date.now(),
          consecutiveNoUpdates: cacheForSha?.consecutiveNoUpdates ?? 0,
          appliedSha: latestSha,
        });
      } else if (latestSha !== appliedSha) {
        const shortFrom = appliedSha.slice(0, 7);
        const shortTo = latestSha.slice(0, 7);
        hotUpdateState.latestVersion = shortTo;
        hotUpdateState.updateAvailable = true;
        logger.warn(
          { from: shortFrom, to: shortTo },
          `[hot-update] New commit on ${branch}: ${shortFrom} → ${shortTo}`,
        );

        if (config.autoUpdate) {
          logger.info("[hot-update] Auto-update enabled, applying SHA-based update...");
          hotUpdateState.status = "applying";
          const result = await downloadAndApply(config, currentVersion);
          if (result.success) {
            writeCheckCache(cachePathForSha, {
              latestVersion: cacheForSha.latestVersion,
              lastCheckTime: Date.now(),
              consecutiveNoUpdates: 0,
              appliedSha: latestSha,
            });
            gracefulRestart();
          } else {
            logger.error("[hot-update] SHA-based auto-update failed; will fall back to release-based check");
          }
        }

        // Whether or not we auto-applied, return the SHA-based result so
        // status endpoints surface it. Skip the release-tag path below.
        hotUpdateState.status = "idle";
        hotUpdateState.completedTime = Date.now();
        return {
          updateAvailable: true,
          currentVersion: shortFrom,
          latestVersion: shortTo,
          releaseInfo: null,
        };
      }
    }

    const release = await fetchLatestRelease(config.githubRepo, config.githubToken);

    if (release) {
      const latestVersion = release.tag_name.replace(/^v/, "");
      hotUpdateState.latestVersion = latestVersion;
      const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
      hotUpdateState.updateAvailable = updateAvailable;

      if (updateAvailable) {
        logger.warn(
          { currentVersion, latestVersion },
          `[hot-update] New version available: v${currentVersion} → v${latestVersion}`,
        );

        if (config.autoUpdate) {
          logger.info("[hot-update] Auto-update enabled, applying update...");
          hotUpdateState.status = "applying";
          const result = await downloadAndApply(config, currentVersion);
          if (result.success) gracefulRestart();
          else logger.error("[hot-update] Auto-update failed");
        }
      }

      hotUpdateState.status = "idle";
      hotUpdateState.completedTime = Date.now();

      return {
        updateAvailable,
        currentVersion,
        latestVersion,
        releaseInfo: {
          name: release.name,
          body: release.body,
          publishedAt: release.published_at,
          htmlUrl: release.html_url,
        },
      };
    }

    const remoteVersion = await fetchRemoteVersion(
      config.githubRepo,
      config.branch ?? "main",
      config.githubToken,
    );

    if (remoteVersion) {
      hotUpdateState.latestVersion = remoteVersion;
      hotUpdateState.updateAvailable = compareVersions(remoteVersion, currentVersion) > 0;
      hotUpdateState.status = "idle";
      hotUpdateState.completedTime = Date.now();

      return {
        updateAvailable: hotUpdateState.updateAvailable,
        currentVersion,
        latestVersion: remoteVersion,
        releaseInfo: null,
      };
    }

    hotUpdateState.status = "idle";
    hotUpdateState.completedTime = Date.now();

    return { updateAvailable: false, currentVersion, latestVersion: null, releaseInfo: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    hotUpdateState.status = "failed";
    hotUpdateState.error = error;
    hotUpdateState.completedTime = Date.now();
    logger.error({ err }, "[hot-update] Check for update failed");
    return {
      updateAvailable: false,
      currentVersion: hotUpdateState.currentVersion,
      latestVersion: null,
      releaseInfo: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Sleep/Wake mechanism
// ---------------------------------------------------------------------------

type ActivityListener = () => void;
const wakeListeners: ActivityListener[] = [];

let isSleeping = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let checkTimer: ReturnType<typeof setTimeout> | null = null;
let lastActivityTime = Date.now();
let backoffConsecutive = 0;

export function recordActivity(): void {
  lastActivityTime = Date.now();
  backoffConsecutive = 0;

  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (isSleeping) {
    isSleeping = false;
    hotUpdateState.status = "idle";
    logger.info("[hot-update] Woken up by activity");
    scheduleNextCheck();
  }

  for (const listener of wakeListeners) {
    try { listener(); } catch { /* ignore */ }
  }
}

function scheduleIdleTimeout(config: HotUpdateConfig): void {
  const idleTimeout = config.idleTimeoutMs ?? 900000;
  if (idleTimer) clearTimeout(idleTimer);

  idleTimer = setTimeout(() => {
    if (!isSleeping) {
      isSleeping = true;
      hotUpdateState.status = "sleeping";
      logger.info("[hot-update] Entering sleep mode (idle timeout)");
      if (checkTimer) { clearTimeout(checkTimer); checkTimer = null; }
    }
  }, idleTimeout);
}

function scheduleNextCheck(): void {
  if (isSleeping) return;
  if (checkTimer) { clearTimeout(checkTimer); checkTimer = null; }

  const config = getDefaultConfig();
  const baseInterval = config.checkIntervalMs ?? 1800000;
  const maxInterval = config.maxIntervalMs ?? 7200000;
  const useBackoff = config.exponentialBackoff ?? true;

  const delay = useBackoff
    ? Math.min(baseInterval * Math.pow(1.5, backoffConsecutive), maxInterval)
    : baseInterval;

  checkTimer = setTimeout(() => {
    checkTimer = null;
    void runPeriodicCheck();
  }, delay);
}

async function runPeriodicCheck(): Promise<void> {
  if (isSleeping) return;

  const config = getDefaultConfig();
  const result = await checkForUpdate(config);

  if (!result.updateAvailable) {
    backoffConsecutive++;
  } else {
    backoffConsecutive = 0;
  }

  scheduleNextCheck();
}

/**
 * Manually suspend hot update checking.
 */
export function suspend(): void {
  logger.info("[hot-update] Suspended manually");
  if (checkTimer) { clearTimeout(checkTimer); checkTimer = null; }
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  isSleeping = true;
  hotUpdateState.status = "sleeping";
}

/**
 * Manually resume hot update checking.
 */
export function resume(): void {
  logger.info("[hot-update] Resumed manually");
  isSleeping = false;
  hotUpdateState.status = "idle";
  const config = getDefaultConfig();
  scheduleIdleTimeout(config);
  scheduleNextCheck();
}

/**
 * Check if hot update checker is sleeping.
 */
export function isSuspended(): boolean {
  return isSleeping;
}

/**
 * Register wake listener.
 */
export function onWake(listener: ActivityListener): () => void {
  wakeListeners.push(listener);
  return () => {
    const idx = wakeListeners.indexOf(listener);
    if (idx >= 0) wakeListeners.splice(idx, 1);
  };
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

export function getDefaultConfig(): HotUpdateConfig {
  return {
    githubRepo: process.env.GITHUB_REPO ?? "Akatsuki03/Replit2Api",
    branch: process.env.GITHUB_BRANCH ?? "main",
    githubToken: process.env.GITHUB_TOKEN,
    autoUpdate: process.env.AUTO_UPDATE === "true",
    checkIntervalMs: parseInt(process.env.UPDATE_CHECK_INTERVAL ?? "1800000", 10),
    hotReload: process.env.HOT_RELOAD === "true",
    enabled: process.env.HOT_UPDATE_ENABLED !== "false",
    maxIntervalMs: parseInt(process.env.HOT_UPDATE_MAX_INTERVAL ?? "7200000", 10),
    exponentialBackoff: process.env.HOT_UPDATE_EXPONENTIAL_BACKOFF !== "false",
    idleTimeoutMs: parseInt(process.env.HOT_UPDATE_IDLE_TIMEOUT ?? "900000", 10),
  };
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

export function startHotUpdateChecker(): void {
  const config = getDefaultConfig();

  if (config.enabled === false) {
    logger.info("[hot-update] Hot update disabled by config");
    return;
  }

  logger.info(
    {
      intervalMs: config.checkIntervalMs,
      autoUpdate: config.autoUpdate,
      backoff: config.exponentialBackoff,
      idleTimeoutMs: config.idleTimeoutMs,
    },
    "[hot-update] Starting optimized hot update checker",
  );

  // Cold start: try to use cache
  const cachePath = config.cachePath ?? DEFAULT_CACHE_PATH;
  const cached = readCheckCache(cachePath);

  if (cached) {
    const cacheAge = Date.now() - cached.lastCheckTime;
    if (cacheAge < 600000 && cached.latestVersion) { // 10 min cache validity
      logger.info({ cachedVersion: cached.latestVersion }, "[hot-update] Using cached result for cold start");
      hotUpdateState.latestVersion = cached.latestVersion;
    }
  }

  // Schedule initial check after short delay
  setTimeout(() => {
    void runPeriodicCheck();
    scheduleIdleTimeout(config);
  }, 3000);
}