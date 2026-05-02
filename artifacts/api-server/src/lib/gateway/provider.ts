import type {
  GatewayModelResolution,
  GatewayProviderConfig,
  GatewayProviderRoute,
  GatewayReasoningConfig,
  GatewayVerbosityConfig,
} from "./types";

interface GatewayProviderPrefixSpec {
  aliases: string[];
  /** Canonical OpenRouter provider slug to lock the request to.
   *  When omitted (e.g. for the "openrouter" pass-through prefix), no
   *  provider.only / allow_fallbacks restriction is applied. */
  provider?: string;
  order?: string[];
  only?: string[];
  /** When provider is set this is forced to false (absolute routing).
   *  When provider is undefined this field is ignored. */
  allowFallbacks?: boolean;
}

/**
 * Absolute provider routing table.
 *
 * Each entry maps one or more incoming model-prefix aliases to a single
 * canonical OpenRouter provider slug.  When a request arrives with a model
 * id like `bedrock/claude-sonnet-4.5`, the gateway:
 *   1. detects the `bedrock` prefix here
 *   2. strips the prefix from the model id forwarded to OpenRouter
 *   3. injects `provider: { only: ["amazon-bedrock"], allow_fallbacks: false }`
 *      into the upstream body
 *   4. refuses any client attempt to override `only` or set
 *      `allow_fallbacks: true`
 *
 * Slugs follow OpenRouter's documented provider list
 * (https://openrouter.ai/docs/features/provider-routing).
 *
 * Two kinds of entries coexist:
 *
 * 1. **Provider locks** (have `provider` field) — force `provider.only` +
 *    `allow_fallbacks:false`.
 * 2. **Vendor-only namespaces** (no `provider` field) — recognised so the
 *    prefix is stripped during canonicalisation, but no lock is injected.
 *    Used for model ids like `meta-llama/llama-3.3` and `qwen/qwen-2.5`
 *    that can be served by multiple OpenRouter providers.
 *
 * The `openrouter/` and `auto/` prefixes are explicit pass-through entries:
 * they consume the prefix (so it's stripped from the forwarded model id)
 * but inject no `only` / `allow_fallbacks` fields. `openrouter/<inner>/...`
 * additionally recurses so a nested lock prefix is honoured.
 */
const PROVIDER_PREFIX_SPECS: GatewayProviderPrefixSpec[] = [
  // ── Cloud Anthropic backends ────────────────────────────────────────────
  {
    aliases: ["bedrock", "amazon-bedrock"],
    provider: "amazon-bedrock",
    order: ["amazon-bedrock"],
    only: ["amazon-bedrock"],
    allowFallbacks: false,
  },
  {
    aliases: ["vertex", "google-vertex", "anthropic-vertex"],
    provider: "google-vertex",
    order: ["google-vertex"],
    only: ["google-vertex"],
    allowFallbacks: false,
  },
  {
    aliases: ["anthropic", "anthropic-direct"],
    provider: "anthropic",
    order: ["anthropic"],
    only: ["anthropic"],
    allowFallbacks: false,
  },

  // ── Google ──────────────────────────────────────────────────────────────
  // `aistudio/` → AI Studio Gemini API
  // `google/`   → Vertex AI Gemini (preserve historical behaviour)
  {
    aliases: ["aistudio", "ai-studio", "google-ai-studio"],
    provider: "google-ai-studio",
    order: ["google-ai-studio"],
    only: ["google-ai-studio"],
    allowFallbacks: false,
  },
  {
    aliases: ["google"],
    provider: "google-vertex",
    order: ["google-vertex"],
    only: ["google-vertex"],
    allowFallbacks: false,
  },

  // ── First-party ─────────────────────────────────────────────────────────
  {
    aliases: ["openai", "openai-direct"],
    provider: "openai",
    order: ["openai"],
    only: ["openai"],
    allowFallbacks: false,
  },
  {
    aliases: ["x-ai", "xai"],
    provider: "x-ai",
    order: ["x-ai"],
    only: ["x-ai"],
    allowFallbacks: false,
  },
  {
    aliases: ["deepseek", "deepseek-direct"],
    provider: "deepseek",
    order: ["deepseek"],
    only: ["deepseek"],
    allowFallbacks: false,
  },
  {
    aliases: ["mistral", "mistralai"],
    provider: "mistral",
    order: ["mistral"],
    only: ["mistral"],
    allowFallbacks: false,
  },
  {
    aliases: ["cohere"],
    provider: "cohere",
    order: ["cohere"],
    only: ["cohere"],
    allowFallbacks: false,
  },
  {
    aliases: ["perplexity"],
    provider: "perplexity",
    order: ["perplexity"],
    only: ["perplexity"],
    allowFallbacks: false,
  },
  {
    aliases: ["moonshotai", "moonshot"],
    provider: "moonshotai",
    order: ["moonshotai"],
    only: ["moonshotai"],
    allowFallbacks: false,
  },
  {
    aliases: ["z-ai", "zai"],
    provider: "z-ai",
    order: ["z-ai"],
    only: ["z-ai"],
    allowFallbacks: false,
  },

  // ── Fast-inference partner clouds ───────────────────────────────────────
  {
    aliases: ["groq"],
    provider: "groq",
    order: ["groq"],
    only: ["groq"],
    allowFallbacks: false,
  },
  {
    aliases: ["cerebras"],
    provider: "cerebras",
    order: ["cerebras"],
    only: ["cerebras"],
    allowFallbacks: false,
  },
  {
    aliases: ["sambanova"],
    provider: "sambanova",
    order: ["sambanova"],
    only: ["sambanova"],
    allowFallbacks: false,
  },
  {
    aliases: ["fireworks", "fireworks-ai"],
    provider: "fireworks",
    order: ["fireworks"],
    only: ["fireworks"],
    allowFallbacks: false,
  },
  {
    aliases: ["together", "togetherai"],
    provider: "together",
    order: ["together"],
    only: ["together"],
    allowFallbacks: false,
  },
  {
    aliases: ["deepinfra"],
    provider: "deepinfra",
    order: ["deepinfra"],
    only: ["deepinfra"],
    allowFallbacks: false,
  },
  {
    aliases: ["novita", "novitaai"],
    provider: "novita",
    order: ["novita"],
    only: ["novita"],
    allowFallbacks: false,
  },
  {
    aliases: ["hyperbolic"],
    provider: "hyperbolic",
    order: ["hyperbolic"],
    only: ["hyperbolic"],
    allowFallbacks: false,
  },
  {
    aliases: ["lambda"],
    provider: "lambda",
    order: ["lambda"],
    only: ["lambda"],
    allowFallbacks: false,
  },
  {
    aliases: ["cloudflare"],
    provider: "cloudflare",
    order: ["cloudflare"],
    only: ["cloudflare"],
    allowFallbacks: false,
  },
  {
    aliases: ["friendli"],
    provider: "friendli",
    order: ["friendli"],
    only: ["friendli"],
    allowFallbacks: false,
  },
  {
    aliases: ["featherless"],
    provider: "featherless",
    order: ["featherless"],
    only: ["featherless"],
    allowFallbacks: false,
  },
  {
    aliases: ["mancer"],
    provider: "mancer",
    order: ["mancer"],
    only: ["mancer"],
    allowFallbacks: false,
  },
  {
    aliases: ["parasail"],
    provider: "parasail",
    order: ["parasail"],
    only: ["parasail"],
    allowFallbacks: false,
  },
  {
    aliases: ["baseten"],
    provider: "baseten",
    order: ["baseten"],
    only: ["baseten"],
    allowFallbacks: false,
  },
  {
    aliases: ["replicate"],
    provider: "replicate",
    order: ["replicate"],
    only: ["replicate"],
    allowFallbacks: false,
  },
  {
    aliases: ["nebius"],
    provider: "nebius",
    order: ["nebius"],
    only: ["nebius"],
    allowFallbacks: false,
  },
  {
    aliases: ["chutes"],
    provider: "chutes",
    order: ["chutes"],
    only: ["chutes"],
    allowFallbacks: false,
  },
  {
    aliases: ["azure", "azure-openai"],
    provider: "azure",
    order: ["azure"],
    only: ["azure"],
    allowFallbacks: false,
  },

  // ── Additional locks (parallel HEAD branch) ─────────────────────────────
  // These slugs were added on the parallel feature branch (fdc0209) and
  // are merged in here so absolute routing covers them too.
  {
    aliases: ["nvidia"],
    provider: "nvidia",
    order: ["nvidia"],
    only: ["nvidia"],
    allowFallbacks: false,
  },
  {
    aliases: ["minimax"],
    provider: "minimax",
    order: ["minimax"],
    only: ["minimax"],
    allowFallbacks: false,
  },
  {
    aliases: ["alibaba", "alibaba-cloud"],
    provider: "alibaba",
    order: ["alibaba"],
    only: ["alibaba"],
    allowFallbacks: false,
  },
  {
    aliases: ["baidu", "baidu-qianfan"],
    provider: "baidu",
    order: ["baidu"],
    only: ["baidu"],
    allowFallbacks: false,
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
    aliases: ["openrouter", "auto"],
  },
];

const KNOWN_VENDOR_PREFIXES: Set<string> = new Set(
  PROVIDER_PREFIX_SPECS.flatMap((spec) => spec.aliases),
);

function normalizePath(raw: string): string {
  return raw
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

// ---------------------------------------------------------------------------
// canonicalizeLogicalModel
// ---------------------------------------------------------------------------
// 重要架构假设（V1.1.9）：本 gateway 当前所有出站流量都通过 Friend Proxy →
// OpenRouter（见项目 README "后端路由"段）。OpenRouter 的 Claude 模型 ID 使用
// **dot 形式 + 不带日期/版本后缀**，例如：
//   - anthropic/claude-3.7-sonnet     （3.x：数字在 sonnet/opus/haiku 之前）
//   - anthropic/claude-sonnet-4       （4.0 整数版）
//   - anthropic/claude-sonnet-4.5     （4.x：数字在 sonnet/opus/haiku 之后）
//   - anthropic/claude-opus-4.5
//   - anthropic/claude-haiku-4.5
//
// 而 Anthropic 官方 API / Vertex / Bedrock 全部使用 **dash 形式 + 可带日期**：
//   - claude-sonnet-4-5、claude-sonnet-4-5-20250929
//   - claude-haiku-4-5@20251001                   （Vertex）
//   - anthropic.claude-sonnet-4-5-20250929-v1:0   （Bedrock）
//
// 因此本函数把客户端可能传入的 Anthropic 风格 ID 统一规范化为
// OpenRouter 风格（dot + 去日期）。**该规范化仅在目的地确实是 OpenRouter
// 时才正确**；如果将来恢复 Anthropic 直连/Vertex 直连/Bedrock 直连，调用
// 处必须先把规范化后的 dot ID 反向还原为各家的 dash ID，否则上游会拒绝。
//
// 参考文档：docs/vendors/anthropic/models.md, vertex.md, bedrock.md;
//          docs/vendors/openrouter/{provider-routing,quickstart,models}.md
// ---------------------------------------------------------------------------
function canonicalizeLogicalModel(model: string): string {
  const normalized = normalizePath(model).toLowerCase();
  if (!normalized) return normalized;

  if (!normalized.startsWith("claude-")) return normalized;

  // Step 1: 剥离 Anthropic / Vertex / Bedrock 的日期与版本后缀。
  //   - "@20250929"     (Vertex)
  //   - "-20250929"     (Anthropic / Bedrock 日期段)
  //   - "-v1:0" / "-v1" (Bedrock 版本段)
  let stripped = normalized
    .replace(/@\d{6,8}.*$/i, "")
    .replace(/-\d{8}(?:-v\d+(?::\d+)?)?$/i, "")
    .replace(/-v\d+(?::\d+)?$/i, "");

  // Step 2: 形态 A —— claude-{name}-X-Y → claude-{name}-X.Y (4.x 系列)
  stripped = stripped.replace(
    /^(claude-(?:opus|sonnet|haiku)-)(\d+)[._-](\d+)(.*)$/i,
    (_m, prefix: string, major: string, minor: string, suffix: string) =>
      `${prefix}${major}.${minor}${suffix}`,
  );

  // Step 3: 形态 B —— claude-X-Y-{name} → claude-X.Y-{name} (3.x 系列)
  stripped = stripped.replace(
    /^(claude-)(\d+)[._-](\d+)(-(?:opus|sonnet|haiku).*)$/i,
    (_m, prefix: string, major: string, minor: string, suffix: string) =>
      `${prefix}${major}.${minor}${suffix}`,
  );

  return stripped;
}

function canonicalizeModelIdentifier(model: string): string {
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

function stripVendorPrefix(model: string): string {
  const normalized = canonicalizeModelIdentifier(model);
  const segments = normalized.split("/");
  if (segments.length > 1 && KNOWN_VENDOR_PREFIXES.has(segments[0].toLowerCase())) {
    return canonicalizeLogicalModel(segments.slice(1).join("/"));
  }
  return normalized;
}

function inferVendorModelPath(logicalModel: string): string {
  const normalized = canonicalizeLogicalModel(logicalModel);
  if (!normalized) return normalized;
  if (normalized.includes("/")) return canonicalizeModelIdentifier(normalized);

  if (normalized.startsWith("claude-")) return `anthropic/${normalized}`;
  if (normalized.startsWith("gemini-")) return `google/${normalized}`;
  if (
    normalized.startsWith("gpt-") ||
    /^o\d/.test(normalized) ||
    normalized.startsWith("text-embedding-") ||
    normalized.startsWith("whisper-") ||
    normalized.startsWith("dall-e-")
  ) {
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

function findProviderPrefixSpec(prefix: string): GatewayProviderPrefixSpec | undefined {
  const normalizedPrefix = prefix.trim().toLowerCase();
  return PROVIDER_PREFIX_SPECS.find((spec) => spec.aliases.includes(normalizedPrefix));
}

/** Public: list of every accepted absolute-routing prefix alias.
 *  Consumed by the legacy /v1/chat/completions and /v1/messages routes
 *  so they share a single source of truth with the unified gateway. */
export function listAbsoluteProviderPrefixAliases(): string[] {
  const aliases = new Set<string>();
  for (const spec of PROVIDER_PREFIX_SPECS) {
    for (const alias of spec.aliases) aliases.add(alias.toLowerCase());
  }
  return Array.from(aliases);
}

/** Public: detect an absolute-routing prefix on a model id and return the
 *  resolved route.  Returns undefined when no prefix matches or when the
 *  matching prefix is a pass-through alias (no `provider` lock). */
export function detectAbsoluteProviderRoute(model: string): GatewayProviderRoute | undefined {
  const normalized = normalizePath(model);
  if (!normalized) return undefined;
  const segments = normalized.split("/");
  if (segments.length < 2) return undefined;
  const prefix = segments[0]?.toLowerCase() ?? "";
  return buildProviderRoute(prefix);
}

function buildProviderRoute(prefix: string): GatewayProviderRoute | undefined {
  const spec = findProviderPrefixSpec(prefix);
  if (!spec?.provider) return undefined;

  return {
    prefix: prefix.toLowerCase(),
    provider: spec.provider,
    order: spec.order ? [...spec.order] : undefined,
    only: spec.only ? [...spec.only] : undefined,
    // Absolute routing — `allow_fallbacks: false` is non-negotiable here
    // even if the spec entry forgets to set it.  See ROUTING_AUDIT.md §1.
    allowFallbacks: false,
    source: "model-prefix",
  };
}

function buildAliasCandidates(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0),
    ),
  );
}

function applyReasoningAliasToken(
  token: string,
  reasoning: GatewayReasoningConfig,
  verbosity: GatewayVerbosityConfig,
): boolean {
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

function extractModelAliases(model: string): {
  logicalModel: string;
  reasoning?: GatewayReasoningConfig;
  verbosity?: GatewayVerbosityConfig;
} {
  let logicalModel = canonicalizeLogicalModel(model);
  const reasoning: GatewayReasoningConfig = {};
  const verbosity: GatewayVerbosityConfig = {};

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
    reasoning: Object.keys(reasoning).length > 0 ? reasoning : undefined,
    verbosity: Object.keys(verbosity).length > 0 ? verbosity : undefined,
  };
}

export function resolveGatewayModelRoute(model: string): GatewayModelResolution {
  const original = normalizePath(model);
  if (!original) {
    return {
      raw: model,
      original: "",
      logical: "",
      resolved: "",
      aliasCandidates: [],
      routeApplied: false,
    };
  }

  // Detect outermost prefix.
  let segments = original.split("/");
  let prefixSpec = segments.length > 1 ? findProviderPrefixSpec(segments[0] ?? "") : undefined;
  let prefix = prefixSpec ? segments[0].toLowerCase() : undefined;
  let payload = prefix ? segments.slice(1).join("/") : original;

  // `openrouter/` is a pass-through — recurse into the inner segment so a
  // nested lock prefix (e.g. `openrouter/anthropic/claude-...`) is honored.
  if (prefix === "openrouter") {
    const innerSegments = payload.split("/");
    const innerSpec = innerSegments.length > 1 ? findProviderPrefixSpec(innerSegments[0] ?? "") : undefined;
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
  const resolved = prefix
    ? inferVendorModelPath(logical)
    : (canonicalPayload.includes("/") ? canonicalPayload : inferVendorModelPath(logical));

  const aliasCandidates = buildAliasCandidates([
    original,
    payload,
    canonicalPayload,
    rawLogical,
    logical,
    resolved,
    prefix ? `${prefix}/${rawLogical}` : undefined,
    prefix ? `${prefix}/${logical}` : undefined,
    prefix && resolved !== logical ? `${prefix}/${resolved}` : undefined,
  ]);

  return {
    raw: model,
    original,
    logical,
    resolved,
    aliasCandidates,
    routeApplied: !!prefix || resolved !== original || rawLogical !== logical,
    prefix,
    providerRoute: prefix ? buildProviderRoute(prefix) : undefined,
    reasoning: aliased.reasoning,
    verbosity: aliased.verbosity,
  };
}

/**
 * Merge a request-supplied `provider` block with the prefix-derived route.
 *
 * **Absolute-routing contract** (see `docs/vendors/ROUTING_AUDIT.md`) —
 * when the prefix declares a provider lock, the lock is non-overridable:
 *   • `only` is FORCE-set to the route's `only`.  Any client `only` is
 *     discarded so a client cannot widen the allow-list.
 *   • `allow_fallbacks` is FORCE-set to `false`.  Any client `true` is
 *     discarded so a client cannot opt out of the lock.
 *   • `order` is FORCE-set to the route's `order` for stable observability.
 *
 * Other request fields (`sort`, `raw`, custom keys) are preserved so the
 * client can still e.g. ask for `sort: "throughput"` within the locked
 * provider's variants.
 *
 * NB: an earlier implementation tried to take the **intersection** of the
 * client's `only` and the prefix's `only`.  That is unsafe — a malicious
 * or misconfigured client can supply `only: []` and effectively widen the
 * lock to "any provider".  Force-overwrite is the only correct choice.
 */
export function mergeGatewayProviderConfig(
  requestProvider: GatewayProviderConfig | undefined,
  modelResolution: GatewayModelResolution | undefined,
): GatewayProviderConfig | undefined {
  const route = modelResolution?.providerRoute;
  if (!requestProvider && !route) return undefined;

  const merged: GatewayProviderConfig = {
    ...(requestProvider ?? {}),
  };

  if (route) {
    // Absolute routing — force-overwrite the lock fields.  Any client-supplied
    // `only` / `order` / `allow_fallbacks` is discarded; client cannot escape.
    if (route.order?.length) merged.order = [...route.order];
    if (route.only?.length) merged.only = [...route.only];
    merged.allowFallbacks = false;
    merged.routeLabel = route.provider;
  } else {
    // No prefix lock — fall back to the request's own preferences.
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

  merged.source = requestProvider
    ? (route ? "request+model-prefix" : "request")
    : (route ? "model-prefix" : undefined);

  if (requestProvider?.raw || route) {
    merged.raw = {
      ...(requestProvider?.raw ?? {}),
      ...(route
        ? {
            // Surface the lock in the raw block so downstream observability
            // can see the absolute routing contract was applied.
            provider_route: route.provider,
            provider_prefix: route.prefix,
            allow_fallbacks: false,
            only: route.only ? [...route.only] : undefined,
          }
        : {}),
    };
  }

  return merged;
}
