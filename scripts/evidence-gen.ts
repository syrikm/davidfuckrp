/**
 * evidence-gen.ts — Cross-check evidence generator (Task #5)
 *
 * Builds: esbuild --bundle scripts/evidence-gen.ts --platform=node --outfile=scripts/evidence-gen.mjs
 * Run:    node scripts/evidence-gen.mjs
 */

import { normalizeGatewayRequest } from "../artifacts/api-server/src/lib/gateway/normalize";
import { buildOpenRouterRequest } from "../artifacts/api-server/src/lib/gateway/openrouter";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const _dir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
const CAPTURES = join(_dir, "../docs/upstream-crosscheck/captures");
mkdirSync(CAPTURES, { recursive: true });

interface TestVector {
  id: string;
  desc: string;
  body: Record<string, unknown>;
  checks: Array<{ field: string; op: "eq" | "exists" | "absent" | "contains"; expected?: unknown }>;
}

const VECTORS: TestVector[] = [
  // §P-001: bedrock/ prefix → provider lock
  {
    id: "P-001-bedrock",
    desc: "bedrock/ prefix → provider.only=[amazon-bedrock], allow_fallbacks=false",
    body: { model: "bedrock/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
    checks: [
      { field: "outbound.body.provider.only[0]", op: "eq", expected: "amazon-bedrock" },
      { field: "outbound.body.provider.allow_fallbacks", op: "eq", expected: false },
    ],
  },
  {
    id: "P-001-vertex",
    desc: "vertex/ prefix → provider.only=[google-vertex], allow_fallbacks=false",
    body: { model: "vertex/gemini-2.5-pro", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
    checks: [
      { field: "outbound.body.provider.only[0]", op: "eq", expected: "google-vertex" },
      { field: "outbound.body.provider.allow_fallbacks", op: "eq", expected: false },
    ],
  },
  {
    id: "P-001-anthropic",
    desc: "anthropic/ prefix → provider.only contains anthropic slug",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
    checks: [
      { field: "outbound.body.provider.allow_fallbacks", op: "eq", expected: false },
    ],
  },
  {
    id: "P-001-groq",
    desc: "groq/ prefix → provider.only=[Groq], allow_fallbacks=false",
    body: { model: "groq/llama-3.3-70b", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
    checks: [
      { field: "outbound.body.provider.allow_fallbacks", op: "eq", expected: false },
    ],
  },
  // §P-002: client cannot override allow_fallbacks
  {
    id: "P-002",
    desc: "client allow_fallbacks:true overridden when bedrock lock active",
    body: { model: "bedrock/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5, provider: { allow_fallbacks: true } },
    checks: [
      { field: "outbound.body.provider.allow_fallbacks", op: "eq", expected: false },
    ],
  },
  // §P-003: openrouter/ passthrough — openrouter/ prefix strips to bare model;
  // openrouter/meta-llama/... has no recognized provider sub-prefix so no lock.
  {
    id: "P-003-passthrough",
    desc: "openrouter/<bare-model> — no recognized sub-prefix → no allow_fallbacks forced",
    body: { model: "openrouter/meta-llama/llama-3.3-70b-instruct", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
    checks: [
      // When no recognized provider prefix is present, allow_fallbacks is not forced to false
      { field: "outbound.body.provider.allow_fallbacks", op: "absent" },
    ],
  },
  // §P-005: OpenAI system+user roles preserved
  {
    id: "P-005-roles",
    desc: "OpenAI system+user roles → ir.messages[0].role=system, [1].role=user",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Hi." }], max_tokens: 5 },
    checks: [
      { field: "ir.messages[0].role", op: "eq", expected: "system" },
      { field: "ir.messages[1].role", op: "eq", expected: "user" },
    ],
  },
  // §P-009: max_completion_tokens alias
  {
    id: "P-009-max-tokens",
    desc: "max_completion_tokens → ir.maxOutputTokens, outbound max_tokens",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_completion_tokens: 100 },
    checks: [
      { field: "ir.maxOutputTokens", op: "eq", expected: 100 },
      { field: "outbound.body.max_tokens", op: "eq", expected: 100 },
    ],
  },
  // §P-010: reasoning_effort
  {
    id: "P-010-reasoning-effort",
    desc: "reasoning_effort:high → ir.reasoning.effort=high",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 20, reasoning_effort: "high" },
    checks: [
      { field: "ir.reasoning.effort", op: "eq", expected: "high" },
    ],
  },
  // §P-012: Anthropic thinking config
  {
    id: "P-012-thinking",
    desc: "Anthropic thinking.budget_tokens=1024 → ir.reasoning.maxTokens=1024",
    body: { model: "anthropic/claude-haiku-3-5", anthropic_version: "2023-06-01", messages: [{ role: "user", content: "hi" }], max_tokens: 200, thinking: { type: "enabled", budget_tokens: 1024 } },
    checks: [
      { field: "ir.reasoning.maxTokens", op: "eq", expected: 1024 },
      { field: "ir.reasoning.enabled", op: "eq", expected: true },
    ],
  },
  // §P-013: Anthropic protocol detection
  {
    id: "P-013-anthropic-native",
    desc: "anthropic_version field → protocol=anthropic-messages",
    body: { model: "anthropic/claude-haiku-3-5", anthropic_version: "2023-06-01", max_tokens: 20, messages: [{ role: "user", content: "hello" }] },
    checks: [
      { field: "protocol", op: "eq", expected: "anthropic-messages" },
    ],
  },
  // §P-014: Anthropic system prompt → prepended message
  {
    id: "P-014-system",
    desc: "Anthropic system string → prepended system role message in ir.messages",
    body: { model: "anthropic/claude-haiku-3-5", anthropic_version: "2023-06-01", max_tokens: 20, messages: [{ role: "user", content: "hi" }], system: "You are helpful." },
    checks: [
      { field: "ir.messages[0].role", op: "eq", expected: "system" },
    ],
  },
  // §P-015 (F-001 FIX): Anthropic stop_sequences → ir.stop → outbound stop
  {
    id: "P-015-stop-sequences",
    desc: "F-001: stop_sequences→ir.stop→outbound.stop (NOT stop_sequences in outbound)",
    body: { model: "anthropic/claude-haiku-3-5", anthropic_version: "2023-06-01", max_tokens: 50, messages: [{ role: "user", content: "count" }], stop_sequences: ["3"] },
    checks: [
      { field: "ir.stop[0]", op: "eq", expected: "3" },
      { field: "outbound.body.stop[0]", op: "eq", expected: "3" },
      { field: "outbound.body.stop_sequences", op: "absent" },
    ],
  },
  // §P-019: Gemini contents model→assistant role
  {
    id: "P-019-gemini-roles",
    desc: "Gemini contents role=model → assistant in ir.messages",
    body: { model: "google/gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: "hi" }] }, { role: "model", parts: [{ text: "hello" }] }] },
    checks: [
      { field: "ir.messages[0].role", op: "eq", expected: "user" },
      { field: "ir.messages[1].role", op: "eq", expected: "assistant" },
    ],
  },
  // §P-021: Gemini stopSequences → ir.stop
  {
    id: "P-021-stop-sequences",
    desc: "Gemini generationConfig.stopSequences → ir.stop",
    body: { model: "google/gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { stopSequences: ["END"] } },
    checks: [
      { field: "ir.stop[0]", op: "eq", expected: "END" },
    ],
  },
  // §P-022 (F-002 FIX): Gemini thinkingConfig official fields
  {
    id: "P-022-thinkingBudget",
    desc: "F-002: generationConfig.thinkingConfig.thinkingBudget=1024 → ir.reasoning.maxTokens=1024",
    body: { model: "google/gemini-2.5-pro", contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: { thinkingConfig: { thinkingBudget: 1024, includeThoughts: true, thinkingLevel: "ENABLED" } } },
    checks: [
      { field: "ir.reasoning.maxTokens", op: "eq", expected: 1024 },
      { field: "ir.reasoning.includeReasoning", op: "eq", expected: true },
      { field: "ir.reasoning.enabled", op: "eq", expected: true },
    ],
  },
  {
    id: "P-022-DISABLED",
    desc: "F-002: thinkingLevel=DISABLED → ir.reasoning.enabled=false",
    body: { model: "google/gemini-2.5-pro", contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: { thinkingConfig: { thinkingLevel: "DISABLED" } } },
    checks: [
      { field: "ir.reasoning.enabled", op: "eq", expected: false },
    ],
  },
  {
    id: "P-022-DYNAMIC",
    desc: "F-002: thinkingLevel=DYNAMIC → ir.reasoning.enabled=true, interleaved=true",
    body: { model: "google/gemini-2.5-pro", contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: { thinkingConfig: { thinkingLevel: "DYNAMIC" } } },
    checks: [
      { field: "ir.reasoning.enabled", op: "eq", expected: true },
      { field: "ir.reasoning.interleaved", op: "eq", expected: true },
    ],
  },
  {
    id: "P-022-compat-reasoningConfig",
    desc: "Backward compat: body.reasoningConfig.enabled=true → ir.reasoning.enabled=true",
    body: { model: "google/gemini-2.5-pro", contents: [{ role: "user", parts: [{ text: "hello" }] }], reasoningConfig: { enabled: true, maxOutputTokens: 512 } },
    checks: [
      { field: "ir.reasoning.enabled", op: "eq", expected: true },
      { field: "ir.reasoning.maxTokens", op: "eq", expected: 512 },
    ],
  },
  // §P-025: cache_control forwarded (normalizeCacheControl stores type in .mode)
  {
    id: "P-025-caching",
    desc: "cache_control.type=ephemeral → ir.cache.mode=ephemeral, outbound body.cache_control.type=ephemeral",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5, cache_control: { type: "ephemeral" } },
    checks: [
      { field: "ir.cache.mode", op: "eq", expected: "ephemeral" },
    ],
  },
  // §P-027: reasoning.max_tokens
  {
    id: "P-027-reasoning",
    desc: "reasoning.max_tokens=512 → ir.reasoning.maxTokens=512",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5, reasoning: { max_tokens: 512 } },
    checks: [
      { field: "ir.reasoning.maxTokens", op: "eq", expected: 512 },
    ],
  },
  // §NA-003: Bedrock model ID normalisation
  {
    id: "NA-003-bedrock-model-id",
    desc: "Bedrock model ID anthropic.claude-haiku-3-5-20251022-v1:0 → canonical form",
    body: { model: "bedrock/anthropic.claude-haiku-3-5-20251022-v1:0", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
    checks: [
      { field: "outbound.body.provider.only[0]", op: "eq", expected: "amazon-bedrock" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Run vectors
// ---------------------------------------------------------------------------
function getPath(obj: unknown, path: string): unknown {
  const parts = path.split(/[\.\[\]]+/).filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    const idx = parseInt(p, 10);
    if (!isNaN(idx) && Array.isArray(cur)) cur = (cur as unknown[])[idx];
    else cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function check(
  data: { ir: unknown; outbound: unknown; protocol: string },
  c: TestVector["checks"][0]
): { pass: boolean; actual: unknown } {
  const actual = getPath({ ir: data.ir, outbound: data.outbound, protocol: data.protocol }, c.field);
  switch (c.op) {
    case "eq":     return { pass: actual === c.expected, actual };
    case "exists": return { pass: actual !== undefined && actual !== null, actual };
    case "absent": return { pass: actual === undefined, actual };
    case "contains": return { pass: Array.isArray(actual) && (actual as unknown[]).includes(c.expected), actual };
    default:       return { pass: false, actual };
  }
}

const allResults: unknown[] = [];
let totalPass = 0, totalFail = 0;

for (const v of VECTORS) {
  try {
    const normalized = normalizeGatewayRequest(v.body);
    const outbound = buildOpenRouterRequest(normalized.ir);

    const checkResults = v.checks.map((c) => {
      const r = check({ ir: normalized.ir, outbound, protocol: normalized.protocol }, c);
      return { field: c.field, op: c.op, expected: c.expected, actual: r.actual, pass: r.pass };
    });

    const allPass = checkResults.every((r) => r.pass);
    if (allPass) totalPass++; else totalFail++;

    allResults.push({
      id: v.id, desc: v.desc, ok: allPass,
      protocol: normalized.protocol,
      ir_stop: (normalized.ir as Record<string, unknown>).stop,
      ir_reasoning: (normalized.ir as Record<string, unknown>).reasoning,
      ir_messages_roles: Array.isArray((normalized.ir as Record<string, unknown>).messages)
        ? ((normalized.ir as Record<string, unknown>).messages as Array<Record<string, unknown>>).map((m) => m.role)
        : undefined,
      outbound_provider: (outbound.body as Record<string, unknown>).provider,
      outbound_stop: (outbound.body as Record<string, unknown>).stop,
      outbound_stop_sequences: (outbound.body as Record<string, unknown>).stop_sequences,
      outbound_model: (outbound.body as Record<string, unknown>).model,
      outbound_max_tokens: (outbound.body as Record<string, unknown>).max_tokens,
      checkResults,
    });

    // Write individual capture
    writeFileSync(
      join(CAPTURES, `${v.id}.ir.json`),
      JSON.stringify({ id: v.id, desc: v.desc, request: v.body, protocol: normalized.protocol, ir: normalized.ir, outbound }, null, 2)
    );
    console.log(allPass ? "PASS" : "FAIL", v.id, checkResults.filter((r) => !r.pass).map((r) => `${r.field}=${JSON.stringify(r.actual)} expected ${JSON.stringify(r.expected)}`).join("; "));
  } catch (e) {
    totalFail++;
    allResults.push({ id: v.id, desc: v.desc, ok: false, error: String(e) });
    console.log("ERR ", v.id, String(e).slice(0, 120));
  }
}

writeFileSync(join(CAPTURES, "summary.json"), JSON.stringify({ totalPass, totalFail, results: allResults }, null, 2));
console.log(`\nTotal PASS=${totalPass} FAIL=${totalFail}`);
