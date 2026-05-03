import type {
  GatewayCacheConfig,
  GatewayDetectResult,
  GatewayMessage,
  GatewayNormalizeResult,
  GatewayPart,
  GatewayProviderConfig,
  GatewayProtocol,
  GatewayReasoningConfig,
  GatewayRequestIR,
  GatewayResponseFormat,
  GatewayToolDefinition,
  GatewayVerbosityConfig,
} from "./types";
import { detectGatewayProtocol } from "./detect";
import { mergeGatewayProviderConfig, resolveGatewayModelRoute } from "./provider";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function normalizeVerbosity(value: unknown): GatewayVerbosityConfig | undefined {
  if (typeof value === "string" && value.trim()) return { level: value.trim() };
  if (!isRecord(value)) return undefined;

  const level = typeof value.level === "string"
    ? value.level
    : typeof value.value === "string"
      ? value.value
      : undefined;

  return level ? { level } : undefined;
}

function normalizeReasoningRecord(value: unknown): GatewayReasoningConfig | undefined {
  if (typeof value === "boolean") return { enabled: value };
  if (!isRecord(value)) return undefined;

  const reasoning: GatewayReasoningConfig = {};
  if (typeof value.effort === "string") reasoning.effort = value.effort;
  if (typeof value.max_tokens === "number") reasoning.maxTokens = value.max_tokens;
  if (typeof value.maxTokens === "number") reasoning.maxTokens = value.maxTokens;
  if (typeof value.exclude === "boolean") reasoning.exclude = value.exclude;
  if (typeof value.enabled === "boolean") reasoning.enabled = value.enabled;
  if (typeof value.include_reasoning === "boolean") reasoning.includeReasoning = value.include_reasoning;
  if (typeof value.display === "string" && (value.display === "summarized" || value.display === "omitted")) {
    reasoning.display = value.display;
  }

  return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

function normalizeThinkingConfig(value: unknown): GatewayReasoningConfig | undefined {
  if (!isRecord(value)) return undefined;

  const reasoning: GatewayReasoningConfig = {};
  if (value.type === "enabled" || value.enabled === true) reasoning.enabled = true;
  if (value.type === "disabled" || value.enabled === false) reasoning.enabled = false;
  if (value.type === "adaptive") {
    reasoning.enabled = true;
    reasoning.interleaved = true;
  }
  if (typeof value.budget_tokens === "number") reasoning.maxTokens = value.budget_tokens;
  if (typeof value.max_tokens === "number") reasoning.maxTokens = value.max_tokens;
  if (typeof value.display === "string" && (value.display === "summarized" || value.display === "omitted")) {
    reasoning.display = value.display;
  }

  return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

function normalizeGeminiReasoningConfig(value: unknown): GatewayReasoningConfig | undefined {
  if (!isRecord(value)) return undefined;

  const reasoning: GatewayReasoningConfig = {};

  // Official Gemini ThinkingConfig field names
  // Spec: https://ai.google.dev/api/generate-content#ThinkingConfig
  if (typeof value.thinkingBudget === "number") reasoning.maxTokens = value.thinkingBudget;
  if (typeof value.includeThoughts === "boolean") reasoning.includeReasoning = value.includeThoughts;
  if (typeof value.thinkingLevel === "string") {
    if (value.thinkingLevel === "ENABLED") reasoning.enabled = true;
    else if (value.thinkingLevel === "DISABLED") reasoning.enabled = false;
    else if (value.thinkingLevel === "DYNAMIC") { reasoning.enabled = true; reasoning.interleaved = true; }
  }

  // Gateway-extension field names (backward-compat fallbacks when official fields absent)
  if (typeof value.enabled === "boolean" && reasoning.enabled === undefined) reasoning.enabled = value.enabled;
  if (typeof value.maxOutputTokens === "number" && reasoning.maxTokens === undefined) reasoning.maxTokens = value.maxOutputTokens;
  if (typeof value.include_reasoning === "boolean" && reasoning.includeReasoning === undefined) reasoning.includeReasoning = value.include_reasoning;

  return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

function normalizeReasoningShorthand(includeReasoning: unknown, effort: unknown): GatewayReasoningConfig | undefined {
  const reasoning: GatewayReasoningConfig = {};
  if (typeof includeReasoning === "boolean") reasoning.includeReasoning = includeReasoning;
  if (typeof effort === "string" && effort.trim()) reasoning.effort = effort.trim();
  return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

function mergeReasoningConfigs(...configs: Array<GatewayReasoningConfig | undefined>): GatewayReasoningConfig | undefined {
  const reasoning: GatewayReasoningConfig = {};

  for (const config of configs) {
    if (!config) continue;
    if (config.effort !== undefined) reasoning.effort = config.effort;
    if (config.maxTokens !== undefined) reasoning.maxTokens = config.maxTokens;
    if (config.exclude !== undefined) reasoning.exclude = config.exclude;
    if (config.enabled !== undefined) reasoning.enabled = config.enabled;
    if (config.includeReasoning !== undefined) reasoning.includeReasoning = config.includeReasoning;
    if (config.display !== undefined) reasoning.display = config.display;
    if (config.interleaved !== undefined) reasoning.interleaved = config.interleaved;
  }

  return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

function normalizeProvider(value: unknown): GatewayProviderConfig | undefined {
  if (!isRecord(value)) return undefined;

  const provider: GatewayProviderConfig = {
    raw: value,
  };

  if (asStringArray(value.order)?.length) provider.order = asStringArray(value.order);
  if (asStringArray(value.only)?.length) provider.only = asStringArray(value.only);
  if (typeof value.allow_fallbacks === "boolean") provider.allowFallbacks = value.allow_fallbacks;
  if (typeof value.sort === "string") provider.sort = value.sort;

  return provider;
}

function normalizeCacheControl(value: unknown): GatewayCacheConfig | undefined {
  if (!isRecord(value)) return undefined;

  const cache: GatewayCacheConfig = {
    enabled: true,
    raw: value,
  };

  if (typeof value.ttl === "string") cache.ttl = value.ttl;
  if (typeof value.type === "string") cache.mode = value.type;

  return cache;
}

function applyModelResolution(ir: GatewayRequestIR): void {
  const resolution = resolveGatewayModelRoute(ir.requestedModel);
  ir.modelResolution = resolution;
  if (resolution.resolved) ir.model = resolution.resolved;
  if (resolution.reasoning) {
    ir.reasoning = mergeReasoningConfigs(resolution.reasoning, ir.reasoning);
  }
  if (resolution.verbosity && !ir.verbosity?.level) {
    ir.verbosity = resolution.verbosity;
  }
  ir.provider = mergeGatewayProviderConfig(ir.provider, resolution);
  ir.metadata.requestedModel = ir.requestedModel;
  ir.metadata.resolvedModel = ir.model;
  ir.metadata.providerRoute = resolution.providerRoute;

  if (
    resolution.routeApplied ||
    resolution.providerRoute ||
    resolution.aliasCandidates.length > 0 ||
    resolution.reasoning ||
    resolution.verbosity
  ) {
    ir.metadata.rawHints.modelResolution = {
      prefix: resolution.prefix,
      logicalModel: resolution.logical,
      resolvedModel: resolution.resolved,
      aliasCandidates: resolution.aliasCandidates,
      routeApplied: resolution.routeApplied,
      providerRoute: resolution.providerRoute?.provider,
      reasoning: resolution.reasoning,
      verbosity: resolution.verbosity,
    };
  }
}

function cloneUnknownFields(source: Record<string, unknown>, excludedKeys: string[]): Record<string, unknown> {
  // Deep-clone (Node ≥17 structuredClone) so nested objects from `req.body`
  // — `metadata`, `cache_control`, custom vendor fields, etc. — do not leak
  // shared references into the IR. Without this, downstream mutations on
  // `body.<unknownKey>.<nested>` would silently propagate back to the
  // Express-level request body and to any other handler that happens to
  // hold a reference (logging, retry, inflight dedup snapshots).
  // HTTP request bodies are JSON-only (no functions / BigInt / cycles), so
  // structuredClone never throws here in practice; the try/catch is
  // belt-and-braces for malformed runtime values.
  const excluded = new Set(excludedKeys);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (excluded.has(key)) continue;
    if (value === null || typeof value !== "object") {
      output[key] = value;
      continue;
    }
    try {
      output[key] = structuredClone(value);
    } catch {
      // Fall back to shallow copy — preserves the previous behaviour for the
      // (vanishingly rare) un-cloneable value, with a JSON-roundtrip first
      // for plain-object cases.
      try {
        output[key] = JSON.parse(JSON.stringify(value));
      } catch {
        output[key] = value;
      }
    }
  }
  return output;
}

function toTextPart(text: unknown): GatewayPart {
  return { type: "text", text: typeof text === "string" ? text : String(text ?? "") };
}

function normalizeOpenAIToolCalls(toolCalls: unknown): GatewayPart[] {
  if (!Array.isArray(toolCalls)) return [];
  const parts: GatewayPart[] = [];
  for (const toolCall of toolCalls) {
    if (!isRecord(toolCall)) continue;
    const fn = isRecord(toolCall.function) ? toolCall.function : undefined;
    if (typeof fn?.name !== "string") continue;
    parts.push({
      type: "tool_call",
      id: typeof toolCall.id === "string" ? toolCall.id : undefined,
      name: fn.name,
      arguments: typeof fn.arguments === "string" ? fn.arguments : (fn.arguments ?? {}),
    });
  }
  return parts;
}

function normalizeOpenAIReasoningDetails(reasoningDetails: unknown): GatewayPart[] {
  if (!Array.isArray(reasoningDetails)) return [];
  const parts: GatewayPart[] = [];
  for (const detail of reasoningDetails) {
    if (!isRecord(detail) || typeof detail.type !== "string") continue;
    const common = {
      id: typeof detail.id === "string" || detail.id === null ? detail.id : undefined,
      index: typeof detail.index === "number" ? detail.index : undefined,
      format: typeof detail.format === "string" ? detail.format : undefined,
    };
    if (detail.type === "reasoning.summary") {
      parts.push({
        type: "thinking",
        thinking: typeof detail.summary === "string" ? detail.summary : "",
        ...common,
      });
      continue;
    }
    if (detail.type === "reasoning.text") {
      parts.push({
        type: "thinking",
        thinking: typeof detail.text === "string" ? detail.text : "",
        signature: typeof detail.signature === "string" ? detail.signature : undefined,
        ...common,
      });
      continue;
    }
    if (detail.type === "reasoning.encrypted") {
      parts.push({
        type: "redacted_thinking",
        data: typeof detail.data === "string" ? detail.data : "",
        ...common,
      });
    }
  }
  return parts;
}

function normalizeOpenAIContent(content: unknown): GatewayPart[] {
  if (typeof content === "string") return [toTextPart(content)];
  if (!Array.isArray(content)) return [];

  const parts: GatewayPart[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "text" || part.type === "input_text") {
      parts.push({ type: "text", text: typeof part.text === "string" ? part.text : "" });
      continue;
    }
    if (part.type === "image_url" && isRecord(part.image_url) && typeof part.image_url.url === "string") {
      parts.push({
        type: "image_url",
        url: part.image_url.url,
      });
      continue;
    }
    parts.push({ type: "json", value: part });
  }
  return parts;
}

function normalizeAnthropicContent(content: unknown): GatewayPart[] {
  if (typeof content === "string") return [toTextPart(content)];
  if (!Array.isArray(content)) return [];

  const parts: GatewayPart[] = [];
  for (const part of content) {
    if (!isRecord(part) || typeof part.type !== "string") continue;
    if (part.type === "text") {
      parts.push({ type: "text", text: typeof part.text === "string" ? part.text : "" });
      continue;
    }
    if (part.type === "thinking") {
      const thinking = typeof part.thinking === "string" ? part.thinking : "";
      parts.push({
        type: "thinking",
        thinking,
        signature: typeof part.signature === "string" ? part.signature : undefined,
        hidden: thinking.length === 0,
        display: thinking.length === 0 ? "omitted" : "summarized",
        format: "anthropic-claude-v1",
      });
      continue;
    }
    if (part.type === "redacted_thinking") {
      parts.push({
        type: "redacted_thinking",
        data: typeof part.data === "string" ? part.data : "",
        format: "anthropic-claude-v1",
      });
      continue;
    }
    if (part.type === "tool_use") {
      parts.push({
        type: "tool_call",
        id: typeof part.id === "string" ? part.id : undefined,
        name: typeof part.name === "string" ? part.name : "unknown_tool",
        arguments:
          isRecord(part.input) || typeof part.input === "string"
            ? part.input
            : JSON.stringify(part.input ?? {}),
      });
      continue;
    }
    if (part.type === "tool_result") {
      parts.push({
        type: "tool_result",
        toolCallId: typeof part.tool_use_id === "string" ? part.tool_use_id : undefined,
        content: typeof part.content === "string"
          ? part.content
          : Array.isArray(part.content)
            ? JSON.stringify(part.content)
            : JSON.stringify(part.content ?? ""),
        isError: typeof part.is_error === "boolean" ? part.is_error : undefined,
      });
      continue;
    }
    if (part.type === "image" && isRecord(part.source)) {
      const source = part.source;
      if (typeof source.url === "string") {
        parts.push({ type: "image_url", url: source.url });
        continue;
      }
      if (typeof source.data === "string") {
        const mediaType = typeof source.media_type === "string" ? source.media_type : "application/octet-stream";
        parts.push({
          type: "image_url",
          url: `data:${mediaType};base64,${source.data}`,
          mediaType,
        });
        continue;
      }
    }
    parts.push({ type: "json", value: part });
  }
  return parts;
}

function normalizeGeminiParts(partsInput: unknown): GatewayPart[] {
  if (!Array.isArray(partsInput)) return [];
  const parts: GatewayPart[] = [];

  for (const part of partsInput) {
    if (!isRecord(part)) continue;
    if (typeof part.text === "string") {
      parts.push({ type: "text", text: part.text });
      continue;
    }
    if (isRecord(part.inlineData) && typeof part.inlineData.data === "string") {
      const mediaType = typeof part.inlineData.mimeType === "string" ? part.inlineData.mimeType : "application/octet-stream";
      parts.push({
        type: "input_image",
        url: `data:${mediaType};base64,${part.inlineData.data}`,
        mediaType,
      });
      continue;
    }
    if (isRecord(part.fileData) && typeof part.fileData.fileUri === "string") {
      parts.push({
        type: "input_image",
        url: part.fileData.fileUri,
        mediaType: typeof part.fileData.mimeType === "string" ? part.fileData.mimeType : undefined,
      });
      continue;
    }
    if (isRecord(part.functionCall)) {
      parts.push({
        type: "tool_call",
        name: typeof part.functionCall.name === "string" ? part.functionCall.name : "unknown_tool",
        arguments: isRecord(part.functionCall.args) ? part.functionCall.args : {},
      });
      continue;
    }
    if (isRecord(part.functionResponse)) {
      parts.push({
        type: "tool_result",
        name: typeof part.functionResponse.name === "string" ? part.functionResponse.name : undefined,
        content: JSON.stringify(part.functionResponse.response ?? {}),
      });
      continue;
    }
    parts.push({ type: "json", value: part });
  }

  return parts;
}

function normalizeResponseFormat(value: unknown): GatewayResponseFormat | undefined {
  if (!isRecord(value)) return undefined;

  const formatType = typeof value.type === "string" ? value.type : undefined;
  if (formatType === "json_schema") {
    return {
      type: "json_schema",
      name: typeof value.name === "string" ? value.name : undefined,
      jsonSchema: isRecord(value.json_schema)
        ? value.json_schema
        : isRecord(value.schema)
          ? value.schema
          : undefined,
    };
  }

  if (formatType === "json_object") {
    return { type: "json_object" };
  }

  return undefined;
}

function normalizeOpenAITools(value: unknown): GatewayToolDefinition[] {
  if (!Array.isArray(value)) return [];
  const tools: GatewayToolDefinition[] = [];

  for (const tool of value) {
    if (!isRecord(tool) || !isRecord(tool.function) || typeof tool.function.name !== "string") continue;
    tools.push({
      name: tool.function.name,
      description: typeof tool.function.description === "string" ? tool.function.description : undefined,
      inputSchema: isRecord(tool.function.parameters) ? tool.function.parameters : undefined,
    });
  }

  return tools;
}

function normalizeAnthropicTools(value: unknown): GatewayToolDefinition[] {
  if (!Array.isArray(value)) return [];
  const tools: GatewayToolDefinition[] = [];

  for (const tool of value) {
    if (!isRecord(tool) || typeof tool.name !== "string") continue;
    tools.push({
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description : undefined,
      inputSchema: isRecord(tool.input_schema) ? tool.input_schema : undefined,
    });
  }

  return tools;
}

function normalizeGeminiTools(value: unknown): GatewayToolDefinition[] {
  if (!Array.isArray(value)) return [];
  const tools: GatewayToolDefinition[] = [];

  for (const tool of value) {
    if (!isRecord(tool) || !Array.isArray(tool.functionDeclarations)) continue;
    for (const declaration of tool.functionDeclarations) {
      if (!isRecord(declaration) || typeof declaration.name !== "string") continue;
      tools.push({
        name: declaration.name,
        description: typeof declaration.description === "string" ? declaration.description : undefined,
        inputSchema: isRecord(declaration.parameters) ? declaration.parameters : undefined,
      });
    }
  }

  return tools;
}

function createBaseIR(protocol: GatewayProtocol, body: Record<string, unknown>): GatewayRequestIR {
  const requestedModel = typeof body.model === "string"
    ? body.model
    : typeof body.model_id === "string"
      ? body.model_id
      : "unknown";

  return {
    requestedModel,
    model: requestedModel,
    messages: [],
    tools: [],
    stream: body.stream === true,
    metadata: {
      protocol,
      requestedModel,
      resolvedModel: requestedModel,
      rawHints: {},
    },
    unknownFields: {},
  };
}

function normalizeOpenAI(body: Record<string, unknown>): GatewayNormalizeResult {
  const ir = createBaseIR("openai-chat", body);

  ir.requestedModel = typeof body.model === "string" ? body.model : "unknown";
  ir.model = ir.requestedModel;
  ir.stream = body.stream === true;
  ir.tools = normalizeOpenAITools(body.tools);
  ir.responseFormat = normalizeResponseFormat(body.response_format);
  ir.reasoning = mergeReasoningConfigs(
    normalizeReasoningRecord(body.reasoning),
    normalizeReasoningShorthand(body.include_reasoning, body.reasoning_effort),
  );
  ir.verbosity = normalizeVerbosity(body.verbosity);
  ir.provider = normalizeProvider(body.provider);
  ir.cache = normalizeCacheControl(body.cache_control);
  ir.temperature = typeof body.temperature === "number" ? body.temperature : undefined;
  ir.maxOutputTokens = firstNumber(body.max_output_tokens, body.max_completion_tokens, body.max_tokens);
  ir.topP = typeof body.top_p === "number" ? body.top_p : undefined;
  ir.stop = asStringArray(body.stop);
  ir.metadata.rawHints = {
    hasToolChoice: body.tool_choice !== undefined,
    hasResponseFormat: body.response_format !== undefined,
    tokenParam: typeof body.max_output_tokens === "number"
      ? "max_output_tokens"
      : typeof body.max_completion_tokens === "number"
        ? "max_completion_tokens"
        : typeof body.max_tokens === "number"
          ? "max_tokens"
          : undefined,
  };

  if (Array.isArray(body.messages)) {
    const normalizedMessages: GatewayMessage[] = [];
    for (const message of body.messages) {
      if (!isRecord(message) || typeof message.role !== "string") continue;
      const reasoningParts = normalizeOpenAIReasoningDetails(message.reasoning_details);
      const contentParts = normalizeOpenAIContent(message.content);
      const toolParts = normalizeOpenAIToolCalls(message.tool_calls);
      normalizedMessages.push({
        role: message.role as GatewayMessage["role"],
        name: typeof message.name === "string" ? message.name : undefined,
        parts: [...reasoningParts, ...contentParts, ...toolParts],
        reasoning: typeof message.reasoning === "string"
          ? message.reasoning
          : typeof message.reasoning_content === "string"
            ? message.reasoning_content
            : undefined,
        reasoningDetails: Array.isArray(message.reasoning_details)
          ? message.reasoning_details
          : undefined,
      });
    }
    ir.messages = normalizedMessages;
  }

  ir.unknownFields = cloneUnknownFields(body, [
    "model",
    "messages",
    "stream",
    "tools",
    "tool_choice",
    "response_format",
    "reasoning",
    "verbosity",
    "provider",
    "cache_control",
    "temperature",
    "max_tokens",
    "max_completion_tokens",
    "max_output_tokens",
    "top_p",
    "stop",
    "include_reasoning",
    "reasoning_effort",
  ]);

  applyModelResolution(ir);
  return { protocol: "openai-chat", ir };
}

function normalizeAnthropic(body: Record<string, unknown>): GatewayNormalizeResult {
  const ir = createBaseIR("anthropic-messages", body);

  ir.requestedModel = typeof body.model === "string" ? body.model : "unknown";
  ir.model = ir.requestedModel;
  ir.stream = body.stream === true;
  ir.tools = normalizeAnthropicTools(body.tools);
  ir.reasoning = mergeReasoningConfigs(
    normalizeThinkingConfig(body.thinking),
    normalizeReasoningRecord(body.reasoning),
    normalizeReasoningShorthand(body.include_reasoning, body.reasoning_effort),
  );
  ir.verbosity = normalizeVerbosity(body.verbosity);
  ir.provider = normalizeProvider(body.provider);
  ir.cache = normalizeCacheControl(body.cache_control);
  // Spec: https://docs.anthropic.com/en/api/messages#stop_sequences
  // Anthropic uses `stop_sequences` (not `stop`); map to ir.stop for OpenRouter forwarding.
  ir.stop = asStringArray(body.stop_sequences) ?? asStringArray(body.stop);
  ir.maxOutputTokens = firstNumber(body.max_output_tokens, body.max_completion_tokens, body.max_tokens);
  ir.metadata.rawHints = {
    anthropicVersion: typeof body.anthropic_version === "string" ? body.anthropic_version : undefined,
    anthropicBeta: body.anthropic_beta,
    tokenParam: typeof body.max_output_tokens === "number"
      ? "max_output_tokens"
      : typeof body.max_completion_tokens === "number"
        ? "max_completion_tokens"
        : typeof body.max_tokens === "number"
          ? "max_tokens"
          : undefined,
  };

  const normalizedMessages: GatewayMessage[] = [];
  if (body.system !== undefined) {
    normalizedMessages.push({
      role: "system",
      parts: normalizeAnthropicContent(body.system),
    });
  }
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!isRecord(message) || typeof message.role !== "string") continue;
      normalizedMessages.push({
        role: message.role as GatewayMessage["role"],
        parts: normalizeAnthropicContent(message.content),
      });
    }
  }
  ir.messages = normalizedMessages;

  ir.unknownFields = cloneUnknownFields(body, [
    "model",
    "messages",
    "system",
    "stream",
    "tools",
    "thinking",
    "reasoning",
    "verbosity",
    "provider",
    "cache_control",
    "stop_sequences",
    "stop",
    "max_tokens",
    "max_completion_tokens",
    "max_output_tokens",
    "anthropic_version",
    "anthropic_beta",
    "include_reasoning",
    "reasoning_effort",
  ]);

  applyModelResolution(ir);
  return { protocol: "anthropic-messages", ir };
}

function normalizeGemini(body: Record<string, unknown>): GatewayNormalizeResult {
  const ir = createBaseIR("gemini-generate-content", body);

  ir.requestedModel = typeof body.model === "string"
    ? body.model
    : typeof body.model_id === "string"
      ? body.model_id
      : "gemini";
  ir.model = ir.requestedModel;
  ir.stream = body.stream === true || body.streamGenerateContent === true;
  ir.tools = normalizeGeminiTools(body.tools);

  const generationConfig = isRecord(body.generationConfig) ? body.generationConfig : undefined;
  ir.responseFormat = generationConfig && typeof generationConfig.responseMimeType === "string"
    ? generationConfig.responseMimeType.includes("json")
      ? {
          type: generationConfig.responseSchema ? "json_schema" : "json_object",
          jsonSchema: isRecord(generationConfig.responseSchema) ? generationConfig.responseSchema : undefined,
        }
      : { type: "text" }
    : undefined;
  ir.temperature = firstNumber(body.temperature, generationConfig?.temperature);
  ir.topP = firstNumber(body.top_p, generationConfig?.topP);
  ir.maxOutputTokens = firstNumber(
    body.max_output_tokens,
    body.max_completion_tokens,
    generationConfig?.maxOutputTokens,
    body.max_tokens,
  );
  ir.stop = asStringArray(body.stop) ?? (generationConfig ? asStringArray(generationConfig.stopSequences) : undefined);
  ir.reasoning = mergeReasoningConfigs(
    // Official Gemini ThinkingConfig path: generationConfig.thinkingConfig
    // Spec: https://ai.google.dev/api/generate-content#ThinkingConfig
    normalizeGeminiReasoningConfig(generationConfig?.thinkingConfig),
    // Backward-compat: gateway-specific top-level reasoningConfig field
    normalizeGeminiReasoningConfig(body.reasoningConfig),
    normalizeReasoningRecord(body.reasoning),
    normalizeReasoningShorthand(body.include_reasoning, body.reasoning_effort),
  );
  ir.verbosity = normalizeVerbosity(body.verbosity);
  ir.provider = normalizeProvider(body.provider);
  ir.cache = normalizeCacheControl(body.cache_control);
  ir.metadata.rawHints = {
    hasGenerationConfig: !!generationConfig,
    hasSafetySettings: Array.isArray(body.safetySettings),
    tokenParam: typeof body.max_output_tokens === "number"
      ? "max_output_tokens"
      : typeof body.max_completion_tokens === "number"
        ? "max_completion_tokens"
        : generationConfig && typeof generationConfig.maxOutputTokens === "number"
          ? "generationConfig.maxOutputTokens"
          : typeof body.max_tokens === "number"
            ? "max_tokens"
            : undefined,
  };

  if (Array.isArray(body.contents)) {
    const normalizedMessages: GatewayMessage[] = [];
    for (const message of body.contents) {
      if (!isRecord(message)) continue;
      const role = message.role === "model" ? "assistant" : message.role === "user" ? "user" : "user";
      normalizedMessages.push({
        role,
        parts: normalizeGeminiParts(message.parts),
      });
    }
    ir.messages = normalizedMessages;
  }

  ir.unknownFields = cloneUnknownFields(body, [
    "model",
    "model_id",
    "contents",
    "tools",
    "generationConfig",
    "reasoningConfig",
    "reasoning",
    "verbosity",
    "provider",
    "cache_control",
    "stream",
    "streamGenerateContent",
    "safetySettings",
    "temperature",
    "top_p",
    "topP",
    "max_tokens",
    "max_completion_tokens",
    "max_output_tokens",
    "stop",
    "include_reasoning",
    "reasoning_effort",
  ]);

  applyModelResolution(ir);
  return { protocol: "gemini-generate-content", ir };
}

function normalizeUnknown(body: Record<string, unknown>, detection: GatewayDetectResult): GatewayNormalizeResult {
  const ir = createBaseIR("unknown", body);
  ir.requestedModel = typeof body.model === "string"
    ? body.model
    : typeof body.model_id === "string"
      ? body.model_id
      : "unknown";
  ir.model = ir.requestedModel;
  ir.metadata.requestedModel = ir.requestedModel;
  ir.metadata.resolvedModel = ir.model;
  ir.metadata.rawHints = {
    detectionReasons: detection.reasons,
    confidence: detection.confidence,
  };
  ir.unknownFields = { ...body };
  return { protocol: "unknown", ir };
}

export function normalizeGatewayRequest(body: unknown, detection?: GatewayDetectResult): GatewayNormalizeResult {
  const detectResult = detection ?? detectGatewayProtocol(body);

  if (!isRecord(body)) {
    return normalizeUnknown({}, detectResult);
  }

  if (detectResult.protocol === "openai-chat") return normalizeOpenAI(body);
  if (detectResult.protocol === "anthropic-messages") return normalizeAnthropic(body);
  if (detectResult.protocol === "gemini-generate-content") return normalizeGemini(body);
  return normalizeUnknown(body, detectResult);
}