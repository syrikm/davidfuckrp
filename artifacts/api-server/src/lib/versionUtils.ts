import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Walk up from cwd until version.json is found — that directory is the project root.
 * Falls back to cwd if no version.json found within 6 levels.
 */
export function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    try { readFileSync(resolve(dir, "version.json")); return dir; } catch { /* keep going */ }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * Read the local version string from version.json (cwd → project root fallback).
 * Returns "unknown" when not found / unparsable.
 */
export function readLocalVersion(): string {
  const candidates = [
    resolve(process.cwd(), "version.json"),
    resolve(findProjectRoot(), "version.json"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const raw = readFileSync(p, "utf8");
        const parsed = JSON.parse(raw) as { version?: string };
        return parsed.version ?? "unknown";
      }
    } catch { /* continue */ }
  }
  return "unknown";
}

/**
 * Resolve the remote version-check URL from a base URL.
 *   GitHub repo  → https://raw.githubusercontent.com/owner/repo/main/version.json
 *   Server URL   → {url}/api/version  (legacy / self-hosted)
 */
export function resolveVersionUrl(base: string): string {
  const clean = base.replace(/\/$/, "");
  const ghMatch = clean.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)/);
  if (ghMatch) {
    const slug = ghMatch[1].replace(/\.git$/, "");
    return `https://raw.githubusercontent.com/${slug}/main/version.json`;
  }
  return `${clean}/api/version`;
}

/**
 * Compare two version strings (MAJOR.MINOR.PATCH[.BUILD], optional leading "v").
 * Returns >0 if a is newer, <0 if b is newer, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  if (a === b) return 0;
  const parse = (s: string) => s.replace(/^v/i, "").split(".").map((seg) => {
    const n = parseInt(seg, 10);
    return isNaN(n) ? 0 : n;
  });
  const pa = parse(a), pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0, nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}
