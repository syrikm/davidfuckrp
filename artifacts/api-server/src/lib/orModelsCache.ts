/**
 * Shared OpenRouter live model catalog cache.
 * Used by the /v1/models endpoint and OR reasoning-model detection.
 *
 * Improvements adapted from vcpfuckcachefork:
 *   - Synchronous seed from local registry.json at module load (zero cold-start gap)
 *   - normaliseORModelId() for cache-key normalisation: dash→dot conversion and
 *     stripping of -thinking / -thinking-visible / -max decorator suffixes so that
 *     equivalent model aliases never produce phantom cache misses.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

export interface ORModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  context_length?: number;
  pricing?: Record<string, unknown>;
  [key: string]: unknown;
}

const OR_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OR_CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

let _cache: { data: ORModel[]; fetchedAt: number } | null = null;
let _inflight: Promise<ORModel[]> | null = null;

// Derived index of model ids whose `supported_parameters` includes "reasoning".
// Seeded synchronously at module-load from local registry.json so there is
// zero cold-start gap — live OR catalog updates replace it when it arrives.
let _reasoningIds: Set<string> = new Set();

// ---------------------------------------------------------------------------
// Model-ID normalisation
// ---------------------------------------------------------------------------

/**
 * Canonical OR model-id form used for cache-key comparisons.
 *
 *  1. Lowercase + trim
 *  2. Strip decorator suffixes: -thinking-visible → -thinking → -max
 *     (handles stacked combos such as claude-opus-4-7-thinking-max)
 *  3. Normalise version separator: dash→dot for version segments only
 *     e.g. "anthropic/claude-opus-4-5" → "anthropic/claude-opus-4.5"
 *     but leaves provider slugs like "meta-llama/llama-4-maverick" untouched.
 */
const OR_DECORATOR_SUFFIXES = ["-thinking-visible", "-thinking", "-max"] as const;

export function normaliseORModelId(raw: string): string {
  let id = raw.toLowerCase().trim();

  // Strip decorator suffixes (up to 3 iterations for stacked combos)
  for (let i = 0; i < OR_DECORATOR_SUFFIXES.length; i++) {
    let stripped = false;
    for (const suf of OR_DECORATOR_SUFFIXES) {
      if (id.endsWith(suf)) {
        id = id.slice(0, id.length - suf.length);
        stripped = true;
        break;
      }
    }
    if (!stripped) break;
  }

  // Normalise version-separator (dash→dot) for known provider prefixes.
  // Only the "logical name" portion (after the slash) is normalised, so that
  // slugs like "meta-llama/..." remain intact.
  const slashIdx = id.indexOf("/");
  if (slashIdx >= 0) {
    const provider = id.slice(0, slashIdx);
    const logical = id.slice(slashIdx + 1);
    // Convert dash-separated version digits: e.g. claude-opus-4-5 → claude-opus-4.5
    const normLogical = logical.replace(
      /^(.*[a-z]-)(\d+)-(\d+)(.*)$/,
      (_m, prefix, major, minor, rest) => `${prefix}${major}.${minor}${rest}`,
    );
    return `${provider}/${normLogical}`;
  }

  // No slash: normalise version digits in bare model names (e.g. claude-opus-4-5)
  return id.replace(
    /^(.*[a-z]-)(\d+)-(\d+)(.*)$/,
    (_m, prefix, major, minor, rest) => `${prefix}${major}.${minor}${rest}`,
  );
}

// ---------------------------------------------------------------------------
// Sync seed from local registry.json
// ---------------------------------------------------------------------------

/** Build initial Set from local registry (sync, runs at module load). */
function seedReasoningIdsFromRegistry(): Set<string> {
  try {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const regPath = join(dir, "..", "..", "lib", "models", "registry.json");
    const reg = JSON.parse(readFileSync(regPath, "utf8")) as {
      models: Array<{
        capabilities?: { reasoning?: boolean };
        routing?: { openrouter_slug?: string };
      }>;
    };
    const ids = new Set<string>();
    for (const m of reg.models) {
      if (m.capabilities?.reasoning === true && m.routing?.openrouter_slug) {
        // Store both raw and normalised forms
        const slug = m.routing.openrouter_slug;
        ids.add(slug);
        ids.add(normaliseORModelId(slug));
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

function indexReasoningIds(data: ORModel[]): void {
  const next = new Set<string>();
  for (const m of data) {
    const sp = m.supported_parameters;
    if (Array.isArray(sp) && sp.includes("reasoning") && typeof m.id === "string") {
      next.add(m.id);
      next.add(normaliseORModelId(m.id));
    }
  }
  _reasoningIds = next;
}

// Synchronous seed from local registry (covers all known reasoning models
// before the async OR catalog fetch resolves).
_reasoningIds = seedReasoningIdsFromRegistry();

/** Sync accessor: returns the set of OR model ids that support `reasoning`. */
export function getORReasoningModelIds(): ReadonlySet<string> {
  return _reasoningIds;
}

/**
 * Check whether a model supports OR reasoning, normalising the id first so
 * aliases like "anthropic/claude-opus-4-5-thinking" resolve correctly.
 */
export function isORReasoningModel(modelId: string): boolean {
  return _reasoningIds.has(modelId) || _reasoningIds.has(normaliseORModelId(modelId));
}

declare const fetch: any;
declare const AbortSignal: any;

export async function fetchORModels(): Promise<ORModel[]> {
  const res = await fetch(OR_MODELS_URL, {
    headers: { "User-Agent": "GallopStudio/3.2 (EquineRender; +https://gallopstudio.io)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OR models fetch failed: ${res.status}`);
  const json = (await res.json()) as { data?: ORModel[] };
  return json.data ?? [];
}

export async function getORModels(): Promise<ORModel[]> {
  const now = Date.now();
  if (_cache && now - _cache.fetchedAt < OR_CACHE_TTL_MS) return _cache.data;
  if (_inflight) return _inflight;
  _inflight = fetchORModels()
    .then((data) => {
      _cache = { data, fetchedAt: Date.now() };
      indexReasoningIds(data);
      return data;
    })
    .catch(() => _cache?.data ?? [])
    .finally(() => { _inflight = null; });
  return _inflight;
}

// Warm the cache at module load so isORReasoningModel has live data
// available before the first chat request. Errors are swallowed — the
// sync registry seed and regex fallback in callers handle the offline case.
void getORModels().catch(() => {});
