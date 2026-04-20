import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type ModelModality =
  | "text"
  | "image"
  | "file"
  | "audio"
  | "video"
  | "embeddings"
  | "rerank";

export type RegistryAliasKind = "stable" | "friendly" | "versioned" | "legacy";

export interface OpenRouterModelArchitecture {
  modality?: string | null;
  tokenizer?: string | null;
  instruct_type?: string | null;
  input_modalities?: string[];
  output_modalities?: string[];
}

export interface OpenRouterModelPricingRaw {
  prompt?: string;
  completion?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  image?: string;
  image_output?: string;
  image_token?: string;
  audio?: string;
  audio_output?: string;
  input_audio_cache?: string;
  internal_reasoning?: string;
  request?: string;
  web_search?: string;
  discount?: number;
}

export interface OpenRouterPerRequestLimitsRaw {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}

export interface OpenRouterTopProviderRaw {
  context_length?: number | null;
  max_completion_tokens?: number | null;
  is_moderated?: boolean;
}

export interface OpenRouterModelRaw {
  id: string;
  canonical_slug?: string;
  name?: string;
  description?: string;
  created?: number;
  context_length?: number | null;
  architecture?: OpenRouterModelArchitecture;
  pricing?: OpenRouterModelPricingRaw;
  per_request_limits?: OpenRouterPerRequestLimitsRaw;
  supported_parameters?: string[];
  top_provider?: OpenRouterTopProviderRaw;
  knowledge_cutoff?: string | null;
  hugging_face_id?: string | null;
  expiration_date?: string | null;
  links?: {
    details?: string;
  };
}

export interface BuiltinModelAliasSet {
  stable: string[];
  friendly: string[];
  versioned: string[];
  legacy: string[];
}

export interface BuiltinModelCapabilities {
  chat: boolean;
  reasoning: boolean;
  tools: boolean;
  structured_outputs: boolean;
  prompt_caching: boolean;
  vision: boolean;
  web_search: boolean;
  streaming: boolean;
}

export interface BuiltinModelModalities {
  input: ModelModality[];
  output: ModelModality[];
}

export interface BuiltinModelContext {
  window_tokens: number | null;
  max_output_tokens: number | null;
}

export interface BuiltinModelPrice {
  input_per_mtok_usd: number | null;
  output_per_mtok_usd: number | null;
  cache_read_per_mtok_usd: number | null;
  cache_write_per_mtok_usd: number | null;
}

export interface BuiltinModelRouting {
  openrouter_slug?: string | null;
  preferred_providers?: string[];
}

export interface BuiltinModelMetadata {
  description?: string | null;
  release_channel?: string | null;
  stage?: string | null;
  first_party?: boolean;
  [key: string]: unknown;
}

export interface BuiltinRegistryEntry {
  id: string;
  provider: string;
  provider_family: string;
  canonical_id: string;
  display_name: string;
  aliases: BuiltinModelAliasSet;
  capabilities: BuiltinModelCapabilities;
  modalities: BuiltinModelModalities;
  context: BuiltinModelContext;
  price: BuiltinModelPrice;
  routing: BuiltinModelRouting;
  metadata: BuiltinModelMetadata;
}

export interface BuiltinRegistryDocument {
  version: number;
  generated_at: string;
  models: BuiltinRegistryEntry[];
}

export interface RemoteOverlayModel {
  id: string;
  canonical_id: string;
  provider: string;
  provider_family: string;
  display_name: string;
  description: string | null;
  created_at: number | null;
  knowledge_cutoff: string | null;
  expiration_date: string | null;
  hugging_face_id: string | null;
  capabilities: BuiltinModelCapabilities;
  modalities: BuiltinModelModalities;
  context: BuiltinModelContext;
  price: BuiltinModelPrice;
  routing: BuiltinModelRouting;
  metadata: Record<string, unknown>;
  aliases: string[];
  supported_parameters: string[];
  source: "openrouter";
}

export type RegistryInputOrigin = "mother_manual" | "child_manual_report" | "newapi_import";

export interface RegistrySupplementalModel {
  id: string;
  canonical_id?: string;
  display_name?: string | null;
  provider?: string;
  provider_family?: string;
  description?: string | null;
  aliases?: Partial<BuiltinModelAliasSet> | string[];
  context?: Partial<BuiltinModelContext>;
  price?: Partial<BuiltinModelPrice>;
  capabilities?: Partial<BuiltinModelCapabilities>;
  modalities?: Partial<BuiltinModelModalities>;
  routing?: BuiltinModelRouting;
  metadata?: Record<string, unknown>;
  source_metadata?: Record<string, unknown>;
  origin: RegistryInputOrigin;
  source: "manual";
}

export type ManualOverlayModel = RegistrySupplementalModel;

export interface UnifiedModelAliasConflict {
  alias: string;
  reason: "alias_conflict";
  existing_canonical_id: string;
  blocked_canonical_id: string;
  winning_source_rank: number;
  blocked_source_rank: number;
  blocked_origin?: RegistryInputOrigin;
}

export interface UnifiedModelSourceDescriptor {
  builtin: boolean;
  remote: boolean;
  manual: boolean;
  manual_scope?: "mother" | "child" | null;
  child_reported: boolean;
  newapi_imported: boolean;
  builtin_id?: string;
  remote_id?: string;
  manual_ids: string[];
  child_reported_ids: string[];
  newapi_import_ids: string[];
  child_node_ids: string[];
  source_rank: number;
  source_ids: string[];
  alias_conflicts: UnifiedModelAliasConflict[];
}

export interface UnifiedModelMergeInput {
  builtin?: BuiltinRegistryEntry;
  remote?: RemoteOverlayModel;
  motherManual?: RegistrySupplementalModel[];
  childReported?: RegistrySupplementalModel[];
  newapiImported?: RegistrySupplementalModel[];
}

export interface UnifiedModelView {
  id: string;
  provider: string;
  provider_family: string;
  canonical_id: string;
  display_name: string;
  description: string | null;
  aliases: BuiltinModelAliasSet;
  capabilities: BuiltinModelCapabilities;
  modalities: BuiltinModelModalities;
  context: BuiltinModelContext;
  price: BuiltinModelPrice;
  routing: BuiltinModelRouting;
  metadata: Record<string, unknown>;
  source: UnifiedModelSourceDescriptor;
}

export interface RegistryAliasMatch {
  canonical_id: string;
  alias: string;
  kind: RegistryAliasKind | "canonical";
  provider_prefix?: string;
}

export interface BuiltinRegistryIndex {
  document: BuiltinRegistryDocument;
  canonicalIndex: Map<string, BuiltinRegistryEntry>;
  aliasIndex: Map<string, RegistryAliasMatch>;
}

export interface UnifiedRegistryResult {
  map: Map<string, UnifiedModelView>;
  list: UnifiedModelView[];
}

export type RegistryModelPricing = BuiltinModelPrice;
export type RegistryModelLimits = {
  contextWindow: number | null;
  maxPromptTokens: number | null;
  maxCompletionTokens: number | null;
};
export type RegistryModelCapabilities = {
  supportsTextInput: boolean;
  supportsImageInput: boolean;
  supportsFileInput: boolean;
  supportsAudioInput: boolean;
  supportsVideoInput: boolean;
  supportsTextOutput: boolean;
  supportsImageOutput: boolean;
  supportsAudioOutput: boolean;
  supportsVideoOutput: boolean;
  supportsEmbeddingsOutput: boolean;
  supportsRerankOutput: boolean;
  supportsTools: boolean;
  supportsReasoning: boolean;
  supportsStructuredOutputs: boolean;
  supportsResponseFormat: boolean;
  supportsWebSearch: boolean;
  supportsParallelToolCalls: boolean;
  supportsPromptCaching: boolean | "implicit" | "explicit" | "unknown";
};

// 兼容旧调用方：第一阶段先保留这个别名，后续可逐步替换为 RemoteOverlayModel / UnifiedModelView。
export type RegistryModel = RemoteOverlayModel;

export type RegistryReadableModel =
  | UnifiedModelView
  | BuiltinRegistryEntry
  | RemoteOverlayModel
  | RegistrySupplementalModel;

export interface RegistryModelContextSummary {
  context_window: number | null;
  max_output_tokens: number | null;
}

export interface RegistryModelPricingSummary {
  input_per_mtok_usd: number | null;
  output_per_mtok_usd: number | null;
  cache_read_per_mtok_usd: number | null;
  cache_write_per_mtok_usd: number | null;
}

export interface RegistryModelCapabilitySummary {
  thinking: boolean | null;
  vision: boolean | null;
  code: boolean | null;
  tool_use: boolean | null;
  structured_output: boolean | null;
  web_search: boolean | null;
  streaming: boolean | null;
}

export interface RegistryModelModalitiesSummary {
  input: ModelModality[];
  output: ModelModality[];
}

const BUILTIN_REGISTRY_RELATIVE_CANDIDATES = [
  "../../../lib/models/registry.json",
  "../../lib/models/registry.json",
  "lib/models/registry.json",
] as const;

const PROVIDER_ROUTE_PREFIXES = new Set(["bedrock", "vertex", "anthropic", "google", "openrouter"]);

let builtinRegistryCache: BuiltinRegistryDocument | null = null;
let builtinRegistryIndexCache: BuiltinRegistryIndex | null = null;

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPerMillion(ratePerToken: unknown): number | null {
  const parsed = parseNumber(ratePerToken);
  if (parsed === null) return null;
  return parsed * 1_000_000;
}

function normalizeModalities(values: unknown): ModelModality[] {
  if (!Array.isArray(values)) return [];
  const normalized = new Set<ModelModality>();

  for (const value of values) {
    if (typeof value !== "string") continue;
    const modality = value.trim().toLowerCase();
    if (
      modality === "text" ||
      modality === "image" ||
      modality === "file" ||
      modality === "audio" ||
      modality === "video" ||
      modality === "embeddings" ||
      modality === "rerank"
    ) {
      normalized.add(modality);
    }
  }

  return [...normalized];
}

function dedupeStrings(values: Array<string | undefined | null>): string[] {
  return [
    ...new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  ];
}

function dedupeModalities(values: Array<ModelModality | undefined | null>): ModelModality[] {
  return [...new Set(values.filter((value): value is ModelModality => !!value))];
}

function inferProviderFamily(id: string, tokenizer?: string | null): string {
  const prefix = id.split("/")[0]?.trim().toLowerCase();
  if (prefix) return prefix;
  if (typeof tokenizer === "string" && tokenizer.trim()) return tokenizer.trim().toLowerCase();
  return "openrouter";
}

function buildCapabilities(model: OpenRouterModelRaw, inputModalities: ModelModality[], outputModalities: ModelModality[]): RegistryModelCapabilities {
  const supportedParameters = new Set((model.supported_parameters ?? []).map((value) => value.trim().toLowerCase()));
  const pricing = model.pricing ?? {};

  const hasCachePricing =
    parseNumber(pricing.input_cache_read) !== null ||
    parseNumber(pricing.input_cache_write) !== null ||
    parseNumber(pricing.input_audio_cache) !== null;

  return {
    supportsTextInput: inputModalities.includes("text") || inputModalities.length === 0,
    supportsImageInput: inputModalities.includes("image"),
    supportsFileInput: inputModalities.includes("file"),
    supportsAudioInput: inputModalities.includes("audio"),
    supportsVideoInput: inputModalities.includes("video"),

    supportsTextOutput: outputModalities.includes("text") || outputModalities.length === 0,
    supportsImageOutput: outputModalities.includes("image"),
    supportsAudioOutput: outputModalities.includes("audio"),
    supportsVideoOutput: outputModalities.includes("video"),
    supportsEmbeddingsOutput: outputModalities.includes("embeddings"),
    supportsRerankOutput: outputModalities.includes("rerank"),

    supportsTools: supportedParameters.has("tools") || supportedParameters.has("tool_choice"),
    supportsReasoning:
      supportedParameters.has("reasoning") ||
      supportedParameters.has("reasoning_effort") ||
      supportedParameters.has("include_reasoning") ||
      parseNumber(pricing.internal_reasoning) !== null,
    supportsStructuredOutputs: supportedParameters.has("structured_outputs"),
    supportsResponseFormat: supportedParameters.has("response_format"),
    supportsWebSearch: supportedParameters.has("web_search_options") || parseNumber(pricing.web_search) !== null,
    supportsParallelToolCalls: supportedParameters.has("parallel_tool_calls"),
    supportsPromptCaching: hasCachePricing ? "explicit" : "unknown",
  };
}

function toBuiltinCapabilities(capabilities: RegistryModelCapabilities): BuiltinModelCapabilities {
  return {
    chat: capabilities.supportsTextInput || capabilities.supportsTextOutput,
    reasoning: capabilities.supportsReasoning,
    tools: capabilities.supportsTools,
    structured_outputs: capabilities.supportsStructuredOutputs || capabilities.supportsResponseFormat,
    prompt_caching: capabilities.supportsPromptCaching === true || capabilities.supportsPromptCaching === "explicit" || capabilities.supportsPromptCaching === "implicit",
    vision: capabilities.supportsImageInput || capabilities.supportsImageOutput || capabilities.supportsVideoInput || capabilities.supportsVideoOutput,
    web_search: capabilities.supportsWebSearch,
    streaming: true,
  };
}

function toBuiltinModalities(input: ModelModality[], output: ModelModality[]): BuiltinModelModalities {
  return {
    input,
    output,
  };
}

function normalizeAliasKey(value: string): string {
  return value.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
}

function canonicalizeLogicalModel(model: string): string {
  const normalized = normalizeAliasKey(model);
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
  const normalized = normalizeAliasKey(model);
  if (!normalized) return normalized;

  const segments = normalized.split("/");
  if (segments.length <= 1) {
    return canonicalizeLogicalModel(normalized);
  }

  const provider = segments[0]!.toLowerCase();
  const logical = canonicalizeLogicalModel(segments.slice(1).join("/"));
  return `${provider}/${logical}`;
}

function createEmptyAliasSet(): BuiltinModelAliasSet {
  return {
    stable: [],
    friendly: [],
    versioned: [],
    legacy: [],
  };
}

function mergeAliasSets(...sets: Array<Partial<BuiltinModelAliasSet> | undefined>): BuiltinModelAliasSet {
  const merged = createEmptyAliasSet();
  for (const set of sets) {
    if (!set) continue;
    merged.stable = dedupeStrings([...merged.stable, ...(set.stable ?? [])]);
    merged.friendly = dedupeStrings([...merged.friendly, ...(set.friendly ?? [])]);
    merged.versioned = dedupeStrings([...merged.versioned, ...(set.versioned ?? [])]);
    merged.legacy = dedupeStrings([...merged.legacy, ...(set.legacy ?? [])]);
  }
  return merged;
}

const SOURCE_RANKS = {
  builtin: 500,
  remote: 400,
  mother_manual: 300,
  child_manual_report: 200,
  newapi_import: 100,
} as const;

function normalizeAliasSetLike(value?: Partial<BuiltinModelAliasSet> | string[]): BuiltinModelAliasSet {
  if (!value) return createEmptyAliasSet();
  if (Array.isArray(value)) {
    return {
      stable: dedupeStrings(value),
      friendly: [],
      versioned: [],
      legacy: [],
    };
  }
  return mergeAliasSets(value);
}

function pickFirstDefined<T>(values: Array<T | undefined | null>): T | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function mergeObjectRecords(
  ...records: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const record of records) {
    if (!record) continue;
    Object.assign(merged, record);
  }
  return merged;
}

function mergeCapabilities(
  builtin?: BuiltinModelCapabilities,
  remote?: BuiltinModelCapabilities,
  manual?: Partial<BuiltinModelCapabilities>,
): BuiltinModelCapabilities {
  return {
    chat: manual?.chat ?? remote?.chat ?? builtin?.chat ?? false,
    reasoning: manual?.reasoning ?? remote?.reasoning ?? builtin?.reasoning ?? false,
    tools: manual?.tools ?? remote?.tools ?? builtin?.tools ?? false,
    structured_outputs: manual?.structured_outputs ?? remote?.structured_outputs ?? builtin?.structured_outputs ?? false,
    prompt_caching: manual?.prompt_caching ?? remote?.prompt_caching ?? builtin?.prompt_caching ?? false,
    vision: manual?.vision ?? remote?.vision ?? builtin?.vision ?? false,
    web_search: manual?.web_search ?? remote?.web_search ?? builtin?.web_search ?? false,
    streaming: manual?.streaming ?? remote?.streaming ?? builtin?.streaming ?? false,
  };
}

function mergeModalities(
  builtin?: BuiltinModelModalities,
  remote?: BuiltinModelModalities,
  manual?: Partial<BuiltinModelModalities>,
): BuiltinModelModalities {
  return {
    input: dedupeModalities([...(builtin?.input ?? []), ...(remote?.input ?? []), ...(manual?.input ?? [])]),
    output: dedupeModalities([...(builtin?.output ?? []), ...(remote?.output ?? []), ...(manual?.output ?? [])]),
  };
}

function mergeContext(
  builtin?: BuiltinModelContext,
  remote?: BuiltinModelContext,
  manual?: Partial<BuiltinModelContext>,
): BuiltinModelContext {
  return {
    window_tokens: manual?.window_tokens ?? remote?.window_tokens ?? builtin?.window_tokens ?? null,
    max_output_tokens: manual?.max_output_tokens ?? remote?.max_output_tokens ?? builtin?.max_output_tokens ?? null,
  };
}

function mergePrice(
  builtin?: BuiltinModelPrice,
  remote?: BuiltinModelPrice,
  manual?: Partial<BuiltinModelPrice>,
): BuiltinModelPrice {
  return {
    input_per_mtok_usd: manual?.input_per_mtok_usd ?? remote?.input_per_mtok_usd ?? builtin?.input_per_mtok_usd ?? null,
    output_per_mtok_usd: manual?.output_per_mtok_usd ?? remote?.output_per_mtok_usd ?? builtin?.output_per_mtok_usd ?? null,
    cache_read_per_mtok_usd: manual?.cache_read_per_mtok_usd ?? remote?.cache_read_per_mtok_usd ?? builtin?.cache_read_per_mtok_usd ?? null,
    cache_write_per_mtok_usd: manual?.cache_write_per_mtok_usd ?? remote?.cache_write_per_mtok_usd ?? builtin?.cache_write_per_mtok_usd ?? null,
  };
}

function mergeRouting(
  builtin?: BuiltinModelRouting,
  remote?: BuiltinModelRouting,
  manual?: BuiltinModelRouting,
): BuiltinModelRouting {
  return {
    openrouter_slug: manual?.openrouter_slug ?? remote?.openrouter_slug ?? builtin?.openrouter_slug ?? null,
    preferred_providers: dedupeStrings([
      ...(builtin?.preferred_providers ?? []),
      ...(remote?.preferred_providers ?? []),
      ...(manual?.preferred_providers ?? []),
    ]),
  };
}

// phase-3：统一价格/能力读取层
function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMetadataRecord(model?: RegistryReadableModel | null): Record<string, unknown> {
  if (!model) return {};
  const metadata = "metadata" in model ? model.metadata : undefined;
  return metadata && typeof metadata === "object" ? metadata : {};
}

function readMetadataBoolean(metadata: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function inferVisionCapability(model?: RegistryReadableModel | null): boolean | null {
  if (!model) return null;
  const metadata = getMetadataRecord(model);
  const explicit = readMetadataBoolean(metadata, "vision", "supports_vision");
  if (explicit !== null) return explicit;

  if ("capabilities" in model && typeof model.capabilities?.vision === "boolean") {
    return model.capabilities.vision;
  }

  const modalities = getRegistryModelModalitiesSummary(model);
  if (
    modalities.input.includes("image") ||
    modalities.input.includes("video") ||
    modalities.output.includes("image") ||
    modalities.output.includes("video")
  ) {
    return true;
  }

  return null;
}

function inferCodeCapability(model?: RegistryReadableModel | null): boolean | null {
  if (!model) return null;
  const metadata = getMetadataRecord(model);

  const direct = readMetadataBoolean(
    metadata,
    "code",
    "coding",
    "supports_code",
    "code_generation",
  );
  if (direct !== null) return direct;

  const metadataCapabilities = metadata.capabilities;
  if (metadataCapabilities && typeof metadataCapabilities === "object") {
    const nested = readMetadataBoolean(metadataCapabilities as Record<string, unknown>, "code", "coding", "supports_code");
    if (nested !== null) return nested;
  }

  return null;
}

export function getRegistryModelContextSummary(model?: RegistryReadableModel | null): RegistryModelContextSummary {
  if (!model) {
    return {
      context_window: null,
      max_output_tokens: null,
    };
  }

  const context = "context" in model ? model.context : undefined;

  return {
    context_window: toNullableNumber(context?.window_tokens),
    max_output_tokens: toNullableNumber(context?.max_output_tokens),
  };
}

export function getRegistryModelContextWindow(model?: RegistryReadableModel | null): number | null {
  return getRegistryModelContextSummary(model).context_window;
}

export function getRegistryModelPricingSummary(model?: RegistryReadableModel | null): RegistryModelPricingSummary {
  if (!model) {
    return {
      input_per_mtok_usd: null,
      output_per_mtok_usd: null,
      cache_read_per_mtok_usd: null,
      cache_write_per_mtok_usd: null,
    };
  }

  const price = "price" in model ? model.price : undefined;

  return {
    input_per_mtok_usd: toNullableNumber(price?.input_per_mtok_usd),
    output_per_mtok_usd: toNullableNumber(price?.output_per_mtok_usd),
    cache_read_per_mtok_usd: toNullableNumber(price?.cache_read_per_mtok_usd),
    cache_write_per_mtok_usd: toNullableNumber(price?.cache_write_per_mtok_usd),
  };
}

export function getRegistryModelCachePricing(model?: RegistryReadableModel | null): Pick<
  RegistryModelPricingSummary,
  "cache_read_per_mtok_usd" | "cache_write_per_mtok_usd"
> {
  const pricing = getRegistryModelPricingSummary(model);
  return {
    cache_read_per_mtok_usd: pricing.cache_read_per_mtok_usd,
    cache_write_per_mtok_usd: pricing.cache_write_per_mtok_usd,
  };
}

export function getRegistryModelModalitiesSummary(model?: RegistryReadableModel | null): RegistryModelModalitiesSummary {
  if (!model) {
    return {
      input: [],
      output: [],
    };
  }

  const modalities = "modalities" in model ? model.modalities : undefined;

  return {
    input: normalizeModalities(modalities?.input),
    output: normalizeModalities(modalities?.output),
  };
}

export function getRegistryModelCapabilitiesSummary(model?: RegistryReadableModel | null): RegistryModelCapabilitySummary {
  if (!model) {
    return {
      thinking: null,
      vision: null,
      code: null,
      tool_use: null,
      structured_output: null,
      web_search: null,
      streaming: null,
    };
  }

  const metadata = getMetadataRecord(model);
  const capabilities = "capabilities" in model ? model.capabilities : undefined;

  return {
    thinking:
      readMetadataBoolean(metadata, "thinking", "reasoning", "supports_reasoning") ??
      (typeof capabilities?.reasoning === "boolean" ? capabilities.reasoning : null),
    vision: inferVisionCapability(model),
    code: inferCodeCapability(model),
    tool_use:
      readMetadataBoolean(metadata, "tool_use", "tools", "supports_tools") ??
      (typeof capabilities?.tools === "boolean" ? capabilities.tools : null),
    structured_output:
      readMetadataBoolean(metadata, "structured_output", "structured_outputs", "supports_structured_output") ??
      (typeof capabilities?.structured_outputs === "boolean" ? capabilities.structured_outputs : null),
    web_search:
      readMetadataBoolean(metadata, "web_search", "supports_web_search") ??
      (typeof capabilities?.web_search === "boolean" ? capabilities.web_search : null),
    streaming:
      readMetadataBoolean(metadata, "streaming", "supports_streaming") ??
      (typeof capabilities?.streaming === "boolean" ? capabilities.streaming : null),
  };
}

function resolveBuiltinRegistryPath(): string {
  const runtimeDir = typeof __dirname === "string" ? __dirname : process.cwd();

  for (const candidate of BUILTIN_REGISTRY_RELATIVE_CANDIDATES) {
    const absolute = path.resolve(runtimeDir, candidate);
    if (existsSync(absolute)) return absolute;
  }

  const cwdCandidate = path.resolve(process.cwd(), "lib/models/registry.json");
  if (existsSync(cwdCandidate)) return cwdCandidate;

  throw new Error("Builtin model registry not found. Phase-1 skeleton expects lib/models/registry.json to be present.");
}

export function loadBuiltinModelRegistry(forceReload = false): BuiltinRegistryDocument {
  if (!forceReload && builtinRegistryCache) return builtinRegistryCache;

  const registryPath = resolveBuiltinRegistryPath();
  const raw = readFileSync(registryPath, "utf8");
  const parsed = JSON.parse(raw) as BuiltinRegistryDocument;

  builtinRegistryCache = parsed;
  return parsed;
}

export function buildBuiltinRegistryIndex(document = loadBuiltinModelRegistry()): BuiltinRegistryIndex {
  const canReuseCache = builtinRegistryCache === document;
  if (canReuseCache && builtinRegistryIndexCache) return builtinRegistryIndexCache;

  const canonicalIndex = new Map<string, BuiltinRegistryEntry>();
  const aliasIndex = new Map<string, RegistryAliasMatch>();

  for (const model of document.models) {
    const canonicalId = canonicalizeModelIdentifier(model.canonical_id || model.id);
    canonicalIndex.set(canonicalId, { ...model, canonical_id: canonicalId });

    const canonicalKey = normalizeAliasKey(canonicalId);
    aliasIndex.set(canonicalKey, {
      canonical_id: canonicalId,
      alias: canonicalId,
      kind: "canonical",
    });

    const aliasKinds: RegistryAliasKind[] = ["stable", "friendly", "versioned", "legacy"];
    for (const kind of aliasKinds) {
      for (const alias of model.aliases[kind] ?? []) {
        const key = normalizeAliasKey(alias);
        if (!key) continue;
        aliasIndex.set(key, {
          canonical_id: canonicalId,
          alias,
          kind,
        });
      }
    }
  }

  const built = { document, canonicalIndex, aliasIndex };
  if (canReuseCache) builtinRegistryIndexCache = built;
  return built;
}

export function getBuiltinRegistryIndex(forceReload = false): BuiltinRegistryIndex {
  if (forceReload) {
    builtinRegistryCache = null;
    builtinRegistryIndexCache = null;
  }
  const document = loadBuiltinModelRegistry(forceReload);
  return buildBuiltinRegistryIndex(document);
}

// Strip known decorator suffixes from model names so alias resolution finds the
// canonical model regardless of whether the caller appended -thinking, -max, etc.
// Order matters: strip from longest suffix to shortest to avoid partial matches.
const DECORATOR_SUFFIXES = [
  "-thinking-visible",
  "-thinking",
  "-max",
] as const;

function stripReservedDecoratorSuffix(rawModel: string): { base: string; decorators: string[] } {
  let base = rawModel.toLowerCase().trim();
  const decorators: string[] = [];

  // Iterate up to N times to handle stacked suffixes (e.g. -thinking-max)
  for (let iter = 0; iter < DECORATOR_SUFFIXES.length; iter++) {
    let matched = false;
    for (const suffix of DECORATOR_SUFFIXES) {
      if (base.endsWith(suffix)) {
        decorators.unshift(suffix.slice(1)); // strip leading dash
        base = base.slice(0, base.length - suffix.length);
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }

  return { base: rawModel.slice(0, base.length) || rawModel, decorators };
}

export function resolveRegistryAlias(
  model: string,
  index = getBuiltinRegistryIndex(),
  extraAliases?: Map<string, RegistryAliasMatch>,
): RegistryAliasMatch | null {
  const stripped = stripReservedDecoratorSuffix(model);
  const normalized = canonicalizeModelIdentifier(stripped.base);
  if (!normalized) return null;

  const direct = extraAliases?.get(normalized) ?? index.aliasIndex.get(normalized);
  if (direct) return direct;

  const segments = normalized.split("/");
  if (segments.length > 1 && PROVIDER_ROUTE_PREFIXES.has(segments[0]!)) {
    const providerPrefix = segments[0]!;
    const remainder = canonicalizeLogicalModel(segments.slice(1).join("/"));
    const prefixed = extraAliases?.get(remainder) ?? index.aliasIndex.get(remainder);
    if (prefixed) {
      return {
        ...prefixed,
        provider_prefix: providerPrefix,
      };
    }
  }

  return null;
}

export function normalizeOpenRouterModel(model: OpenRouterModelRaw): RemoteOverlayModel {
  const architecture = model.architecture ?? {};
  const inputModalities = normalizeModalities(architecture.input_modalities);
  const outputModalities = normalizeModalities(architecture.output_modalities);

  const canonicalSlug = (model.canonical_slug ?? model.id ?? "").trim();
  const id = (model.id ?? canonicalSlug).trim();
  const tokenizerGroup = typeof architecture.tokenizer === "string" ? architecture.tokenizer.trim() || null : null;
  const providerFamily = inferProviderFamily(id, tokenizerGroup);

  const pricingRaw = model.pricing ?? {};
  const canonicalId = canonicalizeModelIdentifier(canonicalSlug || id);
  const aliases = dedupeStrings([
    id,
    canonicalSlug,
    model.name,
    id.split("/")[1],
    canonicalSlug.split("/")[1],
  ]);

  return {
    id,
    canonical_id: canonicalId,
    provider: providerFamily,
    provider_family: providerFamily,
    display_name: (model.name ?? id).trim(),
    description: model.description ?? null,
    created_at: typeof model.created === "number" ? model.created : null,
    knowledge_cutoff: model.knowledge_cutoff ?? null,
    expiration_date: model.expiration_date ?? null,
    hugging_face_id: model.hugging_face_id ?? null,
    capabilities: toBuiltinCapabilities(buildCapabilities(model, inputModalities, outputModalities)),
    modalities: toBuiltinModalities(inputModalities, outputModalities),
    context: {
      window_tokens: typeof model.context_length === "number"
        ? model.context_length
        : (typeof model.top_provider?.context_length === "number" ? model.top_provider.context_length : null),
      max_output_tokens: typeof model.per_request_limits?.completion_tokens === "number"
        ? model.per_request_limits.completion_tokens
        : (typeof model.top_provider?.max_completion_tokens === "number" ? model.top_provider.max_completion_tokens : null),
    },
    price: {
      input_per_mtok_usd: toPerMillion(pricingRaw.prompt),
      output_per_mtok_usd: toPerMillion(pricingRaw.completion),
      cache_read_per_mtok_usd: toPerMillion(pricingRaw.input_cache_read),
      cache_write_per_mtok_usd: toPerMillion(pricingRaw.input_cache_write),
    },
    routing: {
      openrouter_slug: id,
    },
    metadata: {
      tokenizer_group: tokenizerGroup,
      instruct_type: typeof architecture.instruct_type === "string" ? architecture.instruct_type.trim() || null : null,
      primary_modality: typeof architecture.modality === "string" ? architecture.modality.trim() || null : null,
      supported_parameters: dedupeStrings(model.supported_parameters ?? []),
      details_url: model.links?.details ?? null,
      knowledge_cutoff: model.knowledge_cutoff ?? null,
      expiration_date: model.expiration_date ?? null,
      hugging_face_id: model.hugging_face_id ?? null,
      description: model.description ?? null,
    },
    aliases,
    supported_parameters: dedupeStrings(model.supported_parameters ?? []),
    source: "openrouter",
  };
}

export function normalizeOpenRouterModels(models: OpenRouterModelRaw[]): RemoteOverlayModel[] {
  return models.map(normalizeOpenRouterModel);
}

function remoteAliasesToAliasSet(remote: RemoteOverlayModel): BuiltinModelAliasSet {
  return {
    stable: dedupeStrings(remote.aliases),
    friendly: [],
    versioned: remote.routing.openrouter_slug ? [remote.routing.openrouter_slug] : [],
    legacy: [],
  };
}

function manualAliasesToAliasSet(manual: RegistrySupplementalModel): BuiltinModelAliasSet {
  return mergeAliasSets(
    {
      stable: [manual.id, manual.canonical_id ?? manual.id],
      friendly: [],
      versioned: [],
      legacy: [],
    },
    normalizeAliasSetLike(manual.aliases),
  );
}

function mergeCapabilitiesByPriority(
  builtin?: BuiltinModelCapabilities,
  remote?: BuiltinModelCapabilities,
  motherManual: RegistrySupplementalModel[] = [],
  childReported: RegistrySupplementalModel[] = [],
  newapiImported: RegistrySupplementalModel[] = [],
): BuiltinModelCapabilities {
  return {
    chat: pickFirstDefined([
      ...motherManual.map((entry) => entry.capabilities?.chat),
      builtin?.chat,
      remote?.chat,
      ...childReported.map((entry) => entry.capabilities?.chat),
      ...newapiImported.map((entry) => entry.capabilities?.chat),
      false,
    ]) ?? false,
    reasoning: pickFirstDefined([
      ...motherManual.map((entry) => entry.capabilities?.reasoning),
      builtin?.reasoning,
      remote?.reasoning,
      ...childReported.map((entry) => entry.capabilities?.reasoning),
      ...newapiImported.map((entry) => entry.capabilities?.reasoning),
      false,
    ]) ?? false,
    tools: pickFirstDefined([
      ...motherManual.map((entry) => entry.capabilities?.tools),
      builtin?.tools,
      remote?.tools,
      ...childReported.map((entry) => entry.capabilities?.tools),
      ...newapiImported.map((entry) => entry.capabilities?.tools),
      false,
    ]) ?? false,
    structured_outputs: pickFirstDefined([
      ...motherManual.map((entry) => entry.capabilities?.structured_outputs),
      builtin?.structured_outputs,
      remote?.structured_outputs,
      ...childReported.map((entry) => entry.capabilities?.structured_outputs),
      ...newapiImported.map((entry) => entry.capabilities?.structured_outputs),
      false,
    ]) ?? false,
    prompt_caching: pickFirstDefined([
      ...motherManual.map((entry) => entry.capabilities?.prompt_caching),
      builtin?.prompt_caching,
      remote?.prompt_caching,
      ...childReported.map((entry) => entry.capabilities?.prompt_caching),
      ...newapiImported.map((entry) => entry.capabilities?.prompt_caching),
      false,
    ]) ?? false,
    vision: pickFirstDefined([
      ...motherManual.map((entry) => entry.capabilities?.vision),
      builtin?.vision,
      remote?.vision,
      ...childReported.map((entry) => entry.capabilities?.vision),
      ...newapiImported.map((entry) => entry.capabilities?.vision),
      false,
    ]) ?? false,
    web_search: pickFirstDefined([
      ...motherManual.map((entry) => entry.capabilities?.web_search),
      builtin?.web_search,
      remote?.web_search,
      ...childReported.map((entry) => entry.capabilities?.web_search),
      ...newapiImported.map((entry) => entry.capabilities?.web_search),
      false,
    ]) ?? false,
    streaming: pickFirstDefined([
      ...motherManual.map((entry) => entry.capabilities?.streaming),
      builtin?.streaming,
      remote?.streaming,
      ...childReported.map((entry) => entry.capabilities?.streaming),
      ...newapiImported.map((entry) => entry.capabilities?.streaming),
      false,
    ]) ?? false,
  };
}

function mergeModalitiesByPriority(
  builtin?: BuiltinModelModalities,
  remote?: BuiltinModelModalities,
  motherManual: RegistrySupplementalModel[] = [],
  childReported: RegistrySupplementalModel[] = [],
  newapiImported: RegistrySupplementalModel[] = [],
): BuiltinModelModalities {
  return {
    input: dedupeModalities([
      ...(motherManual.flatMap((entry) => entry.modalities?.input ?? [])),
      ...(builtin?.input ?? []),
      ...(remote?.input ?? []),
      ...(childReported.flatMap((entry) => entry.modalities?.input ?? [])),
      ...(newapiImported.flatMap((entry) => entry.modalities?.input ?? [])),
    ]),
    output: dedupeModalities([
      ...(motherManual.flatMap((entry) => entry.modalities?.output ?? [])),
      ...(builtin?.output ?? []),
      ...(remote?.output ?? []),
      ...(childReported.flatMap((entry) => entry.modalities?.output ?? [])),
      ...(newapiImported.flatMap((entry) => entry.modalities?.output ?? [])),
    ]),
  };
}

function mergeContextByPriority(
  builtin?: BuiltinModelContext,
  remote?: BuiltinModelContext,
  motherManual: RegistrySupplementalModel[] = [],
  childReported: RegistrySupplementalModel[] = [],
  newapiImported: RegistrySupplementalModel[] = [],
): BuiltinModelContext {
  return {
    window_tokens: pickFirstDefined([
      ...motherManual.map((entry) => entry.context?.window_tokens),
      builtin?.window_tokens,
      remote?.window_tokens,
      ...childReported.map((entry) => entry.context?.window_tokens),
      ...newapiImported.map((entry) => entry.context?.window_tokens),
      null,
    ]) ?? null,
    max_output_tokens: pickFirstDefined([
      ...motherManual.map((entry) => entry.context?.max_output_tokens),
      builtin?.max_output_tokens,
      remote?.max_output_tokens,
      ...childReported.map((entry) => entry.context?.max_output_tokens),
      ...newapiImported.map((entry) => entry.context?.max_output_tokens),
      null,
    ]) ?? null,
  };
}

function mergePriceByPriority(
  builtin?: BuiltinModelPrice,
  remote?: BuiltinModelPrice,
  motherManual: RegistrySupplementalModel[] = [],
  childReported: RegistrySupplementalModel[] = [],
  newapiImported: RegistrySupplementalModel[] = [],
): BuiltinModelPrice {
  return {
    input_per_mtok_usd: pickFirstDefined([
      ...motherManual.map((entry) => entry.price?.input_per_mtok_usd),
      builtin?.input_per_mtok_usd,
      remote?.input_per_mtok_usd,
      ...childReported.map((entry) => entry.price?.input_per_mtok_usd),
      ...newapiImported.map((entry) => entry.price?.input_per_mtok_usd),
      null,
    ]) ?? null,
    output_per_mtok_usd: pickFirstDefined([
      ...motherManual.map((entry) => entry.price?.output_per_mtok_usd),
      builtin?.output_per_mtok_usd,
      remote?.output_per_mtok_usd,
      ...childReported.map((entry) => entry.price?.output_per_mtok_usd),
      ...newapiImported.map((entry) => entry.price?.output_per_mtok_usd),
      null,
    ]) ?? null,
    cache_read_per_mtok_usd: pickFirstDefined([
      ...motherManual.map((entry) => entry.price?.cache_read_per_mtok_usd),
      builtin?.cache_read_per_mtok_usd,
      remote?.cache_read_per_mtok_usd,
      ...childReported.map((entry) => entry.price?.cache_read_per_mtok_usd),
      ...newapiImported.map((entry) => entry.price?.cache_read_per_mtok_usd),
      null,
    ]) ?? null,
    cache_write_per_mtok_usd: pickFirstDefined([
      ...motherManual.map((entry) => entry.price?.cache_write_per_mtok_usd),
      builtin?.cache_write_per_mtok_usd,
      remote?.cache_write_per_mtok_usd,
      ...childReported.map((entry) => entry.price?.cache_write_per_mtok_usd),
      ...newapiImported.map((entry) => entry.price?.cache_write_per_mtok_usd),
      null,
    ]) ?? null,
  };
}

function mergeRoutingByPriority(
  builtin?: BuiltinModelRouting,
  remote?: BuiltinModelRouting,
  motherManual: RegistrySupplementalModel[] = [],
  childReported: RegistrySupplementalModel[] = [],
  newapiImported: RegistrySupplementalModel[] = [],
): BuiltinModelRouting {
  return {
    openrouter_slug: pickFirstDefined([
      ...motherManual.map((entry) => entry.routing?.openrouter_slug),
      builtin?.openrouter_slug,
      remote?.openrouter_slug,
      ...childReported.map((entry) => entry.routing?.openrouter_slug),
      ...newapiImported.map((entry) => entry.routing?.openrouter_slug),
      null,
    ]) ?? null,
    preferred_providers: dedupeStrings([
      ...(motherManual.flatMap((entry) => entry.routing?.preferred_providers ?? [])),
      ...(builtin?.preferred_providers ?? []),
      ...(remote?.preferred_providers ?? []),
      ...(childReported.flatMap((entry) => entry.routing?.preferred_providers ?? [])),
      ...(newapiImported.flatMap((entry) => entry.routing?.preferred_providers ?? [])),
    ]),
  };
}

function collectChildNodeIds(entries: RegistrySupplementalModel[]): string[] {
  return dedupeStrings(entries.map((entry) => {
    const raw = entry.source_metadata?.node_id;
    return typeof raw === "string" ? raw : null;
  }));
}

function sourceRankForInput(input: UnifiedModelMergeInput): number {
  if (input.builtin) return SOURCE_RANKS.builtin;
  if (input.remote) return SOURCE_RANKS.remote;
  if ((input.motherManual?.length ?? 0) > 0) return SOURCE_RANKS.mother_manual;
  if ((input.childReported?.length ?? 0) > 0) return SOURCE_RANKS.child_manual_report;
  if ((input.newapiImported?.length ?? 0) > 0) return SOURCE_RANKS.newapi_import;
  return 0;
}

export function mergeUnifiedModel(input: UnifiedModelMergeInput): UnifiedModelView {
  const motherManual = input.motherManual ?? [];
  const childReported = input.childReported ?? [];
  const newapiImported = input.newapiImported ?? [];
  const builtin = input.builtin;
  const remote = input.remote;

  const canonicalId = canonicalizeModelIdentifier(
    builtin?.canonical_id ??
      remote?.canonical_id ??
      motherManual.find((entry) => entry.canonical_id)?.canonical_id ??
      childReported.find((entry) => entry.canonical_id)?.canonical_id ??
      newapiImported.find((entry) => entry.canonical_id)?.canonical_id ??
      builtin?.id ??
      remote?.id ??
      motherManual[0]?.id ??
      childReported[0]?.id ??
      newapiImported[0]?.id ??
      "",
  );
  const builtinDescription = typeof builtin?.metadata?.description === "string" ? builtin.metadata.description : null;

  return {
    id: canonicalId,
    provider:
      builtin?.provider ??
      remote?.provider ??
      motherManual.find((entry) => entry.provider)?.provider ??
      "unknown",
    provider_family:
      builtin?.provider_family ??
      remote?.provider_family ??
      motherManual.find((entry) => entry.provider_family)?.provider_family ??
      "unknown",
    canonical_id: canonicalId,
    display_name:
      pickFirstDefined([
        ...motherManual.map((entry) => entry.display_name),
        builtin?.display_name,
        remote?.display_name,
        ...childReported.map((entry) => entry.display_name),
        ...newapiImported.map((entry) => entry.display_name),
      ]) ?? canonicalId,
    description:
      pickFirstDefined([
        ...motherManual.map((entry) => entry.description),
        remote?.description,
        builtinDescription,
        ...childReported.map((entry) => entry.description),
        ...newapiImported.map((entry) => entry.description),
      ]) ?? null,
    aliases: mergeAliasSets(
      builtin?.aliases,
      remote ? remoteAliasesToAliasSet(remote) : undefined,
      ...motherManual.map(manualAliasesToAliasSet),
      ...childReported.map(manualAliasesToAliasSet),
      ...newapiImported.map(manualAliasesToAliasSet),
    ),
    capabilities: mergeCapabilitiesByPriority(builtin?.capabilities, remote?.capabilities, motherManual, childReported, newapiImported),
    modalities: mergeModalitiesByPriority(builtin?.modalities, remote?.modalities, motherManual, childReported, newapiImported),
    context: mergeContextByPriority(builtin?.context, remote?.context, motherManual, childReported, newapiImported),
    price: mergePriceByPriority(builtin?.price, remote?.price, motherManual, childReported, newapiImported),
    routing: mergeRoutingByPriority(builtin?.routing, remote?.routing, motherManual, childReported, newapiImported),
    metadata: mergeObjectRecords(
      builtin?.metadata,
      remote?.metadata,
      ...newapiImported.map((entry) => mergeObjectRecords(entry.metadata, entry.source_metadata ? { source_metadata: entry.source_metadata } : undefined)),
      ...childReported.map((entry) => mergeObjectRecords(entry.metadata, entry.source_metadata ? { source_metadata: entry.source_metadata } : undefined)),
      ...motherManual.map((entry) => mergeObjectRecords(entry.metadata, entry.source_metadata ? { source_metadata: entry.source_metadata } : undefined)),
    ),
    source: {
      builtin: !!builtin,
      remote: !!remote,
      manual: motherManual.length > 0 || childReported.length > 0 || newapiImported.length > 0,
      manual_scope: motherManual.length > 0 ? "mother" : (childReported.length > 0 ? "child" : null),
      child_reported: childReported.length > 0,
      newapi_imported: newapiImported.length > 0,
      ...(builtin ? { builtin_id: builtin.id } : {}),
      ...(remote ? { remote_id: remote.id } : {}),
      manual_ids: dedupeStrings([
        ...motherManual.map((entry) => entry.id),
        ...childReported.map((entry) => entry.id),
        ...newapiImported.map((entry) => entry.id),
      ]),
      child_reported_ids: dedupeStrings(childReported.map((entry) => entry.id)),
      newapi_import_ids: dedupeStrings(newapiImported.map((entry) => entry.id)),
      child_node_ids: collectChildNodeIds(childReported),
      source_rank: sourceRankForInput(input),
      source_ids: dedupeStrings([
        ...(builtin ? [`builtin:${builtin.id}`] : []),
        ...(remote ? [`remote:${remote.id}`] : []),
        ...motherManual.map((entry) => `manual:${entry.id}`),
        ...childReported.map((entry) => `child_reported:${entry.id}`),
        ...newapiImported.map((entry) => `newapi_imported:${entry.id}`),
      ]),
      alias_conflicts: [],
    },
  };
}

export function buildUnifiedRegistryAliasIndex(
  models: Iterable<UnifiedModelView>,
  conflictCollector?: Map<string, UnifiedModelAliasConflict[]>,
): Map<string, RegistryAliasMatch> {
  const aliasIndex = new Map<string, RegistryAliasMatch>();

  const sortedModels = [...models].sort((left, right) => {
    if (right.source.source_rank !== left.source.source_rank) {
      return right.source.source_rank - left.source.source_rank;
    }
    return left.canonical_id.localeCompare(right.canonical_id);
  });

  for (const model of sortedModels) {
    const canonicalId = canonicalizeModelIdentifier(model.canonical_id || model.id);
    const canonicalKey = normalizeAliasKey(canonicalId);

    aliasIndex.set(canonicalKey, {
      canonical_id: canonicalId,
      alias: canonicalId,
      kind: "canonical",
    });

    const aliasKinds: RegistryAliasKind[] = ["stable", "friendly", "versioned", "legacy"];
    for (const kind of aliasKinds) {
      for (const alias of model.aliases[kind] ?? []) {
        const key = normalizeAliasKey(alias);
        if (!key) continue;

        const existing = aliasIndex.get(key);
        if (existing && existing.canonical_id !== canonicalId) {
          if (conflictCollector) {
            const nextConflict: UnifiedModelAliasConflict = {
              alias,
              reason: "alias_conflict",
              existing_canonical_id: existing.canonical_id,
              blocked_canonical_id: canonicalId,
              winning_source_rank: sortedModels.find((entry) => entry.canonical_id === existing.canonical_id)?.source.source_rank ?? 0,
              blocked_source_rank: model.source.source_rank,
              blocked_origin: model.source.newapi_imported
                ? "newapi_import"
                : (model.source.child_reported ? "child_manual_report" : (model.source.manual_scope === "mother" ? "mother_manual" : undefined)),
            };
            const conflicts = conflictCollector.get(canonicalId) ?? [];
            conflicts.push(nextConflict);
            conflictCollector.set(canonicalId, conflicts);
          }
          continue;
        }

        aliasIndex.set(key, {
          canonical_id: canonicalId,
          alias,
          kind,
        });
      }
    }
  }

  return aliasIndex;
}

export function resolveUnifiedRegistryAlias(
  model: string,
  models: Iterable<UnifiedModelView>,
  builtinIndex = getBuiltinRegistryIndex(),
): RegistryAliasMatch | null {
  return resolveRegistryAlias(model, builtinIndex, buildUnifiedRegistryAliasIndex(models));
}

export function buildUnifiedModelRegistry(
  builtinEntries: BuiltinRegistryEntry[],
  remoteEntries: RemoteOverlayModel[],
  motherManualEntries: RegistrySupplementalModel[] = [],
  childReportedEntries: RegistrySupplementalModel[] = [],
  newapiImportedEntries: RegistrySupplementalModel[] = [],
): UnifiedRegistryResult {
  const unifiedMap = new Map<string, UnifiedModelView>();
  const builtinByCanonical = new Map<string, BuiltinRegistryEntry>();
  const remoteByCanonical = new Map<string, RemoteOverlayModel>();
  const motherByCanonical = new Map<string, RegistrySupplementalModel[]>();
  const childByCanonical = new Map<string, RegistrySupplementalModel[]>();
  const newapiByCanonical = new Map<string, RegistrySupplementalModel[]>();

  const pushGrouped = (
    target: Map<string, RegistrySupplementalModel[]>,
    entry: RegistrySupplementalModel,
  ): void => {
    const canonicalId = canonicalizeModelIdentifier(entry.canonical_id || entry.id);
    const grouped = target.get(canonicalId) ?? [];
    grouped.push({ ...entry, canonical_id: canonicalId });
    target.set(canonicalId, grouped);
  };

  for (const builtin of builtinEntries) {
    const canonicalId = canonicalizeModelIdentifier(builtin.canonical_id || builtin.id);
    builtinByCanonical.set(canonicalId, { ...builtin, canonical_id: canonicalId });
  }

  for (const remote of remoteEntries) {
    const canonicalId = canonicalizeModelIdentifier(remote.canonical_id || remote.id);
    remoteByCanonical.set(canonicalId, { ...remote, canonical_id: canonicalId });
  }

  for (const manual of motherManualEntries) pushGrouped(motherByCanonical, manual);
  for (const child of childReportedEntries) pushGrouped(childByCanonical, child);
  for (const imported of newapiImportedEntries) pushGrouped(newapiByCanonical, imported);

  const allCanonicalIds = new Set<string>([
    ...builtinByCanonical.keys(),
    ...remoteByCanonical.keys(),
    ...motherByCanonical.keys(),
    ...childByCanonical.keys(),
    ...newapiByCanonical.keys(),
  ]);

  for (const canonicalId of allCanonicalIds) {
    unifiedMap.set(canonicalId, mergeUnifiedModel({
      builtin: builtinByCanonical.get(canonicalId),
      remote: remoteByCanonical.get(canonicalId),
      motherManual: motherByCanonical.get(canonicalId),
      childReported: childByCanonical.get(canonicalId),
      newapiImported: newapiByCanonical.get(canonicalId),
    }));
  }

  const conflictCollector = new Map<string, UnifiedModelAliasConflict[]>();
  buildUnifiedRegistryAliasIndex(unifiedMap.values(), conflictCollector);

  for (const [canonicalId, conflicts] of conflictCollector.entries()) {
    const current = unifiedMap.get(canonicalId);
    if (!current) continue;
    unifiedMap.set(canonicalId, {
      ...current,
      source: {
        ...current.source,
        alias_conflicts: conflicts,
      },
    });
  }

  return {
    map: unifiedMap,
    list: [...unifiedMap.values()],
  };
}

export function getBuiltinRegistryEntries(forceReload = false): BuiltinRegistryEntry[] {
  return getBuiltinRegistryIndex(forceReload).document.models;
}