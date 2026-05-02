/**
 * generate-crosscheck-evidence.mjs
 *
 * Standalone evidence-generation script for upstream-crosscheck Task #5.
 * Imports the compiled gateway bundle directly (no running server needed)
 * and runs every test vector through normalizeGatewayRequest + buildOpenRouterRequest,
 * writing captures to docs/upstream-crosscheck/captures/.
 *
 * Usage:
 *   node scripts/generate-crosscheck-evidence.mjs
 *   # captures written to docs/upstream-crosscheck/captures/
 */

import { createRequire } from "module";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CAPTURES = join(ROOT, "docs/upstream-crosscheck/captures");
mkdirSync(CAPTURES, { recursive: true });

// ---------------------------------------------------------------------------
// Load the compiled bundle so we can call normalize + build directly.
// The bundle is self-contained (no external runtime deps needed).
// ---------------------------------------------------------------------------
const BUNDLE = join(ROOT, "artifacts/api-server/dist/index.mjs");

// We extract the two functions we need by injecting a global sidecar before
// importing the bundle; the sidecar receives function references via the
// bundle's internal exports that are re-exposed on globalThis.
// Simpler: just inline the logic we need via a small ts-node invocation.
// Actually, we use a temporary wrapper approach: spawn a child Node process
// that imports the bundle and calls our vectors.

import { execSync } from "child_process";

const VECTORS = [
  // §P-001: bedrock/ prefix → provider lock
  {
    id: "P-001-bedrock",
    desc: "bedrock/ prefix → provider.only=[amazon-bedrock], allow_fallbacks=false",
    body: { model: "bedrock/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
  },
  // §P-001: vertex/ prefix → provider lock
  {
    id: "P-001-vertex",
    desc: "vertex/ prefix → provider.only=[google-vertex], allow_fallbacks=false",
    body: { model: "vertex/gemini-2.5-pro", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
  },
  // §P-001: anthropic/ prefix → provider lock
  {
    id: "P-001-anthropic",
    desc: "anthropic/ prefix → provider.only=[anthropic], allow_fallbacks=false",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
  },
  // §P-001: groq/ prefix → provider lock
  {
    id: "P-001-groq",
    desc: "groq/ prefix → provider.only=[Groq], allow_fallbacks=false",
    body: { model: "groq/llama-3.3-70b", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
  },
  // §P-002: client cannot override allow_fallbacks
  {
    id: "P-002",
    desc: "client allow_fallbacks:true must be overridden when lock is active",
    body: { model: "bedrock/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5, provider: { allow_fallbacks: true } },
  },
  // §P-003: openrouter/ passthrough — no lock
  {
    id: "P-003-passthrough",
    desc: "openrouter/ prefix — no provider lock injected",
    body: { model: "openrouter/anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
  },
  // §P-005: OpenAI system+user roles
  {
    id: "P-005-roles",
    desc: "OpenAI system+user roles preserved in outbound",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Say HELLO." }], max_tokens: 5 },
  },
  // §P-006: tool_calls in assistant message
  {
    id: "P-006-tool-calls",
    desc: "OpenAI tool_calls in assistant → forwarded with type:function, arguments as string",
    body: {
      model: "anthropic/claude-haiku-3-5",
      messages: [
        { role: "assistant", content: null, tool_calls: [{ id: "tc1", type: "function", function: { name: "my_fn", arguments: '{"x":1}' } }] },
        { role: "tool", content: "result", tool_call_id: "tc1" },
      ],
      max_tokens: 5,
    },
  },
  // §P-009: max_completion_tokens alias
  {
    id: "P-009-max-tokens",
    desc: "max_completion_tokens alias → outbound max_tokens",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_completion_tokens: 100 },
  },
  // §P-010: reasoning_effort
  {
    id: "P-010-reasoning-effort",
    desc: "reasoning_effort:high → ir.reasoning.effort=high",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 20, reasoning_effort: "high" },
  },
  // §P-012: Anthropic thinking config (ANT-3)
  {
    id: "P-012-thinking",
    desc: "Anthropic thinking.budget_tokens → ir.reasoning.maxTokens",
    body: { model: "anthropic/claude-haiku-3-5", anthropic_version: "2023-06-01", messages: [{ role: "user", content: "hi" }], max_tokens: 200, thinking: { type: "enabled", budget_tokens: 1024 } },
  },
  // §P-013: Anthropic /v1/messages protocol detected
  {
    id: "P-013-anthropic-native",
    desc: "Anthropic anthropic_version field → protocol=anthropic-messages",
    body: { model: "anthropic/claude-haiku-3-5", anthropic_version: "2023-06-01", max_tokens: 20, messages: [{ role: "user", content: "hello" }] },
  },
  // §P-014: Anthropic system prompt
  {
    id: "P-014-system",
    desc: "Anthropic system string → prepended as system role message",
    body: { model: "anthropic/claude-haiku-3-5", anthropic_version: "2023-06-01", max_tokens: 20, messages: [{ role: "user", content: "hi" }], system: "You are helpful." },
  },
  // §P-015 (F-001): Anthropic stop_sequences → ir.stop → outbound stop
  {
    id: "P-015-stop-sequences",
    desc: "F-001 FIX: Anthropic stop_sequences → ir.stop → outbound body.stop (not stop_sequences)",
    body: { model: "anthropic/claude-haiku-3-5", anthropic_version: "2023-06-01", max_tokens: 50, messages: [{ role: "user", content: "count 1 2 3" }], stop_sequences: ["3"] },
  },
  // §P-018: Anthropic stop_reason pass-through (checked at stream layer; static check)
  {
    id: "P-018-stop-reason",
    desc: "Anthropic stop + stop_reason are forwarded without mapping",
    body: { model: "anthropic/claude-haiku-3-5", anthropic_version: "2023-06-01", max_tokens: 20, messages: [{ role: "user", content: "hi" }] },
  },
  // §P-019: Gemini contents model→assistant role
  {
    id: "P-019-gemini-roles",
    desc: "Gemini contents role=model → assistant in IR messages",
    body: { model: "google/gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: "hi" }] }, { role: "model", parts: [{ text: "hello" }] }, { role: "user", parts: [{ text: "ok" }] }] },
  },
  // §P-021: Gemini stopSequences
  {
    id: "P-021-stop-sequences",
    desc: "Gemini generationConfig.stopSequences → ir.stop",
    body: { model: "google/gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { stopSequences: ["END"] } },
  },
  // §P-022 (F-002): Gemini thinkingConfig official fields
  {
    id: "P-022-thinking-budget",
    desc: "F-002 FIX: Gemini generationConfig.thinkingConfig.thinkingBudget → ir.reasoning.maxTokens",
    body: { model: "google/gemini-2.5-pro", contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: { thinkingConfig: { thinkingBudget: 1024, includeThoughts: true, thinkingLevel: "ENABLED" } } },
  },
  {
    id: "P-022-thinking-disabled",
    desc: "F-002 FIX: Gemini thinkingLevel=DISABLED → ir.reasoning.enabled=false",
    body: { model: "google/gemini-2.5-pro", contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: { thinkingConfig: { thinkingLevel: "DISABLED" } } },
  },
  {
    id: "P-022-thinking-dynamic",
    desc: "F-002 FIX: Gemini thinkingLevel=DYNAMIC → ir.reasoning.enabled=true, interleaved=true",
    body: { model: "google/gemini-2.5-pro", contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: { thinkingConfig: { thinkingLevel: "DYNAMIC" } } },
  },
  // §P-022 backward compat: old reasoningConfig field still works
  {
    id: "P-022-compat-reasoningConfig",
    desc: "Backward compat: body.reasoningConfig.enabled → ir.reasoning.enabled (fallback)",
    body: { model: "google/gemini-2.5-pro", contents: [{ role: "user", parts: [{ text: "hello" }] }], reasoningConfig: { enabled: true, maxOutputTokens: 512 } },
  },
  // §P-025: prompt caching
  {
    id: "P-025-caching",
    desc: "cache_control top-level → ir.cache → outbound body.cache_control",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5, cache_control: { type: "ephemeral" } },
  },
  // §P-027: reasoning max_tokens
  {
    id: "P-027-reasoning",
    desc: "reasoning.max_tokens → ir.reasoning.maxTokens → outbound reasoning.max_tokens",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5, reasoning: { max_tokens: 512 } },
  },
  // §N-A-003: Bedrock model ID normalisation
  {
    id: "NA-003-bedrock-model-id",
    desc: "Bedrock model ID normalised to OR canonical form",
    body: { model: "bedrock/anthropic.claude-haiku-3-5-20251022-v1:0", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
  },
];

// ---------------------------------------------------------------------------
// Inner script that runs inside the bundle context
// ---------------------------------------------------------------------------
const INNER = `
import { normalizeGatewayRequest, buildOpenRouterRequest } from "${BUNDLE}";
import { writeFileSync } from "fs";

const vectors = ${JSON.stringify(VECTORS)};

const results = [];
for (const v of vectors) {
  try {
    const normalized = normalizeGatewayRequest(v.body);
    const outbound = buildOpenRouterRequest(normalized.ir);
    results.push({ id: v.id, desc: v.desc, protocol: normalized.protocol, ir: normalized.ir, outbound, ok: true });
  } catch (e) {
    results.push({ id: v.id, desc: v.desc, error: String(e), ok: false });
  }
}

writeFileSync("${CAPTURES}/all-captures.json", JSON.stringify(results, null, 2));
console.log("wrote", results.length, "captures");
for (const r of results) {
  console.log(r.ok ? "OK" : "ERR", r.id, r.error || "");
}
`;

const innerFile = join(CAPTURES, "_inner.mjs");
writeFileSync(innerFile, INNER);

try {
  const out = execSync(`node --enable-source-maps "${innerFile}"`, {
    timeout: 30000,
    env: { ...process.env, PROXY_API_KEY: "vcspeeper" },
  }).toString();
  console.log(out);
} catch (e) {
  console.error("Inner script failed:", e.stderr?.toString() || e.message);
  process.exit(1);
}
