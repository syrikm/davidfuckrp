/**
 * Native Replit AI-integration dispatcher.
 *
 * Background: Replit's "OpenRouter" AI integration (AI_INTEGRATIONS_OPENROUTER_*)
 * is NOT real openrouter.ai — it points at an internal modelfarm proxy
 * (http://localhost:1106/modelfarm/openrouter) that hard-locks each model
 * family to a single backend (e.g. claude-opus-* → Amazon Bedrock,
 * claude-sonnet-* → Vertex). The `provider.only` / `provider.order` fields
 * are silently dropped by modelfarm, so prefix-locked routing such as
 * `vertex/claude-opus-4.6` cannot be honoured through OR.
 *
 * However, Replit's NATIVE Anthropic integration (AI_INTEGRATIONS_ANTHROPIC_*)
 * routes ALL Claude traffic through Vertex (response IDs are `msg_vrtx_*`),
 * and the Gemini integration routes through Google. We exploit this:
 *
 *   vertex/claude-*    → Replit Anthropic integration (Vertex)
 *   anthropic/claude-* → Replit Anthropic integration (Vertex)
 *   vertex/gemini-*    → Replit Gemini integration (Google)
 *   aistudio/gemini-*  → Replit Gemini integration (Google)
 *   google/gemini-*    → Replit Gemini integration (Google)
 *
 * `bedrock/*` and all other models continue through the friend-proxy path.
 *
 * Format conversion:
 *   Inbound  : OpenAI chat/completions (request body)
 *   Outbound : Anthropic Messages API or Gemini generateContent
 *   Response : converted back to OpenAI chat/completions shape
 *   Streaming: source SSE re-emitted as OpenAI chat.completion.chunk events
 */

import type { Request, Response } from "express";

// ---------------------------------------------------------------------------
// Routing decision
// ---------------------------------------------------------------------------

const ANTHROPIC_SUPPORTED_MODELS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
]);

const GEMINI_SUPPORTED_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
]);

export type NativeRoute =
  | { kind: "anthropic"; model: string; original: string }
  | { kind: "gemini"; model: string; original: string };

/**
 * Decide whether `model` should bypass friend-proxy and call a native
 * Replit AI integration directly. Returns null when the request must
 * continue through the regular friend-proxy path.
 */
export function routeIsNative(model: string): NativeRoute | null {
  if (process.env["NATIVE_INTEGRATION_DISABLE"] === "1") return null;

  let stripped: string;
  let intent: "anthropic" | "gemini" | null = null;

  if (model.startsWith("vertex/")) {
    stripped = model.slice("vertex/".length);
    if (/^claude-/i.test(stripped)) intent = "anthropic";
    else if (/^gemini-/i.test(stripped)) intent = "gemini";
    else return null; // unknown vertex/* payload → friend
  } else if (model.startsWith("anthropic/")) {
    stripped = model.slice("anthropic/".length);
    if (!/^claude-/i.test(stripped)) return null;
    intent = "anthropic";
  } else if (model.startsWith("aistudio/") || model.startsWith("google/")) {
    stripped = model.replace(/^(aistudio|google)\//, "");
    if (!/^gemini-/i.test(stripped)) return null;
    intent = "gemini";
  } else if (model.startsWith("bedrock/")) {
    return null; // explicit Bedrock intent → leave to friend
  } else {
    return null; // no recognised prefix → friend
  }

  // Strip thinking/-max/-thinking-max suffixes (mother applies reasoning
  // injection separately; the underlying model id is unchanged).
  const noSuffix = stripped.replace(/-(thinking-max|max|thinking)$/i, "");

  if (intent === "anthropic") {
    // Replit modelfarm Anthropic uses dashes for version separators
    // (claude-opus-4-6, not claude-opus-4.6).
    const dashed = noSuffix.replace(/(\d)\.(\d)/g, "$1-$2").toLowerCase();
    if (ANTHROPIC_SUPPORTED_MODELS.has(dashed)) {
      return { kind: "anthropic", model: dashed, original: model };
    }
  } else if (intent === "gemini") {
    // Gemini keeps dotted versions (gemini-2.5-flash, gemini-2.5-pro).
    const lower = noSuffix.toLowerCase();
    if (GEMINI_SUPPORTED_MODELS.has(lower)) {
      return { kind: "gemini", model: lower, original: model };
    }
  }
  return null; // not on supported list → fall back to friend
}

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OAIPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | OAIPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OAIToolCall[];
}

interface AnthropicTextBlock { type: "text"; text: string }
interface AnthropicImageBlock {
  type: "image";
  source:
    | { type: "base64"; media_type: string; data: string }
    | { type: "url"; url: string };
}
interface AnthropicToolUseBlock { type: "tool_use"; id: string; name: string; input: unknown }
interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | AnthropicTextBlock[];
  is_error?: boolean;
}
type AnthropicBlock = AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicBlock[];
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: Array<{ name: string; description?: string; input_schema: unknown }>;
  tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
  thinking?: { type: "enabled"; budget_tokens: number };
}

// ---------------------------------------------------------------------------
// OpenAI → Anthropic
// ---------------------------------------------------------------------------

function extractText(content: OAIMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is OAIPart => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text ?? "")
    .join("\n");
}

function convertOAIToAnthropic(body: Record<string, unknown>, model: string): AnthropicRequest {
  const messages = (body["messages"] as OAIMessage[] | undefined) ?? [];
  let system: string | undefined;
  const out: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      const txt = extractText(m.content);
      system = system ? `${system}\n\n${txt}` : txt;
      continue;
    }
    if (m.role === "tool") {
      const txt = extractText(m.content);
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.tool_call_id ?? "", content: txt }],
      });
      continue;
    }
    if (m.role === "assistant") {
      const blocks: AnthropicBlock[] = [];
      const txt = extractText(m.content);
      if (txt) blocks.push({ type: "text", text: txt });
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          let input: unknown = {};
          try { input = JSON.parse(tc.function.arguments || "{}"); } catch { /* keep {} */ }
          blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
      }
      out.push({ role: "assistant", content: blocks.length > 0 ? blocks : (txt || "") });
      continue;
    }
    // user
    if (typeof m.content === "string") {
      out.push({ role: "user", content: m.content });
    } else if (Array.isArray(m.content)) {
      const blocks: AnthropicBlock[] = [];
      for (const part of m.content) {
        if (part.type === "text") {
          blocks.push({ type: "text", text: part.text ?? "" });
        } else if (part.type === "image_url" && part.image_url?.url) {
          const url = part.image_url.url;
          const m2 = url.match(/^data:([^;]+);base64,(.+)$/);
          if (m2 && m2[1] && m2[2]) {
            blocks.push({ type: "image", source: { type: "base64", media_type: m2[1], data: m2[2] } });
          } else {
            blocks.push({ type: "image", source: { type: "url", url } });
          }
        }
      }
      out.push({ role: "user", content: blocks });
    } else {
      out.push({ role: "user", content: "" });
    }
  }

  const req: AnthropicRequest = {
    model,
    max_tokens: typeof body["max_tokens"] === "number" ? (body["max_tokens"] as number) : 4096,
    messages: out,
    stream: !!body["stream"],
  };
  if (system) req.system = system;
  if (typeof body["temperature"] === "number") req.temperature = body["temperature"] as number;
  if (typeof body["top_p"] === "number") req.top_p = body["top_p"] as number;
  if (typeof body["top_k"] === "number") req.top_k = body["top_k"] as number;
  if (Array.isArray(body["stop"])) req.stop_sequences = body["stop"] as string[];
  else if (typeof body["stop"] === "string") req.stop_sequences = [body["stop"] as string];

  // Tools
  const oaiTools = body["tools"] as
    | Array<{ type: "function"; function: { name: string; description?: string; parameters?: unknown } }>
    | undefined;
  const tc = body["tool_choice"];
  if (oaiTools && oaiTools.length > 0 && tc !== "none") {
    req.tools = oaiTools.map((t) => ({
      name: t.function.name,
      ...(t.function.description ? { description: t.function.description } : {}),
      input_schema: t.function.parameters ?? { type: "object", properties: {} },
    }));
    if (tc === "auto" || tc === undefined) req.tool_choice = { type: "auto" };
    else if (tc === "required") req.tool_choice = { type: "any" };
    else if (typeof tc === "object" && tc !== null) {
      const fn = (tc as { type?: string; function?: { name?: string } });
      if (fn.type === "function" && fn.function?.name) {
        req.tool_choice = { type: "tool", name: fn.function.name };
      }
    }
  }

  // Reasoning → thinking
  const reasoning = body["reasoning"] as { effort?: string; max_tokens?: number } | undefined;
  if (reasoning) {
    const budget = typeof reasoning.max_tokens === "number"
      ? reasoning.max_tokens
      : reasoning.effort === "low" ? 1024
      : reasoning.effort === "medium" ? 4096
      : (reasoning.effort === "high" || reasoning.effort === "max" || reasoning.effort === "xhigh") ? 16384
      : 0;
    if (budget > 0) {
      req.thinking = { type: "enabled", budget_tokens: budget };
      if (req.max_tokens <= budget) req.max_tokens = budget + 4096;
    }
  }

  return req;
}

// ---------------------------------------------------------------------------
// Anthropic → OpenAI (non-streaming)
// ---------------------------------------------------------------------------

function anthropicStopToOAI(stop: string | null | undefined): string {
  if (stop === "end_turn" || stop === "stop_sequence") return "stop";
  if (stop === "max_tokens") return "length";
  if (stop === "tool_use") return "tool_calls";
  return "stop";
}

interface AnthropicResponse {
  id?: string;
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

function convertAnthropicToOAI(resp: AnthropicResponse, requestModel: string): {
  oai: Record<string, unknown>;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
} {
  const id = resp.id ?? `chatcmpl-${Math.random().toString(36).slice(2)}`;
  const content = Array.isArray(resp.content) ? resp.content : [];
  const text = content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  const toolCalls = content
    .filter((b) => b.type === "tool_use")
    .map((b) => ({
      id: b.id ?? "",
      type: "function" as const,
      function: { name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) },
    }));

  const message: Record<string, unknown> = { role: "assistant", content: text || null };
  if (toolCalls.length > 0) message["tool_calls"] = toolCalls;

  const u = resp.usage ?? {};
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const inputTokens = (u.input_tokens ?? 0) + cacheRead + cacheWrite;
  const outputTokens = u.output_tokens ?? 0;

  const oai: Record<string, unknown> = {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestModel,
    choices: [{
      index: 0,
      message,
      finish_reason: anthropicStopToOAI(resp.stop_reason),
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      ...(cacheRead ? { prompt_tokens_details: { cached_tokens: cacheRead } } : {}),
    },
  };

  return { oai, promptTokens: inputTokens, completionTokens: outputTokens, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite };
}

// ---------------------------------------------------------------------------
// Anthropic SSE → OpenAI chat-completion SSE
// ---------------------------------------------------------------------------

interface RouteLogger {
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
}

async function streamAnthropicAsOAI(
  upstream: globalThis.Response,
  res: Response,
  requestModel: string,
  log: RouteLogger,
): Promise<{ promptTokens: number; completionTokens: number; cacheReadTokens: number; cacheWriteTokens: number }> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const id = `chatcmpl-${Math.random().toString(36).slice(2)}`;
  const created = Math.floor(Date.now() / 1000);

  const send = (delta: Record<string, unknown>, finishReason: string | null = null, usage?: Record<string, unknown>): void => {
    const chunk: Record<string, unknown> = {
      id,
      object: "chat.completion.chunk",
      created,
      model: requestModel,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    if (usage) chunk["usage"] = usage;
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };

  send({ role: "assistant" });

  let promptTokens = 0;
  let completionTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let stopReason: string | null = null;

  interface ToolState { id: string; name: string; emittedHeader: boolean }
  const toolStates = new Map<number, ToolState>();

  if (!upstream.body) {
    res.write("data: [DONE]\n\n");
    res.end();
    return { promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens };
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, "");
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
          continue;
        }
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;
        let evt: Record<string, unknown>;
        try { evt = JSON.parse(data) as Record<string, unknown>; } catch { continue; }
        const evtType = (evt["type"] as string | undefined) ?? currentEvent;

        if (evtType === "message_start") {
          const msg = evt["message"] as { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } | undefined;
          const u = msg?.usage;
          if (u) {
            cacheReadTokens = u.cache_read_input_tokens ?? 0;
            cacheWriteTokens = u.cache_creation_input_tokens ?? 0;
            promptTokens = (u.input_tokens ?? 0) + cacheReadTokens + cacheWriteTokens;
          }
        } else if (evtType === "content_block_start") {
          const block = evt["content_block"] as { type?: string; id?: string; name?: string } | undefined;
          const idx = (evt["index"] as number | undefined) ?? 0;
          if (block?.type === "tool_use" && block.id && block.name) {
            toolStates.set(idx, { id: block.id, name: block.name, emittedHeader: false });
          }
        } else if (evtType === "content_block_delta") {
          const delta = evt["delta"] as { type?: string; text?: string; thinking?: string; partial_json?: string } | undefined;
          const idx = (evt["index"] as number | undefined) ?? 0;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            send({ content: delta.text });
          } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
            send({ reasoning: delta.thinking });
          } else if (delta?.type === "input_json_delta") {
            const ts = toolStates.get(idx);
            if (ts) {
              if (!ts.emittedHeader) {
                send({
                  tool_calls: [{
                    index: idx,
                    id: ts.id,
                    type: "function",
                    function: { name: ts.name, arguments: "" },
                  }],
                });
                ts.emittedHeader = true;
              }
              send({ tool_calls: [{ index: idx, function: { arguments: delta.partial_json ?? "" } }] });
            }
          }
        } else if (evtType === "message_delta") {
          const d = evt["delta"] as { stop_reason?: string } | undefined;
          if (d?.stop_reason) stopReason = d.stop_reason;
          const u = evt["usage"] as { output_tokens?: number } | undefined;
          if (typeof u?.output_tokens === "number") completionTokens = u.output_tokens;
        } else if (evtType === "error") {
          const e = evt["error"];
          res.write(`data: ${JSON.stringify({ error: e })}\n\n`);
        }
      }
    }
  } catch (e) {
    log.error({ err: (e as Error).message }, "[native-anthropic] stream read error");
  }

  send({}, anthropicStopToOAI(stopReason), {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    ...(cacheReadTokens ? { prompt_tokens_details: { cached_tokens: cacheReadTokens } } : {}),
  });
  res.write("data: [DONE]\n\n");
  res.end();
  return { promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens };
}

// ---------------------------------------------------------------------------
// Gemini conversion + handler
// ---------------------------------------------------------------------------

interface GeminiPart { text?: string; inline_data?: { mime_type: string; data: string } }
interface GeminiContent { role: "user" | "model"; parts: GeminiPart[] }

function buildGeminiRequest(body: Record<string, unknown>): { url_suffix: string; req: Record<string, unknown> } {
  const messages = (body["messages"] as OAIMessage[] | undefined) ?? [];
  let systemInstruction: string | undefined;
  const contents: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      const txt = extractText(m.content);
      systemInstruction = systemInstruction ? `${systemInstruction}\n\n${txt}` : txt;
      continue;
    }
    if (m.role === "tool") continue; // Gemini path: skip tool results for now
    const role: "user" | "model" = m.role === "assistant" ? "model" : "user";
    if (typeof m.content === "string") {
      contents.push({ role, parts: [{ text: m.content }] });
    } else if (Array.isArray(m.content)) {
      const parts: GeminiPart[] = [];
      for (const p of m.content) {
        if (p.type === "text") parts.push({ text: p.text ?? "" });
        else if (p.type === "image_url" && p.image_url?.url) {
          const mm = p.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
          if (mm && mm[1] && mm[2]) parts.push({ inline_data: { mime_type: mm[1], data: mm[2] } });
        }
      }
      if (parts.length > 0) contents.push({ role, parts });
    }
  }

  const generationConfig: Record<string, unknown> = {};
  if (typeof body["max_tokens"] === "number") generationConfig["maxOutputTokens"] = body["max_tokens"];
  if (typeof body["temperature"] === "number") generationConfig["temperature"] = body["temperature"];
  if (typeof body["top_p"] === "number") generationConfig["topP"] = body["top_p"];
  if (typeof body["top_k"] === "number") generationConfig["topK"] = body["top_k"];
  if (Array.isArray(body["stop"])) generationConfig["stopSequences"] = body["stop"];
  else if (typeof body["stop"] === "string") generationConfig["stopSequences"] = [body["stop"]];

  const req: Record<string, unknown> = { contents, generationConfig };
  if (systemInstruction) req["systemInstruction"] = { parts: [{ text: systemInstruction }] };

  return { url_suffix: "", req };
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

function geminiFinishReason(r: string | undefined): string {
  if (r === "MAX_TOKENS") return "length";
  if (r === "SAFETY" || r === "RECITATION") return "content_filter";
  return "stop";
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface NativeHandlerArgs {
  req: Request;
  res: Response;
  route: NativeRoute;
  body: Record<string, unknown>;
}

export interface NativeHandlerResult {
  promptTokens: number;
  completionTokens: number;
  ttftMs: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheTier: string;
  msgSummary: string;
}

function getLogger(req: Request): RouteLogger {
  const r = req as Request & { log?: RouteLogger };
  return r.log ?? { info: () => {}, warn: () => {}, error: () => {} };
}

export async function handleNativeIntegration(args: NativeHandlerArgs): Promise<NativeHandlerResult> {
  const { req, res, route, body } = args;
  const log = getLogger(req);

  if (route.kind === "anthropic") {
    const key = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
    const base = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
    if (!key || !base) throw new Error("AI_INTEGRATIONS_ANTHROPIC_* not configured on this gateway");

    const aReq = convertOAIToAnthropic(body, route.model);
    const wantStream = !!body["stream"];
    const t0 = Date.now();

    const upstream = await fetch(`${base.replace(/\/+$/, "")}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "Authorization": `Bearer ${key}`,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(aReq),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      let errMessage = text;
      try {
        const j = JSON.parse(text) as { error?: { message?: string }; message?: string };
        errMessage = j.error?.message ?? j.message ?? text;
      } catch { /* keep raw */ }
      const err = new Error(errMessage) as Error & { status?: number };
      err.status = upstream.status;
      throw err;
    }

    const ttftMs = Date.now() - t0;

    if (wantStream) {
      const r = await streamAnthropicAsOAI(upstream, res, route.original, log);
      return {
        ...r,
        ttftMs,
        cacheTier: r.cacheReadTokens ? "read" : (r.cacheWriteTokens ? "write" : "none"),
        msgSummary: "",
      };
    }

    const json = await upstream.json() as AnthropicResponse;
    const conv = convertAnthropicToOAI(json, route.original);
    res.json(conv.oai);
    return {
      promptTokens: conv.promptTokens,
      completionTokens: conv.completionTokens,
      ttftMs,
      cacheReadTokens: conv.cacheReadTokens,
      cacheWriteTokens: conv.cacheWriteTokens,
      cacheTier: conv.cacheReadTokens ? "read" : (conv.cacheWriteTokens ? "write" : "none"),
      msgSummary: "",
    };
  }

  // ── Gemini ──
  const key = process.env["AI_INTEGRATIONS_GEMINI_API_KEY"];
  const base = process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"];
  if (!key || !base) throw new Error("AI_INTEGRATIONS_GEMINI_* not configured on this gateway");

  const { req: gReq } = buildGeminiRequest(body);
  const wantStream = !!body["stream"];
  const action = wantStream ? "streamGenerateContent" : "generateContent";
  const url = `${base.replace(/\/+$/, "")}/models/${route.model}:${action}?key=${encodeURIComponent(key)}${wantStream ? "&alt=sse" : ""}`;

  const t0 = Date.now();
  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(gReq),
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    let errMessage = text;
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      errMessage = j.error?.message ?? text;
    } catch { /* keep raw */ }
    const err = new Error(errMessage) as Error & { status?: number };
    err.status = upstream.status;
    throw err;
  }

  const ttftMs = Date.now() - t0;

  if (!wantStream) {
    const json = await upstream.json() as GeminiResponse;
    const cand = json.candidates?.[0];
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    const finishReason = geminiFinishReason(cand?.finishReason);
    const promptTokens = json.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = json.usageMetadata?.candidatesTokenCount ?? 0;
    res.json({
      id: `chatcmpl-${Math.random().toString(36).slice(2)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: route.original,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: finishReason }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    });
    return { promptTokens, completionTokens, ttftMs, cacheReadTokens: 0, cacheWriteTokens: 0, cacheTier: "none", msgSummary: "" };
  }

  // Streaming path
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const id = `chatcmpl-${Math.random().toString(36).slice(2)}`;
  const created = Math.floor(Date.now() / 1000);
  res.write(`data: ${JSON.stringify({
    id, object: "chat.completion.chunk", created, model: route.original,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  })}\n\n`);

  let promptTokens = 0;
  let completionTokens = 0;

  if (!upstream.body) {
    res.write("data: [DONE]\n\n");
    res.end();
    return { promptTokens, completionTokens, ttftMs, cacheReadTokens: 0, cacheWriteTokens: 0, cacheTier: "none", msgSummary: "" };
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, "");
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;
        let evt: GeminiResponse;
        try { evt = JSON.parse(data) as GeminiResponse; } catch { continue; }
        const cand = evt.candidates?.[0];
        const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
        if (text) {
          res.write(`data: ${JSON.stringify({
            id, object: "chat.completion.chunk", created, model: route.original,
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
          })}\n\n`);
        }
        if (evt.usageMetadata) {
          promptTokens = evt.usageMetadata.promptTokenCount ?? promptTokens;
          completionTokens = evt.usageMetadata.candidatesTokenCount ?? completionTokens;
        }
        if (cand?.finishReason) {
          res.write(`data: ${JSON.stringify({
            id, object: "chat.completion.chunk", created, model: route.original,
            choices: [{ index: 0, delta: {}, finish_reason: geminiFinishReason(cand.finishReason) }],
            usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
          })}\n\n`);
        }
      }
    }
  } catch (e) {
    log.error({ err: (e as Error).message }, "[native-gemini] stream read error");
  }

  res.write("data: [DONE]\n\n");
  res.end();
  return { promptTokens, completionTokens, ttftMs, cacheReadTokens: 0, cacheWriteTokens: 0, cacheTier: "none", msgSummary: "" };
}
