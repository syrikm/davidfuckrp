import type {
  GatewayBridgeRequest,
  GatewayMessage,
  GatewayPart,
  GatewayRequestIR,
  GatewayToolDefinition,
  OpenRouterRequestBuildResult,
} from "./types";

// ─── Claude provider sanitization helpers ──────────────────────────────────
// Per Anthropic docs (https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)
//   • When extended thinking is enabled, `temperature` MUST be 1.0 and
//     `top_p`/`top_k`/`presence_penalty` are forbidden (returns 400).
// Per Replit AI Integrations Anthropic skill (claude-opus-4-7 + Mythos)
//   • `temperature`, `top_p`, `top_k` are deprecated on opus-4-7 and Mythos
//     even WITHOUT thinking. Setting any to a non-default value returns 400.
//
// Both rules apply equally whether the request is routed through OpenRouter
// or any of the cloud-Anthropic backends (Bedrock / Vertex / Anthropic
// direct), so the sanitization runs unconditionally for the Claude family
// at the OpenRouter-bridge serialization step.
const CLAUDE_FAMILY_RE = /^(?:(?:anthropic|bedrock|vertex|amazon|azure|aistudio)\/)?claude[-/]/i;
const CLAUDE_OPUS_47_PLUS_RE = /^claude-opus-4[-.](?:[7-9])(?:\D|$)|^claude-opus-(?:[5-9])|^claude-mythos/i;

function stripClaudeBackendPrefix(model: string): string {
  return model
    .replace(/^(?:anthropic|bedrock|vertex|amazon|azure|aistudio)\//i, "")
    .replace(/-(?:thinking-visible|thinking|max|xhigh|high|medium|low|minimal|none)$/gi, "")
    .replace(/-(?:thinking-visible|thinking|max|xhigh|high|medium|low|minimal|none)$/gi, "");
}

function isClaudeFamily(model: string | undefined): boolean {
  if (!model) return false;
  return CLAUDE_FAMILY_RE.test(model);
}

function isClaudeOpus47Plus(model: string | undefined): boolean {
  if (!model) return false;
  return CLAUDE_OPUS_47_PLUS_RE.test(stripClaudeBackendPrefix(model.toLowerCase()));
}

function reasoningIsEnabled(reasoningField: unknown): boolean {
  if (!reasoningField || typeof reasoningField !== "object") return false;
  const r = reasoningField as Record<string, unknown>;
  if (r.enabled === false) return false;
  return (
    r.enabled === true ||
    typeof r.effort === "string" ||
    typeof r.max_tokens === "number"
  );
}

/**
 * Strip / coerce sampling params that the Claude family rejects.
 *
 *   1. opus-4-7+ / Mythos:   delete temperature, top_p, top_k unconditionally.
 *   2. Other Claude w/ reasoning: force temperature=1, delete top_p, top_k.
 *
 * Mutates `body` in-place and records what was removed in `removed`.
 */
function sanitizeClaudeSamplingParams(
  body: Record<string, unknown>,
): { applied: boolean; removed: string[]; reason?: string } {
  const model = typeof body.model === "string" ? body.model : "";
  if (!isClaudeFamily(model)) return { applied: false, removed: [] };

  const removed: string[] = [];

  if (isClaudeOpus47Plus(model)) {
    for (const key of ["temperature", "top_p", "top_k", "presence_penalty"] as const) {
      if (body[key] !== undefined) {
        delete body[key];
        removed.push(key);
      }
    }
    return { applied: true, removed, reason: "claude-opus-4-7+/mythos: sampling params deprecated" };
  }

  if (reasoningIsEnabled(body.reasoning)) {
    if (body.temperature !== undefined && body.temperature !== 1) {
      body.temperature = 1;
      removed.push("temperature→1");
    }
    for (const key of ["top_p", "top_k", "presence_penalty"] as const) {
      if (body[key] !== undefined) {
        delete body[key];
        removed.push(key);
      }
    }
    if (removed.length > 0) {
      return { applied: true, removed, reason: "claude+thinking: incompatible sampling params stripped" };
    }
  }

  return { applied: false, removed: [] };
}

function partToOpenAICompatible(part: GatewayPart): Record<string, unknown> {
  if (part.type === "text" || part.type === "input_text") {
    return { type: "text", text: part.text };
  }

  if (part.type === "image_url" || part.type === "input_image") {
    return {
      type: "image_url",
      image_url: {
        url: part.url,
      },
    };
  }

  if (part.type === "tool_result") {
    return {
      type: "text",
      text: part.content,
    };
  }

  if (part.type === "json") {
    return {
      type: "text",
      text: JSON.stringify(part.value),
    };
  }

  if (part.type === "tool_call") {
    return {
      type: "text",
      text: JSON.stringify({
        tool_call: {
          id: part.id,
          name: part.name,
          arguments: part.arguments,
        },
      }),
    };
  }

  return {
    type: "text",
    text: "",
  };
}

function partToReasoningDetail(part: GatewayPart, index: number): Record<string, unknown> | null {
  if (part.type === "thinking") {
    return {
      type: "reasoning.text",
      text: part.thinking,
      ...(part.signature ? { signature: part.signature } : {}),
      ...(part.id !== undefined ? { id: part.id } : {}),
      ...(part.format ? { format: part.format } : {}),
      index,
    };
  }
  if (part.type === "redacted_thinking") {
    return {
      type: "reasoning.encrypted",
      data: part.data,
      ...(part.id !== undefined ? { id: part.id } : {}),
      ...(part.format ? { format: part.format } : {}),
      index,
    };
  }
  return null;
}

function messageToOpenAICompatible(message: GatewayMessage): Record<string, unknown> {
  if (message.role === "assistant") {
    const toolCalls = message.parts
      .filter((part): part is Extract<GatewayPart, { type: "tool_call" }> => part.type === "tool_call")
      .map((part, index) => ({
        id: part.id ?? `tool_call_${index + 1}`,
        type: "function",
        function: {
          name: part.name,
          arguments: typeof part.arguments === "string" ? part.arguments : JSON.stringify(part.arguments),
        },
      }));

    const reasoningDetails = message.parts
      .map((part, index) => partToReasoningDetail(part, index))
      .filter((detail): detail is Record<string, unknown> => !!detail);

    const contentParts = message.parts
      .filter((part) => part.type !== "tool_call" && part.type !== "thinking" && part.type !== "redacted_thinking")
      .map(partToOpenAICompatible);

    const visibleReasoning = message.parts
      .filter((part): part is Extract<GatewayPart, { type: "thinking" }> => part.type === "thinking")
      .map((part) => part.thinking)
      .filter((part) => part.length > 0)
      .join("\n");

    return {
      role: "assistant",
      content: contentParts.length > 0 ? contentParts : "",
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      ...(visibleReasoning
        ? { reasoning: visibleReasoning, reasoning_content: visibleReasoning }
        : typeof message.reasoning === "string" && message.reasoning.length > 0
          ? { reasoning: message.reasoning, reasoning_content: message.reasoning }
          : {}),
      ...(
        reasoningDetails.length > 0
          ? { reasoning_details: reasoningDetails }
          : Array.isArray(message.reasoningDetails) && message.reasoningDetails.length > 0
            ? { reasoning_details: message.reasoningDetails }
            : {}
      ),
    };
  }

  if (message.role === "tool") {
    const toolResult = message.parts.find((part): part is Extract<GatewayPart, { type: "tool_result" }> => part.type === "tool_result");
    return {
      role: "tool",
      tool_call_id: toolResult?.toolCallId ?? message.name ?? "tool_call",
      content: toolResult?.content ?? "",
    };
  }

  return {
    role: message.role,
    content: message.parts.length > 0 ? message.parts.map(partToOpenAICompatible) : "",
    ...(message.name ? { name: message.name } : {}),
  };
}

function toolsToOpenAICompatible(tools: GatewayToolDefinition[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      ...(tool.inputSchema ? { parameters: tool.inputSchema } : {}),
    },
  }));
}

function buildReasoning(ir: GatewayRequestIR): Record<string, unknown> | undefined {
  if (!ir.reasoning) return undefined;

  const reasoning: Record<string, unknown> = {};

  // OpenRouter's reasoning.effort enum: minimal | low | medium | high | xhigh | none
  // Map our internal "max" alias (used by `-max` model suffix) to the right
  // OR effort value based on model capability:
  //   - claude-opus-4-7+ / claude-mythos     → "xhigh" (only these accept it)
  //   - everything else                      → "high"  (the highest effort the older
  //                                                     models accept)
  // Sending the literal "max" through to OR would trigger a 4xx since it's not
  // in the documented enum.
  if (ir.reasoning.effort) {
    const effortLower = ir.reasoning.effort.toLowerCase();
    if (effortLower === "max") {
      reasoning.effort = isClaudeOpus47Plus(ir.model) ? "xhigh" : "high";
    } else {
      reasoning.effort = ir.reasoning.effort;
    }
  }
  if (typeof ir.reasoning.maxTokens === "number") reasoning.max_tokens = ir.reasoning.maxTokens;
  if (typeof ir.reasoning.exclude === "boolean") reasoning.exclude = ir.reasoning.exclude;
  if (typeof ir.reasoning.enabled === "boolean") reasoning.enabled = ir.reasoning.enabled;
  if (typeof ir.reasoning.includeReasoning === "boolean") reasoning.include_reasoning = ir.reasoning.includeReasoning;
  if (typeof ir.reasoning.display === "string") reasoning.display = ir.reasoning.display;
  if (typeof ir.reasoning.interleaved === "boolean") reasoning.interleaved = ir.reasoning.interleaved;

  return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

function buildProvider(ir: GatewayRequestIR): Record<string, unknown> | undefined {
  // Absolute-routing override: when a model prefix declared a provider
  // lock (e.g. `bedrock/...`), force `only` + `allow_fallbacks: false`
  // unconditionally on the outgoing body — even if `ir.provider` was
  // somehow cleared between normalization and serialization.  This is the
  // last line of defence before the payload reaches the sub-node, so it
  // must be self-sufficient.
  const route = ir.modelResolution?.providerRoute;

  if (!ir.provider && !route) return undefined;

  const provider: Record<string, unknown> = {};

  if (ir.provider?.order?.length) provider.order = ir.provider.order;
  if (ir.provider?.only?.length) provider.only = ir.provider.only;
  if (typeof ir.provider?.allowFallbacks === "boolean") provider.allow_fallbacks = ir.provider.allowFallbacks;
  if (ir.provider?.sort) provider.sort = ir.provider.sort;

  if (route) {
    if (route.order?.length) provider.order = [...route.order];
    if (route.only?.length) provider.only = [...route.only];
    provider.allow_fallbacks = false;
  }

  if (Object.keys(provider).length > 0) return provider;
  return ir.provider?.raw;
}

function buildCacheControl(ir: GatewayRequestIR): Record<string, unknown> | undefined {
  if (!ir.cache) return undefined;

  const cacheControl: Record<string, unknown> = {};
  if (ir.cache.mode) cacheControl.type = ir.cache.mode;
  if (ir.cache.ttl) cacheControl.ttl = ir.cache.ttl;

  return Object.keys(cacheControl).length > 0 ? cacheControl : ir.cache.raw;
}

export function buildOpenRouterRequest(ir: GatewayRequestIR): OpenRouterRequestBuildResult {
  const body: Record<string, unknown> = {
    model: ir.model,
    messages: ir.messages.map(messageToOpenAICompatible),
    stream: ir.stream,
  };

  if (ir.tools.length > 0) body.tools = toolsToOpenAICompatible(ir.tools);
  if (ir.responseFormat?.type === "json_object") body.response_format = { type: "json_object" };
  if (ir.responseFormat?.type === "json_schema") {
    body.response_format = {
      type: "json_schema",
      ...(ir.responseFormat.name ? { name: ir.responseFormat.name } : {}),
      ...(ir.responseFormat.jsonSchema ? { json_schema: ir.responseFormat.jsonSchema } : {}),
    };
  }

  const reasoning = buildReasoning(ir);
  if (reasoning) body.reasoning = reasoning;

  if (ir.verbosity?.level) body.verbosity = ir.verbosity.level;

  const provider = buildProvider(ir);
  if (provider) body.provider = provider;

  const cacheControl = buildCacheControl(ir);
  if (cacheControl) body.cache_control = cacheControl;

  if (typeof ir.temperature === "number") body.temperature = ir.temperature;
  if (typeof ir.maxOutputTokens === "number") body.max_tokens = ir.maxOutputTokens;
  if (typeof ir.topP === "number") body.top_p = ir.topP;
  if (ir.stop?.length) body.stop = ir.stop;

  const preservedKeys: string[] = [];
  for (const [key, value] of Object.entries(ir.unknownFields)) {
    if (body[key] !== undefined) continue;
    body[key] = value;
    preservedKeys.push(key);
  }

  // Final pass: strip / coerce sampling params that the Claude family rejects.
  // This MUST run after `unknownFields` are spread (in case top_k / top_p
  // sneaked in via that route) and is the last line of defence before the
  // payload reaches the upstream provider.
  const sanitization = sanitizeClaudeSamplingParams(body);

  return {
    body,
    summary: {
      requestedModel: ir.requestedModel,
      logicalModel: ir.modelResolution?.logical,
      resolvedModel: ir.model,
      model: ir.model,
      stream: ir.stream,
      messageCount: ir.messages.length,
      toolCount: ir.tools.length,
      responseFormatType: ir.responseFormat?.type,
      reasoning: ir.reasoning,
      verbosity: ir.verbosity,
      provider: ir.provider,
      providerRoute: ir.modelResolution?.providerRoute,
      cache: ir.cache,
      preservedKeys,
      claudeSanitization: sanitization.applied
        ? { removed: sanitization.removed, reason: sanitization.reason }
        : undefined,
    },
  };
}

export function buildGatewayBridgeRequest(ir: GatewayRequestIR): GatewayBridgeRequest {
  const upstream = buildOpenRouterRequest(ir);

  return {
    requestedModel: ir.requestedModel,
    logicalModel: ir.modelResolution?.logical,
    resolvedModel: ir.model,
    providerRoute: ir.modelResolution?.providerRoute,
    model: ir.model,
    messages: upstream.body.messages as Record<string, unknown>[],
    stream: ir.stream,
    maxTokens: typeof upstream.body.max_tokens === "number" ? upstream.body.max_tokens as number : undefined,
    tools: Array.isArray(upstream.body.tools) ? upstream.body.tools as Record<string, unknown>[] : undefined,
    toolChoice: upstream.body.tool_choice,
    extraParams: Object.fromEntries(
      Object.entries(upstream.body).filter(([key]) => (
        key !== "model" &&
        key !== "messages" &&
        key !== "stream" &&
        key !== "max_tokens" &&
        key !== "tools" &&
        key !== "tool_choice"
      )),
    ),
    protocol: ir.metadata.protocol,
    originalBody: upstream.body,
    anthropicVersion: ir.metadata.protocol === "anthropic-messages" ? "2023-06-01" : undefined,
    anthropicBeta: ir.metadata.protocol === "anthropic-messages" ? "gateway-openrouter-bridge" : undefined,
    gatewayDebug: {
      protocol: ir.metadata.protocol,
      normalizedProtocol: ir.metadata.protocol,
      target: "openrouter-compatible",
      requestedModel: ir.requestedModel,
      logicalModel: ir.modelResolution?.logical,
      resolvedModel: ir.model,
      providerRoute: ir.modelResolution?.providerRoute?.provider,
    },
  };
}