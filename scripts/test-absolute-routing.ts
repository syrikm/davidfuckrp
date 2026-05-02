/* eslint-disable no-console */
/**
 * Absolute Provider Routing — programmatic regression suite.
 *
 * What this asserts (no running gateway required for §1, §2):
 *   §1  detectAbsoluteProviderRoute() correctly classifies every documented
 *       prefix alias and every pass-through alias.
 *   §2  Both lock-injection paths (mergeGatewayProviderConfig used by
 *       /api/* and buildAbsoluteProviderBlock used by legacy /v1/* routes)
 *       emit the same lock — including under hostile client overrides —
 *       across the prefix × protocol matrix (OpenAI Chat Completions,
 *       Anthropic Messages, Gemini-style ids).
 *   §3  When `GATEWAY_URL` + `GATEWAY_API_KEY` are set, hits the live
 *       gateway and asserts that the response advertises
 *       `X-Gateway-Locked-Provider: <slug>` for every non-pass-through
 *       prefix and that pass-through aliases never carry that header.
 *
 * Exits non-zero on the first failure so this can be wired into CI.
 *
 * Usage (no extra devDependencies — Node ≥22 strips TS natively):
 *   node --experimental-strip-types scripts/test-absolute-routing.ts
 *   GATEWAY_URL=http://localhost:3000 GATEWAY_API_KEY=… \
 *     node --experimental-strip-types scripts/test-absolute-routing.ts
 *   # …or via the wrapper:
 *   ./scripts/test-absolute-routing.sh
 */

import {
  detectAbsoluteProviderRoute,
  listAbsoluteProviderPrefixAliases,
  mergeGatewayProviderConfig,
  resolveGatewayModelRoute,
} from "../artifacts/api-server/src/lib/gateway/provider.ts";
import type {
  GatewayModelResolution,
  GatewayProviderConfig,
  GatewayProviderRoute,
} from "../artifacts/api-server/src/lib/gateway/types.ts";

interface PrefixCase {
  /** Routing prefix as it appears in a model id (lowercase). */
  prefix: string;
  /** Expected canonical OpenRouter provider slug. */
  expectedSlug: string;
  /** A representative bare model id under that prefix, used to build
   *  realistic OpenAI/Anthropic/Gemini-protocol payloads. */
  bareModel: string;
}

/** All non-pass-through prefixes we expect to lock.  The expected canonical
 *  slug for each comes from PROVIDER_PREFIX_SPECS in provider.ts. */
const PREFIX_CASES: PrefixCase[] = [
  { prefix: "bedrock",           expectedSlug: "amazon-bedrock",   bareModel: "claude-sonnet-4.5" },
  { prefix: "amazon-bedrock",    expectedSlug: "amazon-bedrock",   bareModel: "claude-opus-4.5" },
  { prefix: "vertex",            expectedSlug: "google-vertex",    bareModel: "claude-sonnet-4.5" },
  { prefix: "google-vertex",     expectedSlug: "google-vertex",    bareModel: "gemini-2.5-pro" },
  { prefix: "anthropic-vertex",  expectedSlug: "google-vertex",    bareModel: "claude-sonnet-4.5" },
  { prefix: "anthropic",         expectedSlug: "anthropic",        bareModel: "claude-sonnet-4.5" },
  { prefix: "anthropic-direct",  expectedSlug: "anthropic",        bareModel: "claude-sonnet-4.5" },
  { prefix: "aistudio",          expectedSlug: "google-ai-studio", bareModel: "gemini-2.5-pro" },
  { prefix: "google-ai-studio",  expectedSlug: "google-ai-studio", bareModel: "gemini-2.5-pro" },
  { prefix: "google",            expectedSlug: "google-vertex",    bareModel: "gemini-2.5-pro" },
  { prefix: "openai",            expectedSlug: "openai",           bareModel: "gpt-5-mini" },
  { prefix: "openai-direct",     expectedSlug: "openai",           bareModel: "gpt-5-mini" },
  { prefix: "x-ai",              expectedSlug: "x-ai",             bareModel: "grok-4" },
  { prefix: "xai",               expectedSlug: "x-ai",             bareModel: "grok-4" },
  { prefix: "deepseek",          expectedSlug: "deepseek",         bareModel: "deepseek-v3" },
  { prefix: "deepseek-direct",   expectedSlug: "deepseek",         bareModel: "deepseek-v3" },
  { prefix: "mistral",           expectedSlug: "mistral",          bareModel: "mistral-large" },
  { prefix: "mistralai",         expectedSlug: "mistral",          bareModel: "mistral-large" },
  { prefix: "cohere",            expectedSlug: "cohere",           bareModel: "command-r-plus" },
  { prefix: "perplexity",        expectedSlug: "perplexity",       bareModel: "sonar-pro" },
  { prefix: "moonshotai",        expectedSlug: "moonshotai",       bareModel: "kimi-k2" },
  { prefix: "moonshot",          expectedSlug: "moonshotai",       bareModel: "kimi-k2" },
  { prefix: "z-ai",              expectedSlug: "z-ai",             bareModel: "glm-4.6" },
  { prefix: "zai",               expectedSlug: "z-ai",             bareModel: "glm-4.6" },
  { prefix: "groq",              expectedSlug: "groq",             bareModel: "llama-3.3-70b-versatile" },
  { prefix: "cerebras",          expectedSlug: "cerebras",         bareModel: "llama-3.3-70b" },
  { prefix: "sambanova",         expectedSlug: "sambanova",        bareModel: "llama-3.3-70b" },
  { prefix: "fireworks",         expectedSlug: "fireworks",        bareModel: "llama-3.3-70b" },
  { prefix: "fireworks-ai",      expectedSlug: "fireworks",        bareModel: "llama-3.3-70b" },
  { prefix: "together",          expectedSlug: "together",         bareModel: "llama-3.3-70b" },
  { prefix: "togetherai",        expectedSlug: "together",         bareModel: "llama-3.3-70b" },
  { prefix: "deepinfra",         expectedSlug: "deepinfra",        bareModel: "llama-3.3-70b" },
  { prefix: "novita",            expectedSlug: "novita",           bareModel: "llama-3.3-70b" },
  { prefix: "novitaai",          expectedSlug: "novita",           bareModel: "llama-3.3-70b" },
  { prefix: "hyperbolic",        expectedSlug: "hyperbolic",       bareModel: "llama-3.3-70b" },
  { prefix: "lambda",            expectedSlug: "lambda",           bareModel: "llama-3.3-70b" },
  { prefix: "cloudflare",        expectedSlug: "cloudflare",       bareModel: "llama-3.3-70b" },
  { prefix: "friendli",          expectedSlug: "friendli",         bareModel: "llama-3.3-70b" },
  { prefix: "featherless",       expectedSlug: "featherless",      bareModel: "llama-3.3-70b" },
  { prefix: "mancer",            expectedSlug: "mancer",           bareModel: "llama-3.3-70b" },
  { prefix: "parasail",          expectedSlug: "parasail",         bareModel: "llama-3.3-70b" },
  { prefix: "baseten",           expectedSlug: "baseten",          bareModel: "llama-3.3-70b" },
  { prefix: "replicate",         expectedSlug: "replicate",        bareModel: "llama-3.3-70b" },
  { prefix: "nebius",            expectedSlug: "nebius",           bareModel: "llama-3.3-70b" },
  { prefix: "chutes",            expectedSlug: "chutes",           bareModel: "llama-3.3-70b" },
  { prefix: "azure",             expectedSlug: "azure",            bareModel: "gpt-5-mini" },
  { prefix: "azure-openai",      expectedSlug: "azure",            bareModel: "gpt-5-mini" },
  // ── Locks merged in from the parallel HEAD branch (fdc0209) ──
  { prefix: "ai-studio",         expectedSlug: "google-ai-studio", bareModel: "gemini-2.5-pro" },
  { prefix: "nvidia",            expectedSlug: "nvidia",           bareModel: "llama-3.3-70b" },
  { prefix: "minimax",           expectedSlug: "minimax",          bareModel: "minimax-m2" },
  { prefix: "alibaba",           expectedSlug: "alibaba",          bareModel: "qwen-2.5-72b" },
  { prefix: "alibaba-cloud",     expectedSlug: "alibaba",          bareModel: "qwen-2.5-72b" },
  { prefix: "baidu",             expectedSlug: "baidu",            bareModel: "ernie-4.5" },
  { prefix: "baidu-qianfan",     expectedSlug: "baidu",            bareModel: "ernie-4.5" },
];

const PASS_THROUGH_PREFIXES = ["openrouter", "auto"];

/** Vendor-only namespaces — recognised so the prefix is stripped during
 *  canonicalisation, but no `provider.only` is injected (these vendors are
 *  hosted by multiple OpenRouter sub-channels). detectAbsoluteProviderRoute()
 *  returns undefined for them, just like for pass-through aliases. */
const VENDOR_ONLY_PREFIXES = ["meta-llama", "meta", "llama", "qwen", "amazon"];

const PROTOCOL_PROBES: ReadonlyArray<{
  protocol: "openai-chat-completions" | "anthropic-messages" | "gemini-generate-content";
  /** Build a bare model id under the given prefix for the given protocol. */
  formatModel(prefix: string, bare: string): string;
}> = [
  {
    protocol: "openai-chat-completions",
    formatModel: (prefix, bare) => `${prefix}/${bare}`,
  },
  {
    protocol: "anthropic-messages",
    formatModel: (prefix, bare) => `${prefix}/${bare.startsWith("claude") ? bare : "claude-sonnet-4.5"}`,
  },
  {
    protocol: "gemini-generate-content",
    formatModel: (prefix, bare) => `${prefix}/${bare.startsWith("gemini") ? bare : "gemini-2.5-pro"}`,
  },
];

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    const msg = detail ? `${name} — ${detail}` : name;
    failures.push(msg);
    console.error(`  FAIL  ${msg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// §1  detectAbsoluteProviderRoute() classification
// ─────────────────────────────────────────────────────────────────────────

console.log("§1  detectAbsoluteProviderRoute() classification");

for (const prefix of listAbsoluteProviderPrefixAliases()) {
  const route = detectAbsoluteProviderRoute(`${prefix}/foo-model`);
  if (PASS_THROUGH_PREFIXES.includes(prefix)) {
    check(
      `pass-through: ${prefix}/`,
      route === undefined,
      `expected undefined (pass-through), got ${JSON.stringify(route)}`,
    );
  } else if (VENDOR_ONLY_PREFIXES.includes(prefix)) {
    check(
      `vendor-only namespace: ${prefix}/`,
      route === undefined,
      `expected undefined (vendor-only namespace, no lock), got ${JSON.stringify(route)}`,
    );
  } else {
    const expected = PREFIX_CASES.find((c) => c.prefix === prefix);
    check(
      `prefix in PREFIX_CASES: ${prefix}`,
      !!expected,
      `prefix ${prefix} returned by listAbsoluteProviderPrefixAliases() but not present in PREFIX_CASES (test fixture out of sync with PROVIDER_PREFIX_SPECS)`,
    );
    check(
      `lock present for: ${prefix}/`,
      !!route,
      `expected provider lock, got undefined`,
    );
    if (route && expected) {
      check(
        `lock slug for ${prefix}/ → ${expected.expectedSlug}`,
        route.provider === expected.expectedSlug,
        `expected provider="${expected.expectedSlug}", got "${route.provider}"`,
      );
      check(
        `lock allow_fallbacks=false for ${prefix}/`,
        route.allowFallbacks === false,
        `expected false, got ${route.allowFallbacks}`,
      );
      check(
        `lock only=[${expected.expectedSlug}] for ${prefix}/`,
        Array.isArray(route.only) && route.only.length === 1 && route.only[0] === expected.expectedSlug,
        `expected ["${expected.expectedSlug}"], got ${JSON.stringify(route.only)}`,
      );
    }
  }
}

for (const c of PREFIX_CASES) {
  const inAliases = listAbsoluteProviderPrefixAliases().includes(c.prefix);
  check(
    `PREFIX_CASES prefix is recognised: ${c.prefix}`,
    inAliases,
    `prefix "${c.prefix}" not present in listAbsoluteProviderPrefixAliases() output (PROVIDER_PREFIX_SPECS missing this alias)`,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// §2  Lock-injection across prefix × protocol matrix
//     (mergeGatewayProviderConfig + buildAbsoluteProviderBlock)
// ─────────────────────────────────────────────────────────────────────────

console.log("§2  Lock injection (prefix × protocol × hostile-override matrix)");

// Local mirror of routes/proxy.ts#buildAbsoluteProviderBlock — kept in sync
// manually so this script can exercise the legacy /v1/* code path without
// having to import the route module (which imports Express).
function buildAbsoluteProviderBlockLocal(
  route: GatewayProviderRoute,
  clientProvider: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (clientProvider && typeof clientProvider === "object" && !Array.isArray(clientProvider)) {
    for (const [k, v] of Object.entries(clientProvider as Record<string, unknown>)) {
      if (k === "only" || k === "allow_fallbacks" || k === "order") continue;
      out[k] = v;
    }
  }
  if (route.order?.length) out.order = [...route.order];
  if (route.only?.length) out.only = [...route.only];
  out.allow_fallbacks = false;
  return out;
}

function expectLock(
  label: string,
  expectedSlug: string,
  block: Record<string, unknown> | undefined,
  unrelatedKey?: { name: string; value: unknown },
): void {
  check(`${label}: block present`, !!block, "expected non-undefined provider block");
  if (!block) return;
  check(
    `${label}: only=["${expectedSlug}"]`,
    Array.isArray(block.only) && (block.only as string[]).length === 1 && (block.only as string[])[0] === expectedSlug,
    `expected only=["${expectedSlug}"], got ${JSON.stringify(block.only)}`,
  );
  check(
    `${label}: order=["${expectedSlug}"]`,
    Array.isArray(block.order) && (block.order as string[]).length === 1 && (block.order as string[])[0] === expectedSlug,
    `expected order=["${expectedSlug}"], got ${JSON.stringify(block.order)}`,
  );
  check(
    `${label}: allow_fallbacks coerced to false`,
    block.allow_fallbacks === false || (block as { allowFallbacks?: unknown }).allowFallbacks === false,
    `expected allow_fallbacks/allowFallbacks=false, got ${JSON.stringify({
      allow_fallbacks: block.allow_fallbacks,
      allowFallbacks: (block as { allowFallbacks?: unknown }).allowFallbacks,
    })}`,
  );
  if (unrelatedKey) {
    check(
      `${label}: preserves unrelated key "${unrelatedKey.name}"`,
      JSON.stringify(block[unrelatedKey.name]) === JSON.stringify(unrelatedKey.value),
      `expected ${unrelatedKey.name}=${JSON.stringify(unrelatedKey.value)}, got ${JSON.stringify(block[unrelatedKey.name])}`,
    );
  }
}

function gatewayBlockToWire(merged: GatewayProviderConfig | undefined): Record<string, unknown> | undefined {
  if (!merged) return undefined;
  const wire: Record<string, unknown> = {};
  if (merged.only?.length) wire.only = [...merged.only];
  if (merged.order?.length) wire.order = [...merged.order];
  wire.allow_fallbacks = merged.allowFallbacks === false ? false : merged.allowFallbacks;
  if (merged.raw && typeof merged.raw === "object") {
    for (const [k, v] of Object.entries(merged.raw)) {
      if (k in wire) continue;
      wire[k] = v;
    }
  }
  // Preserve the typed sort field if present (preserves unrelated-key contract)
  if (typeof (merged as { sort?: unknown }).sort !== "undefined") {
    wire.sort = (merged as { sort?: unknown }).sort;
  }
  return wire;
}

const HOSTILE_CLIENT_PROVIDER = {
  // Try to widen the lock — must be discarded.
  only: ["openai", "anthropic", "groq"],
  // Try to escape the lock — must be coerced to false.
  allow_fallbacks: true,
  // Try to reorder providers — must be replaced.
  order: ["openai", "anthropic"],
  // Try to inject something the lock doesn't know about — must be preserved
  // (it's an unrelated key).
  sort: "throughput",
};

for (const c of PREFIX_CASES) {
  for (const probe of PROTOCOL_PROBES) {
    const modelId = probe.formatModel(c.prefix, c.bareModel);
    const resolution: GatewayModelResolution = resolveGatewayModelRoute(modelId);

    const route = detectAbsoluteProviderRoute(modelId);
    check(
      `route detected for ${probe.protocol} ${modelId}`,
      !!route && route.provider === c.expectedSlug,
      `expected provider="${c.expectedSlug}", got ${JSON.stringify(route)}`,
    );
    if (!route) continue;

    // §2a  Unified gateway path — mergeGatewayProviderConfig
    const mergedHonest = mergeGatewayProviderConfig(undefined, resolution);
    expectLock(
      `merge[${probe.protocol} honest ${c.prefix}/]`,
      c.expectedSlug,
      gatewayBlockToWire(mergedHonest),
    );

    const mergedHostile = mergeGatewayProviderConfig(
      {
        only: HOSTILE_CLIENT_PROVIDER.only,
        order: HOSTILE_CLIENT_PROVIDER.order,
        allowFallbacks: true,
        sort: "throughput",
      } as unknown as GatewayProviderConfig,
      resolution,
    );
    expectLock(
      `merge[${probe.protocol} HOSTILE ${c.prefix}/]`,
      c.expectedSlug,
      gatewayBlockToWire(mergedHostile),
      { name: "sort", value: "throughput" },
    );

    // §2b  Legacy /v1/* path — buildAbsoluteProviderBlock
    expectLock(
      `legacy[${probe.protocol} honest ${c.prefix}/]`,
      c.expectedSlug,
      buildAbsoluteProviderBlockLocal(route, undefined),
    );
    expectLock(
      `legacy[${probe.protocol} HOSTILE ${c.prefix}/]`,
      c.expectedSlug,
      buildAbsoluteProviderBlockLocal(route, HOSTILE_CLIENT_PROVIDER),
      { name: "sort", value: "throughput" },
    );
  }
}

// Pass-through prefixes must NEVER inject a lock.
for (const prefix of PASS_THROUGH_PREFIXES) {
  for (const probe of PROTOCOL_PROBES) {
    const modelId = probe.formatModel(prefix, "claude-sonnet-4.5");
    const resolution = resolveGatewayModelRoute(modelId);
    const route = detectAbsoluteProviderRoute(modelId);
    check(
      `pass-through: detect undefined for ${probe.protocol} ${modelId}`,
      route === undefined,
      `expected undefined, got ${JSON.stringify(route)}`,
    );
    const merged = mergeGatewayProviderConfig(undefined, resolution);
    check(
      `pass-through: no lock from merge for ${probe.protocol} ${modelId}`,
      merged === undefined || merged.allowFallbacks !== false || (merged.only ?? []).length === 0,
      `expected no lock (allowFallbacks!=false or only.length==0), got ${JSON.stringify(merged)}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// §3  Live gateway probe (optional)
// ─────────────────────────────────────────────────────────────────────────

async function runLiveProbes(): Promise<void> {
  const url = process.env.GATEWAY_URL;
  const apiKey = process.env.GATEWAY_API_KEY;
  if (!url || !apiKey) {
    console.log("§3  Live gateway probe — SKIPPED (set GATEWAY_URL and GATEWAY_API_KEY to enable)");
    return;
  }
  console.log(`§3  Live gateway probe — ${url}`);

  for (const c of PREFIX_CASES.slice(0, 6)) {
    // Light request: max_tokens=1, no streaming — we don't care about the
    // reply, only the gateway's response headers.
    const modelId = `${c.prefix}/${c.bareModel}`;
    let resp: Response;
    try {
      resp = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          stream: false,
        }),
      });
    } catch (err) {
      check(`live: ${modelId} fetch`, false, `network error: ${(err as Error).message}`);
      continue;
    }
    const lockedHeader = resp.headers.get("x-gateway-locked-provider");
    const allowFallbacksHeader = resp.headers.get("x-gateway-allow-fallbacks");
    // 422 (provider_capability_missing) is an acceptable outcome too — it
    // proves the capability gate fired; the lock is still being honoured.
    if (resp.status === 422) {
      const body = await resp.json().catch(() => ({}));
      check(
        `live: ${modelId} 422 carries provider_capability_missing`,
        body?.error?.type === "provider_capability_missing" && body?.error?.providerSlug === c.expectedSlug,
        `expected provider_capability_missing for ${c.expectedSlug}, got ${JSON.stringify(body)}`,
      );
      continue;
    }
    check(
      `live: ${modelId} → X-Gateway-Locked-Provider=${c.expectedSlug}`,
      lockedHeader === c.expectedSlug,
      `expected "${c.expectedSlug}", got "${lockedHeader}" (status=${resp.status})`,
    );
    check(
      `live: ${modelId} → X-Gateway-Allow-Fallbacks=false`,
      allowFallbacksHeader === "false",
      `expected "false", got "${allowFallbacksHeader}"`,
    );
  }

  // Pass-through must NOT carry the locked-provider header.
  const ptModel = "openrouter/anthropic/claude-sonnet-4.5";
  try {
    const resp = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ptModel,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
    });
    const lockedHeader = resp.headers.get("x-gateway-locked-provider");
    check(
      `live: pass-through ${ptModel} omits X-Gateway-Locked-Provider`,
      lockedHeader === null,
      `expected null/missing, got "${lockedHeader}"`,
    );
  } catch (err) {
    check(`live: ${ptModel} fetch`, false, `network error: ${(err as Error).message}`);
  }
}

await runLiveProbes();

// ─────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────

console.log("");
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error(`\n${fail} assertion(s) failed:`);
  for (const msg of failures) console.error(`  - ${msg}`);
  process.exit(1);
}
process.exit(0);
