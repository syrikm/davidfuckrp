import { Router, type IRouter, type Request, type Response } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "fs";
import { resolve, join, dirname, relative } from "path";
import {
  hotUpdateState,
  getDefaultConfig,
  checkForUpdate,
  downloadAndApply,
  rollbackFromBackup,
  gracefulRestart,
  fetchLatestRelease,
  cleanupOldBackups,
  suspend,
  resume,
  isSuspended,
  recordActivity,
  type HotUpdateConfig,
} from "../lib/hotUpdater";
import { logger } from "../lib/logger";
import { gatewayConfig } from "../lib/gatewayConfig";

const router: IRouter = Router();
const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Workspace root (monorepo root)
// ---------------------------------------------------------------------------

const WORKSPACE_ROOT = resolve(process.cwd(), "../../");

// ---------------------------------------------------------------------------
// GitHub config — sourced from gatewayConfig.updateRepo (env GATEWAY_UPDATE_REPO)
// ---------------------------------------------------------------------------

const [GITHUB_OWNER, GITHUB_REPO] = (() => {
  const slug = gatewayConfig.updateRepo;
  const idx = slug.indexOf("/");
  if (idx <= 0 || idx === slug.length - 1) {
    throw new Error(
      `Invalid GATEWAY_UPDATE_REPO="${slug}" — expected "owner/repo" format`,
    );
  }
  return [slug.slice(0, idx), slug.slice(idx + 1)];
})();
const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? "main";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
export const GITHUB_RAW_VERSION_URL =
  `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/version.json`;

// Strip every non-ASCII character so the value is always safe as an HTTP header.
export function safeVersionHeader(version: string): string {
  return version.replace(/[^\x00-\x7F]/g, "");
}

function githubHeaders(withToken = true): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": `${gatewayConfig.brand}-Updater`,
  };
  const tok = process.env.GITHUB_TOKEN;
  if (withToken && tok) h.Authorization = `token ${tok}`;
  return h;
}

// ---------------------------------------------------------------------------
// Version info
// ---------------------------------------------------------------------------

interface VersionInfo {
  version: string;
  name?: string;
  releaseDate?: string;
  releaseNotes?: string;
}

function readLocalVersion(): VersionInfo {
  const candidates = [
    resolve(process.cwd(), "version.json"),
    resolve(WORKSPACE_ROOT, "version.json"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")) as VersionInfo;
    } catch {}
  }
  return { version: "unknown" };
}

// Parse version string — supports v1.2.3, v1.2.3a, v1.2.3b, v1.2.3rc1, v1.2.3-beta, etc.
function parseVersion(v: string): { nums: number[]; pre: string } {
  const clean = v.replace(/^v/i, "").trim();
  const match = clean.match(/^([\d]+(?:\.[\d]+)*)(.*)$/);
  if (!match) return { nums: [0], pre: "" };
  const nums = match[1].split(".").map((n) => parseInt(n, 10) || 0);
  const pre = match[2].trim();
  return { nums, pre };
}

function isNewer(remote: string, local: string): boolean {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  const len = Math.max(r.nums.length, l.nums.length);

  for (let i = 0; i < len; i++) {
    if ((r.nums[i] ?? 0) > (l.nums[i] ?? 0)) return true;
    if ((r.nums[i] ?? 0) < (l.nums[i] ?? 0)) return false;
  }

  if (!r.pre && l.pre) return true;
  if (r.pre && !l.pre) return false;
  if (r.pre && l.pre) return r.pre > l.pre;

  return false;
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function checkApiKey(req: Request, res: Response): boolean {
  const proxyKey = process.env.PROXY_API_KEY;
  if (!proxyKey) {
    res.status(500).json({ error: "Server API key not configured" });
    return false;
  }
  const authHeader = req.headers["authorization"];
  const xApiKey = req.headers["x-api-key"];
  let provided: string | undefined;
  if (authHeader?.startsWith("Bearer ")) provided = authHeader.slice(7);
  else if (typeof xApiKey === "string") provided = xApiKey;
  if (!provided || provided !== proxyKey) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// File scanner — collect all source file contents for bundle
// ---------------------------------------------------------------------------

const BUNDLE_INCLUDE_DIRS = [
  "artifacts/api-server/src",
  "artifacts/api-portal/src",
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
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  ".npmrc",
  ".replitignore",
  "README.md",
];

const BUNDLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".css", ".html", ".md", ".yaml", ".yml"]);
const BUNDLE_EXCLUDE = new Set(["node_modules", "dist", ".git", ".cache"]);

function scanDir(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  if (!existsSync(dir)) return files;
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (BUNDLE_EXCLUDE.has(entry)) continue;
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        const ext = entry.slice(entry.lastIndexOf("."));
        if (BUNDLE_EXTENSIONS.has(ext)) {
          const rel = relative(WORKSPACE_ROOT, full);
          try { files[rel] = readFileSync(full, "utf8"); } catch {}
        }
      }
    }
  };
  walk(dir);
  return files;
}

function buildBundle(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const dir of BUNDLE_INCLUDE_DIRS) {
    Object.assign(files, scanDir(join(WORKSPACE_ROOT, dir)));
  }
  for (const rel of BUNDLE_INCLUDE_FILES) {
    const full = join(WORKSPACE_ROOT, rel);
    try {
      if (existsSync(full)) files[rel] = readFileSync(full, "utf8");
    } catch {}
  }
  return files;
}

// ---------------------------------------------------------------------------
// GitHub: download latest files and apply to local workspace
// ---------------------------------------------------------------------------

async function applyFromGitHub(): Promise<{ written: number }> {
  const treeRes = await fetch(`${GITHUB_API}/git/trees/${GITHUB_BRANCH}?recursive=1`, {
    headers: githubHeaders(),
  });
  if (!treeRes.ok) throw new Error(`Failed to fetch GitHub tree: HTTP ${treeRes.status}`);
  const treeData = await treeRes.json() as {
    tree: { path: string; type: string; sha: string; url: string }[];
  };

  const bundleFilesSet = new Set(BUNDLE_INCLUDE_FILES);
  const filesToFetch = treeData.tree.filter((item) => {
    if (item.type !== "blob") return false;
    if (bundleFilesSet.has(item.path)) return true;
    return BUNDLE_INCLUDE_DIRS.some((dir) => item.path.startsWith(dir + "/"));
  });

  let written = 0;
  for (const file of filesToFetch) {
    try {
      const r = await fetch(`${GITHUB_API}/contents/${file.path}?ref=${GITHUB_BRANCH}`, {
        headers: githubHeaders(),
      });
      if (!r.ok) { console.warn(`[apply-github] skip ${file.path}: HTTP ${r.status}`); continue; }
      const data = await r.json() as { content: string };
      const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
      const fullPath = join(WORKSPACE_ROOT, file.path);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, "utf8");
      written++;
    } catch (e) {
      console.warn(`[apply-github] write failed ${file.path}:`, e);
    }
  }
  return { written };
}

// ---------------------------------------------------------------------------
// Check whether UPDATE_CHECK_URL points to GitHub
// ---------------------------------------------------------------------------

function isGitHubCheckUrl(url: string | undefined): boolean {
  if (!url) return false;
  return url.includes("raw.githubusercontent.com") || url.includes("github.com");
}

// ---------------------------------------------------------------------------
// GET /update/version — local version + optional remote check
// ---------------------------------------------------------------------------

router.get("/update/version", async (_req: Request, res: Response) => {
  const local = readLocalVersion();
  const checkUrl = process.env.UPDATE_CHECK_URL || GITHUB_RAW_VERSION_URL;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(checkUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const remote = (await r.json()) as VersionInfo;
    const hasUpdate = isNewer(remote.version, local.version);
    res.json({
      ...local,
      hasUpdate,
      latestVersion: remote.version,
      latestReleaseNotes: remote.releaseNotes,
      latestReleaseDate: remote.releaseDate,
      source: isGitHubCheckUrl(checkUrl) ? "github" : "bundle",
    });
  } catch (err) {
    res.json({ ...local, hasUpdate: false, checkError: err instanceof Error ? err.message : "check failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /update/bundle — public endpoint, returns JSON file bundle
// ---------------------------------------------------------------------------

router.get("/update/bundle", (_req: Request, res: Response) => {
  try {
    const local = readLocalVersion();
    const files = buildBundle();
    res.json({ version: local.version, releaseNotes: local.releaseNotes, fileCount: Object.keys(files).length, files });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "bundle failed" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/update/check — Check for updates using hotUpdater
// ---------------------------------------------------------------------------

router.get("/update/check", async (_req: Request, res: Response) => {
  const config = getDefaultConfig();
  const result = await checkForUpdate(config);
  res.json(result);
});

// ---------------------------------------------------------------------------
// GET /update/status — Get update status (including hot update state)
// ---------------------------------------------------------------------------

router.get("/update/status", (_req: Request, res: Response) => {
  res.json({
    // Legacy fields
    inProgress: hotUpdateState.status !== "idle",
    githubRepo: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
    githubRawVersionUrl: GITHUB_RAW_VERSION_URL,
    // Hot update state
    hotUpdate: {
      status: hotUpdateState.status,
      currentVersion: hotUpdateState.currentVersion,
      latestVersion: hotUpdateState.latestVersion,
      downloadProgress: hotUpdateState.downloadProgress,
      error: hotUpdateState.error,
      backupPath: hotUpdateState.backupPath,
      startTime: hotUpdateState.startTime,
      completedTime: hotUpdateState.completedTime,
    },
    // Config
    config: {
      autoUpdate: process.env.AUTO_UPDATE === "true",
      checkIntervalMs: parseInt(process.env.UPDATE_CHECK_INTERVAL ?? "1800000", 10),
      hotReload: process.env.HOT_RELOAD === "true",
      githubRepo: process.env.GITHUB_REPO ?? `${GITHUB_OWNER}/${GITHUB_REPO}`,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /update/apply — Apply update (protected)
// ---------------------------------------------------------------------------

let updateInProgress = false;

router.post("/update/apply", async (req: Request, res: Response) => {
  if (!checkApiKey(req, res)) return;
  if (updateInProgress) {
    res.status(409).json({ error: "Update already in progress, please wait" });
    return;
  }

  const checkUrl = process.env.UPDATE_CHECK_URL;
  const useGitHub = !checkUrl || isGitHubCheckUrl(checkUrl) || process.env.GITHUB_APPLY === "true";

  res.json({
    status: "started",
    source: useGitHub ? "github" : "bundle",
    message: useGitHub
      ? "Pulling latest code from GitHub, server will restart automatically in ~30-60s..."
      : "Downloading update bundle from upstream gateway instance, server will restart in ~30s...",
  });
  updateInProgress = true;

  (async () => {
    try {
      if (useGitHub) {
        // Use hot updater for download and apply
        const config = getDefaultConfig();
        const currentVersion = readLocalVersion().version;

        hotUpdateState.status = "applying";
        const result = await downloadAndApply(config, currentVersion);

        if (!result.success) {
          updateInProgress = false;
          logger.error("[update] Hot update failed");
          return;
        }

        logger.info({ writtenFiles: result.writtenFiles }, "[update] Hot update completed, installing dependencies...");
      } else {
        // Legacy bundle mode (peer gateway instance acting as update source)
        const bundleUrl = checkUrl!.replace(/\/update\/version$/, "/update/bundle");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        const r = await fetch(bundleUrl, { signal: controller.signal });
        clearTimeout(timer);
        if (!r.ok) throw new Error(`Download failed HTTP ${r.status}`);
        const bundle = (await r.json()) as { version: string; files: Record<string, string> };
        for (const [relPath, content] of Object.entries(bundle.files)) {
          const fullPath = join(WORKSPACE_ROOT, relPath);
          mkdirSync(dirname(fullPath), { recursive: true });
          writeFileSync(fullPath, content, "utf8");
        }
        console.log(`[update] wrote ${Object.keys(bundle.files).length} files from peer bundle`);
      }

      // Install dependencies
      await execFileAsync("pnpm", ["install", "--no-frozen-lockfile"], { cwd: WORKSPACE_ROOT });

      // Graceful restart
      setTimeout(() => gracefulRestart(500), 500);
    } catch (err) {
      updateInProgress = false;
      console.error("[update] update failed:", err instanceof Error ? err.message : err);
    }
  })();
});

// ---------------------------------------------------------------------------
// POST /update/rollback — Rollback to previous version (protected)
// ---------------------------------------------------------------------------

router.post("/update/rollback", async (req: Request, res: Response) => {
  if (!checkApiKey(req, res)) return;

  if (!hotUpdateState.backupPath) {
    res.status(400).json({ error: "No backup available for rollback" });
    return;
  }

  res.json({
    status: "started",
    message: "Rolling back to previous version...",
    backupPath: hotUpdateState.backupPath,
  });

  (async () => {
    try {
      const config = getDefaultConfig();
      const success = await rollbackFromBackup(hotUpdateState.backupPath!, config);

      if (success) {
        // Install dependencies after rollback
        await execFileAsync("pnpm", ["install", "--no-frozen-lockfile"], { cwd: WORKSPACE_ROOT });

        hotUpdateState.status = "rollback";
        logger.info("[update] Rollback completed, restarting...");

        // Restart after rollback
        setTimeout(() => gracefulRestart(500), 500);
      } else {
        hotUpdateState.status = "failed";
        hotUpdateState.error = "Rollback failed";
      }
    } catch (err) {
      hotUpdateState.status = "failed";
      hotUpdateState.error = err instanceof Error ? err.message : String(err);
      console.error("[update] rollback failed:", err);
    }
  })();
});

// ---------------------------------------------------------------------------
// GET /update/release — Get latest GitHub release info
// ---------------------------------------------------------------------------

router.get("/update/release", async (_req: Request, res: Response) => {
  const config = getDefaultConfig();
  const release = await fetchLatestRelease(config.githubRepo, config.githubToken);

  if (!release) {
    res.json({ error: "No releases found" });
    return;
  }

  res.json({
    tagName: release.tag_name,
    name: release.name,
    body: release.body,
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
  });
});

// ---------------------------------------------------------------------------
// POST /update/cleanup — Cleanup old backups (protected)
// ---------------------------------------------------------------------------

router.post("/update/cleanup", async (req: Request, res: Response) => {
  if (!checkApiKey(req, res)) return;

  const config = getDefaultConfig();
  const maxBackups = (req.body as { maxBackups?: number })?.maxBackups ?? 5;

  cleanupOldBackups(config, maxBackups);
  res.json({ status: "ok", message: "Old backups cleaned" });
});

// ---------------------------------------------------------------------------
// Export router
// ---------------------------------------------------------------------------

export default router;