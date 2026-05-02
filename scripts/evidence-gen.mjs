// src/lib/gateway/detect.ts
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function hasArray(value, key) {
  return Array.isArray(value[key]);
}
function hasString(value, key) {
  return typeof value[key] === "string" && value[key].length > 0;
}
function detectGatewayProtocol(body) {
  if (!isRecord(body)) {
    return {
      protocol: "unknown",
      confidence: 0,
      reasons: ["body is not an object"]
    };
  }
  const reasons = [];
  if (hasArray(body, "contents")) {
    reasons.push("contains contents array");
    if (hasArray(body, "tools")) reasons.push("contains gemini-style tools");
    if (isRecord(body.generationConfig)) reasons.push("contains generationConfig");
    return {
      protocol: "gemini-generate-content",
      confidence: 0.98,
      reasons
    };
  }
  if (hasArray(body, "messages")) {
    if (hasString(body, "anthropic_version")) {
      reasons.push("contains messages array");
      reasons.push("contains anthropic_version");
      return {
        protocol: "anthropic-messages",
        confidence: 0.99,
        reasons
      };
    }
    const messages = body.messages;
    const hasAnthropicContentBlocks = messages.some((message) => {
      if (!isRecord(message) || !Array.isArray(message.content)) return false;
      return message.content.some((part) => isRecord(part) && typeof part.type === "string");
    });
    if (hasAnthropicContentBlocks && (body.system !== void 0 || hasArray(body, "tools"))) {
      reasons.push("contains messages array");
      reasons.push("contains anthropic-style content blocks");
      return {
        protocol: "anthropic-messages",
        confidence: 0.82,
        reasons
      };
    }
    reasons.push("contains messages array");
    if (hasString(body, "model")) reasons.push("contains model");
    if (body.response_format !== void 0) reasons.push("contains response_format");
    return {
      protocol: "openai-chat",
      confidence: 0.92,
      reasons
    };
  }
  return {
    protocol: "unknown",
    confidence: 0.1,
    reasons: ["no known protocol markers detected"]
  };
}

// src/lib/gateway/provider.ts
var PROVIDER_PREFIX_SPECS = [
  // ── Cloud Anthropic backends ────────────────────────────────────────────
  {
    aliases: ["bedrock", "amazon-bedrock"],
    provider: "amazon-bedrock",
    order: ["amazon-bedrock"],
    only: ["amazon-bedrock"],
    allowFallbacks: false
  },
  {
    aliases: ["vertex", "google-vertex", "anthropic-vertex"],
    provider: "google-vertex",
    order: ["google-vertex"],
    only: ["google-vertex"],
    allowFallbacks: false
  },
  {
    aliases: ["anthropic", "anthropic-direct"],
    provider: "anthropic",
    order: ["anthropic"],
    only: ["anthropic"],
    allowFallbacks: false
  },
  // ── Google ──────────────────────────────────────────────────────────────
  // `aistudio/` → AI Studio Gemini API
  // `google/`   → Vertex AI Gemini (preserve historical behaviour)
  {
    aliases: ["aistudio", "ai-studio", "google-ai-studio"],
    provider: "google-ai-studio",
    order: ["google-ai-studio"],
    only: ["google-ai-studio"],
    allowFallbacks: false
  },
  {
    aliases: ["google"],
    provider: "google-vertex",
    order: ["google-vertex"],
    only: ["google-vertex"],
    allowFallbacks: false
  },
  // ── First-party ─────────────────────────────────────────────────────────
  {
    aliases: ["openai", "openai-direct"],
    provider: "openai",
    order: ["openai"],
    only: ["openai"],
    allowFallbacks: false
  },
  {
    aliases: ["x-ai", "xai"],
    provider: "x-ai",
    order: ["x-ai"],
    only: ["x-ai"],
    allowFallbacks: false
  },
  {
    aliases: ["deepseek", "deepseek-direct"],
    provider: "deepseek",
    order: ["deepseek"],
    only: ["deepseek"],
    allowFallbacks: false
  },
  {
    aliases: ["mistral", "mistralai"],
    provider: "mistral",
    order: ["mistral"],
    only: ["mistral"],
    allowFallbacks: false
  },
  {
    aliases: ["cohere"],
    provider: "cohere",
    order: ["cohere"],
    only: ["cohere"],
    allowFallbacks: false
  },
  {
    aliases: ["perplexity"],
    provider: "perplexity",
    order: ["perplexity"],
    only: ["perplexity"],
    allowFallbacks: false
  },
  {
    aliases: ["moonshotai", "moonshot"],
    provider: "moonshotai",
    order: ["moonshotai"],
    only: ["moonshotai"],
    allowFallbacks: false
  },
  {
    aliases: ["z-ai", "zai"],
    provider: "z-ai",
    order: ["z-ai"],
    only: ["z-ai"],
    allowFallbacks: false
  },
  // ── Fast-inference partner clouds ───────────────────────────────────────
  {
    aliases: ["groq"],
    provider: "groq",
    order: ["groq"],
    only: ["groq"],
    allowFallbacks: false
  },
  {
    aliases: ["cerebras"],
    provider: "cerebras",
    order: ["cerebras"],
    only: ["cerebras"],
    allowFallbacks: false
  },
  {
    aliases: ["sambanova"],
    provider: "sambanova",
    order: ["sambanova"],
    only: ["sambanova"],
    allowFallbacks: false
  },
  {
    aliases: ["fireworks", "fireworks-ai"],
    provider: "fireworks",
    order: ["fireworks"],
    only: ["fireworks"],
    allowFallbacks: false
  },
  {
    aliases: ["together", "togetherai"],
    provider: "together",
    order: ["together"],
    only: ["together"],
    allowFallbacks: false
  },
  {
    aliases: ["deepinfra"],
    provider: "deepinfra",
    order: ["deepinfra"],
    only: ["deepinfra"],
    allowFallbacks: false
  },
  {
    aliases: ["novita", "novitaai"],
    provider: "novita",
    order: ["novita"],
    only: ["novita"],
    allowFallbacks: false
  },
  {
    aliases: ["hyperbolic"],
    provider: "hyperbolic",
    order: ["hyperbolic"],
    only: ["hyperbolic"],
    allowFallbacks: false
  },
  {
    aliases: ["lambda"],
    provider: "lambda",
    order: ["lambda"],
    only: ["lambda"],
    allowFallbacks: false
  },
  {
    aliases: ["cloudflare"],
    provider: "cloudflare",
    order: ["cloudflare"],
    only: ["cloudflare"],
    allowFallbacks: false
  },
  {
    aliases: ["friendli"],
    provider: "friendli",
    order: ["friendli"],
    only: ["friendli"],
    allowFallbacks: false
  },
  {
    aliases: ["featherless"],
    provider: "featherless",
    order: ["featherless"],
    only: ["featherless"],
    allowFallbacks: false
  },
  {
    aliases: ["mancer"],
    provider: "mancer",
    order: ["mancer"],
    only: ["mancer"],
    allowFallbacks: false
  },
  {
    aliases: ["parasail"],
    provider: "parasail",
    order: ["parasail"],
    only: ["parasail"],
    allowFallbacks: false
  },
  {
    aliases: ["baseten"],
    provider: "baseten",
    order: ["baseten"],
    only: ["baseten"],
    allowFallbacks: false
  },
  {
    aliases: ["replicate"],
    provider: "replicate",
    order: ["replicate"],
    only: ["replicate"],
    allowFallbacks: false
  },
  {
    aliases: ["nebius"],
    provider: "nebius",
    order: ["nebius"],
    only: ["nebius"],
    allowFallbacks: false
  },
  {
    aliases: ["chutes"],
    provider: "chutes",
    order: ["chutes"],
    only: ["chutes"],
    allowFallbacks: false
  },
  {
    aliases: ["azure", "azure-openai"],
    provider: "azure",
    order: ["azure"],
    only: ["azure"],
    allowFallbacks: false
  },
  // ── Additional locks (parallel HEAD branch) ─────────────────────────────
  // These slugs were added on the parallel feature branch (fdc0209) and
  // are merged in here so absolute routing covers them too.
  {
    aliases: ["nvidia"],
    provider: "nvidia",
    order: ["nvidia"],
    only: ["nvidia"],
    allowFallbacks: false
  },
  {
    aliases: ["minimax"],
    provider: "minimax",
    order: ["minimax"],
    only: ["minimax"],
    allowFallbacks: false
  },
  {
    aliases: ["alibaba", "alibaba-cloud"],
    provider: "alibaba",
    order: ["alibaba"],
    only: ["alibaba"],
    allowFallbacks: false
  },
  {
    aliases: ["baidu", "baidu-qianfan"],
    provider: "baidu",
    order: ["baidu"],
    only: ["baidu"],
    allowFallbacks: false
  },
  // ── Vendor-only namespaces (no provider lock) ───────────────────────────
  // Stripped during canonicalisation but no `provider.only` is injected,
  // since these vendors are hosted by multiple OpenRouter sub-channels.
  { aliases: ["meta-llama", "meta", "llama"] },
  { aliases: ["qwen"] },
  { aliases: ["amazon"] },
  // ── Pass-through ────────────────────────────────────────────────────────
  // No provider field → no lock.  The model id (with the prefix stripped)
  // is forwarded to OpenRouter and OpenRouter is free to pick.
  {
    aliases: ["openrouter", "auto"]
  }
];
var KNOWN_VENDOR_PREFIXES = new Set(
  PROVIDER_PREFIX_SPECS.flatMap((spec) => spec.aliases)
);
function normalizePath(raw) {
  return raw.trim().replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}
function canonicalizeLogicalModel(model) {
  const normalized = normalizePath(model).toLowerCase();
  if (!normalized) return normalized;
  if (!normalized.startsWith("claude-")) return normalized;
  let stripped = normalized.replace(/@\d{6,8}.*$/i, "").replace(/-\d{8}(?:-v\d+(?::\d+)?)?$/i, "").replace(/-v\d+(?::\d+)?$/i, "");
  stripped = stripped.replace(
    /^(claude-(?:opus|sonnet|haiku)-)(\d+)[._-](\d+)(.*)$/i,
    (_m, prefix, major, minor, suffix) => `${prefix}${major}.${minor}${suffix}`
  );
  stripped = stripped.replace(
    /^(claude-)(\d+)[._-](\d+)(-(?:opus|sonnet|haiku).*)$/i,
    (_m, prefix, major, minor, suffix) => `${prefix}${major}.${minor}${suffix}`
  );
  return stripped;
}
function canonicalizeModelIdentifier(model) {
  const normalized = normalizePath(model);
  if (!normalized) return normalized;
  const segments = normalized.split("/");
  if (segments.length <= 1) {
    return canonicalizeLogicalModel(normalized);
  }
  const vendor = segments[0].toLowerCase();
  const remainder = canonicalizeLogicalModel(segments.slice(1).join("/"));
  return `${vendor}/${remainder}`;
}
function stripVendorPrefix(model) {
  const normalized = canonicalizeModelIdentifier(model);
  const segments = normalized.split("/");
  if (segments.length > 1 && KNOWN_VENDOR_PREFIXES.has(segments[0].toLowerCase())) {
    return canonicalizeLogicalModel(segments.slice(1).join("/"));
  }
  return normalized;
}
function inferVendorModelPath(logicalModel) {
  const normalized = canonicalizeLogicalModel(logicalModel);
  if (!normalized) return normalized;
  if (normalized.includes("/")) return canonicalizeModelIdentifier(normalized);
  if (normalized.startsWith("claude-")) return `anthropic/${normalized}`;
  if (normalized.startsWith("gemini-")) return `google/${normalized}`;
  if (normalized.startsWith("gpt-") || /^o\d/.test(normalized) || normalized.startsWith("text-embedding-") || normalized.startsWith("whisper-") || normalized.startsWith("dall-e-")) {
    return `openai/${normalized}`;
  }
  if (normalized.startsWith("grok-")) return `x-ai/${normalized}`;
  if (normalized.startsWith("llama-")) return `meta-llama/${normalized}`;
  if (normalized.startsWith("deepseek-")) return `deepseek/${normalized}`;
  if (normalized.startsWith("qwen")) return `qwen/${normalized}`;
  if (normalized.startsWith("nova-")) return `amazon/${normalized}`;
  if (normalized.startsWith("mistral-")) return `mistralai/${normalized}`;
  return normalized;
}
function findProviderPrefixSpec(prefix) {
  const normalizedPrefix = prefix.trim().toLowerCase();
  return PROVIDER_PREFIX_SPECS.find((spec) => spec.aliases.includes(normalizedPrefix));
}
function buildProviderRoute(prefix) {
  const spec = findProviderPrefixSpec(prefix);
  if (!spec?.provider) return void 0;
  return {
    prefix: prefix.toLowerCase(),
    provider: spec.provider,
    order: spec.order ? [...spec.order] : void 0,
    only: spec.only ? [...spec.only] : void 0,
    // Absolute routing — `allow_fallbacks: false` is non-negotiable here
    // even if the spec entry forgets to set it.  See ROUTING_AUDIT.md §1.
    allowFallbacks: false,
    source: "model-prefix"
  };
}
function buildAliasCandidates(values) {
  return Array.from(
    new Set(
      values.map((value) => typeof value === "string" ? value.trim() : "").filter((value) => value.length > 0)
    )
  );
}
function applyReasoningAliasToken(token, reasoning, verbosity) {
  const normalized = token.toLowerCase();
  if (normalized === "thinking") {
    reasoning.enabled = true;
    return true;
  }
  if (normalized === "thinking-visible") {
    reasoning.enabled = true;
    reasoning.includeReasoning = true;
    return true;
  }
  if (["xhigh", "max", "high", "medium", "low"].includes(normalized)) {
    reasoning.enabled = true;
    reasoning.effort = normalized;
    verbosity.level = normalized;
    return true;
  }
  if (normalized === "minimal") {
    reasoning.enabled = true;
    reasoning.effort = normalized;
    return true;
  }
  if (normalized === "none") {
    reasoning.enabled = false;
    reasoning.effort = normalized;
    reasoning.exclude = true;
    return true;
  }
  return false;
}
function extractModelAliases(model) {
  let logicalModel = canonicalizeLogicalModel(model);
  const reasoning = {};
  const verbosity = {};
  while (true) {
    if (logicalModel.endsWith("-thinking-visible")) {
      logicalModel = logicalModel.slice(0, -"-thinking-visible".length);
      reasoning.enabled = true;
      reasoning.includeReasoning = true;
      continue;
    }
    if (logicalModel.endsWith("-thinking")) {
      logicalModel = logicalModel.slice(0, -"-thinking".length);
      reasoning.enabled = true;
      continue;
    }
    const effortMatch = /^(.*)-(xhigh|max|high|medium|low|minimal|none)$/i.exec(logicalModel);
    if (effortMatch) {
      logicalModel = effortMatch[1] ?? logicalModel;
      applyReasoningAliasToken(effortMatch[2] ?? "", reasoning, verbosity);
      continue;
    }
    break;
  }
  return {
    logicalModel,
    reasoning: Object.keys(reasoning).length > 0 ? reasoning : void 0,
    verbosity: Object.keys(verbosity).length > 0 ? verbosity : void 0
  };
}
function resolveGatewayModelRoute(model) {
  const original = normalizePath(model);
  if (!original) {
    return {
      raw: model,
      original: "",
      logical: "",
      resolved: "",
      aliasCandidates: [],
      routeApplied: false
    };
  }
  let segments = original.split("/");
  let prefixSpec = segments.length > 1 ? findProviderPrefixSpec(segments[0] ?? "") : void 0;
  let prefix = prefixSpec ? segments[0].toLowerCase() : void 0;
  let payload = prefix ? segments.slice(1).join("/") : original;
  if (prefix === "openrouter") {
    const innerSegments = payload.split("/");
    const innerSpec = innerSegments.length > 1 ? findProviderPrefixSpec(innerSegments[0] ?? "") : void 0;
    if (innerSpec) {
      prefixSpec = innerSpec;
      prefix = innerSegments[0].toLowerCase();
      payload = innerSegments.slice(1).join("/");
    }
  }
  const canonicalPayload = canonicalizeModelIdentifier(payload);
  const rawLogical = stripVendorPrefix(canonicalPayload);
  const aliased = extractModelAliases(rawLogical);
  const logical = aliased.logicalModel;
  const resolved = prefix ? inferVendorModelPath(logical) : canonicalPayload.includes("/") ? canonicalPayload : inferVendorModelPath(logical);
  const aliasCandidates = buildAliasCandidates([
    original,
    payload,
    canonicalPayload,
    rawLogical,
    logical,
    resolved,
    prefix ? `${prefix}/${rawLogical}` : void 0,
    prefix ? `${prefix}/${logical}` : void 0,
    prefix && resolved !== logical ? `${prefix}/${resolved}` : void 0
  ]);
  return {
    raw: model,
    original,
    logical,
    resolved,
    aliasCandidates,
    routeApplied: !!prefix || resolved !== original || rawLogical !== logical,
    prefix,
    providerRoute: prefix ? buildProviderRoute(prefix) : void 0,
    reasoning: aliased.reasoning,
    verbosity: aliased.verbosity
  };
}
function mergeGatewayProviderConfig(requestProvider, modelResolution) {
  const route = modelResolution?.providerRoute;
  if (!requestProvider && !route) return void 0;
  const merged = {
    ...requestProvider ?? {}
  };
  if (route) {
    if (route.order?.length) merged.order = [...route.order];
    if (route.only?.length) merged.only = [...route.only];
    merged.allowFallbacks = false;
    merged.routeLabel = route.provider;
  } else {
    if (!merged.order?.length && requestProvider?.order?.length) {
      merged.order = [...requestProvider.order];
    }
    if (!merged.only?.length && requestProvider?.only?.length) {
      merged.only = [...requestProvider.only];
    }
    if (typeof merged.allowFallbacks !== "boolean" && typeof requestProvider?.allowFallbacks === "boolean") {
      merged.allowFallbacks = requestProvider.allowFallbacks;
    }
  }
  merged.source = requestProvider ? route ? "request+model-prefix" : "request" : route ? "model-prefix" : void 0;
  if (requestProvider?.raw || route) {
    merged.raw = {
      ...requestProvider?.raw ?? {},
      ...route ? {
        // Surface the lock in the raw block so downstream observability
        // can see the absolute routing contract was applied.
        provider_route: route.provider,
        provider_prefix: route.prefix,
        allow_fallbacks: false,
        only: route.only ? [...route.only] : void 0
      } : {}
    };
  }
  return merged;
}

// src/lib/gateway/normalize.ts
function isRecord2(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function asStringArray(value) {
  if (!Array.isArray(value)) return void 0;
  const items = value.filter((item) => typeof item === "string");
  return items.length > 0 ? items : void 0;
}
function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return void 0;
}
function normalizeVerbosity(value) {
  if (typeof value === "string" && value.trim()) return { level: value.trim() };
  if (!isRecord2(value)) return void 0;
  const level = typeof value.level === "string" ? value.level : typeof value.value === "string" ? value.value : void 0;
  return level ? { level } : void 0;
}
function normalizeReasoningRecord(value) {
  if (typeof value === "boolean") return { enabled: value };
  if (!isRecord2(value)) return void 0;
  const reasoning = {};
  if (typeof value.effort === "string") reasoning.effort = value.effort;
  if (typeof value.max_tokens === "number") reasoning.maxTokens = value.max_tokens;
  if (typeof value.maxTokens === "number") reasoning.maxTokens = value.maxTokens;
  if (typeof value.exclude === "boolean") reasoning.exclude = value.exclude;
  if (typeof value.enabled === "boolean") reasoning.enabled = value.enabled;
  if (typeof value.include_reasoning === "boolean") reasoning.includeReasoning = value.include_reasoning;
  if (typeof value.display === "string" && (value.display === "summarized" || value.display === "omitted")) {
    reasoning.display = value.display;
  }
  return Object.keys(reasoning).length > 0 ? reasoning : void 0;
}
function normalizeThinkingConfig(value) {
  if (!isRecord2(value)) return void 0;
  const reasoning = {};
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
  return Object.keys(reasoning).length > 0 ? reasoning : void 0;
}
function normalizeGeminiReasoningConfig(value) {
  if (!isRecord2(value)) return void 0;
  const reasoning = {};
  if (typeof value.thinkingBudget === "number") reasoning.maxTokens = value.thinkingBudget;
  if (typeof value.includeThoughts === "boolean") reasoning.includeReasoning = value.includeThoughts;
  if (typeof value.thinkingLevel === "string") {
    if (value.thinkingLevel === "ENABLED") reasoning.enabled = true;
    else if (value.thinkingLevel === "DISABLED") reasoning.enabled = false;
    else if (value.thinkingLevel === "DYNAMIC") {
      reasoning.enabled = true;
      reasoning.interleaved = true;
    }
  }
  if (typeof value.enabled === "boolean" && reasoning.enabled === void 0) reasoning.enabled = value.enabled;
  if (typeof value.maxOutputTokens === "number" && reasoning.maxTokens === void 0) reasoning.maxTokens = value.maxOutputTokens;
  if (typeof value.include_reasoning === "boolean" && reasoning.includeReasoning === void 0) reasoning.includeReasoning = value.include_reasoning;
  return Object.keys(reasoning).length > 0 ? reasoning : void 0;
}
function normalizeReasoningShorthand(includeReasoning, effort) {
  const reasoning = {};
  if (typeof includeReasoning === "boolean") reasoning.includeReasoning = includeReasoning;
  if (typeof effort === "string" && effort.trim()) reasoning.effort = effort.trim();
  return Object.keys(reasoning).length > 0 ? reasoning : void 0;
}
function mergeReasoningConfigs(...configs) {
  const reasoning = {};
  for (const config of configs) {
    if (!config) continue;
    if (config.effort !== void 0) reasoning.effort = config.effort;
    if (config.maxTokens !== void 0) reasoning.maxTokens = config.maxTokens;
    if (config.exclude !== void 0) reasoning.exclude = config.exclude;
    if (config.enabled !== void 0) reasoning.enabled = config.enabled;
    if (config.includeReasoning !== void 0) reasoning.includeReasoning = config.includeReasoning;
    if (config.display !== void 0) reasoning.display = config.display;
    if (config.interleaved !== void 0) reasoning.interleaved = config.interleaved;
  }
  return Object.keys(reasoning).length > 0 ? reasoning : void 0;
}
function normalizeProvider(value) {
  if (!isRecord2(value)) return void 0;
  const provider = {
    raw: value
  };
  if (asStringArray(value.order)?.length) provider.order = asStringArray(value.order);
  if (asStringArray(value.only)?.length) provider.only = asStringArray(value.only);
  if (typeof value.allow_fallbacks === "boolean") provider.allowFallbacks = value.allow_fallbacks;
  if (typeof value.sort === "string") provider.sort = value.sort;
  return provider;
}
function normalizeCacheControl(value) {
  if (!isRecord2(value)) return void 0;
  const cache = {
    enabled: true,
    raw: value
  };
  if (typeof value.ttl === "string") cache.ttl = value.ttl;
  if (typeof value.type === "string") cache.mode = value.type;
  return cache;
}
function applyModelResolution(ir) {
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
  if (resolution.routeApplied || resolution.providerRoute || resolution.aliasCandidates.length > 0 || resolution.reasoning || resolution.verbosity) {
    ir.metadata.rawHints.modelResolution = {
      prefix: resolution.prefix,
      logicalModel: resolution.logical,
      resolvedModel: resolution.resolved,
      aliasCandidates: resolution.aliasCandidates,
      routeApplied: resolution.routeApplied,
      providerRoute: resolution.providerRoute?.provider,
      reasoning: resolution.reasoning,
      verbosity: resolution.verbosity
    };
  }
}
function cloneUnknownFields(source, excludedKeys) {
  const excluded = new Set(excludedKeys);
  const output = {};
  for (const [key, value] of Object.entries(source)) {
    if (!excluded.has(key)) output[key] = value;
  }
  return output;
}
function toTextPart(text) {
  return { type: "text", text: typeof text === "string" ? text : String(text ?? "") };
}
function normalizeOpenAIToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  const parts = [];
  for (const toolCall of toolCalls) {
    if (!isRecord2(toolCall)) continue;
    const fn = isRecord2(toolCall.function) ? toolCall.function : void 0;
    if (typeof fn?.name !== "string") continue;
    parts.push({
      type: "tool_call",
      id: typeof toolCall.id === "string" ? toolCall.id : void 0,
      name: fn.name,
      arguments: typeof fn.arguments === "string" ? fn.arguments : fn.arguments ?? {}
    });
  }
  return parts;
}
function normalizeOpenAIReasoningDetails(reasoningDetails) {
  if (!Array.isArray(reasoningDetails)) return [];
  const parts = [];
  for (const detail of reasoningDetails) {
    if (!isRecord2(detail) || typeof detail.type !== "string") continue;
    const common = {
      id: typeof detail.id === "string" || detail.id === null ? detail.id : void 0,
      index: typeof detail.index === "number" ? detail.index : void 0,
      format: typeof detail.format === "string" ? detail.format : void 0
    };
    if (detail.type === "reasoning.summary") {
      parts.push({
        type: "thinking",
        thinking: typeof detail.summary === "string" ? detail.summary : "",
        ...common
      });
      continue;
    }
    if (detail.type === "reasoning.text") {
      parts.push({
        type: "thinking",
        thinking: typeof detail.text === "string" ? detail.text : "",
        signature: typeof detail.signature === "string" ? detail.signature : void 0,
        ...common
      });
      continue;
    }
    if (detail.type === "reasoning.encrypted") {
      parts.push({
        type: "redacted_thinking",
        data: typeof detail.data === "string" ? detail.data : "",
        ...common
      });
    }
  }
  return parts;
}
function normalizeOpenAIContent(content) {
  if (typeof content === "string") return [toTextPart(content)];
  if (!Array.isArray(content)) return [];
  const parts = [];
  for (const part of content) {
    if (!isRecord2(part)) continue;
    if (part.type === "text" || part.type === "input_text") {
      parts.push({ type: "text", text: typeof part.text === "string" ? part.text : "" });
      continue;
    }
    if (part.type === "image_url" && isRecord2(part.image_url) && typeof part.image_url.url === "string") {
      parts.push({
        type: "image_url",
        url: part.image_url.url
      });
      continue;
    }
    parts.push({ type: "json", value: part });
  }
  return parts;
}
function normalizeAnthropicContent(content) {
  if (typeof content === "string") return [toTextPart(content)];
  if (!Array.isArray(content)) return [];
  const parts = [];
  for (const part of content) {
    if (!isRecord2(part) || typeof part.type !== "string") continue;
    if (part.type === "text") {
      parts.push({ type: "text", text: typeof part.text === "string" ? part.text : "" });
      continue;
    }
    if (part.type === "thinking") {
      const thinking = typeof part.thinking === "string" ? part.thinking : "";
      parts.push({
        type: "thinking",
        thinking,
        signature: typeof part.signature === "string" ? part.signature : void 0,
        hidden: thinking.length === 0,
        display: thinking.length === 0 ? "omitted" : "summarized",
        format: "anthropic-claude-v1"
      });
      continue;
    }
    if (part.type === "redacted_thinking") {
      parts.push({
        type: "redacted_thinking",
        data: typeof part.data === "string" ? part.data : "",
        format: "anthropic-claude-v1"
      });
      continue;
    }
    if (part.type === "tool_use") {
      parts.push({
        type: "tool_call",
        id: typeof part.id === "string" ? part.id : void 0,
        name: typeof part.name === "string" ? part.name : "unknown_tool",
        arguments: isRecord2(part.input) || typeof part.input === "string" ? part.input : JSON.stringify(part.input ?? {})
      });
      continue;
    }
    if (part.type === "tool_result") {
      parts.push({
        type: "tool_result",
        toolCallId: typeof part.tool_use_id === "string" ? part.tool_use_id : void 0,
        content: typeof part.content === "string" ? part.content : Array.isArray(part.content) ? JSON.stringify(part.content) : JSON.stringify(part.content ?? ""),
        isError: typeof part.is_error === "boolean" ? part.is_error : void 0
      });
      continue;
    }
    if (part.type === "image" && isRecord2(part.source)) {
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
          mediaType
        });
        continue;
      }
    }
    parts.push({ type: "json", value: part });
  }
  return parts;
}
function normalizeGeminiParts(partsInput) {
  if (!Array.isArray(partsInput)) return [];
  const parts = [];
  for (const part of partsInput) {
    if (!isRecord2(part)) continue;
    if (typeof part.text === "string") {
      parts.push({ type: "text", text: part.text });
      continue;
    }
    if (isRecord2(part.inlineData) && typeof part.inlineData.data === "string") {
      const mediaType = typeof part.inlineData.mimeType === "string" ? part.inlineData.mimeType : "application/octet-stream";
      parts.push({
        type: "input_image",
        url: `data:${mediaType};base64,${part.inlineData.data}`,
        mediaType
      });
      continue;
    }
    if (isRecord2(part.fileData) && typeof part.fileData.fileUri === "string") {
      parts.push({
        type: "input_image",
        url: part.fileData.fileUri,
        mediaType: typeof part.fileData.mimeType === "string" ? part.fileData.mimeType : void 0
      });
      continue;
    }
    if (isRecord2(part.functionCall)) {
      parts.push({
        type: "tool_call",
        name: typeof part.functionCall.name === "string" ? part.functionCall.name : "unknown_tool",
        arguments: isRecord2(part.functionCall.args) ? part.functionCall.args : {}
      });
      continue;
    }
    if (isRecord2(part.functionResponse)) {
      parts.push({
        type: "tool_result",
        name: typeof part.functionResponse.name === "string" ? part.functionResponse.name : void 0,
        content: JSON.stringify(part.functionResponse.response ?? {})
      });
      continue;
    }
    parts.push({ type: "json", value: part });
  }
  return parts;
}
function normalizeResponseFormat(value) {
  if (!isRecord2(value)) return void 0;
  const formatType = typeof value.type === "string" ? value.type : void 0;
  if (formatType === "json_schema") {
    return {
      type: "json_schema",
      name: typeof value.name === "string" ? value.name : void 0,
      jsonSchema: isRecord2(value.json_schema) ? value.json_schema : isRecord2(value.schema) ? value.schema : void 0
    };
  }
  if (formatType === "json_object") {
    return { type: "json_object" };
  }
  return void 0;
}
function normalizeOpenAITools(value) {
  if (!Array.isArray(value)) return [];
  const tools = [];
  for (const tool of value) {
    if (!isRecord2(tool) || !isRecord2(tool.function) || typeof tool.function.name !== "string") continue;
    tools.push({
      name: tool.function.name,
      description: typeof tool.function.description === "string" ? tool.function.description : void 0,
      inputSchema: isRecord2(tool.function.parameters) ? tool.function.parameters : void 0
    });
  }
  return tools;
}
function normalizeAnthropicTools(value) {
  if (!Array.isArray(value)) return [];
  const tools = [];
  for (const tool of value) {
    if (!isRecord2(tool) || typeof tool.name !== "string") continue;
    tools.push({
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description : void 0,
      inputSchema: isRecord2(tool.input_schema) ? tool.input_schema : void 0
    });
  }
  return tools;
}
function normalizeGeminiTools(value) {
  if (!Array.isArray(value)) return [];
  const tools = [];
  for (const tool of value) {
    if (!isRecord2(tool) || !Array.isArray(tool.functionDeclarations)) continue;
    for (const declaration of tool.functionDeclarations) {
      if (!isRecord2(declaration) || typeof declaration.name !== "string") continue;
      tools.push({
        name: declaration.name,
        description: typeof declaration.description === "string" ? declaration.description : void 0,
        inputSchema: isRecord2(declaration.parameters) ? declaration.parameters : void 0
      });
    }
  }
  return tools;
}
function createBaseIR(protocol, body) {
  const requestedModel = typeof body.model === "string" ? body.model : typeof body.model_id === "string" ? body.model_id : "unknown";
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
      rawHints: {}
    },
    unknownFields: {}
  };
}
function normalizeOpenAI(body) {
  const ir = createBaseIR("openai-chat", body);
  ir.requestedModel = typeof body.model === "string" ? body.model : "unknown";
  ir.model = ir.requestedModel;
  ir.stream = body.stream === true;
  ir.tools = normalizeOpenAITools(body.tools);
  ir.responseFormat = normalizeResponseFormat(body.response_format);
  ir.reasoning = mergeReasoningConfigs(
    normalizeReasoningRecord(body.reasoning),
    normalizeReasoningShorthand(body.include_reasoning, body.reasoning_effort)
  );
  ir.verbosity = normalizeVerbosity(body.verbosity);
  ir.provider = normalizeProvider(body.provider);
  ir.cache = normalizeCacheControl(body.cache_control);
  ir.temperature = typeof body.temperature === "number" ? body.temperature : void 0;
  ir.maxOutputTokens = firstNumber(body.max_output_tokens, body.max_completion_tokens, body.max_tokens);
  ir.topP = typeof body.top_p === "number" ? body.top_p : void 0;
  ir.stop = asStringArray(body.stop);
  ir.metadata.rawHints = {
    hasToolChoice: body.tool_choice !== void 0,
    hasResponseFormat: body.response_format !== void 0,
    tokenParam: typeof body.max_output_tokens === "number" ? "max_output_tokens" : typeof body.max_completion_tokens === "number" ? "max_completion_tokens" : typeof body.max_tokens === "number" ? "max_tokens" : void 0
  };
  if (Array.isArray(body.messages)) {
    const normalizedMessages = [];
    for (const message of body.messages) {
      if (!isRecord2(message) || typeof message.role !== "string") continue;
      const reasoningParts = normalizeOpenAIReasoningDetails(message.reasoning_details);
      const contentParts = normalizeOpenAIContent(message.content);
      const toolParts = normalizeOpenAIToolCalls(message.tool_calls);
      normalizedMessages.push({
        role: message.role,
        name: typeof message.name === "string" ? message.name : void 0,
        parts: [...reasoningParts, ...contentParts, ...toolParts],
        reasoning: typeof message.reasoning === "string" ? message.reasoning : typeof message.reasoning_content === "string" ? message.reasoning_content : void 0,
        reasoningDetails: Array.isArray(message.reasoning_details) ? message.reasoning_details : void 0
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
    "reasoning_effort"
  ]);
  applyModelResolution(ir);
  return { protocol: "openai-chat", ir };
}
function normalizeAnthropic(body) {
  const ir = createBaseIR("anthropic-messages", body);
  ir.requestedModel = typeof body.model === "string" ? body.model : "unknown";
  ir.model = ir.requestedModel;
  ir.stream = body.stream === true;
  ir.tools = normalizeAnthropicTools(body.tools);
  ir.reasoning = mergeReasoningConfigs(
    normalizeThinkingConfig(body.thinking),
    normalizeReasoningRecord(body.reasoning),
    normalizeReasoningShorthand(body.include_reasoning, body.reasoning_effort)
  );
  ir.verbosity = normalizeVerbosity(body.verbosity);
  ir.provider = normalizeProvider(body.provider);
  ir.cache = normalizeCacheControl(body.cache_control);
  ir.stop = asStringArray(body.stop_sequences) ?? asStringArray(body.stop);
  ir.maxOutputTokens = firstNumber(body.max_output_tokens, body.max_completion_tokens, body.max_tokens);
  ir.metadata.rawHints = {
    anthropicVersion: typeof body.anthropic_version === "string" ? body.anthropic_version : void 0,
    anthropicBeta: body.anthropic_beta,
    tokenParam: typeof body.max_output_tokens === "number" ? "max_output_tokens" : typeof body.max_completion_tokens === "number" ? "max_completion_tokens" : typeof body.max_tokens === "number" ? "max_tokens" : void 0
  };
  const normalizedMessages = [];
  if (body.system !== void 0) {
    normalizedMessages.push({
      role: "system",
      parts: normalizeAnthropicContent(body.system)
    });
  }
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!isRecord2(message) || typeof message.role !== "string") continue;
      normalizedMessages.push({
        role: message.role,
        parts: normalizeAnthropicContent(message.content)
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
    "reasoning_effort"
  ]);
  applyModelResolution(ir);
  return { protocol: "anthropic-messages", ir };
}
function normalizeGemini(body) {
  const ir = createBaseIR("gemini-generate-content", body);
  ir.requestedModel = typeof body.model === "string" ? body.model : typeof body.model_id === "string" ? body.model_id : "gemini";
  ir.model = ir.requestedModel;
  ir.stream = body.stream === true || body.streamGenerateContent === true;
  ir.tools = normalizeGeminiTools(body.tools);
  const generationConfig = isRecord2(body.generationConfig) ? body.generationConfig : void 0;
  ir.responseFormat = generationConfig && typeof generationConfig.responseMimeType === "string" ? generationConfig.responseMimeType.includes("json") ? {
    type: generationConfig.responseSchema ? "json_schema" : "json_object",
    jsonSchema: isRecord2(generationConfig.responseSchema) ? generationConfig.responseSchema : void 0
  } : { type: "text" } : void 0;
  ir.temperature = firstNumber(body.temperature, generationConfig?.temperature);
  ir.topP = firstNumber(body.top_p, generationConfig?.topP);
  ir.maxOutputTokens = firstNumber(
    body.max_output_tokens,
    body.max_completion_tokens,
    generationConfig?.maxOutputTokens,
    body.max_tokens
  );
  ir.stop = asStringArray(body.stop) ?? (generationConfig ? asStringArray(generationConfig.stopSequences) : void 0);
  ir.reasoning = mergeReasoningConfigs(
    // Official Gemini ThinkingConfig path: generationConfig.thinkingConfig
    // Spec: https://ai.google.dev/api/generate-content#ThinkingConfig
    normalizeGeminiReasoningConfig(generationConfig?.thinkingConfig),
    // Backward-compat: gateway-specific top-level reasoningConfig field
    normalizeGeminiReasoningConfig(body.reasoningConfig),
    normalizeReasoningRecord(body.reasoning),
    normalizeReasoningShorthand(body.include_reasoning, body.reasoning_effort)
  );
  ir.verbosity = normalizeVerbosity(body.verbosity);
  ir.provider = normalizeProvider(body.provider);
  ir.cache = normalizeCacheControl(body.cache_control);
  ir.metadata.rawHints = {
    hasGenerationConfig: !!generationConfig,
    hasSafetySettings: Array.isArray(body.safetySettings),
    tokenParam: typeof body.max_output_tokens === "number" ? "max_output_tokens" : typeof body.max_completion_tokens === "number" ? "max_completion_tokens" : generationConfig && typeof generationConfig.maxOutputTokens === "number" ? "generationConfig.maxOutputTokens" : typeof body.max_tokens === "number" ? "max_tokens" : void 0
  };
  if (Array.isArray(body.contents)) {
    const normalizedMessages = [];
    for (const message of body.contents) {
      if (!isRecord2(message)) continue;
      const role = message.role === "model" ? "assistant" : message.role === "user" ? "user" : "user";
      normalizedMessages.push({
        role,
        parts: normalizeGeminiParts(message.parts)
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
    "reasoning_effort"
  ]);
  applyModelResolution(ir);
  return { protocol: "gemini-generate-content", ir };
}
function normalizeUnknown(body, detection) {
  const ir = createBaseIR("unknown", body);
  ir.requestedModel = typeof body.model === "string" ? body.model : typeof body.model_id === "string" ? body.model_id : "unknown";
  ir.model = ir.requestedModel;
  ir.metadata.requestedModel = ir.requestedModel;
  ir.metadata.resolvedModel = ir.model;
  ir.metadata.rawHints = {
    detectionReasons: detection.reasons,
    confidence: detection.confidence
  };
  ir.unknownFields = { ...body };
  return { protocol: "unknown", ir };
}
function normalizeGatewayRequest(body, detection) {
  const detectResult = detection ?? detectGatewayProtocol(body);
  if (!isRecord2(body)) {
    return normalizeUnknown({}, detectResult);
  }
  if (detectResult.protocol === "openai-chat") return normalizeOpenAI(body);
  if (detectResult.protocol === "anthropic-messages") return normalizeAnthropic(body);
  if (detectResult.protocol === "gemini-generate-content") return normalizeGemini(body);
  return normalizeUnknown(body, detectResult);
}

// src/lib/gateway/openrouter.ts
function partToOpenAICompatible(part) {
  if (part.type === "text" || part.type === "input_text") {
    return { type: "text", text: part.text };
  }
  if (part.type === "image_url" || part.type === "input_image") {
    return {
      type: "image_url",
      image_url: {
        url: part.url
      }
    };
  }
  if (part.type === "tool_result") {
    return {
      type: "text",
      text: part.content
    };
  }
  if (part.type === "json") {
    return {
      type: "text",
      text: JSON.stringify(part.value)
    };
  }
  if (part.type === "tool_call") {
    return {
      type: "text",
      text: JSON.stringify({
        tool_call: {
          id: part.id,
          name: part.name,
          arguments: part.arguments
        }
      })
    };
  }
  return {
    type: "text",
    text: ""
  };
}
function partToReasoningDetail(part, index) {
  if (part.type === "thinking") {
    return {
      type: "reasoning.text",
      text: part.thinking,
      ...part.signature ? { signature: part.signature } : {},
      ...part.id !== void 0 ? { id: part.id } : {},
      ...part.format ? { format: part.format } : {},
      index
    };
  }
  if (part.type === "redacted_thinking") {
    return {
      type: "reasoning.encrypted",
      data: part.data,
      ...part.id !== void 0 ? { id: part.id } : {},
      ...part.format ? { format: part.format } : {},
      index
    };
  }
  return null;
}
function messageToOpenAICompatible(message) {
  if (message.role === "assistant") {
    const toolCalls = message.parts.filter((part) => part.type === "tool_call").map((part, index) => ({
      id: part.id ?? `tool_call_${index + 1}`,
      type: "function",
      function: {
        name: part.name,
        arguments: typeof part.arguments === "string" ? part.arguments : JSON.stringify(part.arguments)
      }
    }));
    const reasoningDetails = message.parts.map((part, index) => partToReasoningDetail(part, index)).filter((detail) => !!detail);
    const contentParts = message.parts.filter((part) => part.type !== "tool_call" && part.type !== "thinking" && part.type !== "redacted_thinking").map(partToOpenAICompatible);
    const visibleReasoning = message.parts.filter((part) => part.type === "thinking").map((part) => part.thinking).filter((part) => part.length > 0).join("\n");
    return {
      role: "assistant",
      content: contentParts.length > 0 ? contentParts : "",
      ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
      ...visibleReasoning ? { reasoning: visibleReasoning, reasoning_content: visibleReasoning } : typeof message.reasoning === "string" && message.reasoning.length > 0 ? { reasoning: message.reasoning, reasoning_content: message.reasoning } : {},
      ...reasoningDetails.length > 0 ? { reasoning_details: reasoningDetails } : Array.isArray(message.reasoningDetails) && message.reasoningDetails.length > 0 ? { reasoning_details: message.reasoningDetails } : {}
    };
  }
  if (message.role === "tool") {
    const toolResult = message.parts.find((part) => part.type === "tool_result");
    return {
      role: "tool",
      tool_call_id: toolResult?.toolCallId ?? message.name ?? "tool_call",
      content: toolResult?.content ?? ""
    };
  }
  return {
    role: message.role,
    content: message.parts.length > 0 ? message.parts.map(partToOpenAICompatible) : "",
    ...message.name ? { name: message.name } : {}
  };
}
function toolsToOpenAICompatible(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      ...tool.description ? { description: tool.description } : {},
      ...tool.inputSchema ? { parameters: tool.inputSchema } : {}
    }
  }));
}
function buildReasoning(ir) {
  if (!ir.reasoning) return void 0;
  const reasoning = {};
  if (ir.reasoning.effort) reasoning.effort = ir.reasoning.effort;
  if (typeof ir.reasoning.maxTokens === "number") reasoning.max_tokens = ir.reasoning.maxTokens;
  if (typeof ir.reasoning.exclude === "boolean") reasoning.exclude = ir.reasoning.exclude;
  if (typeof ir.reasoning.enabled === "boolean") reasoning.enabled = ir.reasoning.enabled;
  if (typeof ir.reasoning.includeReasoning === "boolean") reasoning.include_reasoning = ir.reasoning.includeReasoning;
  if (typeof ir.reasoning.display === "string") reasoning.display = ir.reasoning.display;
  if (typeof ir.reasoning.interleaved === "boolean") reasoning.interleaved = ir.reasoning.interleaved;
  return Object.keys(reasoning).length > 0 ? reasoning : void 0;
}
function buildProvider(ir) {
  const route = ir.modelResolution?.providerRoute;
  if (!ir.provider && !route) return void 0;
  const provider = {};
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
function buildCacheControl(ir) {
  if (!ir.cache) return void 0;
  const cacheControl = {};
  if (ir.cache.mode) cacheControl.type = ir.cache.mode;
  if (ir.cache.ttl) cacheControl.ttl = ir.cache.ttl;
  return Object.keys(cacheControl).length > 0 ? cacheControl : ir.cache.raw;
}
function buildOpenRouterRequest(ir) {
  const body = {
    model: ir.model,
    messages: ir.messages.map(messageToOpenAICompatible),
    stream: ir.stream
  };
  if (ir.tools.length > 0) body.tools = toolsToOpenAICompatible(ir.tools);
  if (ir.responseFormat?.type === "json_object") body.response_format = { type: "json_object" };
  if (ir.responseFormat?.type === "json_schema") {
    body.response_format = {
      type: "json_schema",
      ...ir.responseFormat.name ? { name: ir.responseFormat.name } : {},
      ...ir.responseFormat.jsonSchema ? { json_schema: ir.responseFormat.jsonSchema } : {}
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
  const preservedKeys = [];
  for (const [key, value] of Object.entries(ir.unknownFields)) {
    if (body[key] !== void 0) continue;
    body[key] = value;
    preservedKeys.push(key);
  }
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
      preservedKeys
    }
  };
}

// ../../scripts/evidence-gen.ts
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
var _dir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
var CAPTURES = join(_dir, "../docs/upstream-crosscheck/captures");
mkdirSync(CAPTURES, { recursive: true });
var VECTORS = [
  // §P-001: bedrock/ prefix → provider lock
  {
    id: "P-001-bedrock",
    desc: "bedrock/ prefix \u2192 provider.only=[amazon-bedrock], allow_fallbacks=false",
    body: { model: "bedrock/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
    checks: [
      { field: "outbound.body.provider.only[0]", op: "eq", expected: "amazon-bedrock" },
      { field: "outbound.body.provider.allow_fallbacks", op: "eq", expected: false }
    ]
  },
  {
    id: "P-001-vertex",
    desc: "vertex/ prefix \u2192 provider.only=[google-vertex], allow_fallbacks=false",
    body: { model: "vertex/gemini-2.5-pro", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
    checks: [
      { field: "outbound.body.provider.only[0]", op: "eq", expected: "google-vertex" },
      { field: "outbound.body.provider.allow_fallbacks", op: "eq", expected: false }
    ]
  },
  {
    id: "P-001-anthropic",
    desc: "anthropic/ prefix \u2192 provider.only contains anthropic slug",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
    checks: [
      { field: "outbound.body.provider.allow_fallbacks", op: "eq", expected: false }
    ]
  },
  {
    id: "P-001-groq",
    desc: "groq/ prefix \u2192 provider.only=[Groq], allow_fallbacks=false",
    body: { model: "groq/llama-3.3-70b", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
    checks: [
      { field: "outbound.body.provider.allow_fallbacks", op: "eq", expected: false }
    ]
  },
  // §P-002: client cannot override allow_fallbacks
  {
    id: "P-002",
    desc: "client allow_fallbacks:true overridden when bedrock lock active",
    body: { model: "bedrock/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5, provider: { allow_fallbacks: true } },
    checks: [
      { field: "outbound.body.provider.allow_fallbacks", op: "eq", expected: false }
    ]
  },
  // §P-003: openrouter/ passthrough — openrouter/ prefix strips to bare model;
  // openrouter/meta-llama/... has no recognized provider sub-prefix so no lock.
  {
    id: "P-003-passthrough",
    desc: "openrouter/<bare-model> \u2014 no recognized sub-prefix \u2192 no allow_fallbacks forced",
    body: { model: "openrouter/meta-llama/llama-3.3-70b-instruct", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
    checks: [
      // When no recognized provider prefix is present, allow_fallbacks is not forced to false
      { field: "outbound.body.provider.allow_fallbacks", op: "absent" }
    ]
  },
  // §P-005: OpenAI system+user roles preserved
  {
    id: "P-005-roles",
    desc: "OpenAI system+user roles \u2192 ir.messages[0].role=system, [1].role=user",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Hi." }], max_tokens: 5 },
    checks: [
      { field: "ir.messages[0].role", op: "eq", expected: "system" },
      { field: "ir.messages[1].role", op: "eq", expected: "user" }
    ]
  },
  // §P-009: max_completion_tokens alias
  {
    id: "P-009-max-tokens",
    desc: "max_completion_tokens \u2192 ir.maxOutputTokens, outbound max_tokens",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_completion_tokens: 100 },
    checks: [
      { field: "ir.maxOutputTokens", op: "eq", expected: 100 },
      { field: "outbound.body.max_tokens", op: "eq", expected: 100 }
    ]
  },
  // §P-010: reasoning_effort
  {
    id: "P-010-reasoning-effort",
    desc: "reasoning_effort:high \u2192 ir.reasoning.effort=high",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 20, reasoning_effort: "high" },
    checks: [
      { field: "ir.reasoning.effort", op: "eq", expected: "high" }
    ]
  },
  // §P-012: Anthropic thinking config
  {
    id: "P-012-thinking",
    desc: "Anthropic thinking.budget_tokens=1024 \u2192 ir.reasoning.maxTokens=1024",
    body: { model: "anthropic/claude-haiku-3-5", anthropic_version: "2023-06-01", messages: [{ role: "user", content: "hi" }], max_tokens: 200, thinking: { type: "enabled", budget_tokens: 1024 } },
    checks: [
      { field: "ir.reasoning.maxTokens", op: "eq", expected: 1024 },
      { field: "ir.reasoning.enabled", op: "eq", expected: true }
    ]
  },
  // §P-013: Anthropic protocol detection
  {
    id: "P-013-anthropic-native",
    desc: "anthropic_version field \u2192 protocol=anthropic-messages",
    body: { model: "anthropic/claude-haiku-3-5", anthropic_version: "2023-06-01", max_tokens: 20, messages: [{ role: "user", content: "hello" }] },
    checks: [
      { field: "protocol", op: "eq", expected: "anthropic-messages" }
    ]
  },
  // §P-014: Anthropic system prompt → prepended message
  {
    id: "P-014-system",
    desc: "Anthropic system string \u2192 prepended system role message in ir.messages",
    body: { model: "anthropic/claude-haiku-3-5", anthropic_version: "2023-06-01", max_tokens: 20, messages: [{ role: "user", content: "hi" }], system: "You are helpful." },
    checks: [
      { field: "ir.messages[0].role", op: "eq", expected: "system" }
    ]
  },
  // §P-015 (F-001 FIX): Anthropic stop_sequences → ir.stop → outbound stop
  {
    id: "P-015-stop-sequences",
    desc: "F-001: stop_sequences\u2192ir.stop\u2192outbound.stop (NOT stop_sequences in outbound)",
    body: { model: "anthropic/claude-haiku-3-5", anthropic_version: "2023-06-01", max_tokens: 50, messages: [{ role: "user", content: "count" }], stop_sequences: ["3"] },
    checks: [
      { field: "ir.stop[0]", op: "eq", expected: "3" },
      { field: "outbound.body.stop[0]", op: "eq", expected: "3" },
      { field: "outbound.body.stop_sequences", op: "absent" }
    ]
  },
  // §P-019: Gemini contents model→assistant role
  {
    id: "P-019-gemini-roles",
    desc: "Gemini contents role=model \u2192 assistant in ir.messages",
    body: { model: "google/gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: "hi" }] }, { role: "model", parts: [{ text: "hello" }] }] },
    checks: [
      { field: "ir.messages[0].role", op: "eq", expected: "user" },
      { field: "ir.messages[1].role", op: "eq", expected: "assistant" }
    ]
  },
  // §P-021: Gemini stopSequences → ir.stop
  {
    id: "P-021-stop-sequences",
    desc: "Gemini generationConfig.stopSequences \u2192 ir.stop",
    body: { model: "google/gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: { stopSequences: ["END"] } },
    checks: [
      { field: "ir.stop[0]", op: "eq", expected: "END" }
    ]
  },
  // §P-022 (F-002 FIX): Gemini thinkingConfig official fields
  {
    id: "P-022-thinkingBudget",
    desc: "F-002: generationConfig.thinkingConfig.thinkingBudget=1024 \u2192 ir.reasoning.maxTokens=1024",
    body: { model: "google/gemini-2.5-pro", contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: { thinkingConfig: { thinkingBudget: 1024, includeThoughts: true, thinkingLevel: "ENABLED" } } },
    checks: [
      { field: "ir.reasoning.maxTokens", op: "eq", expected: 1024 },
      { field: "ir.reasoning.includeReasoning", op: "eq", expected: true },
      { field: "ir.reasoning.enabled", op: "eq", expected: true }
    ]
  },
  {
    id: "P-022-DISABLED",
    desc: "F-002: thinkingLevel=DISABLED \u2192 ir.reasoning.enabled=false",
    body: { model: "google/gemini-2.5-pro", contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: { thinkingConfig: { thinkingLevel: "DISABLED" } } },
    checks: [
      { field: "ir.reasoning.enabled", op: "eq", expected: false }
    ]
  },
  {
    id: "P-022-DYNAMIC",
    desc: "F-002: thinkingLevel=DYNAMIC \u2192 ir.reasoning.enabled=true, interleaved=true",
    body: { model: "google/gemini-2.5-pro", contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: { thinkingConfig: { thinkingLevel: "DYNAMIC" } } },
    checks: [
      { field: "ir.reasoning.enabled", op: "eq", expected: true },
      { field: "ir.reasoning.interleaved", op: "eq", expected: true }
    ]
  },
  {
    id: "P-022-compat-reasoningConfig",
    desc: "Backward compat: body.reasoningConfig.enabled=true \u2192 ir.reasoning.enabled=true",
    body: { model: "google/gemini-2.5-pro", contents: [{ role: "user", parts: [{ text: "hello" }] }], reasoningConfig: { enabled: true, maxOutputTokens: 512 } },
    checks: [
      { field: "ir.reasoning.enabled", op: "eq", expected: true },
      { field: "ir.reasoning.maxTokens", op: "eq", expected: 512 }
    ]
  },
  // §P-025: cache_control forwarded (normalizeCacheControl stores type in .mode)
  {
    id: "P-025-caching",
    desc: "cache_control.type=ephemeral \u2192 ir.cache.mode=ephemeral, outbound body.cache_control.type=ephemeral",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5, cache_control: { type: "ephemeral" } },
    checks: [
      { field: "ir.cache.mode", op: "eq", expected: "ephemeral" }
    ]
  },
  // §P-027: reasoning.max_tokens
  {
    id: "P-027-reasoning",
    desc: "reasoning.max_tokens=512 \u2192 ir.reasoning.maxTokens=512",
    body: { model: "anthropic/claude-haiku-3-5", messages: [{ role: "user", content: "hi" }], max_tokens: 5, reasoning: { max_tokens: 512 } },
    checks: [
      { field: "ir.reasoning.maxTokens", op: "eq", expected: 512 }
    ]
  },
  // §NA-003: Bedrock model ID normalisation
  {
    id: "NA-003-bedrock-model-id",
    desc: "Bedrock model ID anthropic.claude-haiku-3-5-20251022-v1:0 \u2192 canonical form",
    body: { model: "bedrock/anthropic.claude-haiku-3-5-20251022-v1:0", messages: [{ role: "user", content: "hi" }], max_tokens: 5 },
    checks: [
      { field: "outbound.body.provider.only[0]", op: "eq", expected: "amazon-bedrock" }
    ]
  }
];
function getPath(obj, path) {
  const parts = path.split(/[\.\[\]]+/).filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return void 0;
    const idx = parseInt(p, 10);
    if (!isNaN(idx) && Array.isArray(cur)) cur = cur[idx];
    else cur = cur[p];
  }
  return cur;
}
function check(data, c) {
  const actual = getPath({ ir: data.ir, outbound: data.outbound, protocol: data.protocol }, c.field);
  switch (c.op) {
    case "eq":
      return { pass: actual === c.expected, actual };
    case "exists":
      return { pass: actual !== void 0 && actual !== null, actual };
    case "absent":
      return { pass: actual === void 0, actual };
    case "contains":
      return { pass: Array.isArray(actual) && actual.includes(c.expected), actual };
    default:
      return { pass: false, actual };
  }
}
var allResults = [];
var totalPass = 0;
var totalFail = 0;
for (const v of VECTORS) {
  try {
    const normalized = normalizeGatewayRequest(v.body);
    const outbound = buildOpenRouterRequest(normalized.ir);
    const checkResults = v.checks.map((c) => {
      const r = check({ ir: normalized.ir, outbound, protocol: normalized.protocol }, c);
      return { field: c.field, op: c.op, expected: c.expected, actual: r.actual, pass: r.pass };
    });
    const allPass = checkResults.every((r) => r.pass);
    if (allPass) totalPass++;
    else totalFail++;
    allResults.push({
      id: v.id,
      desc: v.desc,
      ok: allPass,
      protocol: normalized.protocol,
      ir_stop: normalized.ir.stop,
      ir_reasoning: normalized.ir.reasoning,
      ir_messages_roles: Array.isArray(normalized.ir.messages) ? normalized.ir.messages.map((m) => m.role) : void 0,
      outbound_provider: outbound.body.provider,
      outbound_stop: outbound.body.stop,
      outbound_stop_sequences: outbound.body.stop_sequences,
      outbound_model: outbound.body.model,
      outbound_max_tokens: outbound.body.max_tokens,
      checkResults
    });
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
console.log(`
Total PASS=${totalPass} FAIL=${totalFail}`);
