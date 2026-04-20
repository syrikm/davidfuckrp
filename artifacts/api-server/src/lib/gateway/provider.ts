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

const KNOWN_VENDOR_PREFIXES = new Set([
  "anthropic",
  "google",
  "openai",
  "x-ai",
  "meta-llama",
  "deepseek",
  "qwen",
  "amazon",
  "cohere",
  "mistralai",
  "baidu",
]);

const PROVIDER_PREFIX_SPECS: GatewayProviderPrefixSpec[] = [
  {
    aliases: ["bedrock", "amazon-bedrock"],
    provider: "amazon-bedrock",
    order: ["amazon-bedrock"],
    only: ["amazon-bedrock"],
    allowFallbacks: false,
  },
  {
    aliases: ["vertex", "google-vertex"],
    provider: "google-vertex",
    order: ["google-vertex"],
    only: ["google-vertex"],
    allowFallbacks: false,
  },
  {
    aliases: ["google"],
    provider: "google-vertex",
    order: ["google-vertex"],
    only: ["google-vertex"],
    allowFallbacks: false,
  },
  {
    aliases: ["anthropic"],
    provider: "anthropic",
    order: ["anthropic"],
    only: ["anthropic"],
    allowFallbacks: false,
  },
  {
    aliases: ["openrouter"],
  },
];

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

  const segments = original.split("/");
  const prefixSpec = segments.length > 1 ? findProviderPrefixSpec(segments[0] ?? "") : undefined;
  const prefix = prefixSpec ? segments[0].toLowerCase() : undefined;
  const payload = prefix ? segments.slice(1).join("/") : original;

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

export function mergeGatewayProviderConfig(
  requestProvider: GatewayProviderConfig | undefined,
  modelResolution: GatewayModelResolution | undefined,
): GatewayProviderConfig | undefined {
  const route = modelResolution?.providerRoute;
  if (!requestProvider && !route) return undefined;

  const merged: GatewayProviderConfig = {
    ...(requestProvider ?? {}),
  };

  if (!merged.order?.length && route?.order?.length) {
    merged.order = [...route.order];
  }

  if (!merged.only?.length && route?.only?.length) {
    merged.only = [...route.only];
  }

  if (typeof merged.allowFallbacks !== "boolean" && typeof route?.allowFallbacks === "boolean") {
    merged.allowFallbacks = route.allowFallbacks;
  }

  if (route?.provider) {
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