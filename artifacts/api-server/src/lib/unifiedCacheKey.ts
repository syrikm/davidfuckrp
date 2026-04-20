/**
 * Unified cache key generation module.
 *
 * Merges the base hashing logic from the parent proxy with the child proxy's
 * cachePoint filtering and stripMessageBlockCacheControl functionality.
 *
 * This module is shared between:
 *   - davidfuckrp-github (v1.1.9)
 *   - vcpfuckcachefork-github (v1.2.0)
 *
 * Both repositories produce identical cache keys for the same request body,
 * enabling cross-proxy cache sharing when deployed to the same origin.
 */

import { createHash } from "crypto";
import { normaliseORModelId } from "./orModelsCache.js";

// ---------------------------------------------------------------------------
// Request hashing
//
// Fields that affect ONLY routing, billing, or observability — not the
// response content.  These are excluded from the cache key so that adding
// or removing them does not cause spurious cache misses.
// ---------------------------------------------------------------------------
const HASH_EXCLUDE_FIELDS = new Set([
  "stream",             // delivery mode, not content
  "cache_control",      // Anthropic/Gemini prompt-caching breakpoints (billing only)
  "cachePoint",         // AWS Bedrock prompt-caching markers
  "provider",           // OpenRouter routing preference (except reasoning influence)
  "route",              // OpenRouter routing
  "session_id",         // OpenRouter observability
  "trace",              // OpenRouter observability
  "metadata",           // OpenRouter metadata
  "service_tier",       // billing tier
  "speed",              // performance tier
  "user",               // end-user identifier
  "x_use_prompt_tools", // internal proxy flag
  "stream_options",     // SSE delivery option
  "transforms",         // OpenRouter prompt transforms (middle-out etc.)
  "extra_headers",      // OpenRouter passthrough headers (e.g. anthropic-beta)
]);

/**
 * JSON replacer that:
 *  - drops fields that only affect billing/routing (see HASH_EXCLUDE_FIELDS)
 *  - converts `undefined` → `null` so omitted fields hash the same as explicit null
 *  - sorts object keys alphabetically so { a:1, b:2 } and { b:2, a:1 } hash the same
 *
 * Using a blacklist instead of a whitelist means any new content-affecting
 * parameter (thinking, reasoning, verbosity, response_format, etc.) is
 * automatically included in the hash without requiring code changes here.
 */
export function stableReplacer(key: string, value: unknown): unknown {
  if (HASH_EXCLUDE_FIELDS.has(key)) return undefined;
  if (value === undefined) return null;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    );
  }
  return value;
}

/**
 * Normalizes a request body by stripping 'cache_control' and Bedrock 'cachePoint'
 * fields from within message content blocks or system prompt blocks.
 * This ensures that the local response-cache key remains stable even as the
 * proxy shifts its internal prompt-caching breakpoints (T1b/T2/P2) between turns.
 */
function stripMessageBlockCacheControl(value: unknown, path: string[] = []): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item) => {
        // Skip Bedrock cachePoint blocks entirely from hashing if they are standalone
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          const keys = Object.keys(item);
          if (keys.length === 1 && keys[0] === "cachePoint") return false;
        }
        return true;
      })
      .map((item, index) => stripMessageBlockCacheControl(item, [...path, String(index)]));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(record)) {
    const nextPath = [...path, key];

    // Identify cache_control or cachePoint fields that are part of a content block.
    // Structure 1 (OAI): messages[i].content[j].cache_control
    // Structure 2 (Anthropic): system[i].cache_control
    const isBlockLevelCacheMarker =
      (key === "cache_control" || key === "cachePoint") &&
      ((path.length >= 4 && path[path.length - 2] === "content" && (path[path.length - 4] === "messages" || path[path.length - 4] === "system")) ||
       (path.length >= 2 && path[path.length - 2] === "system"));

    if (isBlockLevelCacheMarker) continue;
    next[key] = stripMessageBlockCacheControl(child, nextPath);
  }

  return next;
}

/**
 * Produce a stable SHA-256 cache key for a non-streaming request body.
 *
 * All content-affecting fields are included.  Fields that affect only
 * billing, routing, or observability are excluded (see HASH_EXCLUDE_FIELDS).
 * Additionally, message content blocks are normalized so block-level
 * cache_control noise does not perturb the local response-cache key.
 */
export function hashRequest(body: Record<string, unknown>): string {
  let payload: string;
  try {
    // Normalise the model field so aliases like "anthropic/claude-opus-4-5-thinking"
    // and "anthropic/claude-opus-4.5" produce the same cache key.
    // Only applies to OR-routed models (those containing a slash).
    let hashBody = body;
    if (typeof body["model"] === "string" && (body["model"] as string).includes("/")) {
      hashBody = { ...body, model: normaliseORModelId(body["model"] as string) };
    }
    const normalizedBody = stripMessageBlockCacheControl(hashBody);
    payload = JSON.stringify(normalizedBody, stableReplacer);
  } catch {
    // Extremely unlikely (HTTP bodies cannot contain circular refs / BigInt),
    // but fall back to a key that will never collide with a real entry.
    payload = `__unserializable__${String(body["model"])}__${Date.now()}__${Math.random()}`;
  }
  return createHash("sha256").update(payload).digest("hex").slice(0, 40);
}

/**
 * Unified cache key generator — alias for hashRequest for discoverability.
 * Exported for use by code that prefers the generateCacheKey naming convention.
 */
export const generateCacheKey = hashRequest;
