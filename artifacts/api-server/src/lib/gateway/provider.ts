import type {
  GatewayModelResolution,
  GatewayProviderConfig,
  GatewayProviderRoute,
  GatewayReasoningConfig,
  GatewayVerbosityConfig,
} from "./types";

interface GatewayProviderPrefixSpec {
  aliases: string[];
  provider?: string;
  order?: string[];
  only?: string[];
  allowFallbacks?: boolean;
}

/**
 * Master list of recognized model-id prefixes.
 *
 * Two kinds of prefixes coexist here:
 *
 * 1. **Provider locks** (have `provider` field) — when the user writes
 *    `<prefix>/<model>`, the gateway will force OpenRouter to route the
 *    request to that exact provider via `provider.only` + `allow_fallbacks:false`.
 *
 * 2. **Vendor-only prefixes** (no `provider` field) — these are model-id
 *    namespaces like `meta-llama/`, `qwen/`, `amazon/` that can be hosted
 *    by multiple OpenRouter providers. They are stripped during canonicalization
 *    but produce no provider lock.
 *
 * The `openrouter/` prefix is special: it indicates the inner segment is a
 * full OpenRouter model id (`openrouter/<vendor>/<model>` or `openrouter/<lock-prefix>/<vendor>/<model>`),
 * and we recurse into the inner segment to detect any nested lock prefix.
 */
const PROVIDER_PREFIX_SPECS: GatewayProviderPrefixSpec[] = [
  // —— OpenRouter sub-channel locks ——
  { aliases: ["bedrock", "amazon-bedrock"], provider: "amazon-bedrock", order: ["amazon-bedrock"], only: ["amazon-bedrock"], allowFallbacks: false },
  { aliases: ["vertex", "google-vertex"], provider: "google-vertex", order: ["google-vertex"], only: ["google-vertex"], allowFallbacks: false },
  { aliases: ["google-ai-studio", "ai-studio"], provider: "google-ai-studio", order: ["google-ai-studio"], only: ["google-ai-studio"], allowFallbacks: false },
  // `google` is kept as a Vertex alias for backward compatibility.
  { aliases: ["google"], provider: "google-vertex", order: ["google-vertex"], only: ["google-vertex"], allowFallbacks: false },
  { aliases: ["anthropic"], provider: "anthropic", order: ["anthropic"], only: ["anthropic"], allowFallbacks: false },
  { aliases: ["openai"], provider: "openai", order: ["openai"], only: ["openai"], allowFallbacks: false },
  { aliases: ["azure"], provider: "azure", order: ["azure"], only: ["azure"], allowFallbacks: false },
  { aliases: ["x-ai", "xai"], provider: "x-ai", order: ["x-ai"], only: ["x-ai"], allowFallbacks: false },
  { aliases: ["groq"], provider: "groq", order: ["groq"], only: ["groq"], allowFallbacks: false },
  { aliases: ["cerebras"], provider: "cerebras", order: ["cerebras"], only: ["cerebras"], allowFallbacks: false },
  { aliases: ["fireworks"], provider: "fireworks", order: ["fireworks"], only: ["fireworks"], allowFallbacks: false },
  { aliases: ["together"], provider: "together", order: ["together"], only: ["together"], allowFallbacks: false },
  { aliases: ["deepinfra"], provider: "deepinfra", order: ["deepinfra"], only: ["deepinfra"], allowFallbacks: false },
  { aliases: ["nebius"], provider: "nebius", order: ["nebius"], only: ["nebius"], allowFallbacks: false },
  { aliases: ["novita", "novitaai"], provider: "novita", order: ["novita"], only: ["novita"], allowFallbacks: false },
  { aliases: ["mistral"], provider: "mistral", order: ["mistral"], only: ["mistral"], allowFallbacks: false },
  { aliases: ["cohere"], provider: "cohere", order: ["cohere"], only: ["cohere"], allowFallbacks: false },
  { aliases: ["perplexity"], provider: "perplexity", order: ["perplexity"], only: ["perplexity"], allowFallbacks: false },
  { aliases: ["deepseek"], provider: "deepseek", order: ["deepseek"], only: ["deepseek"], allowFallbacks: false },
  { aliases: ["moonshot", "moonshotai"], provider: "moonshot", order: ["moonshot"], only: ["moonshot"], allowFallbacks: false },
  { aliases: ["sambanova"], provider: "sambanova", order: ["sambanova"], only: ["sambanova"], allowFallbacks: false },
  { aliases: ["nvidia"], provider: "nvidia", order: ["nvidia"], only: ["nvidia"], allowFallbacks: false },
  { aliases: ["cloudflare"], provider: "cloudflare", order: ["cloudflare"], only: ["cloudflare"], allowFallbacks: false },
  { aliases: ["chutes"], provider: "chutes", order: ["chutes"], only: ["chutes"], allowFallbacks: false },
  { aliases: ["parasail"], provider: "parasail", order: ["parasail"], only: ["parasail"], allowFallbacks: false },
  { aliases: ["minimax"], provider: "minimax", order: ["minimax"], only: ["minimax"], allowFallbacks: false },
  { aliases: ["alibaba", "alibaba-cloud"], provider: "alibaba", order: ["alibaba"], only: ["alibaba"], allowFallbacks: false },
  { aliases: ["baidu", "baidu-qianfan"], provider: "baidu", order: ["baidu"], only: ["baidu"], allowFallbacks: false },

  // —— Vendor-only prefixes (model-id namespaces, no provider lock) ——
  { aliases: ["meta-llama", "meta", "llama"] },
  { aliases: ["mistralai"] },
  { aliases: ["qwen"] },
  { aliases: ["amazon"] },

  // —— OpenRouter pass-through (caller will recurse into the inner prefix) ——
  { aliases: ["openrouter"] },
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

function canonicalizeLogicalModel(model: string): string {
  const normalized = normalizePath(model).toLowerCase();
  if (!normalized) return normalized;

  if (normalized.startsWith("claude-")) {
    return normalized.replace(
      /^(claude-(?:opus|sonnet|haiku)-)(\d+)[._-](\d+)(.*)$/i,
      (_match, prefix: string, major: string, minor: string, suffix: string) => `${prefix}${major}.${minor}${suffix}`,
    );
  }

  return normalized;
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

function buildProviderRoute(prefix: string): GatewayProviderRoute | undefined {
  const spec = findProviderPrefixSpec(prefix);
  if (!spec?.provider) return undefined;

  return {
    prefix: prefix.toLowerCase(),
    provider: spec.provider,
    order: spec.order ? [...spec.order] : undefined,
    only: spec.only ? [...spec.only] : undefined,
    allowFallbacks: spec.allowFallbacks,
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
 * Merge request-supplied `provider` config with the model-prefix-derived route.
 *
 * Absolute-routing contract (see `docs/vendors/ROUTING_AUDIT.md`):
 *   When the model id carries a recognized lock prefix, the prefix wins:
 *     - `allowFallbacks` is forced to `false` regardless of what the client sent.
 *     - `only` is the **intersection** of the prefix `only` and any client-supplied
 *       `only`. If the client's `only` excludes the prefix's provider entirely,
 *       we still emit the prefix's `only` (the prefix is authoritative); the
 *       client's incompatible value is preserved in `raw` for audit.
 *     - `order` falls back to the prefix order if the client did not supply one.
 *
 * Anything not constrained by the prefix (e.g. `sort`, `data_collection`,
 * extra fields the client passed) is preserved as-is from the request.
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
    // Absolute lock from prefix — prefix always wins.
    if (route.only?.length) {
      const requestOnly = requestProvider?.only ?? [];
      if (requestOnly.length === 0) {
        merged.only = [...route.only];
      } else {
        const intersection = requestOnly.filter((slug) => route.only!.includes(slug));
        // If client's `only` is compatible with the prefix lock, keep the
        // intersection; otherwise the prefix wins outright.
        merged.only = intersection.length > 0 ? intersection : [...route.only];
      }
    }

    if (!merged.order?.length && route.order?.length) {
      merged.order = [...route.order];
    }

    // Forced — clients cannot relax fallbacks under a lock prefix.
    if (route.allowFallbacks === false) {
      merged.allowFallbacks = false;
    } else if (typeof merged.allowFallbacks !== "boolean" && typeof route.allowFallbacks === "boolean") {
      merged.allowFallbacks = route.allowFallbacks;
    }

    merged.routeLabel = route.provider;
  }

  merged.source = requestProvider
    ? (route ? "request+model-prefix" : "request")
    : (route ? "model-prefix" : undefined);

  if (requestProvider?.raw || route) {
    merged.raw = {
      ...(route ? { provider_route: route.provider, provider_prefix: route.prefix } : {}),
      ...(requestProvider?.raw ?? {}),
    };
  }

  return merged;
}
