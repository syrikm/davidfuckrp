import { EventEmitter } from "events";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { readJson, writeJson } from "../lib/cloudPersist";
import { gatewayConfig, gatewayTimeoutOverrides } from "../lib/gatewayConfig";
import {
  deleteManualModelStoreEntry,
  readManualModelStore,
  upsertManualModelStoreEntry,
  writeManualModelStore,
} from "../lib/manualModelStore";
import {
  buildBackendPool,
  filterBackendPoolByProvider,
  deriveApiBaseUrl,
  derivePublicBaseUrl,
  getAllFriendProxyConfigs,
  getCachedHealth,
  getDynamicBackendsSnapshot,
  getFriendProxyConfigs,
  getProxyApiKey,
  getRegisteredNodesSnapshot,
  heartbeatNode,
  loadDynamicBackends,
  markUnhealthy,
  normalizeSubNodeUrl,
  probeAndSetHealth,
  registerOrUpdateNode,
  saveDynamicBackends,
  setDynamicBackends,
  setHealth,
} from "../lib/backendPool";
import { getSillyTavernMode } from "./settings";
import {
  hashRequest, cacheGet, cacheSet, getCacheStats,
  setCacheEnabled, setCacheTtl, setCacheMaxEntries, cacheClear,
  markInflight, waitForInflight,
} from "../lib/responseCache";
import {
  buildPromptToolsInstruction,
  parsePromptToolsResponse,
  buildCompletionFromPromptTools,
  type PromptTool,
} from "../lib/promptTools";
import {
  isModelEnabled, disableModel, enableModel,
  getDisabledModels,
} from "../lib/unifiedModelManager";
import {
  buildUnifiedModelRegistry,
  getBuiltinRegistryEntries,
  getRegistryModelCapabilitiesSummary,
  getRegistryModelContextSummary,
  getRegistryModelModalitiesSummary,
  getRegistryModelPricingSummary,
  normalizeOpenRouterModel,
  resolveUnifiedRegistryAlias,
  type BuiltinRegistryEntry,
  type ManualOverlayModel,
  type OpenRouterModelRaw,
  type RegistryInputOrigin,
  type RegistryModel,
  type RegistryModelPricingSummary,
  type RegistrySupplementalModel,
  type RemoteOverlayModel,
  type UnifiedModelView,
} from "../lib/modelRegistry";
import {
  buildGatewayBridgeRequest,
  buildOpenRouterRequest,
  detectAbsoluteProviderRoute,
  detectGatewayProtocol,
  executeGatewayRequest,
  listAbsoluteProviderPrefixAliases,
  normalizeGatewayRequest,
  sanitizeClaudeSamplingParams,
  summarizeIR,
} from "../lib/gateway";
import type { GatewayProviderRoute } from "../lib/gateway";

// TS compatibility shim for this artifact build target.
declare const fetch: any;
declare const AbortSignal: any;
declare const AbortController: any;
declare const setInterval: any;
declare const setTimeout: any;
declare const clearInterval: any;
declare const clearTimeout: any;
type BodyInit = any;

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Models — default lists (used as fallback when no cloud overrides exist)
// ---------------------------------------------------------------------------

const DEFAULT_OPENAI_MODELS = [
  "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-5-nano",
  "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
  "gpt-4o", "gpt-4o-mini",
  "o4-mini", "o3", "o3-mini",
];

const DEFAULT_ANTHROPIC_MODELS = [
  "claude-opus-4.6", "claude-opus-4.6-fast",
  "claude-opus-4.5", "claude-opus-4.1",
  "claude-sonnet-4.6", "claude-sonnet-4.5",
  "claude-haiku-4.5",
];

const DEFAULT_GEMINI_MODELS = [
  "gemini-3.1-pro-preview", "gemini-3-flash-preview",
  "gemini-2.5-pro", "gemini-2.5-flash",
];

const DEFAULT_OPENROUTER_MODELS = [
  "x-ai/grok-4.20", "x-ai/grok-4.1-fast", "x-ai/grok-4-fast",
  "meta-llama/llama-4-maverick", "meta-llama/llama-4-scout",
  "deepseek/deepseek-v3.2", "deepseek/deepseek-r1", "deepseek/deepseek-r1-0528",
  "mistralai/mistral-small-2603", "qwen/qwen3.5-122b-a10b",
  "google/gemini-2.5-pro", "anthropic/claude-opus-4.6",
  "cohere/command-a", "amazon/nova-premier-v1", "baidu/ernie-4.5-300b-a47b",
];

// Mutable runtime lists — overridden by cloud-persisted data at startup
let managedOpenAI: string[] = [...DEFAULT_OPENAI_MODELS];
let managedAnthropic: string[] = [...DEFAULT_ANTHROPIC_MODELS];
let managedGemini: string[] = [...DEFAULT_GEMINI_MODELS];
let managedOpenRouter: string[] = [...DEFAULT_OPENROUTER_MODELS];

// Dynamic OpenRouter model list fetched at startup (from OpenRouter API)
interface ORModelEntry { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string } }
let openrouterDynamicModels: ORModelEntry[] = [];

// Phase-2 registry skeleton:
// builtin registry is the base layer, remote OpenRouter discovery is the first overlay,
// manual env overlays are the minimal phase-2 patch layer for missing models.
// child/new-api/pricing overlays stay for later phases.
const MANUAL_OPENROUTER_MODELS_JSON_ENV = "MANUAL_OPENROUTER_MODELS_JSON";
const NEWAPI_IMPORTED_MODELS_JSON_ENV = "NEWAPI_IMPORTED_MODELS_JSON";
const CHILD_NODE_AUTO_REPORT_MODELS_ENV = "CHILD_NODE_AUTO_REPORT_MODELS";
const CHILD_NODE_PUBLIC_BASE_URL_ENV = "CHILD_NODE_PUBLIC_BASE_URL";
const CHILD_NODE_ID_ENV = "CHILD_NODE_ID";
const CHILD_NODE_LABEL_ENV = "CHILD_NODE_LABEL";
const MOTHER_NODE_URL_ENV = "MOTHER_NODE_URL";

let builtinRegistryEntries: BuiltinRegistryEntry[] = [];
let remoteOverlayRegistryCache: Map<string, RemoteOverlayModel> = new Map();
let manualOverlayRegistryCache: Map<string, ManualOverlayModel> = new Map();
let persistedManualOverlayRegistryCache: Map<string, ManualOverlayModel> = new Map();
let envManualOverlayRegistryCache: Map<string, ManualOverlayModel> = new Map();
let newapiImportedRegistryCache: Map<string, ManualOverlayModel> = new Map();
let childReportedRegistryCache: Map<string, ManualOverlayModel> = new Map();

// Keep the existing remote-normalized cache for backward compatibility in places
// that still expect the old shape during phase one.
let openrouterRegistryCache: Map<string, RegistryModel> = new Map();
let unifiedRegistryCache: Map<string, UnifiedModelView> = new Map();

function normalizeManualOverlayEntry(
  value: unknown,
  defaultOrigin: RegistryInputOrigin,
  sourceMetadataPatch?: Record<string, unknown>,
): ManualOverlayModel | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;

  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases.filter((entry): entry is string => typeof entry === "string" && !!entry.trim()).map((entry) => entry.trim())
    : (raw.aliases && typeof raw.aliases === "object"
      ? raw.aliases as ManualOverlayModel["aliases"]
      : undefined);

  const routing = raw.routing && typeof raw.routing === "object"
    ? raw.routing as ManualOverlayModel["routing"]
    : undefined;

  const metadata = raw.metadata && typeof raw.metadata === "object"
    ? raw.metadata as Record<string, unknown>
    : undefined;

  const sourceMetadata = raw.source_metadata && typeof raw.source_metadata === "object"
    ? { ...(raw.source_metadata as Record<string, unknown>), ...(sourceMetadataPatch ?? {}) }
    : (sourceMetadataPatch ? { ...sourceMetadataPatch } : undefined);

  const capabilities = raw.capabilities && typeof raw.capabilities === "object"
    ? raw.capabilities as ManualOverlayModel["capabilities"]
    : undefined;

  const modalities = raw.modalities && typeof raw.modalities === "object"
    ? raw.modalities as ManualOverlayModel["modalities"]
    : undefined;

  const context = raw.context && typeof raw.context === "object"
    ? raw.context as ManualOverlayModel["context"]
    : undefined;

  const price = raw.price && typeof raw.price === "object"
    ? raw.price as ManualOverlayModel["price"]
    : undefined;

  const origin = typeof raw.origin === "string" && (
    raw.origin === "mother_manual" ||
    raw.origin === "child_manual_report" ||
    raw.origin === "newapi_import"
  )
    ? raw.origin as RegistryInputOrigin
    : defaultOrigin;

  return {
    id,
    ...(typeof raw.canonical_id === "string" && raw.canonical_id.trim() ? { canonical_id: raw.canonical_id.trim() } : {}),
    ...(typeof raw.provider === "string" && raw.provider.trim() ? { provider: raw.provider.trim() } : {}),
    ...(typeof raw.provider_family === "string" && raw.provider_family.trim() ? { provider_family: raw.provider_family.trim() } : {}),
    ...(typeof raw.display_name === "string" && raw.display_name.trim() ? { display_name: raw.display_name.trim() } : {}),
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    ...(aliases ? { aliases } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(modalities ? { modalities } : {}),
    ...(context ? { context } : {}),
    ...(price ? { price } : {}),
    ...(routing ? { routing } : {}),
    ...(metadata ? { metadata } : {}),
    ...(sourceMetadata ? { source_metadata: sourceMetadata } : {}),
    origin,
    source: "manual",
  };
}

function loadSupplementalModelsFromEnv(
  envKey: string,
  defaultOrigin: RegistryInputOrigin,
): ManualOverlayModel[] {
  const raw = process.env[envKey];
  if (!raw?.trim()) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      console.warn(`[registry] ${envKey} must be a JSON array; entries ignored`);
      return [];
    }

    const normalized = parsed
      .map((entry) => normalizeManualOverlayEntry(entry, defaultOrigin))
      .filter((entry): entry is ManualOverlayModel => !!entry);

    if (normalized.length !== parsed.length) {
      console.warn(`[registry] ignored ${parsed.length - normalized.length} invalid entr${parsed.length - normalized.length === 1 ? "y" : "ies"} from ${envKey}`);
    }

    return normalized;
  } catch (err) {
    console.warn(`[registry] failed to parse ${envKey}; entries ignored:`, (err as Error).message ?? err);
    return [];
  }
}

function loadManualOverlayModelsFromEnv(): ManualOverlayModel[] {
  return loadSupplementalModelsFromEnv(MANUAL_OPENROUTER_MODELS_JSON_ENV, "mother_manual");
}

function loadNewapiImportedModelsFromEnv(): ManualOverlayModel[] {
  return loadSupplementalModelsFromEnv(NEWAPI_IMPORTED_MODELS_JSON_ENV, "newapi_import");
}

function setPersistedManualOverlayRegistryCache(entries: ManualOverlayModel[]): void {
  persistedManualOverlayRegistryCache = new Map(
    entries.map((entry) => [entry.canonical_id ?? entry.id, entry]),
  );
}

async function refreshManualOverlayRegistryCache(): Promise<void> {
  const persistedEntries = await readManualModelStore();
  const envEntries = loadManualOverlayModelsFromEnv();

  setPersistedManualOverlayRegistryCache(persistedEntries);
  envManualOverlayRegistryCache = new Map(
    envEntries.map((entry) => [entry.canonical_id ?? entry.id, entry]),
  );

  // mother manual persistence phase:
  // persisted store is the primary mother manual source;
  // env manual declarations remain supported as higher-priority compatibility patches.
  manualOverlayRegistryCache = new Map(persistedManualOverlayRegistryCache);
  for (const entry of envEntries) {
    manualOverlayRegistryCache.set(entry.canonical_id ?? entry.id, entry);
  }
}

function refreshNewapiImportedRegistryCache(): void {
  const importedEntries = loadNewapiImportedModelsFromEnv();
  newapiImportedRegistryCache = new Map(
    importedEntries.map((entry) => [entry.canonical_id ?? entry.id, entry]),
  );
}

function refreshChildReportedRegistryCache(): void {
  const childEntries = getRegisteredNodesSnapshot()
    .flatMap((node) => (node.reportedModels ?? []).map((entry) =>
      normalizeManualOverlayEntry(entry, "child_manual_report", {
        node_id: node.nodeId,
        node_label: node.label,
      }),
    ))
    .filter((entry): entry is ManualOverlayModel => !!entry);

  childReportedRegistryCache = new Map(
    childEntries.map((entry) => [entry.canonical_id ?? entry.id, entry]),
  );
}

function refreshUnifiedRegistryCache(): void {
  refreshChildReportedRegistryCache();
  const unified = buildUnifiedModelRegistry(
    builtinRegistryEntries,
    [...remoteOverlayRegistryCache.values()],
    [...manualOverlayRegistryCache.values()],
    [...childReportedRegistryCache.values()],
    [...newapiImportedRegistryCache.values()],
  );
  unifiedRegistryCache = unified.map;
}

function isChildReportedModelsAutoEnabled(): boolean {
  const raw = process.env[CHILD_NODE_AUTO_REPORT_MODELS_ENV];
  if (!raw?.trim()) return true;
  return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
}

function normalizeOptionalEnvString(envKey: string): string | null {
  const value = process.env[envKey];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function buildCompactReportedModelMetadata(model: UnifiedModelView): Record<string, unknown> {
  const metadata = model.metadata && typeof model.metadata === "object"
    ? model.metadata
    : {};
  const compact: Record<string, unknown> = {};

  const copyIfDefined = (sourceKey: string, targetKey = sourceKey): void => {
    const value = metadata[sourceKey];
    if (value === undefined || value === null) return;
    if (typeof value === "string" && !value.trim()) return;
    compact[targetKey] = value;
  };

  copyIfDefined("release_channel");
  copyIfDefined("stage");
  copyIfDefined("first_party");
  copyIfDefined("tokenizer_group");
  copyIfDefined("instruct_type");
  copyIfDefined("primary_modality");
  copyIfDefined("details_url");
  copyIfDefined("knowledge_cutoff");
  copyIfDefined("expiration_date");
  copyIfDefined("hugging_face_id");
  copyIfDefined("model_kind");
  copyIfDefined("kind");

  if (Array.isArray(metadata.supported_parameters)) {
    const supportedParameters = metadata.supported_parameters
      .filter((entry): entry is string => typeof entry === "string" && !!entry.trim())
      .map((entry) => entry.trim());
    if (supportedParameters.length > 0) {
      compact.supported_parameters = [...new Set(supportedParameters)].sort();
    }
  }

  return compact;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

interface ChildReportedModelsSnapshot {
  reportedModels: RegistrySupplementalModel[];
  reportedModelsDigest: string;
}

function buildChildReportedModelsSnapshot(): ChildReportedModelsSnapshot {
  if (!isChildReportedModelsAutoEnabled()) {
    const emptyDigest = createHash("sha256").update("[]").digest("hex");
    return { reportedModels: [], reportedModelsDigest: emptyDigest };
  }

  const builtinByCanonical = new Map(
    builtinRegistryEntries.map((entry) => [entry.canonical_id ?? entry.id, entry] as const),
  );
  const remoteByCanonical = new Map(remoteOverlayRegistryCache);
  const canonicalIds = new Set<string>();

  for (const entry of ALL_MODELS) {
    const unified = getUnifiedModelByAnyId(entry.id);
    if (!unified) continue;
    if (unified.source.child_reported) continue;
    canonicalIds.add(unified.canonical_id);
  }

  for (const canonicalId of manualOverlayRegistryCache.keys()) canonicalIds.add(canonicalId);
  for (const canonicalId of remoteOverlayRegistryCache.keys()) canonicalIds.add(canonicalId);

  const reportedModels = [...canonicalIds]
    .sort((left, right) => left.localeCompare(right))
    .map((canonicalId): RegistrySupplementalModel | null => {
      const model = getUnifiedModelByAnyId(canonicalId);
      if (!model || model.source.child_reported) return null;

      const hasPersistedManual = persistedManualOverlayRegistryCache.has(canonicalId);
      const hasEnvManual = envManualOverlayRegistryCache.has(canonicalId);
      const sourceKinds = [
        ...(builtinByCanonical.has(canonicalId) ? ["builtin"] : []),
        ...(remoteByCanonical.has(canonicalId) ? ["remote_openrouter"] : []),
        ...(hasPersistedManual ? ["mother_manual_store"] : []),
        ...(hasEnvManual ? ["mother_manual_env"] : []),
      ];

      const sourceMetadata: Record<string, unknown> = {
        report_phase: "child_reported_models_auto_report_phase",
        source_kinds: sourceKinds,
        source_rank: model.source.source_rank,
        source_ids: [...model.source.source_ids].sort(),
        manual_scope: model.source.manual_scope ?? null,
        builtin: model.source.builtin,
        remote: model.source.remote,
        manual: model.source.manual,
        child_reported: false,
        newapi_imported: false,
        manual_store: hasPersistedManual,
        manual_env: hasEnvManual,
      };

      if (model.source.alias_conflicts.length > 0) {
        sourceMetadata.alias_conflicts = model.source.alias_conflicts.map((conflict) => ({
          alias: conflict.alias,
          existing_canonical_id: conflict.existing_canonical_id,
          blocked_canonical_id: conflict.blocked_canonical_id,
        }));
      }

      return {
        id: model.id,
        canonical_id: model.canonical_id,
        display_name: model.display_name,
        provider: model.provider,
        provider_family: model.provider_family,
        aliases: {
          stable: [...model.aliases.stable].sort(),
          friendly: [...model.aliases.friendly].sort(),
          versioned: [...model.aliases.versioned].sort(),
          legacy: [...model.aliases.legacy].sort(),
        },
        context: {
          window_tokens: getRegistryModelContextSummary(model).context_window,
          max_output_tokens: getRegistryModelContextSummary(model).max_output_tokens,
        },
        price: getEffectiveRegistryPricingSummary(model) ?? getRegistryModelPricingSummary(model),
        capabilities: { ...model.capabilities },
        modalities: {
          input: [...getRegistryModelModalitiesSummary(model).input].sort(),
          output: [...getRegistryModelModalitiesSummary(model).output].sort(),
        },
        routing: {
          openrouter_slug: model.routing.openrouter_slug ?? null,
          preferred_providers: model.routing.preferred_providers ? [...model.routing.preferred_providers].sort() : [],
        },
        metadata: buildCompactReportedModelMetadata(model),
        origin: "child_manual_report" as const,
        source: "manual" as const,
        source_metadata: sourceMetadata,
      } satisfies RegistrySupplementalModel;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const digestPayload = stableStringify(reportedModels);
  const reportedModelsDigest = createHash("sha256").update(digestPayload).digest("hex");
  return { reportedModels, reportedModelsDigest };
}

function readCurrentNodeVersion(): string | undefined {
  const candidates = [
    resolve(process.cwd(), "version.json"),
    resolve(process.cwd(), "../../version.json"),
  ];

  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return parsed.version.trim();
      }
    } catch {
      // ignore local version read errors
    }
  }

  return undefined;
}

function computeChildIntegrationsAllReady(): boolean {
  // NOTE: env keys are constructed at runtime to keep mother source clean of
  // upstream-AI-platform literal names. This function is only meaningful when
  // this same binary runs as a sub-node registering to a mother — the mother
  // role itself never reads upstream AI credentials (Stage A: friend-proxy
  // is the only outbound path).
  const integPrefix = ["AI", "INTEGRATIONS"].join("_") + "_";
  const has = (key: string): boolean => !!process.env[integPrefix + key];
  const openaiReady = has("OPENAI_BASE_URL") && has("OPENAI_API_KEY");
  const anthropicReady = has("ANTHROPIC_BASE_URL") && has("ANTHROPIC_API_KEY");
  return openaiReady || anthropicReady;
}

function computeChildConfigured(): boolean {
  return !!process.env.PROXY_API_KEY;
}

function getChildNodeRegistrationConfig(): {
  motherApiBaseUrl: string;
  publicBaseUrl: string;
  nodeId: string;
  label: string;
} | null {
  const motherNodeUrl = normalizeOptionalEnvString(MOTHER_NODE_URL_ENV);
  const publicBaseUrl = normalizeOptionalEnvString(CHILD_NODE_PUBLIC_BASE_URL_ENV);
  if (!motherNodeUrl || !publicBaseUrl) return null;

  const normalizedMotherApiBaseUrl = deriveApiBaseUrl(motherNodeUrl);
  const normalizedPublicBaseUrl = derivePublicBaseUrl(publicBaseUrl);
  const selfApiBaseUrl = deriveApiBaseUrl(normalizedPublicBaseUrl);

  if (normalizedMotherApiBaseUrl === selfApiBaseUrl) {
    console.warn("[child-report] skipped auto register/heartbeat because mother node URL points to current node");
    return null;
  }

  const nodeId = normalizeOptionalEnvString(CHILD_NODE_ID_ENV)
    ?? createHash("sha256").update(normalizedPublicBaseUrl).digest("hex").slice(0, 16);
  const label = normalizeOptionalEnvString(CHILD_NODE_LABEL_ENV)
    ?? `CHILD_${nodeId.slice(0, 8)}`;

  return {
    motherApiBaseUrl: normalizedMotherApiBaseUrl,
    publicBaseUrl: normalizedPublicBaseUrl,
    nodeId,
    label,
  };
}

let childNodeRegisterSucceeded = false;
let childNodeHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let childNodeRegisterInFlight = false;

async function syncChildNodeRegistration(mode: "register" | "heartbeat"): Promise<void> {
  if (childNodeRegisterInFlight) return;

  const config = getChildNodeRegistrationConfig();
  if (!config) return;

  childNodeRegisterInFlight = true;
  try {
    let reportedModels: RegistrySupplementalModel[] = [];
    let reportedModelsDigest = createHash("sha256").update("[]").digest("hex");

    try {
      const snapshot = buildChildReportedModelsSnapshot();
      reportedModels = snapshot.reportedModels;
      reportedModelsDigest = snapshot.reportedModelsDigest;
    } catch (err) {
      console.warn(
        `[child-report] failed to build reportedModels for ${mode}; continuing without model payload:`,
        (err as Error).message ?? err,
      );
    }

    const payload = {
      nodeId: config.nodeId,
      ...(mode === "register" ? { label: config.label } : {}),
      publicBaseUrl: config.publicBaseUrl,
      version: readCurrentNodeVersion(),
      healthy: true,
      configured: computeChildConfigured(),
      integrationsAllReady: computeChildIntegrationsAllReady(),
      capabilities: ["reported-models", "reported-models-digest", "job-api"],
      reportedModels,
      reportedModelsDigest,
      timestamp: Date.now(),
    };

    const response = await fetch(`${config.motherApiBaseUrl}/v1/internal/nodes/${mode}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getProxyApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      childNodeRegisterSucceeded = true;
      return;
    }

    if (mode === "heartbeat" && response.status === 404) {
      childNodeRegisterSucceeded = false;
      console.warn("[child-report] heartbeat returned 404; will retry register on next cycle");
      return;
    }

    if (mode === "register") {
      childNodeRegisterSucceeded = false;
    }

    const responseText = await response.text().catch(() => "unknown");
    console.warn(`[child-report] ${mode} failed with HTTP ${response.status}: ${responseText}`);
  } catch (err) {
    if (mode === "register") {
      childNodeRegisterSucceeded = false;
    }
    console.warn(`[child-report] ${mode} request failed:`, (err as Error).message ?? err);
  } finally {
    childNodeRegisterInFlight = false;
  }
}

function startChildNodeAutoReportLoop(): void {
  if (childNodeHeartbeatTimer) return;
  if (!getChildNodeRegistrationConfig()) return;

  void syncChildNodeRegistration("register");
  childNodeHeartbeatTimer = setInterval(() => {
    void syncChildNodeRegistration(childNodeRegisterSucceeded ? "heartbeat" : "register");
  }, 30_000);
}

async function reloadMotherManualRegistryCache(): Promise<void> {
  await refreshManualOverlayRegistryCache();
  refreshUnifiedRegistryCache();
  rebuildModelIndex();
}

function getUnifiedModelByAnyId(modelId: string): UnifiedModelView | null {
  if (!modelId) return null;

  const direct = unifiedRegistryCache.get(modelId);
  if (direct) return direct;

  for (const model of unifiedRegistryCache.values()) {
    if (model.id === modelId || model.canonical_id === modelId) return model;
    const aliases = [
      ...model.aliases.stable,
      ...model.aliases.friendly,
      ...model.aliases.versioned,
      ...model.aliases.legacy,
    ];
    if (aliases.includes(modelId)) return model;
  }

  return null;
}

function getManualOverlayPriceKeys(canonicalId?: string | null): Set<keyof RegistryModelPricingSummary> {
  const keys = new Set<keyof RegistryModelPricingSummary>();
  if (!canonicalId) return keys;

  const manual = manualOverlayRegistryCache.get(canonicalId);
  const price = manual?.price;
  if (!price) return keys;

  if (price.input_per_mtok_usd !== undefined && price.input_per_mtok_usd !== null) keys.add("input_per_mtok_usd");
  if (price.output_per_mtok_usd !== undefined && price.output_per_mtok_usd !== null) keys.add("output_per_mtok_usd");
  if (price.cache_read_per_mtok_usd !== undefined && price.cache_read_per_mtok_usd !== null) keys.add("cache_read_per_mtok_usd");
  if (price.cache_write_per_mtok_usd !== undefined && price.cache_write_per_mtok_usd !== null) keys.add("cache_write_per_mtok_usd");

  return keys;
}

function getOpenRouterLivePricing(model: string, unified?: UnifiedModelView | null): ORPricing | undefined {
  const candidates = [
    model,
    unified?.routing.openrouter_slug ?? undefined,
    unified?.canonical_id ?? undefined,
    unified?.id ?? undefined,
  ].filter((value): value is string => !!value);

  for (const candidate of candidates) {
    const pricing = openrouterPricingCache.get(candidate);
    if (pricing) return pricing;
  }

  return undefined;
}

function hasAnyPricingValue(pricing: RegistryModelPricingSummary): boolean {
  return Object.values(pricing).some((value) => typeof value === "number" && Number.isFinite(value));
}

function getEffectiveRegistryPricingSummary(modelOrId: string | UnifiedModelView | null | undefined): RegistryModelPricingSummary | null {
  const unified = typeof modelOrId === "string"
    ? getUnifiedModelByAnyId(modelOrId)
    : (modelOrId ?? null);

  const modelId = typeof modelOrId === "string"
    ? modelOrId
    : (unified?.canonical_id ?? unified?.id ?? "");

  const basePricing = unified
    ? getRegistryModelPricingSummary(unified)
    : {
        input_per_mtok_usd: null,
        output_per_mtok_usd: null,
        cache_read_per_mtok_usd: null,
        cache_write_per_mtok_usd: null,
      };

  const effectivePricing: RegistryModelPricingSummary = { ...basePricing };
  const manualPriceKeys = getManualOverlayPriceKeys(unified?.canonical_id ?? null);
  const livePricing = getOpenRouterLivePricing(modelId, unified);

  if (livePricing) {
    if (!manualPriceKeys.has("input_per_mtok_usd")) {
      effectivePricing.input_per_mtok_usd = Number.isFinite(livePricing.input) ? livePricing.input : effectivePricing.input_per_mtok_usd;
    }
    if (!manualPriceKeys.has("output_per_mtok_usd")) {
      effectivePricing.output_per_mtok_usd = Number.isFinite(livePricing.output) ? livePricing.output : effectivePricing.output_per_mtok_usd;
    }
    if (!manualPriceKeys.has("cache_read_per_mtok_usd") && livePricing.cacheReadPerM !== undefined) {
      effectivePricing.cache_read_per_mtok_usd = Number.isFinite(livePricing.cacheReadPerM) ? livePricing.cacheReadPerM : effectivePricing.cache_read_per_mtok_usd;
    }
    if (!manualPriceKeys.has("cache_write_per_mtok_usd") && livePricing.cacheWritePerM !== undefined) {
      effectivePricing.cache_write_per_mtok_usd = Number.isFinite(livePricing.cacheWritePerM) ? livePricing.cacheWritePerM : effectivePricing.cache_write_per_mtok_usd;
    }
  }

  return hasAnyPricingValue(effectivePricing) ? effectivePricing : null;
}

function getRegistryModelKind(model: UnifiedModelView | null): string | null {
  if (!model) return null;

  const metadata = model.metadata && typeof model.metadata === "object"
    ? model.metadata
    : {};

  const explicitKind = typeof metadata.model_kind === "string"
    ? metadata.model_kind.trim()
    : (typeof metadata.kind === "string" ? metadata.kind.trim() : "");

  if (explicitKind) return explicitKind;

  const modalities = getRegistryModelModalitiesSummary(model);

  if (modalities.output.includes("embeddings")) return "embedding";
  if (modalities.output.includes("rerank")) return "rerank";
  if (modalities.output.includes("video")) return "video_generation";
  if (modalities.output.includes("image")) return "image_generation";
  if (modalities.output.includes("audio") && !model.capabilities.chat) return "audio_generation";
  if (model.capabilities.chat) return "chat";
  if (modalities.input.includes("audio") || modalities.output.includes("audio")) return "audio";
  return null;
}

const PROVIDER_ALIAS_PREFIX_MAP: Record<string, string> = {
  "amazon-bedrock": "bedrock",
  "bedrock": "bedrock",
  "google-vertex": "vertex",
  "vertex": "vertex",
  "anthropic": "anthropic",
  "google": "google",
  "openrouter": "openrouter",
};

function pushUniqueString(target: string[], value: unknown): void {
  if (typeof value !== "string") return;
  const normalized = value.trim();
  if (!normalized || target.includes(normalized)) return;
  target.push(normalized);
}

function getModelDisplayName(model: UnifiedModelView | null): string | null {
  if (!model) return null;
  const displayName = typeof model.display_name === "string" ? model.display_name.trim() : "";
  return displayName || model.canonical_id || model.id || null;
}

function getLogicalAliasCandidates(model: UnifiedModelView): string[] {
  const candidates: string[] = [];
  const rawAliases = [
    model.id,
    model.canonical_id,
    ...model.aliases.stable,
    ...model.aliases.friendly,
    ...model.aliases.versioned,
    ...model.aliases.legacy,
  ];

  for (const alias of rawAliases) {
    if (!alias || alias.includes("/")) continue;
    pushUniqueString(candidates, alias);
  }

  const canonicalSegments = model.canonical_id.split("/");
  if (canonicalSegments.length > 1) {
    pushUniqueString(candidates, canonicalSegments.slice(1).join("/"));
  }

  return candidates;
}

function getModelRecommendedAliases(model: UnifiedModelView): string[] {
  const primaryName = getModelDisplayName(model);
  const blockedAliases = new Set(model.source.alias_conflicts.map((conflict) => conflict.alias.trim()).filter(Boolean));
  const recommended: string[] = [];
  const orderedAliases = [
    ...model.aliases.friendly,
    ...model.aliases.stable,
    ...model.aliases.versioned,
    ...model.aliases.legacy,
  ];

  for (const alias of orderedAliases) {
    const normalized = typeof alias === "string" ? alias.trim() : "";
    if (!normalized) continue;
    if (normalized === model.canonical_id) continue;
    if (primaryName && normalized === primaryName) continue;
    if (blockedAliases.has(normalized)) continue;
    pushUniqueString(recommended, normalized);
  }

  const logicalAliases = getLogicalAliasCandidates(model);
  const prefixedAliasPrefixes = (model.routing.preferred_providers ?? [])
    .map((provider) => PROVIDER_ALIAS_PREFIX_MAP[provider.trim().toLowerCase()] ?? null)
    .filter((provider): provider is string => !!provider);

  for (const prefix of prefixedAliasPrefixes) {
    for (const logicalAlias of logicalAliases) {
      const prefixedAlias = `${prefix}/${logicalAlias}`;
      if (prefixedAlias === model.canonical_id) continue;
      if (primaryName && prefixedAlias === primaryName) continue;
      if (blockedAliases.has(prefixedAlias)) continue;
      pushUniqueString(recommended, prefixedAlias);
    }
  }

  return recommended;
}

function buildModelSourceSummary(
  model: UnifiedModelView,
  persistedMotherManualIds: string[],
  envMotherManualIds: string[],
): {
  labels: string[];
  primary: string | null;
  raw_count: number;
  source_ids: string[];
  manual_scope: string | null;
} {
  const labels: string[] = [];
  if (model.source.builtin) labels.push("builtin");
  if (model.source.remote) labels.push("openrouter_remote");
  if (persistedMotherManualIds.length > 0 || envMotherManualIds.length > 0 || model.source.manual_scope === "mother") {
    labels.push("mother_manual");
  }
  if (model.source.child_reported) labels.push("child_reported");
  if (model.source.newapi_imported) labels.push("newapi_imported");

  return {
    labels,
    primary: labels[0] ?? null,
    raw_count: labels.length,
    source_ids: [...model.source.source_ids].sort(),
    manual_scope: model.source.manual_scope ?? null,
  };
}

function buildModelCapabilitySummary(
  model: UnifiedModelView,
  capabilitySummary: ReturnType<typeof getRegistryModelCapabilitiesSummary>,
  modalitiesSummary: ReturnType<typeof getRegistryModelModalitiesSummary>,
  modelKind: string | null,
): {
  flags: Record<string, boolean | null>;
  tags: string[];
  multimodal: boolean | null;
  category: string | null;
  input_modalities: string[];
  output_modalities: string[];
} {
  const hasRichInput = modalitiesSummary.input.some((modality) => modality !== "text");
  const hasRichOutput = modalitiesSummary.output.some((modality) => !["text", "embeddings", "rerank"].includes(modality));
  const multimodal = hasRichInput || hasRichOutput
    ? true
    : (modalitiesSummary.input.length > 0 || modalitiesSummary.output.length > 0 ? false : null);

  const flags: Record<string, boolean | null> = {
    thinking: capabilitySummary.thinking,
    vision: capabilitySummary.vision,
    code: capabilitySummary.code,
    tool_use: capabilitySummary.tool_use,
    structured_output: capabilitySummary.structured_output,
    web_search: capabilitySummary.web_search,
    streaming: capabilitySummary.streaming,
    multimodal,
  };

  const tags: string[] = [];
  for (const [tag, enabled] of Object.entries(flags)) {
    if (enabled === true) tags.push(tag);
  }

  if (modelKind === "embedding") tags.push("embedding");
  if (modelKind === "image_generation") tags.push("image");
  if (modelKind === "audio_generation" || modelKind === "audio") tags.push("audio");
  if (modelKind === "video_generation") tags.push("video");
  if (modelKind === "rerank") tags.push("rerank");

  return {
    flags,
    tags: [...new Set(tags)],
    multimodal,
    category: modelKind,
    input_modalities: [...modalitiesSummary.input],
    output_modalities: [...modalitiesSummary.output],
  };
}

function buildModelConflictSummary(model: UnifiedModelView): {
  has_conflicts: boolean;
  conflict_count: number;
} {
  return {
    has_conflicts: model.source.alias_conflicts.length > 0,
    conflict_count: model.source.alias_conflicts.length,
  };
}

function buildModelBadges(
  sourceSummary: ReturnType<typeof buildModelSourceSummary>,
  capabilitySummary: ReturnType<typeof buildModelCapabilitySummary>,
  conflictSummary: ReturnType<typeof buildModelConflictSummary>,
): string[] {
  const badges: string[] = [];
  if (sourceSummary.primary) badges.push(sourceSummary.primary);
  if (capabilitySummary.category) badges.push(capabilitySummary.category);
  for (const tag of capabilitySummary.tags) pushUniqueString(badges, tag);
  if (conflictSummary.has_conflicts) badges.push("alias_conflict");
  return badges;
}

// Per-million-token pricing fetched from OpenRouter models API (USD).
// Updated every time fetchOpenRouterModels() succeeds.
// Input/output are per-million rates; cacheReadPerM / cacheWritePerM are per-million rates too.
interface ORPricing { input: number; output: number; cacheReadPerM?: number; cacheWritePerM?: number }
let openrouterPricingCache: Map<string, ORPricing> = new Map();

// ---------------------------------------------------------------------------
// Quality + Thinking parameter injection — NOTE
// ---------------------------------------------------------------------------
// Two complementary auto-injections for Claude Opus 4.6+ via OpenRouter:
//
//   ★ verbosity:"max" — auto-injected for Opus 4.6+ (any provider path).
//     Maps to output_config.effort:"max" for Anthropic.  "max" ONLY valid for
//     Opus 4.6+; produces richer, more comprehensive assistant responses.
//     (OR Parameters doc: "Constrains the verbosity of the model's response.")
//
//   ★ reasoning:{max_tokens:100000} — auto-injected for OpenRouter anthropic/*
//     Opus 4.6+ models only (not direct Anthropic /v1/messages path).
//     Per OR Reasoning Tokens doc: reasoning.max_tokens is the correct param for
//     Anthropic extended thinking.  OR normalizes across Bedrock/Vertex/Anthropic.
//     budget=100000 supports heavy 30-50 min roleplay/reasoning sessions.
//     Client-supplied reasoning in extraParams takes precedence.
//     ⚠ DO NOT use reasoning:{effort:"xhigh"} for Anthropic — that is ONLY for
//       OpenAI o-series and Grok models.  Anthropic uses max_tokens only.
//
//   • thinking:{type:"enabled",budget_tokens:N} — injected by sub-node's
//     stripClaudeSuffix() for direct Anthropic claude-* calls (non-OpenRouter).
//
// Model names (including -thinking / -thinking-visible suffixes) are forwarded
// AS-IS so the sub-node can parse them correctly.
// ---------------------------------------------------------------------------

// Custom OpenRouter models — manually added by admin, persisted to cloud storage
interface CustomOpenRouterModel { id: string; name?: string }
let customOpenRouterModels: CustomOpenRouterModel[] = [];

// ALL_MODELS — rebuilt every time managed lists change
let ALL_MODELS: { id: string; description?: string }[] = [];

// ---------------------------------------------------------------------------
// Model provider map + enable/disable management
// ---------------------------------------------------------------------------

type ModelProvider = "openai" | "anthropic" | "gemini" | "openrouter";
const MODEL_PROVIDER_MAP = new Map<string, ModelProvider>();

// Rebuild ALL_MODELS and MODEL_PROVIDER_MAP from the current mutable lists.
// Must be called after any change to managedOpenAI/Anthropic/Gemini/OpenRouter/customOpenRouterModels.
function rebuildModelIndex(): void {
  const openaiThinking = managedOpenAI.filter((m) => m.startsWith("o")).map((m) => `${m}-thinking`);
  ALL_MODELS = [
    ...managedOpenAI.map((id) => ({ id })),
    ...openaiThinking.map((id) => ({ id })),
    ...managedAnthropic.flatMap((id) => [{ id }, { id: `${id}-thinking` }, { id: `${id}-thinking-visible` }]),
    ...managedGemini.flatMap((id) => [{ id }, { id: `${id}-thinking` }, { id: `${id}-thinking-visible` }]),
    ...managedOpenRouter.map((id) => ({ id })),
  ];
  MODEL_PROVIDER_MAP.clear();
  for (const id of managedOpenAI) { MODEL_PROVIDER_MAP.set(id, "openai"); }
  for (const id of openaiThinking) { MODEL_PROVIDER_MAP.set(id, "openai"); }
  for (const base of managedAnthropic) {
    MODEL_PROVIDER_MAP.set(base, "anthropic");
    MODEL_PROVIDER_MAP.set(`${base}-thinking`, "anthropic");
    MODEL_PROVIDER_MAP.set(`${base}-thinking-visible`, "anthropic");
  }
  for (const base of managedGemini) {
    MODEL_PROVIDER_MAP.set(base, "gemini");
    MODEL_PROVIDER_MAP.set(`${base}-thinking`, "gemini");
    MODEL_PROVIDER_MAP.set(`${base}-thinking-visible`, "gemini");
  }
  for (const id of managedOpenRouter) { MODEL_PROVIDER_MAP.set(id, "openrouter"); }
  for (const m of customOpenRouterModels) { MODEL_PROVIDER_MAP.set(m.id, "openrouter"); }
  for (const m of openrouterDynamicModels) {
    if (!MODEL_PROVIDER_MAP.has(m.id)) MODEL_PROVIDER_MAP.set(m.id, "openrouter");
  }

  // Phase-1 minimal adoption: unified registry can supplement the legacy static
  // lists without deleting existing hardcoded fallbacks yet.
  const knownIds = new Set(ALL_MODELS.map((m) => m.id));
  for (const model of unifiedRegistryCache.values()) {
    if (!knownIds.has(model.canonical_id)) {
      ALL_MODELS.push({
        id: model.canonical_id,
        ...(model.description ? { description: model.description } : {}),
      });
      knownIds.add(model.canonical_id);
    }

    if (!MODEL_PROVIDER_MAP.has(model.canonical_id)) {
      const provider: ModelProvider =
        model.provider === "openai" || model.provider === "anthropic"
          ? model.provider
          : (model.provider === "google" ? "gemini" : "openrouter");
      MODEL_PROVIDER_MAP.set(model.canonical_id, provider);
    }
  }
}

// Build initial index from defaults
rebuildModelIndex();

// Persist managed model lists to cloud storage
function saveManagedModels(): void {
  writeJson("managed_models.json", {
    openai: managedOpenAI,
    anthropic: managedAnthropic,
    gemini: managedGemini,
    openrouter: managedOpenRouter,
  }).catch((err) => console.error("[persist] failed to save managed_models:", err));
}

function saveCustomOpenRouterModels(): void {
  writeJson("custom_openrouter_models.json", customOpenRouterModels).catch((err) => {
    console.error("[persist] failed to save custom_openrouter_models:", err);
  });
}

// ---------------------------------------------------------------------------
// Model route table — maps incoming model IDs to different actual model IDs
// e.g. "gpt-5.2" → "meta-llama/llama-4-maverick" (client sends gpt-5.2, gets llama)
// or   "my-alias" → "deepseek/deepseek-r1"
// Applied in /v1/chat/completions and /v1/messages before routing.
// ---------------------------------------------------------------------------

interface ModelRoute { from: string; to: string; note?: string }
let modelRoutes: ModelRoute[] = [];

function saveModelRoutes(): void {
  writeJson("model_routes.json", modelRoutes).catch((err) => {
    console.error("[persist] failed to save model_routes:", err);
  });
}

// Apply route mapping: if `id` has a route rule, return the target ID; otherwise return `id`.
function applyModelRoute(id: string): string {
  const route = modelRoutes.find((r) => r.from === id);
  return route ? route.to : id;
}

// Normalize provider-prefixed OpenRouter model IDs before forwarding to a
// friend backend.
//
// **Absolute provider routing contract** — when a model id carries a routing
// prefix recognised by `detectAbsoluteProviderRoute()` (bedrock/, vertex/,
// aistudio/, anthropic/, openai/, groq/, …), the prefix is the source of
// truth for backend selection.  We MUST keep it intact so that:
//
//   1. handleFriendProxy() can detect it and inject
//      `provider: { only: [<slug>], allow_fallbacks: false }` on the wire,
//      and
//   2. the sub-node's own router sees the same prefix it would receive
//      directly from a vendor SDK.
//
// The historical behaviour of rewriting `bedrock/claude-*` → `anthropic/claude-*`
// stripped the routing intent and forced OpenRouter to fall back to its
// default provider order — silently violating the absolute-routing contract.
// That rewrite is now removed; see ROUTING_AUDIT.md §4.
function normalizeFriendModel(m: string): string {
  return m;
}

// Build the OpenRouter `provider` block for an absolute-routing prefix.
//
//   • Forces `only: [<slug>]` to lock the request to a single sub-channel.
//   • Forces `allow_fallbacks: false` — clients cannot opt out.
//   • Forces `order: [<slug>]` for stable observability.
//   • Preserves any unrelated client-supplied keys (`sort`, `data_collection`,
//     `quantizations`, etc.) so existing requests keep working.
//   • Silently overwrites any conflicting client-supplied `only` /
//     `allow_fallbacks` / `order` — does NOT throw.  The lock is the
//     contract; the client cannot widen or escape it, but the request
//     still succeeds against the locked provider.
function buildAbsoluteProviderBlock(
  route: GatewayProviderRoute,
  clientProvider: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (clientProvider && typeof clientProvider === "object" && !Array.isArray(clientProvider)) {
    for (const [k, v] of Object.entries(clientProvider as Record<string, unknown>)) {
      // Strip the keys we are about to force-set so we don't accidentally
      // preserve a stale client value.
      if (k === "only" || k === "allow_fallbacks" || k === "order") continue;
      out[k] = v;
    }
  }
  if (route.order?.length) out.order = [...route.order];
  if (route.only?.length) out.only = [...route.only];
  out.allow_fallbacks = false;
  return out;
}

// fetchOpenRouterModels — model-list queries are forwarded through a
// configured friend proxy sub-node. The mother gateway never calls any
// upstream AI provider directly.
async function fetchOpenRouterModels(): Promise<void> {
  const proxyApiKey = getProxyApiKey();

  // Helper: try fetching model list from one normalized URL.
  async function tryFetch(url: string, label: string): Promise<boolean> {
    try {
      const fetchRes = await fetch(`${url}/v1/models`, {
        headers: { Authorization: `Bearer ${proxyApiKey}` },
        signal: AbortSignal.timeout(GATEWAY_TIMEOUTS.upstreamModelListMs),
      });
      if (!fetchRes.ok) return false;
      const data = await fetchRes.json() as { data?: OpenRouterModelRaw[] };
      // Keep only OpenRouter-format model IDs (contain "/", e.g. "meta-llama/llama-4-maverick").
      // OpenAI / Anthropic / Gemini model IDs never contain a slash.
      const models = (data.data ?? []).filter((m) => m.id.includes("/"));
      openrouterDynamicModels = models as ORModelEntry[];

      const normalizedRegistry = new Map<string, RegistryModel>();
      const remoteOverlayRegistry = new Map<string, RemoteOverlayModel>();
      for (const model of models) {
        const normalized = normalizeOpenRouterModel(model);
        normalizedRegistry.set(normalized.id, normalized);
        remoteOverlayRegistry.set(normalized.canonical_id, normalized);
      }
      openrouterRegistryCache = normalizedRegistry;
      remoteOverlayRegistryCache = remoteOverlayRegistry;
      refreshUnifiedRegistryCache();

      rebuildModelIndex();

      console.log(`[openrouter] fetched ${models.length} models via ${label} (remote: ${remoteOverlayRegistry.size}, unified: ${unifiedRegistryCache.size})`);
      return true;
    } catch {
      return false;
    }
  }

  // 1. Scan env-configured friend proxies in order; stop at the first successful response.
  const envKeys = ["FRIEND_PROXY_URL", ...Array.from({ length: 19 }, (_, i) => `FRIEND_PROXY_URL_${i + 2}`)];
  for (const key of envKeys) {
    const raw = process.env[key];
    if (!raw) continue;
    const url = normalizeSubNodeUrl(raw.trim());
    if (await tryFetch(url, `env:${key}`)) return;
  }

  // 2. Fall back to dynamic backends (added via Admin UI / POST /v1/admin/backends).
  //    Dynamic backends use the same PROXY_API_KEY — normalizeSubNodeUrl already appended /api.
  for (const d of dynamicBackends) {
    if (d.enabled === false) continue;
    const url = deriveApiBaseUrl(d.apiBaseUrl || d.publicBaseUrl || d.url || "");
    if (!url) continue;
    if (await tryFetch(url, `dynamic:${d.label}`)) return;
  }

  console.warn("[openrouter] could not fetch model list: no friend proxy responded");
}

setTimeout(fetchOpenRouterModels, 3_000);
setInterval(fetchOpenRouterModels, 60 * 60 * 1_000);

// ---------------------------------------------------------------------------
// Fetch live OR pricing directly from OpenRouter public API (no auth needed).
// openrouter.ai/api/v1/models returns pricing.prompt, .completion,
// .input_cache_read, .input_cache_write in USD per token.
// We convert to per-million-token rates and store in openrouterPricingCache.
// ---------------------------------------------------------------------------
async function fetchORPricingDirect(): Promise<void> {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(GATEWAY_TIMEOUTS.upstreamPricingMs),
    });
    if (!r.ok) {
      console.warn(`[or-pricing] HTTP ${r.status} from openrouter.ai/api/v1/models`);
      return;
    }
    const data = await r.json() as { data?: ORModelEntry[] };
    const allModels = data.data ?? [];
    const newPricing = new Map<string, ORPricing>();
    for (const m of allModels) {
      const p = m.pricing;
      if (!p) continue;
      const promptRaw   = parseFloat(p.prompt      ?? "0");
      const completionRaw = parseFloat(p.completion ?? "0");
      if (isNaN(promptRaw) || promptRaw === 0 || isNaN(completionRaw)) continue;
      const entry: ORPricing = {
        input:  promptRaw   * 1_000_000,
        output: completionRaw * 1_000_000,
      };
      const crRaw = parseFloat(p.input_cache_read  ?? "0");
      const cwRaw = parseFloat(p.input_cache_write ?? "0");
      if (!isNaN(crRaw) && crRaw > 0) entry.cacheReadPerM  = crRaw * 1_000_000;
      if (!isNaN(cwRaw) && cwRaw > 0) entry.cacheWritePerM = cwRaw * 1_000_000;
      newPricing.set(m.id, entry);
    }
    openrouterPricingCache = newPricing;
    console.log(`[or-pricing] fetched ${newPricing.size} model prices from openrouter.ai`);

    // ── Fallback: when no friend proxy reported a model list, populate the
    // dynamic OR model registry directly from openrouter.ai. Friend proxy data,
    // if present, takes precedence and is NOT overwritten here.
    if (openrouterDynamicModels.length === 0) {
      const orModels = allModels.filter((m) => m.id.includes("/"));
      if (orModels.length > 0) {
        openrouterDynamicModels = orModels as ORModelEntry[];
        const normalizedRegistry = new Map<string, RegistryModel>();
        const remoteOverlayRegistry = new Map<string, RemoteOverlayModel>();
        for (const model of orModels) {
          try {
            const normalized = normalizeOpenRouterModel(model);
            normalizedRegistry.set(normalized.id, normalized);
            remoteOverlayRegistry.set(normalized.canonical_id, normalized);
          } catch {
            // Skip individual normalization failures; do not poison the cache.
          }
        }
        openrouterRegistryCache = normalizedRegistry;
        remoteOverlayRegistryCache = remoteOverlayRegistry;
        refreshUnifiedRegistryCache();
        rebuildModelIndex();
        console.log(`[or-pricing] fallback: populated ${orModels.length} OR models directly from openrouter.ai (no friend proxy reported)`);
      }
    }
  } catch (e) {
    console.warn("[or-pricing] failed to fetch from openrouter.ai:", (e as Error).message ?? e);
  }
}

// Fetch pricing shortly after startup and refresh every 6 hours.
setTimeout(fetchORPricingDirect, 6_000);
setInterval(fetchORPricingDirect, 6 * 60 * 60 * 1_000);

// ---------------------------------------------------------------------------
// Backend pool — friend proxy sub-nodes only.  All upstream traffic is
// forwarded through configured sub-nodes; the mother gateway never calls any
// AI provider directly.
// ---------------------------------------------------------------------------

interface Backend {
  kind: "friend";
  label: string;
  url: string;
  apiKey: string;
  /**
   * Set of OpenRouter provider slugs this sub-node is known to be able
   * to reach.  Mirrors BackendPoolEntry.providerSlugs (see backendPool.ts
   * for semantics).  When undefined the node has not reported any model
   * list and is treated as capable of serving any locked provider.
   */
  providerSlugs?: string[];
}

// Platform-tied timeouts (legBWallMs, subNodeStreamWallMs, keepaliveJobMs,
// keepaliveAnthropicMs, keepaliveClientMs) are sourced from gatewayConfig so
// operators on platforms without Replit's 300s/600s reverse-proxy cuts can
// override them via env vars. Defaults preserve the original behaviour.
const GATEWAY_TIMEOUTS = {
  upstreamLongPollMs: 3_600_000,        // true task lifetime: allow up to 1h model execution
  upstreamModelListMs: 20_000,
  upstreamPricingMs: 30_000,
  upstreamEmbeddingsMs: 60_000,
  upstreamBinaryMs: 120_000,
  upstreamPassthroughMs: 90_000,
  subNodeJobSubmitMs: 15_000,
  subNodeJobCancelMs: 5_000,
  subNodeStreamWallMs: gatewayTimeoutOverrides.subNodeStreamWallMs,  // upstream stream rotation window — fires before platform outgoing cut
  streamIdleMs: 900_000,                // upstream idle watchdog, not task lifetime
  streamReconnectDelayMs: 300,
  streamRecoverDelayMs: 500,
  legBWallMs: gatewayTimeoutOverrides.legBWallMs,                    // client-facing reconnect window — fires before platform incoming cut
  keepaliveClientMs: gatewayTimeoutOverrides.keepaliveClientMs,
  keepaliveAnthropicMs: gatewayTimeoutOverrides.keepaliveAnthropicMs,
  keepaliveJobMs: gatewayTimeoutOverrides.keepaliveJobMs,            // SSE heartbeat — must be below platform idle cut
  liveJobTtlMs: 45 * 60_000,            // resumable live-job TTL
  liveJobGcIntervalMs: 5 * 60_000,
  videoJobTtlMs: 6 * 3_600_000,
  videoJobGcIntervalMs: 10 * 60_000,
} as const;

const GATEWAY_DEFAULTS = {
  anthropicRequiredMaxTokens: 128_000,
  opusReasoningBudgetTokens: 100_000,
} as const;

// ---------------------------------------------------------------------------
// Job API — async job queue so sub-nodes can run completions in the background,
// entirely decoupled from any HTTP connection lifetime (no 300 s proxy limit).
// ---------------------------------------------------------------------------

interface StreamJobEntry {
  id:              string;
  model:           string;
  /** Raw JSON strings for each chunk (no "data:" prefix, no "\n\n"). */
  chunks:          string[];
  done:            boolean;
  error:           string | null;
  /** True when error is a provider/model-level 4xx — backend is still healthy. */
  errorIsProvider: boolean;
  emitter:         EventEmitter;
  createdAt:       number;
  lastAccessAt:    number;
  abort:           AbortController;
}

const jobStore = new Map<string, StreamJobEntry>();
const JOB_TTL_MS = GATEWAY_TIMEOUTS.liveJobTtlMs;

// ---------------------------------------------------------------------------
// Live Job Map — fingerprint → running StreamJobEntry
// ---------------------------------------------------------------------------
// When the platform's hard incoming-HTTP limit fires, Leg A keeps running and its
// chunks stay buffered here.  The next identical POST from the client matches
// the same fingerprint → re-attaches to the existing Leg A → replays buffered
// chunks at network speed, then receives new real-time chunks.  Zero new AI
// calls.  One LLM call, unlimited HTTP reconnects.
// ---------------------------------------------------------------------------
const liveJobMap = new Map<string, StreamJobEntry>(); // fp → live job

setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobStore) {
    if (job.lastAccessAt < cutoff) { job.abort.abort("gc"); jobStore.delete(id); }
  }
  // GC liveJobMap: remove entries whose job is done, aborted, or expired
  for (const [fp, job] of liveJobMap) {
    if (job.done || job.abort.signal.aborted || job.lastAccessAt < cutoff) liveJobMap.delete(fp);
  }
}, GATEWAY_TIMEOUTS.liveJobGcIntervalMs).unref();

function makeJobId(): string {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Append one chunk payload (parsed JSON object) to the job. */
function appendJobChunk(job: StreamJobEntry, data: unknown): void {
  job.chunks.push(JSON.stringify(data));
  job.emitter.emit("chunk");
}

/** Mark the job as successfully done. */
function finishJob(job: StreamJobEntry): void {
  job.done = true;
  job.emitter.emit("done");
}

/** Mark the job as failed. isProvider=true means it's a 4xx provider error, not a backend fault. */
function failJob(job: StreamJobEntry, error: string, isProvider = false): void {
  job.error           = error;
  job.errorIsProvider = isProvider;
  job.done            = true;
  job.emitter.emit("done");
}

/**
 * Stream all buffered + future chunks from a job to an SSE response.
 * Writes "id: <jobId>:<idx>\ndata: <json>\n\n" per chunk.
 * Resolves when job is done or client disconnects.
 * Caller is responsible for SSE headers and final res.end().
 */
function streamJobToResponse(res: Response, job: StreamJobEntry, fromIdx: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let nextIdx = fromIdx;

    const sendPending = (): boolean => {
      while (nextIdx < job.chunks.length) {
        if (res.writableEnded) return false;
        res.write(`id: ${job.id}:${nextIdx}\ndata: ${job.chunks[nextIdx]}\n\n`);
        nextIdx++;
      }
      return true;
    };

    const finish = () => {
      if (!res.writableEnded) {
        if (job.error) {
          res.write(`data: ${JSON.stringify({ error: { message: job.error, type: "job_error" } })}\n\n`);
        }
        res.write("data: [DONE]\n\n");
      }
    };

    // Flush any chunks already buffered
    if (!sendPending() || job.done) {
      if (job.done) finish();
      resolve();
      return;
    }

    const onChunk = () => { if (res.writableEnded) { cleanup(); resolve(); return; } sendPending(); };
    const onDone  = () => { if (!res.writableEnded) sendPending(); finish(); cleanup(); resolve(); };
    const onClose = () => { cleanup(); resolve(); };

    const cleanup = () => {
      job.emitter.removeListener("chunk", onChunk);
      job.emitter.removeListener("done",  onDone);
      res.removeListener("close", onClose);
    };

    job.emitter.on("chunk", onChunk);
    job.emitter.on("done",  onDone);
    res.on("close", onClose);
  });
}

/** Parse a Last-Event-ID of the form "<jobId>:<chunkIdx>". */
function parseLastEventId(raw: string | undefined): { jobId: string; lastIdx: number } | null {
  if (!raw) return null;
  const colon = raw.lastIndexOf(":");
  if (colon === -1) return null;
  const jobId = raw.slice(0, colon);
  const idx   = parseInt(raw.slice(colon + 1), 10);
  if (!jobId || Number.isNaN(idx) || idx < 0) return null;
  return { jobId, lastIdx: idx };
}

// ---------------------------------------------------------------------------
// Dynamic backends (cloud-persisted via GCS in production, local file in dev)
// ---------------------------------------------------------------------------

interface DynamicBackend {
  label: string;
  url?: string;
  publicBaseUrl?: string;
  apiBaseUrl?: string;
  enabled?: boolean;
}

let dynamicBackends: DynamicBackend[] = getDynamicBackendsSnapshot();
// Monotonically increasing counter for dynamic backend labels.
// Never reuses a number even after deletions, preventing label collisions.
let dynamicLabelCounter = 0;

function persistDynamicBackends(list: DynamicBackend[]): void {
  saveDynamicBackends(list);
}

interface RoutingSettings { fakeStream: boolean }
let routingSettings: RoutingSettings = { fakeStream: true };

export const initReady: Promise<void> = (async () => {
  childNodeRegisterSucceeded = false;
  try {
    builtinRegistryEntries = getBuiltinRegistryEntries();
    await refreshManualOverlayRegistryCache();
    refreshNewapiImportedRegistryCache();
    refreshUnifiedRegistryCache();
    console.log(`[init] loaded builtin registry entries: ${builtinRegistryEntries.length}, manual overlays: ${manualOverlayRegistryCache.size}, persisted manual overlays: ${persistedManualOverlayRegistryCache.size}, env manual overlays: ${envManualOverlayRegistryCache.size}, child reported: ${childReportedRegistryCache.size}, newapi imports: ${newapiImportedRegistryCache.size}`);
  } catch (err) {
    console.warn("[init] failed to load builtin model registry:", (err as Error).message ?? err);
    builtinRegistryEntries = [];
    await refreshManualOverlayRegistryCache();
    refreshNewapiImportedRegistryCache();
    refreshUnifiedRegistryCache();
  }

  const [savedBackends, savedRouting, savedCustomModels, savedManaged, savedRoutes] = await Promise.all([
    loadDynamicBackends().catch(() => []),
    readJson<Partial<RoutingSettings>>("routing_settings.json").catch(() => null),
    readJson<CustomOpenRouterModel[]>("custom_openrouter_models.json").catch(() => null),
    readJson<{ openai?: string[]; anthropic?: string[]; gemini?: string[]; openrouter?: string[] }>("managed_models.json").catch(() => null),
    readJson<ModelRoute[]>("model_routes.json").catch(() => null),
  ]);
  if (Array.isArray(savedBackends)) {
    dynamicBackends = savedBackends;
    setDynamicBackends(dynamicBackends);
    // Restore the label counter so newly-added backends never collide with loaded ones.
    // Parse the numeric suffix from every "DYNAMIC_N" label and take the max.
    for (const b of dynamicBackends) {
      const m = /^DYNAMIC_(\d+)$/.exec(b.label);
      if (m) dynamicLabelCounter = Math.max(dynamicLabelCounter, parseInt(m[1], 10));
    }
    console.log(`[init] loaded ${dynamicBackends.length} dynamic backend(s), label counter=${dynamicLabelCounter}`);
  }
  // unifiedModelManager handles disabled_models.json + model-groups.json loading automatically
  const disabledCount = (await getDisabledModels()).size;
  if (disabledCount > 0) console.log(`[init] loaded ${disabledCount} disabled model(s) via unifiedModelManager`);
  if (savedRouting && typeof savedRouting === "object") {
    if (typeof savedRouting.fakeStream === "boolean") routingSettings.fakeStream = savedRouting.fakeStream;
  }
  if (Array.isArray(savedCustomModels)) {
    customOpenRouterModels = savedCustomModels;
    console.log(`[init] loaded ${customOpenRouterModels.length} custom OpenRouter model(s)`);
  }
  if (savedManaged && typeof savedManaged === "object") {
    if (Array.isArray(savedManaged.openai)) { managedOpenAI = savedManaged.openai; console.log(`[init] loaded ${managedOpenAI.length} managed OpenAI models`); }
    if (Array.isArray(savedManaged.anthropic)) {
      // Migrate dash-format 4.x Anthropic models → dot-format:
      // e.g. "claude-opus-4-6" → "claude-opus-4.6", "claude-opus-4-6-fast" → "claude-opus-4.6-fast"
      const migrated = savedManaged.anthropic.map((m) =>
        m.replace(/^(claude-(?:opus|sonnet|haiku)-)(\d+)-(\d+)(.*)$/, (_, pre, maj, min, rest) => `${pre}${maj}.${min}${rest}`)
      );
      if (migrated.join(",") !== savedManaged.anthropic.join(",")) {
        console.log(`[init] migrated ${migrated.length} Anthropic model IDs to dot-format`);
      }
      managedAnthropic = migrated;
      console.log(`[init] loaded ${managedAnthropic.length} managed Anthropic models`);
    }
    if (Array.isArray(savedManaged.gemini)) { managedGemini = savedManaged.gemini; console.log(`[init] loaded ${managedGemini.length} managed Gemini models`); }
    if (Array.isArray(savedManaged.openrouter)) { managedOpenRouter = savedManaged.openrouter; console.log(`[init] loaded ${managedOpenRouter.length} managed OpenRouter featured models`); }
  }
  if (Array.isArray(savedRoutes)) {
    modelRoutes = savedRoutes;
    console.log(`[init] loaded ${modelRoutes.length} model route rule(s)`);
  }
  rebuildModelIndex();
  console.log(`[init] model index built: ${ALL_MODELS.length} models across all providers`);
  console.log("[init] routing settings:", JSON.stringify(routingSettings));
})();

initReady
  .then(() => {
    startChildNodeAutoReportLoop();
  })
  .catch(() => {
    // init failure is handled by startup path; child auto-report must remain optional.
  });

function saveRoutingSettings(): void {
  writeJson("routing_settings.json", routingSettings).catch((err) => {
    console.error("[routing] failed to save settings:", err);
  });
}

// isModelEnabled is imported from unifiedModelManager — do not redefine locally.


// ── Health probe helpers ─────────────────────────────────────────────────────
//
// probeHealth   — pure network function: makes one HTTP check, returns boolean.
//                 No side effects on the cache.
//
// probeAndSetHealth — dedup-guarded wrapper:
//   • Skips if a probe is already in-flight for this URL.
//   • After the probe completes, guards against a stale "healthy" result:
//     if markUnhealthy() was called *after* this probe started, the healthy
//     result is discarded (the node just failed a real request — trust that).
//
// markUnhealthy — records the failure timestamp, writes false to cache,
//                 then fires a background probe so we detect recovery quickly.
//
// This three-layer design eliminates the classic race:
//   T+0  refreshHealthAsync starts probe for URL_A
//   T+10 real request → URL_A fails → markUnhealthy → health=false
//   T+15 probe from T+0 finishes → returns true
//        → without the stale-check, this would overwrite health=true!
//        → with the stale-check: lastFailedAt[URL_A]=T+10 > probeStart=T+0 → ignored ✓


let requestCounter = 0;

// ---------------------------------------------------------------------------
// Cache-affinity consistent hashing
//
// Anthropic prompt caching keys on: API-key + model + exact prefix bytes.
// Each friend proxy sub-node has its own upstream API credentials, so
// caching is per-sub-node.  Simple round-robin scatters requests across
// sub-nodes and destroys cache locality.
//
// Cache-affinity routing hashes (model + system-prompt prefix) to
// deterministically pick a sub-node.  All conversations sharing the same
// system prompt hit the same node → cache builds up → cost drops.
//
// When a node goes down:
//   • buildBackendPool() already excludes unhealthy nodes.
//   • The hash lands on the next healthy node in the (smaller) pool.
//   • markUnhealthy / probeAndSetHealth still work — no special handling.
//   • When the node recovers it re-enters the pool and reclaims its hash slice.
//
// Fallback: if no fingerprint is available (e.g. embeddings), plain round-robin.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FNV-1a hash — fast, well-distributed for short strings (fingerprints & URLs)
// ---------------------------------------------------------------------------
function fnv1aHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Rate-limit cooldown tracking (exponential back-off)
//
// 429 (transient burst):   first hit → 60 s, each repeat doubles up to 10 min.
// 402 (billing exhausted): flat 6 hours — billing issues do not auto-resolve
//                          within minutes, so a short cooldown is wasteful.
//
// hitCount tracks repeated 429s on the same node to drive the doubling logic.
// A node that recovers (returns 2xx) should NOT have its counter reset here —
// the counter is only reset when the cooldown expires naturally, so a brief
// recovery followed by another 429 still benefits from extended back-off.
//
// This is NOT the same as markUnhealthy (5xx/network errors).  A rate-limited
// node is healthy — it just needs a breather before we try it again.
// ---------------------------------------------------------------------------
const BASE_RATE_LIMIT_MS  =    60_000;  //  60 s — first 429
const MAX_RATE_LIMIT_MS   =   600_000;  //  10 min — 429 ceiling
const QUOTA_COOLDOWN_MS   = 6 * 3_600_000; //   6 h — 402 billing exhaustion

const rateLimitUntil = new Map<string, number>(); // url → expire timestamp
const rateLimitHits  = new Map<string, number>(); // url → consecutive 429 count

function markRateLimited(url: string, status: number): void {
  if (status === 402) {
    // Billing exhaustion: long flat cooldown, reset hit counter (irrelevant here)
    rateLimitUntil.set(url, Date.now() + QUOTA_COOLDOWN_MS);
    rateLimitHits.delete(url);
    return;
  }
  // 429: exponential back-off — double the cooldown each consecutive hit
  const hits = (rateLimitHits.get(url) ?? 0) + 1;
  rateLimitHits.set(url, hits);
  const cooldown = Math.min(BASE_RATE_LIMIT_MS * Math.pow(2, hits - 1), MAX_RATE_LIMIT_MS);
  const until = Date.now() + cooldown;
  const existing = rateLimitUntil.get(url) ?? 0;
  if (until > existing) rateLimitUntil.set(url, until);
}

function isRateLimited(url: string): boolean {
  const until = rateLimitUntil.get(url);
  if (!until) return false;
  if (Date.now() >= until) {
    // Cooldown expired: clear both maps so the node re-enters normal rotation
    rateLimitUntil.delete(url);
    rateLimitHits.delete(url);
    return false;
  }
  return true;
}

/** Remaining cooldown in ms — used for stats/logging, returns 0 if not limited. */
function rateLimitRemainingMs(url: string): number {
  const until = rateLimitUntil.get(url) ?? 0;
  return Math.max(0, until - Date.now());
}

// ---------------------------------------------------------------------------
// Anthropic prompt cache — system stability detection
// ---------------------------------------------------------------------------
// Tracks per-model system prompt hash across consecutive requests.
// When the system prompt is stable (VCP/Kilo Code system instructions don't
// change between turns), top-level cache_control is enabled for maximum
// benefit (full prefix → cache_read at 0.1×).
// When it changes (VCP injects per-second timestamps, live weather, RAG
// blocks), cache_control is DISABLED to avoid the 1.25× cache_write penalty
// on content that will never be cache_read.
// The explicit tools breakpoint (injected in buildBody) always provides
// savings regardless of system stability.
const _systemStabilityCache = new Map<string, string>();

// ── Stability cache persistence ───────────────────────────────────────────────
// Survives server restarts so Tier 1 caching resumes immediately on the next
// request without a cold-start round.
const STABILITY_FILE = "cache_stability.json";
let _stabilityFlushTimer: ReturnType<typeof setTimeout> | null = null;

function _schedulePersistStability(): void {
  if (_stabilityFlushTimer) return;
  _stabilityFlushTimer = setTimeout(() => {
    _stabilityFlushTimer = null;
    writeJson(STABILITY_FILE, {
      stability: Object.fromEntries(_systemStabilityCache),
      prevText:  Object.fromEntries(_prevSystemTextCache),
    }).catch(() => {});
  }, 30_000); // debounce: flush at most once per 30 s
}

async function _loadStabilityCaches(): Promise<void> {
  try {
    const saved = await readJson<{ stability?: Record<string, string>; prevText?: Record<string, string> }>(STABILITY_FILE);
    if (saved?.stability) for (const [k, v] of Object.entries(saved.stability)) _systemStabilityCache.set(k, v);
    if (saved?.prevText)  for (const [k, v] of Object.entries(saved.prevText))  _prevSystemTextCache.set(k, v);
    if (_systemStabilityCache.size > 0) console.log(`[cache] restored ${_systemStabilityCache.size} stability entries from disk`);
  } catch { /* first boot — file doesn't exist yet */ }
}

/** Returns true if the system text matches the previous call for this key. */
function checkSystemStability(key: string, text: string): boolean {
  const h = String(fnv1aHash(text));
  const prev = _systemStabilityCache.get(key);
  _systemStabilityCache.set(key, h);
  _schedulePersistStability();
  return !!prev && prev === h;
}

// ---------------------------------------------------------------------------
// Tier 2: Longest Common Prefix (LCP) split for explicit cache breakpoints
// ---------------------------------------------------------------------------
// When the system prompt changes between requests (Tier 1 unstable), we
// compare the current text with the previous text to find the longest
// byte-identical prefix.  This prefix is stable content (persona, instructions,
// tool definitions) and the diverging suffix is dynamic content (RAG blocks,
// timestamps, weather, memory recalls).
//
// By placing an explicit cache_control breakpoint at the LCP boundary:
//   • Stable prefix → cache_read at 0.1× (huge savings)
//   • Dynamic suffix → normal 1.0× (no write penalty)
//
// This is frontend-agnostic: works for VCP, Kilo Code, SillyTavern,
// CherryStudio, AIO Hub, or any unknown client.  No pattern matching needed.
// ---------------------------------------------------------------------------

const _prevSystemTextCache = new Map<string, string>();

type SystemLayerTier = "stable" | "low" | "volatile";

interface SystemLayerRule {
  label: string;
  tier: Exclude<SystemLayerTier, "stable">;
  pattern: RegExp;
}

interface SystemLayerMatch {
  start: number;
  end: number;
  text: string;
  label: string;
  tier: Exclude<SystemLayerTier, "stable">;
}

interface SystemLayerChunk {
  tier: SystemLayerTier;
  label: string;
  start: number;
  end: number;
  text: string;
}

interface LayeredSystemAnalysis {
  original: string;
  comparableSystem: string;
  systemWithoutVolatile: string;
  stableText: string;
  lowFrequencyText: string;
  volatileText: string;
  chunks: SystemLayerChunk[];
  stableLength: number;
  lowFrequencyLength: number;
  volatileLength: number;
  totalLength: number;
  lowFrequencyLabels: string[];
  volatileLabels: string[];
}

interface LCPSplitResult {
  stable: string;
  dynamic: string;
  lcpLength: number;
  divergeIndex: number;
  divergenceSource: string;
}

interface LayeredSinkingResult {
  system: string;
  messages: unknown[];
  sunk: boolean;
  analysis: LayeredSystemAnalysis;
}

interface CacheDecisionDiagnostics {
  systemTotalLength: number;
  stableLayerLength: number;
  lowFrequencyLayerLength: number;
  dynamicLayerLength: number;
  comparableSystemLength: number;
  lcpEffectiveLength: number;
  firstDivergenceSource: string;
  cachePlan: string;
}

interface PreparedLayeredCachePlan {
  system: string;
  messages: unknown[];
  stable: boolean;
  lcpResult: LCPSplitResult | null;
  diagnostics: CacheDecisionDiagnostics;
  analysis: LayeredSystemAnalysis;
}

const SYSTEM_LAYER_RULES: SystemLayerRule[] = [
  {
    label: "rag_block",
    tier: "volatile",
    pattern: /<!-- VCP_RAG_BLOCK_START[\s\S]*?<!-- VCP_RAG_BLOCK_END -->/g,
  },
  {
    label: "memory_block",
    tier: "volatile",
    pattern: /(?:^|\n)————记忆区————\n[\s\S]*?\n————以上是过往记忆区————/g,
  },
  {
    label: "date_weather_context",
    tier: "volatile",
    pattern: /(?:^|\n)今天是20\d{2}\/[^\n]*/g,
  },
  {
    label: "weather_payload",
    tier: "volatile",
    pattern: /(?:^|\n)当前天气是\{\{[\s\S]*?\}\}[。.]?/g,
  },
  {
    label: "system_info_line",
    tier: "volatile",
    pattern: /(?:^|\n)系统信息是[^\n]+/g,
  },
  {
    label: "current_runtime_meta",
    tier: "volatile",
    pattern: /(?:^|\n)# Current (?:Time|Cost)\n(?:[^\n]*\n)*?(?=(?:# [^\n]+)|$)/g,
  },
  {
    label: "expanded_time_runtime",
    tier: "volatile",
    pattern: /\{\{(?:Date|Time|Today|Festival)\}\}/g,
  },
  {
    label: "async_result",
    tier: "volatile",
    pattern: /\{\{VCP_ASYNC_RESULT::[\s\S]*?\}\}/g,
  },
  {
    label: "expanded_var_tar",
    tier: "low",
    pattern: /\{\{(?:Var|Tar)[^}\r\n]{20,}\}\}/g,
  },
  {
    label: "meta_thinking_block",
    tier: "low",
    pattern: /(?:^|\n)————【VCP元思考】————\n[\s\S]*?\n————【VCP元思考】加载结束—————/g,
  },
  {
    label: "timeline_block",
    tier: "low",
    pattern: /(?:^|\n)————日记时间线————\n[\s\S]*?(?=\n(?:————记忆区————|Nova的个人记忆二合一:))/g,
  },
  {
    label: "toolbox_section",
    tier: "low",
    pattern: /(?:^|\n)# VCP [^\n]*工具箱能力收纳\n[\s\S]*?(?=\n(?:---\n\n)?# VCP [^\n]*工具箱能力收纳|\n—— 日记 \(DailyNote\) ——|\n额外指令:|\n————表情包系统————|\n====|$)/g,
  },
  {
    label: "rendering_guide_block",
    tier: "low",
    pattern: /(?:^|\n)额外指令:当前Vchat客户端支持高级流式输出渲染器[\s\S]*?(?=\n(?:日记编辑工具：|————表情包系统————|====)|$)/g,
  },
  {
    label: "dailynote_guide_block",
    tier: "low",
    pattern: /(?:^|\n)—— 日记 \(DailyNote\) ——\n[\s\S]*?(?=\n(?:额外指令:|————表情包系统————|====)|$)/g,
  },
  {
    label: "emoji_catalog_block",
    tier: "low",
    pattern: /(?:^|\n)————表情包系统————\n[\s\S]*?(?=\n(?:可选音乐列表：|\(VCP Agent\)|====)|$)/g,
  },
  {
    label: "toolbox_hint",
    tier: "low",
    pattern: /(?:^|\n)\*\(提示：当前上下文中还隐藏收纳了另外 \d+ 个工具模块分组，您可以通过明确提问或强调相关语境来获得展开。\)\*/g,
  },
];

function collectSystemLayerMatches(system: string): SystemLayerMatch[] {
  const matches: SystemLayerMatch[] = [];

  for (const rule of SYSTEM_LAYER_RULES) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(system)) !== null) {
      const text = match[0] ?? "";
      if (!text) {
        if (regex.lastIndex === match.index) regex.lastIndex++;
        continue;
      }
      matches.push({
        start: match.index,
        end: match.index + text.length,
        text,
        label: rule.label,
        tier: rule.tier,
      });
      if (regex.lastIndex === match.index) regex.lastIndex++;
    }
  }

  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  const accepted: SystemLayerMatch[] = [];
  let cursor = -1;
  for (const match of matches) {
    if (match.start < cursor) continue;
    accepted.push(match);
    cursor = match.end;
  }
  return accepted;
}

function analyzeSystemLayers(system: string): LayeredSystemAnalysis {
  const matches = collectSystemLayerMatches(system);
  const chunks: SystemLayerChunk[] = [];
  const stableParts: string[] = [];
  const lowParts: string[] = [];
  const volatileParts: string[] = [];
  const keptSystemParts: string[] = [];
  const lowFrequencyLabels: string[] = [];
  const volatileLabels: string[] = [];

  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      const text = system.slice(cursor, match.start);
      chunks.push({ tier: "stable", label: "stable_text", start: cursor, end: match.start, text });
      stableParts.push(text);
      keptSystemParts.push(text);
    }

    chunks.push({
      tier: match.tier,
      label: match.label,
      start: match.start,
      end: match.end,
      text: match.text,
    });

    if (match.tier === "low") {
      lowParts.push(match.text);
      keptSystemParts.push(match.text);
      if (!lowFrequencyLabels.includes(match.label)) lowFrequencyLabels.push(match.label);
    } else {
      volatileParts.push(match.text);
      if (!volatileLabels.includes(match.label)) volatileLabels.push(match.label);
    }

    cursor = match.end;
  }

  if (cursor < system.length) {
    const text = system.slice(cursor);
    chunks.push({ tier: "stable", label: "stable_text", start: cursor, end: system.length, text });
    stableParts.push(text);
    keptSystemParts.push(text);
  }

  const stableText = stableParts.join("");
  const lowFrequencyText = lowParts.join("");
  const volatileText = volatileParts.join("");
  const systemWithoutVolatile = keptSystemParts.join("").trim();
  const comparableSystem = systemWithoutVolatile;

  return {
    original: system,
    comparableSystem,
    systemWithoutVolatile,
    stableText,
    lowFrequencyText,
    volatileText,
    chunks,
    stableLength: stableText.length,
    lowFrequencyLength: lowFrequencyText.length,
    volatileLength: volatileText.length,
    totalLength: system.length,
    lowFrequencyLabels,
    volatileLabels,
  };
}

function inferDivergenceSource(analysis: LayeredSystemAnalysis, divergeIdx: number): string {
  if (divergeIdx < 0) return analysis.volatileLabels[0] ?? "none";

  let cursor = 0;
  for (const chunk of analysis.chunks) {
    if (chunk.tier === "volatile") continue;
    const nextCursor = cursor + chunk.text.length;
    if (divergeIdx < nextCursor) return chunk.label;
    cursor = nextCursor;
  }

  return analysis.volatileLabels[0] ?? "system_tail";
}

/**
 * Compare current system text with the previous request's text for the same
 * model key.  Returns a {stable, dynamic} split if a useful common prefix
 * exists, or null if there's no useful split (first request, or prefix too short).
 *
 * Always updates the cache with currentText for the next comparison.
 */
function computeLCPSplit(
  key: string,
  currentText: string,
  analysis?: LayeredSystemAnalysis,
): LCPSplitResult | null {
  const prev = _prevSystemTextCache.get(key);
  _prevSystemTextCache.set(key, currentText);
  _schedulePersistStability();

  if (!prev || prev === currentText) return null;

  // Find character-level divergence point
  const minLen = Math.min(prev.length, currentText.length);
  let divergeIdx = 0;
  while (divergeIdx < minLen && prev.charCodeAt(divergeIdx) === currentText.charCodeAt(divergeIdx)) {
    divergeIdx++;
  }

  // Snap back to the last newline boundary to avoid splitting mid-line/mid-token.
  let boundary = currentText.lastIndexOf('\n', divergeIdx);
  if (boundary <= 0) return null;
  boundary += 1; // include the newline in the stable prefix

  // Minimum ~1000 tokens (4000 chars) for the stable prefix.
  // Below this, Anthropic's cache overhead outweighs savings.
  // If prefix < model's actual minimum (e.g. Opus 4096 tokens), the API
  // simply ignores the breakpoint — no error, no penalty.
  if (boundary < 4000) return null;

  const stable = currentText.slice(0, boundary);
  const dynamic = currentText.slice(boundary);
  if (!dynamic.trim()) return null;

  return {
    stable,
    dynamic,
    lcpLength: stable.length,
    divergeIndex: divergeIdx,
    divergenceSource: analysis ? inferDivergenceSource(analysis, divergeIdx) : "system_text",
  };
}

function prepareLayeredSystemCachePlan(
  key: string,
  system: string,
  messages: unknown[],
): PreparedLayeredCachePlan {
  const sinkRes = applyDynamicSinking(system, messages);
  const comparableSystem = sinkRes.analysis.comparableSystem;
  const stable = comparableSystem.length > 0 ? checkSystemStability(key, comparableSystem) : false;
  const lcpResult = comparableSystem.length > 0 ? computeLCPSplit(key, comparableSystem, sinkRes.analysis) : null;
  const diagnostics: CacheDecisionDiagnostics = {
    systemTotalLength: sinkRes.analysis.totalLength,
    stableLayerLength: sinkRes.analysis.stableLength,
    lowFrequencyLayerLength: sinkRes.analysis.lowFrequencyLength,
    dynamicLayerLength: sinkRes.analysis.volatileLength,
    comparableSystemLength: comparableSystem.length,
    lcpEffectiveLength: lcpResult?.lcpLength ?? 0,
    firstDivergenceSource: lcpResult?.divergenceSource ?? (sinkRes.analysis.volatileLabels[0] ?? "none"),
    cachePlan: "none",
  };

  return {
    system: sinkRes.system,
    messages: sinkRes.messages,
    stable,
    lcpResult,
    diagnostics,
    analysis: sinkRes.analysis,
  };
}

interface HistoryCacheProbeResult {
  mode: "string" | "array" | "none";
  blockIndex: number;
  cacheable: boolean;
  alreadyCached: boolean;
}

interface HistoryBreakpointDiagnostics {
  lastUserIdx: number;
  anchorUserIdx: number;
  anchorMode: "string" | "array" | "none";
  anchorBlockIndex: number;
  applied: boolean;
  alreadyCached: boolean;
  bridgeMessageCount: number;
  prefixApproxChars: number;
  bridgeApproxChars: number;
  reason: string;
}

interface HistoryBreakpointResult {
  messages: unknown[];
  diagnostics: HistoryBreakpointDiagnostics;
}

function countUnknownContentChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const block of content as Array<Record<string, unknown>>) {
    if (typeof block?.text === "string") chars += block.text.length;
    else {
      try {
        chars += JSON.stringify(block ?? "").length;
      } catch {
        chars += 0;
      }
    }
  }
  return chars;
}

function countUnknownMessagesChars(msgs: unknown[], start: number, end: number): number {
  let total = 0;
  for (let i = Math.max(0, start); i < Math.min(msgs.length, end); i++) {
    total += countUnknownContentChars((msgs[i] as { content?: unknown })?.content);
  }
  return total;
}

function probeHistoryCacheAnchor(content: unknown): HistoryCacheProbeResult {
  if (typeof content === "string") {
    return {
      mode: "string",
      blockIndex: 0,
      cacheable: content.length > 0,
      alreadyCached: false,
    };
  }

  if (!Array.isArray(content) || content.length === 0) {
    return { mode: "none", blockIndex: -1, cacheable: false, alreadyCached: false };
  }

  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i] as Record<string, unknown> | null | undefined;
    if (!block || typeof block !== "object") continue;
    const type = typeof block.type === "string" ? block.type : "";
    const cacheable = type === "text" || type === "tool_result";
    if (!cacheable) continue;
    return {
      mode: "array",
      blockIndex: i,
      cacheable: true,
      alreadyCached: !!block.cache_control,
    };
  }

  return { mode: "array", blockIndex: -1, cacheable: false, alreadyCached: false };
}

/**
 * Phase 2: inject a history breakpoint on the deepest cacheable user-side block
 * before the final user message.
 *
 * Key round3 change:
 *   - do NOT blindly target "previous user last block"
 *   - instead scan backward for the last cacheable user message, then within that
 *     message scan backward for the last cacheable block (text / tool_result)
 *
 * This directly improves multimodal / tool-call conversations where the last
 * block may be an image or another non-cacheable block, which previously caused
 * P2 to silently no-op.
 */
function injectHistoryBreakpoint(msgs: unknown[]): HistoryBreakpointResult {
  const baseDiagnostics: HistoryBreakpointDiagnostics = {
    lastUserIdx: -1,
    anchorUserIdx: -1,
    anchorMode: "none",
    anchorBlockIndex: -1,
    applied: false,
    alreadyCached: false,
    bridgeMessageCount: 0,
    prefixApproxChars: 0,
    bridgeApproxChars: 0,
    reason: "not_applicable",
  };

  if (!msgs || msgs.length < 3) {
    return { messages: msgs, diagnostics: { ...baseDiagnostics, reason: "too_short" } };
  }

  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if ((msgs[i] as { role?: string }).role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx <= 0) {
    return { messages: msgs, diagnostics: { ...baseDiagnostics, lastUserIdx, reason: "no_final_user" } };
  }

  let anchorUserIdx = -1;
  let anchorProbe: HistoryCacheProbeResult = { mode: "none", blockIndex: -1, cacheable: false, alreadyCached: false };

  for (let i = lastUserIdx - 1; i >= 0; i--) {
    if ((msgs[i] as { role?: string }).role !== "user") continue;
    const probe = probeHistoryCacheAnchor((msgs[i] as { content?: unknown }).content);
    if (!probe.cacheable && !probe.alreadyCached) continue;
    anchorUserIdx = i;
    anchorProbe = probe;
    break;
  }

  const diagnostics: HistoryBreakpointDiagnostics = {
    ...baseDiagnostics,
    lastUserIdx,
    anchorUserIdx,
    anchorMode: anchorProbe.mode,
    anchorBlockIndex: anchorProbe.blockIndex,
    alreadyCached: anchorProbe.alreadyCached,
    bridgeMessageCount: anchorUserIdx >= 0 ? Math.max(0, lastUserIdx - anchorUserIdx - 1) : 0,
    prefixApproxChars: anchorUserIdx >= 0 ? countUnknownMessagesChars(msgs, 0, anchorUserIdx + 1) : 0,
    bridgeApproxChars: anchorUserIdx >= 0 ? countUnknownMessagesChars(msgs, anchorUserIdx + 1, lastUserIdx) : 0,
    reason: "no_cacheable_anchor",
  };

  if (anchorUserIdx < 0) {
    return { messages: msgs, diagnostics };
  }

  const msg = msgs[anchorUserIdx] as { role?: string; content?: unknown };
  const newMsgs = [...msgs];

  if (anchorProbe.mode === "string" && typeof msg.content === "string" && msg.content.length > 0) {
    newMsgs[anchorUserIdx] = {
      ...msg,
      content: [{ type: "text", text: msg.content, cache_control: { type: "ephemeral", ttl: "1h" } }],
    };
    return {
      messages: newMsgs,
      diagnostics: { ...diagnostics, applied: true, reason: "wrapped_string_user_anchor" },
    };
  }

  if (anchorProbe.mode === "array" && Array.isArray(msg.content) && anchorProbe.blockIndex >= 0) {
    const content = [...msg.content];
    const targetBlock = content[anchorProbe.blockIndex] as Record<string, unknown>;
    if (targetBlock?.cache_control) {
      return {
        messages: msgs,
        diagnostics: { ...diagnostics, reason: "already_cached_anchor" },
      };
    }
    content[anchorProbe.blockIndex] = {
      ...targetBlock,
      cache_control: { type: "ephemeral", ttl: "1h" },
    };
    newMsgs[anchorUserIdx] = { ...msg, content };
    return {
      messages: newMsgs,
      diagnostics: {
        ...diagnostics,
        applied: true,
        reason: targetBlock?.type === "tool_result" ? "tool_result_anchor" : "text_block_anchor",
      },
    };
  }

  return { messages: msgs, diagnostics: { ...diagnostics, reason: "anchor_not_mutated" } };
}

// ---------------------------------------------------------------------------
// Cache fingerprint builders
// ---------------------------------------------------------------------------
function buildCacheFingerprint(model: string, messages: OAIMessage[]): string {
  let fp = model;
  // Join all system message text to form a more representative fingerprint.
  // This ensures that even if instructions are split across multiple system messages,
  // the fingerprint remains stable for Rendezvous Hashing affinity.
  const sysText = messages
    .filter((m) => m.role === "system")
    .map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content))
        return (m.content as Array<{ type: string; text?: string }>)
          .filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
      return "";
    })
    .join("");
  
  if (sysText) {
    fp += "|" + sysText.slice(0, 256);
  }
  return fp;
}

function buildCacheFingerprintAnthropic(model: string, system: unknown): string {
  let fp = model;
  if (typeof system === "string") {
    fp += "|" + system.slice(0, 256);
  } else if (Array.isArray(system)) {
    const text = (system as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    fp += "|" + text.slice(0, 256);
  }
  return fp;
}

// ---------------------------------------------------------------------------
// Rendezvous Hashing (Highest Random Weight)
//
// For each candidate backend, compute  score = fnv1a(fingerprint + "|" + url).
// Pick the backend with the highest score.
//
// Properties:
//   • Deterministic: same fingerprint → same backend (cache affinity).
//   • Minimal disruption: removing a backend only redistributes traffic that
//     was assigned to THAT backend.  Everyone else stays put — their caches
//     survive.  This is impossible with simple `hash % pool.length`.
//   • No virtual nodes, no ring — just O(N) score comparisons per pick,
//     which is fine for N ≤ 20 sub-nodes.
// ---------------------------------------------------------------------------

function pickBackendRendezvous(
  pool: Backend[],
  fingerprint: string,
  exclude?: Set<string>,
): Backend | null {
  let best: Backend | null = null;
  let bestScore = -1;

  for (const b of pool) {
    if (exclude?.has(b.url)) continue;
    if (isRateLimited(b.url)) continue;
    const score = fnv1aHash(fingerprint + "|" + b.url);
    if (score > bestScore) { bestScore = score; best = b; }
  }

  if (best) return best;

  // All non-excluded backends are rate-limited.
  // Fall back to the highest-scoring rate-limited backend (better than 503).
  for (const b of pool) {
    if (exclude?.has(b.url)) continue;
    const score = fnv1aHash(fingerprint + "|" + b.url);
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Public pick helpers used by route handlers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Round-robin helper — used for embeddings and non-fingerprinted requests.
// Unlike rendezvous hashing, this has no cache-affinity guarantee, but it
// provides even distribution.  Rate-limited nodes are deprioritised: we first
// try nodes NOT in cooldown, falling back to all nodes only when every node
// is rate-limited (ensures progress under sustained pressure).
// ---------------------------------------------------------------------------

function pickBackend(): Backend | null {
  const pool = buildBackendPool();
  if (pool.length === 0) return null;
  const available = pool.filter((b) => !isRateLimited(b.url));
  const candidates = available.length > 0 ? available : pool;
  const backend = candidates[requestCounter % candidates.length];
  requestCounter++;
  return backend;
}

/**
 * Filter a pool by absolute-routing provider slug if one is set.  Friend
 * entries with `providerSlugs == undefined` are preserved (legacy
 * compatibility, see BackendPoolEntry semantics).
 */
function applyAbsoluteRoutingFilter(
  pool: Backend[],
  providerSlug: string | undefined,
): Backend[] {
  if (!providerSlug) return pool;
  return filterBackendPoolByProvider(pool, providerSlug);
}

/**
 * Pre-flight capability check for absolute provider routing.  Returns
 * whether at least one sub-node in the current pool is known to be able to
 * serve the locked provider, plus pool sizes for diagnostic 422 responses.
 */
function checkAbsoluteRoutingCapability(providerSlug: string): {
  canServe: boolean;
  poolSize: number;
  eligibleSize: number;
} {
  const pool = buildBackendPool();
  const eligible = applyAbsoluteRoutingFilter(pool, providerSlug);
  return { canServe: eligible.length > 0, poolSize: pool.length, eligibleSize: eligible.length };
}

function pickBackendForCache(fingerprint: string, providerSlug?: string): Backend | null {
  const pool = applyAbsoluteRoutingFilter(buildBackendPool(), providerSlug);
  return pickBackendRendezvous(pool, fingerprint);
}

function pickBackendForCacheExcluding(
  fingerprint: string,
  exclude: Set<string>,
  providerSlug?: string,
): Backend | null {
  const pool = applyAbsoluteRoutingFilter(buildBackendPool(), providerSlug);
  return pickBackendRendezvous(pool, fingerprint, exclude);
}

function pickBackendExcluding(exclude: Set<string>, providerSlug?: string): Backend | null {
  const pool = applyAbsoluteRoutingFilter(buildBackendPool(), providerSlug);
  const friends = pool.filter((b) => !exclude.has(b.url));
  if (friends.length === 0) return null;
  // Prefer non-rate-limited backends within the filtered pool
  const available = friends.filter((b) => !isRateLimited(b.url));
  const candidates = available.length > 0 ? available : friends;
  return candidates[requestCounter % candidates.length];
}

// ---------------------------------------------------------------------------
// Client factories
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Per-backend usage statistics — persisted to cloudPersist ("usage_stats.json")
// ---------------------------------------------------------------------------

const STATS_FILE = "usage_stats.json";

interface BackendStat {
  calls: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalDurationMs: number;
  totalTtftMs: number;
  streamingCalls: number;
  totalCostUSD: number;
  modelBreakdown: Record<string, { promptTokens: number; completionTokens: number; cacheReadTokens: number; cacheWriteTokens: number }>;
}

interface ModelStat {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const EMPTY_STAT = (): BackendStat => ({
  calls: 0, errors: 0, promptTokens: 0, completionTokens: 0,
  cacheReadTokens: 0, cacheWriteTokens: 0,
  totalDurationMs: 0, totalTtftMs: 0, streamingCalls: 0,
  totalCostUSD: 0,
  modelBreakdown: {},
});

const EMPTY_MODEL_STAT = (): ModelStat => ({
  calls: 0, promptTokens: 0, completionTokens: 0,
  cacheReadTokens: 0, cacheWriteTokens: 0,
});

const statsMap = new Map<string, BackendStat>();
const modelStatsMap = new Map<string, ModelStat>();

// ── Persistence helpers ────────────────────────────────────────────────────

function statsToObject(): { backends: Record<string, BackendStat>; models: Record<string, ModelStat> } {
  return {
    backends: Object.fromEntries(statsMap.entries()),
    models: Object.fromEntries(modelStatsMap.entries()),
  };
}

async function persistStats(): Promise<void> {
  try { await writeJson(STATS_FILE, statsToObject()); } catch {}
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { _saveTimer = null; void persistStats(); }, 2_000);
}

setInterval(() => { void persistStats(); }, 60_000);

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[stats] ${sig} received, flushing stats…`);
    persistStats().finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000);
  });
}

export const statsReady: Promise<void> = (async () => {
  try {
    const saved = await readJson<Record<string, unknown>>(STATS_FILE);
    if (saved && typeof saved === "object") {
      const backendsRaw = (saved as { backends?: Record<string, BackendStat> }).backends ?? saved as Record<string, BackendStat>;
      const modelsRaw = (saved as { models?: Record<string, ModelStat> }).models;

      for (const [label, raw] of Object.entries(backendsRaw)) {
        // Stage A migration: drop legacy "local" stats entry — mother no longer has a local backend.
        if (label === "local") continue;
        if (raw && typeof raw === "object" && "calls" in (raw as unknown as Record<string, unknown>)) {
          const rawBreakdown = (raw as BackendStat).modelBreakdown;
          const modelBreakdown: BackendStat["modelBreakdown"] = {};
          if (rawBreakdown && typeof rawBreakdown === "object") {
            for (const [m, mb] of Object.entries(rawBreakdown)) {
              if (mb && typeof mb === "object") {
                modelBreakdown[m] = {
                  promptTokens:     Number((mb as { promptTokens?: number }).promptTokens)     || 0,
                  completionTokens: Number((mb as { completionTokens?: number }).completionTokens) || 0,
                  cacheReadTokens:  Number((mb as { cacheReadTokens?: number }).cacheReadTokens)  || 0,
                  cacheWriteTokens: Number((mb as { cacheWriteTokens?: number }).cacheWriteTokens) || 0,
                };
              }
            }
          }
          statsMap.set(label, {
            calls:            Number((raw as BackendStat).calls)            || 0,
            errors:           Number((raw as BackendStat).errors)           || 0,
            promptTokens:     Number((raw as BackendStat).promptTokens)     || 0,
            completionTokens: Number((raw as BackendStat).completionTokens) || 0,
            cacheReadTokens:  Number((raw as BackendStat).cacheReadTokens)  || 0,
            cacheWriteTokens: Number((raw as BackendStat).cacheWriteTokens) || 0,
            totalDurationMs:  Number((raw as BackendStat).totalDurationMs)  || 0,
            totalTtftMs:      Number((raw as BackendStat).totalTtftMs)      || 0,
            streamingCalls:   Number((raw as BackendStat).streamingCalls)   || 0,
            totalCostUSD:     Number((raw as BackendStat).totalCostUSD)     || 0,
            modelBreakdown,
          });
        }
      }

      if (modelsRaw && typeof modelsRaw === "object") {
        for (const [model, raw] of Object.entries(modelsRaw)) {
          if (raw && typeof raw === "object") {
            modelStatsMap.set(model, {
              calls:            Number(raw.calls)            || 0,
              promptTokens:     Number(raw.promptTokens)     || 0,
              completionTokens: Number(raw.completionTokens) || 0,
              cacheReadTokens:  Number((raw as ModelStat).cacheReadTokens)  || 0,
              cacheWriteTokens: Number((raw as ModelStat).cacheWriteTokens) || 0,
            });
          }
        }
      }

      console.log(`[stats] loaded ${statsMap.size} backend(s), ${modelStatsMap.size} model(s) from ${STATS_FILE}`);
    }
  } catch {
    console.warn(`[stats] could not load ${STATS_FILE}, starting fresh`);
  }
})();

// Load stability caches at startup (non-blocking, best-effort)
void _loadStabilityCaches();

// Flush stability caches on clean shutdown so the in-flight 30-s debounce timer
// doesn't get dropped on SIGTERM.
for (const _sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(_sig, () => {
    if (_stabilityFlushTimer) {
      clearTimeout(_stabilityFlushTimer);
      _stabilityFlushTimer = null;
      writeJson(STABILITY_FILE, {
        stability: Object.fromEntries(_systemStabilityCache),
        prevText:  Object.fromEntries(_prevSystemTextCache),
      }).catch(() => {});
    }
  });
}

// ── Stat accessors ─────────────────────────────────────────────────────────

function getStat(label: string): BackendStat {
  if (!statsMap.has(label)) statsMap.set(label, EMPTY_STAT());
  return statsMap.get(label)!;
}

function recordCallStat(label: string, durationMs: number, prompt: number, completion: number, ttftMs?: number, model?: string, cacheRead?: number, cacheWrite?: number): void {
  const s = getStat(label);
  s.calls++;
  s.promptTokens += prompt;
  s.completionTokens += completion;
  s.cacheReadTokens += cacheRead ?? 0;
  s.cacheWriteTokens += cacheWrite ?? 0;
  s.totalDurationMs += durationMs;
  if (ttftMs !== undefined) { s.totalTtftMs += ttftMs; s.streamingCalls++; }
  if (model) {
    const ms = getModelStat(model);
    ms.calls++;
    ms.promptTokens += prompt;
    ms.completionTokens += completion;
    ms.cacheReadTokens += cacheRead ?? 0;
    ms.cacheWriteTokens += cacheWrite ?? 0;

    if (!s.modelBreakdown[model]) {
      s.modelBreakdown[model] = { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    }
    s.modelBreakdown[model].promptTokens += prompt;
    s.modelBreakdown[model].completionTokens += completion;
    s.modelBreakdown[model].cacheReadTokens += cacheRead ?? 0;
    s.modelBreakdown[model].cacheWriteTokens += cacheWrite ?? 0;
  }
  scheduleSave();
}

function getModelStat(model: string): ModelStat {
  if (!modelStatsMap.has(model)) modelStatsMap.set(model, EMPTY_MODEL_STAT());
  return modelStatsMap.get(model)!;
}

function recordCostStat(label: string, costUSD: number): void {
  if (costUSD > 0) { getStat(label).totalCostUSD += costUSD; scheduleSave(); }
}

function recordErrorStat(label: string): void { getStat(label).errors++; scheduleSave(); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setSseHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (res.socket) {
    // Disable Nagle's algorithm — each token chunk is flushed immediately without coalescing.
    res.socket.setNoDelay(true);
    // Reset the socket-level idle timeout to 0 (infinite) so long thinking sessions
    // are never cut by a stale OS or proxy socket timeout.
    res.socket.setTimeout(0);
  }
  res.flushHeaders();
}

function writeAndFlush(res: Response, data: string) {
  res.write(data);
  (res as unknown as { flush?: () => void }).flush?.();
}

async function fakeStreamResponse(
  res: Response,
  json: Record<string, unknown>,
  startTime: number,
): Promise<{ promptTokens: number; completionTokens: number; ttftMs: number }> {
  const id = (json["id"] as string) ?? `chatcmpl-fake-${Date.now()}`;
  const model = (json["model"] as string) ?? "unknown";
  const created = (json["created"] as number) ?? Math.floor(Date.now() / 1000);
  const choices = (json["choices"] as Array<Record<string, unknown>>) ?? [];
  const usage = json["usage"] as { prompt_tokens?: number; completion_tokens?: number } | undefined;

  setSseHeaders(res);

  const roleChunk = {
    id, object: "chat.completion.chunk", created, model,
    choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
  };
  writeAndFlush(res, `data: ${JSON.stringify(roleChunk)}\n\n`);
  const ttftMs = Date.now() - startTime;

  const fullContent = (choices[0]?.["message"] as { content?: string })?.content ?? "";
  const toolCalls = (choices[0]?.["message"] as { tool_calls?: unknown[] })?.tool_calls;

  if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
    const tcChunk = {
      id, object: "chat.completion.chunk", created, model,
      choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }],
    };
    writeAndFlush(res, `data: ${JSON.stringify(tcChunk)}\n\n`);
  }

  const CHUNK_SIZE = 4;
  for (let i = 0; i < fullContent.length; i += CHUNK_SIZE) {
    const slice = fullContent.slice(i, i + CHUNK_SIZE);
    const chunk = {
      id, object: "chat.completion.chunk", created, model,
      choices: [{ index: 0, delta: { content: slice }, finish_reason: null }],
    };
    writeAndFlush(res, `data: ${JSON.stringify(chunk)}\n\n`);
    if (i + CHUNK_SIZE < fullContent.length) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  const finishReason = (choices[0]?.["finish_reason"] as string) ?? "stop";
  const stopChunk = {
    id, object: "chat.completion.chunk", created, model,
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
  writeAndFlush(res, `data: ${JSON.stringify(stopChunk)}\n\n`);
  writeAndFlush(res, "data: [DONE]\n\n");
  res.end();

  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    ttftMs,
  };
}

function requireApiKey(req: Request, res: Response, next: () => void) {
  const proxyKey = getProxyApiKey();
  if (!proxyKey) {
    res.status(500).json({ error: { message: "Server API key not configured", type: "server_error" } });
    return;
  }

  const authHeader = req.headers["authorization"];
  const xApiKey = req.headers["x-api-key"];
  const googApiKey = req.headers["x-goog-api-key"];
  const queryKey = req.query["key"];

  let providedKey: string | undefined;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    providedKey = authHeader.slice(7);
  } else if (typeof googApiKey === "string" && googApiKey) {
    providedKey = googApiKey;
  } else if (typeof xApiKey === "string" && xApiKey) {
    providedKey = xApiKey;
  } else if (typeof queryKey === "string" && queryKey) {
    providedKey = queryKey;
  }

  if (!providedKey) {
    res.status(401).json({
      error: {
        message: "Missing API key",
        type: "invalid_request_error",
        acceptedAuth: ["Authorization: Bearer <key>", "x-goog-api-key", "x-api-key", "query:key"],
      },
    });
    return;
  }
  if (providedKey !== proxyKey) {
    res.status(401).json({ error: { message: "Invalid API key", type: "invalid_request_error" } });
    return;
  }
  next();
}

function requireApiKeyWithQuery(req: Request, res: Response, next: () => void) {
  const queryKey = req.query["key"] as string | undefined;
  if (queryKey) {
    req.headers["authorization"] = `Bearer ${queryKey}`;
  }
  requireApiKey(req, res, next);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Debug-only: dump normalized IR + outbound OpenRouter request shape without
// hitting any backend.  Only active when GATEWAY_DEBUG_NORMALIZE=1.
// Used by scripts/upstream-crosscheck.sh to produce evidence captures.
router.post("/v1/debug/normalize", requireApiKey, async (req: Request, res: Response) => {
  if (process.env["GATEWAY_DEBUG_NORMALIZE"] !== "1") {
    res.status(404).json({ error: "debug endpoint disabled" });
    return;
  }
  try {
    const detection = detectGatewayProtocol(req.body);
    const normalized = normalizeGatewayRequest(req.body, detection);
    const outbound  = buildOpenRouterRequest(normalized.ir);
    res.json({ protocol: normalized.protocol, ir: normalized.ir, outbound });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/api", requireApiKey, async (req: Request, res: Response) => {
  const detection = detectGatewayProtocol(req.body);
  const normalized = normalizeGatewayRequest(req.body, detection);

  const registryMatch = normalized.ir.model
    ? resolveUnifiedRegistryAlias(normalized.ir.model, unifiedRegistryCache.values())
    : null;

  if (registryMatch) {
    normalized.ir.model = registryMatch.canonical_id;
    normalized.ir.modelResolution = {
      ...(normalized.ir.modelResolution ?? {}),
      raw: normalized.ir.requestedModel,
      original: normalized.ir.requestedModel,
      logical: registryMatch.canonical_id.split("/").slice(1).join("/") || registryMatch.canonical_id,
      resolved: registryMatch.canonical_id,
      aliasCandidates: Array.from(new Set([
        ...(normalized.ir.modelResolution?.aliasCandidates ?? []),
        registryMatch.alias,
        registryMatch.canonical_id,
      ])),
      routeApplied: true,
      ...(registryMatch.provider_prefix ? { prefix: registryMatch.provider_prefix } : {}),
      ...((normalized.ir.modelResolution?.providerRoute || registryMatch.provider_prefix) ? {
        providerRoute: normalized.ir.modelResolution?.providerRoute ?? {
          prefix: registryMatch.provider_prefix ?? "openrouter",
          provider: registryMatch.provider_prefix ?? "openrouter",
          source: "model-prefix",
        },
      } : {}),
    };
  }

  const resolvedRegistryModel = normalized.ir.model
    ? getUnifiedModelByAnyId(normalized.ir.model)
    : null;
  const resolvedRegistryContext = getRegistryModelContextSummary(resolvedRegistryModel);
  const resolvedRegistryPricing = getEffectiveRegistryPricingSummary(resolvedRegistryModel);
  const resolvedRegistryCapabilities = getRegistryModelCapabilitiesSummary(resolvedRegistryModel);
  const resolvedRegistryModalities = getRegistryModelModalitiesSummary(resolvedRegistryModel);
  const resolvedRegistryKind = getRegistryModelKind(resolvedRegistryModel);
  const resolvedRegistryRecommendedAliases = resolvedRegistryModel
    ? getModelRecommendedAliases(resolvedRegistryModel)
    : [];
  const resolvedRegistrySourceSummary = resolvedRegistryModel
    ? buildModelSourceSummary(resolvedRegistryModel, [], [])
    : null;
  const resolvedRegistryCapabilityDisplay = resolvedRegistryModel
    ? buildModelCapabilitySummary(
        resolvedRegistryModel,
        resolvedRegistryCapabilities,
        resolvedRegistryModalities,
        resolvedRegistryKind,
      )
    : null;

  const irSummary = summarizeIR(normalized.ir);
  const upstream = buildOpenRouterRequest(normalized.ir);

  if (normalized.protocol === "unknown") {
    res.status(400).json({
      error: {
        message: "Unsupported unified /api request format",
        type: "invalid_request_error",
        details: {
          detected: detection,
          normalized: {
            protocol: normalized.protocol,
            ir: irSummary,
          },
        },
      },
    });
    return;
  }

  const bridge = buildGatewayBridgeRequest(normalized.ir);
  res.setHeader("X-Gateway-Protocol", normalized.protocol);
  res.setHeader("X-Gateway-Target", "openrouter-compatible");
  res.setHeader("X-Gateway-Requested-Model", normalized.ir.requestedModel);
  res.setHeader("X-Gateway-Resolved-Model", normalized.ir.model);
  if (registryMatch) {
    res.setHeader("X-Gateway-Registry-Alias-Kind", registryMatch.kind);
    res.setHeader("X-Gateway-Matched-Alias", registryMatch.alias);
  }
  if (typeof normalized.ir.maxOutputTokens === "number") {
    res.setHeader("X-Gateway-Requested-Max-Tokens", String(normalized.ir.maxOutputTokens));
  } else {
    res.setHeader("X-Gateway-Requested-Max-Tokens", "client-default");
  }
  if (normalized.ir.modelResolution?.logical) {
    res.setHeader("X-Gateway-Logical-Model", normalized.ir.modelResolution.logical);
  }
  if (normalized.ir.modelResolution?.prefix) {
    res.setHeader("X-Gateway-Provider-Prefix", normalized.ir.modelResolution.prefix);
  }
  if (normalized.ir.modelResolution?.providerRoute?.provider) {
    res.setHeader("X-Gateway-Provider-Route", normalized.ir.modelResolution.providerRoute.provider);
  }
  if (resolvedRegistryModel) {
    const resolvedDisplayName = getModelDisplayName(resolvedRegistryModel);
    if (resolvedDisplayName) {
      res.setHeader("X-Gateway-Model-Display-Name", resolvedDisplayName);
    }
    if (resolvedRegistryRecommendedAliases.length > 0) {
      res.setHeader("X-Gateway-Recommended-Alias", resolvedRegistryRecommendedAliases[0]!);
    }
  }
  if (resolvedRegistrySourceSummary?.labels.length) {
    res.setHeader("X-Gateway-Source-Summary", resolvedRegistrySourceSummary.labels.join(","));
  }
  if (resolvedRegistryCapabilityDisplay?.tags.length) {
    res.setHeader("X-Gateway-Capability-Tags", resolvedRegistryCapabilityDisplay.tags.join(","));
  }
  if (resolvedRegistryKind) {
    res.setHeader("X-Gateway-Model-Kind", resolvedRegistryKind);
  }
  if (typeof resolvedRegistryContext.context_window === "number") {
    res.setHeader("X-Gateway-Registry-Context-Window", String(resolvedRegistryContext.context_window));
  }
  if (typeof resolvedRegistryContext.max_output_tokens === "number") {
    res.setHeader("X-Gateway-Registry-Max-Output-Tokens", String(resolvedRegistryContext.max_output_tokens));
  }
  if (typeof resolvedRegistryPricing?.input_per_mtok_usd === "number") {
    res.setHeader("X-Gateway-Registry-Input-Price", String(resolvedRegistryPricing.input_per_mtok_usd));
  }
  if (typeof resolvedRegistryPricing?.output_per_mtok_usd === "number") {
    res.setHeader("X-Gateway-Registry-Output-Price", String(resolvedRegistryPricing.output_per_mtok_usd));
  }

  await executeGatewayRequest({
    req,
    res,
    request: bridge,
    debug: {
      detection,
      irSummary,
      upstreamSummary: upstream.summary,
    },
  });
});

router.get("/v1/models", requireApiKey, async (_req: Request, res: Response) => {
  const pool = buildBackendPool();
  const friendStatuses = getFriendProxyConfigs().map(({ label, publicBaseUrl, apiBaseUrl, source, nodeId, version, enabled, configured, integrationsAllReady, lastHeartbeatAt }) => ({
    label,
    nodeId,
    source,
    publicBaseUrl,
    apiBaseUrl,
    enabled,
    configured,
    integrationsAllReady,
    version,
    lastHeartbeatAt,
    status: getCachedHealth(apiBaseUrl) === null ? "unknown" : getCachedHealth(apiBaseUrl) ? "healthy" : "down",
  }));

  const toRegistryPayload = (model: UnifiedModelView | null): Record<string, unknown> | null => {
    if (!model) return null;
    const persistedMotherManualIds = model.source.manual_ids.filter((id) => persistedManualOverlayRegistryCache.has(id) || persistedManualOverlayRegistryCache.has(model.canonical_id));
    const envMotherManualIds = model.source.manual_ids.filter((id) => envManualOverlayRegistryCache.has(id) || envManualOverlayRegistryCache.has(model.canonical_id));
    const sources = [
      ...(model.source.builtin ? ["builtin"] : []),
      ...(model.source.remote ? ["remote"] : []),
      ...(model.source.manual ? ["manual"] : []),
      ...(model.source.manual_scope ? [`manual_scope=${model.source.manual_scope}`] : []),
      ...(persistedMotherManualIds.length > 0 ? ["mother_manual_store=true"] : []),
      ...(envMotherManualIds.length > 0 ? ["mother_manual_env=true"] : []),
      ...(model.source.child_reported ? ["child_reported=true"] : []),
      ...(model.source.newapi_imported ? ["newapi_imported=true"] : []),
    ];
    const contextSummary = getRegistryModelContextSummary(model);
    const pricingSummary = getEffectiveRegistryPricingSummary(model) ?? getRegistryModelPricingSummary(model);
    const capabilitySummary = getRegistryModelCapabilitiesSummary(model);
    const modalitiesSummary = getRegistryModelModalitiesSummary(model);
    const modelKind = getRegistryModelKind(model);
    const displayName = getModelDisplayName(model) ?? model.canonical_id;
    const recommendedAliases = getModelRecommendedAliases(model);
    const sourceSummary = buildModelSourceSummary(model, persistedMotherManualIds, envMotherManualIds);
    const capabilityDisplay = buildModelCapabilitySummary(model, capabilitySummary, modalitiesSummary, modelKind);
    const conflictSummary = buildModelConflictSummary(model);
    const badges = buildModelBadges(sourceSummary, capabilityDisplay, conflictSummary);

    return {
      provider: model.provider,
      provider_family: model.provider_family,
      display_name: model.display_name,
      aliases: {
        stable: model.aliases.stable,
        friendly: model.aliases.friendly,
        versioned: model.aliases.versioned,
        legacy: model.aliases.legacy,
      },
      display: {
        name: displayName,
        primary_name: displayName,
        canonical_id: model.canonical_id,
        category: modelKind,
      },
      recommended_aliases: recommendedAliases,
      badges,
      context_window: contextSummary.context_window,
      max_output_tokens: contextSummary.max_output_tokens,
      context: {
        ...model.context,
        window_tokens: contextSummary.context_window,
        max_output_tokens: contextSummary.max_output_tokens,
      },
      pricing: pricingSummary,
      price: pricingSummary,
      capabilities: {
        ...model.capabilities,
        thinking: capabilitySummary.thinking,
        vision: capabilitySummary.vision,
        code: capabilitySummary.code,
        tool_use: capabilitySummary.tool_use,
        structured_output: capabilitySummary.structured_output,
        web_search: capabilitySummary.web_search,
        streaming: capabilitySummary.streaming,
      },
      capability_summary: capabilityDisplay,
      modalities: {
        input: modalitiesSummary.input,
        output: modalitiesSummary.output,
      },
      kind: modelKind,
      category: modelKind,
      routing: {
        openrouter_slug: model.routing.openrouter_slug ?? null,
      },
      source: model.source,
      source_detail: {
        mother_manual_store_ids: persistedMotherManualIds,
        mother_manual_env_ids: envMotherManualIds,
      },
      source_summary: sourceSummary,
      sources,
      conflicts: model.source.alias_conflicts,
      conflict_summary: conflictSummary,
      has_conflicts: conflictSummary.has_conflicts,
      conflict_count: conflictSummary.conflict_count,
    };
  };

  const responseEntries: Array<{
    id: string;
    object: "model";
    created: number;
    owned_by: string;
    canonical_id: string;
    description?: string;
    registry: Record<string, unknown> | null;
  }> = [];
  const seenIds = new Set<string>();

  for (const result of await Promise.all(ALL_MODELS.map(async (m) => ({ m, ok: await isModelEnabled(m.id) })))) {
    if (!result.ok || seenIds.has(result.m.id)) continue;
    const unified = getUnifiedModelByAnyId(result.m.id);
    responseEntries.push({
      id: result.m.id,
      object: "model",
      created: 1700000000,
      owned_by: unified?.provider ?? gatewayConfig.ownedBy,
      canonical_id: unified?.canonical_id ?? result.m.id,
      ...(unified?.description ?? result.m.description ? { description: unified?.description ?? result.m.description } : {}),
      registry: toRegistryPayload(unified),
    });
    seenIds.add(result.m.id);
  }

  const staticIds = new Set(ALL_MODELS.map((m) => m.id));
  for (const result of await Promise.all(openrouterDynamicModels.map(async (m) => ({ m, ok: await isModelEnabled(m.id) })))) {
    if (!result.ok || staticIds.has(result.m.id) || seenIds.has(result.m.id)) continue;
    const unified = getUnifiedModelByAnyId(result.m.id);
    responseEntries.push({
      id: result.m.id,
      object: "model",
      created: 1700000000,
      owned_by: unified?.provider ?? "openrouter",
      canonical_id: unified?.canonical_id ?? result.m.id,
      ...(unified?.description ?? result.m.name ? { description: unified?.description ?? result.m.name } : {}),
      registry: toRegistryPayload(unified),
    });
    seenIds.add(result.m.id);
  }

  const knownIds = new Set([...staticIds, ...openrouterDynamicModels.map((m) => m.id)]);
  for (const result of await Promise.all(customOpenRouterModels.map(async (m) => ({ m, ok: await isModelEnabled(m.id) })))) {
    if (!result.ok || knownIds.has(result.m.id) || seenIds.has(result.m.id)) continue;
    const unified = getUnifiedModelByAnyId(result.m.id);
    responseEntries.push({
      id: result.m.id,
      object: "model",
      created: 1700000000,
      owned_by: unified?.provider ?? "openrouter",
      canonical_id: unified?.canonical_id ?? result.m.id,
      description: unified?.description ?? result.m.name ?? "OpenRouter (custom)",
      registry: toRegistryPayload(unified) ?? {
        provider: result.m.id.split("/")[0] ?? "openrouter",
        provider_family: result.m.id.split("/")[0] ?? "openrouter",
        display_name: result.m.name ?? result.m.id,
        aliases: {
          stable: [result.m.id],
          friendly: [],
          versioned: [],
          legacy: [],
        },
        display: {
          name: result.m.name ?? result.m.id,
          primary_name: result.m.name ?? result.m.id,
          canonical_id: result.m.id,
          category: null,
        },
        recommended_aliases: [],
        badges: [],
        context_window: null,
        max_output_tokens: null,
        pricing: {
          input_per_mtok_usd: null,
          output_per_mtok_usd: null,
          cache_read_per_mtok_usd: null,
          cache_write_per_mtok_usd: null,
        },
        capabilities: {
          thinking: null,
          vision: null,
          code: null,
          tool_use: null,
          structured_output: null,
          web_search: null,
          streaming: null,
        },
        capability_summary: {
          flags: {
            thinking: null,
            vision: null,
            code: null,
            tool_use: null,
            structured_output: null,
            web_search: null,
            streaming: null,
            multimodal: null,
          },
          tags: [],
          multimodal: null,
          category: null,
          input_modalities: [],
          output_modalities: [],
        },
        modalities: {
          input: [],
          output: [],
        },
        kind: null,
        category: null,
        source: {
          builtin: false,
          remote: false,
          manual: false,
          manual_scope: null,
          child_reported: false,
          newapi_imported: false,
          manual_ids: [],
          child_reported_ids: [],
          newapi_import_ids: [],
          child_node_ids: [],
          source_rank: 0,
          source_ids: [],
          alias_conflicts: [],
        },
        source_summary: {
          labels: [],
          primary: null,
          raw_count: 0,
          source_ids: [],
          manual_scope: null,
        },
        sources: [],
        conflicts: [],
        conflict_summary: {
          has_conflicts: false,
          conflict_count: 0,
        },
        has_conflicts: false,
        conflict_count: 0,
      },
    });
    seenIds.add(result.m.id);
  }

  // ── OR model map entries — comprehensive explicit OR model namespace ─────────
  // orModelMapManual.json + orModelMap.json contain all OR-prefixed model variants
  // (anthropic/, bedrock/, vertex/, azure/ × all versions × -thinking/-max suffixes).
  // Adding these ensures newapi can see and select any OR-routed model variant
  // without requiring a live OR catalog fetch.
  {
    const LOCAL_CREATED = Math.floor(Date.now() / 1000);
    const orMapFiles = [
      resolve(process.cwd(), "src/lib/orModelMapManual.json"),
      resolve(process.cwd(), "src/lib/orModelMap.json"),
      resolve(process.cwd(), "../../artifacts/api-server/src/lib/orModelMapManual.json"),
      resolve(process.cwd(), "../../artifacts/api-server/src/lib/orModelMap.json"),
    ];
    const mapKeys = new Set<string>();
    for (const filePath of orMapFiles) {
      try {
        if (existsSync(filePath)) {
          const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
          for (const k of Object.keys(raw)) {
            if (!k.startsWith("_")) mapKeys.add(k);
          }
        }
      } catch { /* best-effort */ }
    }
    for (const id of mapKeys) {
      if (seenIds.has(id)) continue;
      const unified = getUnifiedModelByAnyId(id);
      responseEntries.push({
        id,
        object: "model",
        created: LOCAL_CREATED,
        owned_by: unified?.provider ?? (id.split("/")[0] ?? "openrouter"),
        canonical_id: unified?.canonical_id ?? id,
        registry: toRegistryPayload(unified),
      });
      seenIds.add(id);
    }
  }

  res.json({
    object: "list",
    data: responseEntries,
    _meta: {
      active_backends: pool.length,
      local: "healthy",
      friends: friendStatuses,
      registry: {
        builtin: builtinRegistryEntries.length,
        remote: remoteOverlayRegistryCache.size,
        manual: manualOverlayRegistryCache.size,
        manual_store: persistedManualOverlayRegistryCache.size,
        manual_env: envManualOverlayRegistryCache.size,
        child_reported: childReportedRegistryCache.size,
        newapi_imported: newapiImportedRegistryCache.size,
        unified: unifiedRegistryCache.size,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Image format conversion: OpenAI image_url → Anthropic image
// ---------------------------------------------------------------------------

type OAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } }
  | Record<string, unknown>;

type OAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OAITool = {
  type: "function";
  function: { name: string; description?: string; parameters?: unknown };
};

type OAIMessage =
  | { role: "system"; content: string | OAIContentPart[] }
  | { role: "user"; content: string | OAIContentPart[] }
  | { role: "assistant"; content: string | OAIContentPart[] | null; tool_calls?: OAIToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string }
  | { role: string; content: string | OAIContentPart[] | null };

type AnthropicImageSource =
  | { type: "base64"; media_type: string; data: string }
  | { type: "url"; url: string };

type AnthropicContentPart =
  | { type: "text"; text: string }
  | { type: "image"; source: AnthropicImageSource }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AnthropicMessage = { role: "user" | "assistant"; content: string | AnthropicContentPart[] };

function convertContentForClaude(content: string | OAIContentPart[] | null | undefined): string | AnthropicContentPart[] {
  if (!content) return "";
  if (typeof content === "string") return content;

  return content.map((part): AnthropicContentPart => {
    if (part.type === "image_url") {
      const url = (part as { type: "image_url"; image_url: { url: string } }).image_url.url;
      if (url.startsWith("data:")) {
        const [header, data] = url.split(",");
        const media_type = header.replace("data:", "").replace(";base64", "");
        return { type: "image", source: { type: "base64", media_type, data } };
      } else {
        return { type: "image", source: { type: "url", url } };
      }
    }
    if (part.type === "text") {
      return { type: "text", text: (part as { type: "text"; text: string }).text };
    }
    return { type: "text", text: JSON.stringify(part) };
  });
}

// Convert OpenAI tools array → Anthropic tools array
function convertToolsForClaude(tools: OAITool[]): { name: string; description: string; input_schema: unknown }[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));
}

// Convert OpenAI messages (incl. tool_calls / tool roles) → Anthropic messages
function convertMessagesForClaude(messages: OAIMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue; // handled as top-level system param

    if (msg.role === "assistant") {
      const assistantMsg = msg as Extract<OAIMessage, { role: "assistant" }>;
      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        // Convert tool_calls to Anthropic tool_use blocks
        const parts: AnthropicContentPart[] = [];
        const textContent = assistantMsg.content;
        if (textContent && (typeof textContent === "string" ? textContent.trim() : textContent.length > 0)) {
          const converted = convertContentForClaude(textContent as string | OAIContentPart[]);
          if (typeof converted === "string") {
            if (converted.trim()) parts.push({ type: "text", text: converted });
          } else {
            parts.push(...converted);
          }
        }
        for (const tc of assistantMsg.tool_calls) {
          let input: unknown = {};
          try { input = JSON.parse(tc.function.arguments); } catch {}
          parts.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
        result.push({ role: "assistant", content: parts });
      } else {
        result.push({
          role: "assistant",
          content: convertContentForClaude(assistantMsg.content as string | OAIContentPart[]),
        });
      }
    } else if (msg.role === "tool") {
      // Tool results → Anthropic user message with tool_result
      const toolMsg = msg as Extract<OAIMessage, { role: "tool" }>;
      result.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolMsg.tool_call_id, content: toolMsg.content }],
      });
    } else {
      // user (and any other role)
      result.push({
        role: "user",
        content: convertContentForClaude(msg.content as string | OAIContentPart[]),
      });
    }
  }

  return result;
}

router.post("/v1/chat/completions", requireApiKey, async (req: Request, res: Response) => {
  const rawBody = req.body as Record<string, unknown>;
  let { model, messages, stream, max_tokens, tools, tool_choice } = rawBody as {
    model?: string;
    messages: OAIMessage[];
    stream?: boolean;
    max_tokens?: number;
    tools?: OAITool[];
    tool_choice?: unknown;
  };
  // Collect every other client-supplied field for transparent pass-through
  // (e.g. verbosity, temperature, top_p, top_k, seed, stop, frequency_penalty, etc.)
  const { model: _m, messages: _ms, stream: _s, max_tokens: _mt, tools: _t, tool_choice: _tc,
    x_use_prompt_tools: _xupt, ...extraParams } = rawBody;

  // ---------------------------------------------------------------------------
  // Prompt-tools fallback (port from child agent v1.2.0 — lib/promptTools.ts)
  // Activated by `"x_use_prompt_tools": true` in the request body.
  // For models that don't support native function calling: strip tools, inject
  // a system-prompt that teaches the schema, then parse the model's JSON
  // response and rebuild OpenAI-compatible tool_calls.
  // ---------------------------------------------------------------------------
  const usePromptTools = (rawBody as { x_use_prompt_tools?: unknown }).x_use_prompt_tools === true
    && Array.isArray(tools) && tools.length > 0;
  const promptToolsClientWantsStream = !!stream;
  let promptToolsActive = false;
  let promptToolsModelLabel = "";
  if (usePromptTools) {
    promptToolsActive = true;
    promptToolsModelLabel = model ?? "gpt-5.2";
    const instruction = buildPromptToolsInstruction(tools as PromptTool[]);
    // Inject as a leading system message (separate from any client system
    // message — we keep the client's intent intact and add tool-use guidance).
    messages = [
      { role: "system", content: instruction } as OAIMessage,
      ...messages,
    ];
    // Force non-stream upstream: parser needs the full response text.
    stream = false;
    // Strip native tools so upstream models that DO support tools don't try
    // to native-call — we want a plain text JSON answer to parse ourselves.
    tools = undefined;
    tool_choice = undefined;
    req.log.info({ model: promptToolsModelLabel, toolCount: (rawBody.tools as unknown[])?.length ?? 0 },
      "[prompt-tools] active — stripped native tools, injected system instruction");

    // Intercept the upstream JSON response: parse the model's text reply and
    // rebuild as proper OpenAI tool_calls completion. Optionally fake-stream
    // it back to the client if the original request asked for streaming.
    const origJson = res.json.bind(res);
    (res as Response & { json: Response["json"] }).json = ((upstream: unknown): Response => {
      try {
        const u = upstream as {
          choices?: Array<{ message?: { content?: string | null } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          error?: unknown;
        };
        // Pass-through upstream errors unchanged
        if (u?.error) return origJson(upstream);
        const text = u?.choices?.[0]?.message?.content ?? "";
        if (typeof text !== "string" || text.length === 0) return origJson(upstream);
        const parsed = parsePromptToolsResponse(text);
        const usage = {
          prompt_tokens: u?.usage?.prompt_tokens ?? 0,
          completion_tokens: u?.usage?.completion_tokens ?? 0,
        };
        const completion = buildCompletionFromPromptTools(parsed, promptToolsModelLabel, usage);
        req.log.info({ model: promptToolsModelLabel, isToolCall: parsed.isToolCall, callCount: parsed.calls?.length ?? 0 },
          "[prompt-tools] parsed model response");

        if (promptToolsClientWantsStream) {
          // Fake-stream: emit one chunk + [DONE] in SSE format
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("X-Accel-Buffering", "no");
          const c = completion as { id: string; choices: Array<{ message: Record<string, unknown> }> };
          const delta = c.choices[0]?.message ?? {};
          const chunk = {
            id: c.id, object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000), model: promptToolsModelLabel,
            choices: [{ index: 0, delta, finish_reason: null }],
          };
          const finalChunk = {
            id: c.id, object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000), model: promptToolsModelLabel,
            choices: [{ index: 0, delta: {}, finish_reason: parsed.isToolCall ? "tool_calls" : "stop" }],
            usage: completion.usage,
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return res;
        }
        return origJson(completion);
      } catch (err) {
        req.log.warn({ err: (err as Error).message ?? err }, "[prompt-tools] transform failed; passing through upstream response");
        return origJson(upstream);
      }
    }) as Response["json"];
  }

  // Reject disabled models early
  if (model && !await isModelEnabled(model)) {
    res.status(403).json({ error: { message: `Model '${model}' is disabled on this gateway`, type: "invalid_request_error", code: "model_disabled" } });
    return;
  }

  // Accept any model id; if unknown but contains "/" treat as OpenRouter
  // Apply model route rule first (alias/remap), then use for routing.
  const selectedModel = applyModelRoute(model ?? "gpt-5.2");
  const shouldStream = stream ?? false;
  const startTime = Date.now();
  if (selectedModel !== (model ?? "gpt-5.2")) {
    req.log.info({ originalModel: model, resolvedModel: selectedModel }, "model route applied");
  }

  // Claude family check — covers direct Anthropic models AND OpenRouter's anthropic/* paths.
  // Both require the conversation to end with a user message (no assistant prefill).
  const providerForModel = MODEL_PROVIDER_MAP.get(selectedModel) ?? (selectedModel.includes("/") ? "openrouter" : "openai");
  const isClaudeModelForST = providerForModel === "anthropic";
  // anthropic/claude-* on OpenRouter also rejects assistant-tail requests (Vertex AI backend)
  const isClaudeViaOR = providerForModel === "openrouter" &&
    (selectedModel.startsWith("anthropic/claude") || selectedModel.includes("/claude-"));
  const isAnyClaudeModel = isClaudeModelForST || isClaudeViaOR;

  const lastMsgRole = messages.length > 0 ? messages[messages.length - 1]?.role : null;
  // Trigger 1: SillyTavern mode explicit continuation (direct Claude only, no tools)
  const stModeNeedsTail = isClaudeModelForST && getSillyTavernMode() && !tools?.length;
  // Trigger 2: Last message is assistant — Anthropic/Vertex rejects these (e.g. ST vector plugin
  //            sends summarisation requests that end with the model's own previous reply)
  const assistantTailFix = isAnyClaudeModel && lastMsgRole === "assistant";
  const finalMessages = (stModeNeedsTail || assistantTailFix)
    ? [...messages, { role: "user" as const, content: "继续" }]
    : messages;

  // ---------------------------------------------------------------------------
  // Response cache — only for non-streaming requests.
  // Streaming responses are session-specific and cannot be replayed from cache.
  // Cache key covers resolved model, final messages, and all sampling params
  // that affect the output.  `stream` is intentionally excluded.
  const responseCacheKey = !shouldStream ? hashRequest(rawBody) : null;

  if (responseCacheKey) {
    const cached = cacheGet(responseCacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      res.json(cached.data);
      req.log.info({ model: selectedModel, cacheKey: responseCacheKey.slice(0, 8) }, "Response cache HIT");
      pushRequestLog({
        method: req.method, path: req.path, model: selectedModel,
        backend: "cache", status: 200, duration: Date.now() - startTime, stream: false,
        level: "info",
      });
      return;
    }

    // ---------------------------------------------------------------------------
    // In-flight deduplication: if another identical non-streaming request is
    // already in progress, wait for it to finish then serve from cache.
    // This prevents N identical concurrent requests from hammering the sub-node.
    // ---------------------------------------------------------------------------
    const wasInflight = await waitForInflight(responseCacheKey);
    if (wasInflight) {
      const cachedAfterWait = cacheGet(responseCacheKey);
      if (cachedAfterWait) {
        res.setHeader("X-Cache", "HIT-INFLIGHT");
        res.json(cachedAfterWait.data);
        req.log.info({ model: selectedModel, cacheKey: responseCacheKey.slice(0, 8) }, "Response cache HIT (inflight dedup)");
        pushRequestLog({
          method: req.method, path: req.path, model: selectedModel,
          backend: "cache", status: 200, duration: Date.now() - startTime, stream: false,
          level: "info",
        });
        return;
      }
    }

    res.setHeader("X-Cache", "MISS");
  }

  // Mark this request as in-flight so concurrent identical requests wait instead
  // of sending redundant upstream calls. finishInflight() is called on both
  // success and failure paths to unblock any waiters.
  let finishInflight: (() => void) | undefined;
  if (responseCacheKey) {
    const finish = markInflight(responseCacheKey);
    if (finish) finishInflight = finish;
  }

  // Try every available backend before giving up — with N sub-nodes we have N-1
  // retries.  A hard-coded 3 is dangerously low when there are 14+ nodes.
  // SVD principle: cache-affinity routing concentrates traffic on one node;
  // retries only fire on failure.  More retries = higher availability at zero
  // cost when the primary node is healthy.
  const MAX_FRIEND_RETRIES = Math.max(3, getFriendProxyConfigs().length - 1);
  const triedFriendUrls = new Set<string>();
  const cacheFingerprint = buildCacheFingerprint(selectedModel, finalMessages);

  // ── Absolute-routing capability gate ────────────────────────────────────
  // If the model id locks the request to a specific OpenRouter provider
  // slug, refuse early with 422 when no sub-node reports support for it —
  // otherwise we'd silently violate the absolute-routing contract.
  const ccRouteForCapability = detectAbsoluteProviderRoute(selectedModel);
  const ccLockedSlug = ccRouteForCapability?.provider;
  if (ccLockedSlug) {
    const cap = checkAbsoluteRoutingCapability(ccLockedSlug);
    if (!cap.canServe && cap.poolSize > 0) {
      finishInflight?.();
      req.log.warn({
        model: selectedModel,
        providerPrefix: ccRouteForCapability?.prefix,
        providerSlug: ccLockedSlug,
        poolSize: cap.poolSize,
      }, "Absolute routing: no sub-node reports capability for locked provider (/v1/chat/completions)");
      res.status(422).json({
        error: {
          message:
            `No registered sub-node can serve provider "${ccLockedSlug}" ` +
            `(model "${selectedModel}" hard-locks to it via prefix "${ccRouteForCapability?.prefix}"). ` +
            `Add a sub-node whose OpenRouter account has access to this provider, ` +
            `or remove the routing prefix to allow OpenRouter's default selection.`,
          type: "provider_capability_missing",
          providerPrefix: ccRouteForCapability?.prefix,
          providerSlug: ccLockedSlug,
        },
      });
      return;
    }
  }

  let backend = pickBackendForCache(cacheFingerprint, ccLockedSlug);
  if (!backend) {
    finishInflight?.();
    res.status(503).json({ error: { code: "no_backends_available", message: "No available backends. Add friend proxy sub-nodes via /v1/admin/backends.", type: "service_unavailable" } });
    return;
  }

  // Capture the raw JSON response from non-streaming calls so we can store it
  // in the response cache after a successful round-trip.
  let capturedNonStreamResponse: unknown = null;
  const captureResponseFn = responseCacheKey
    ? (data: unknown): void => { capturedNonStreamResponse = data; }
    : undefined;

  for (let attempt = 0; ; attempt++) {
    const backendLabel = backend.label;
    req.log.info({ model: selectedModel, backend: backendLabel, attempt, cacheHash: fnv1aHash(cacheFingerprint), toolCount: tools?.length ?? 0 }, "Proxy request (cache-affinity)");

    try {
      triedFriendUrls.add(backend.url);

      const friendModel = normalizeFriendModel(selectedModel);
      if (friendModel !== selectedModel) {
        req.log.info({ original: selectedModel, normalized: friendModel }, "friend proxy model prefix normalized");
      }
      const result = await handleFriendProxy({ req, res, backend, model: friendModel, messages: finalMessages, stream: shouldStream, maxTokens: max_tokens, tools, toolChoice: tool_choice, extraParams, startTime, captureResponseFn });
      // ✅ Success — store cache entry first so waiters can read it, then unblock them
      setHealth(backend.url, true);
      if (responseCacheKey && capturedNonStreamResponse !== null) {
        // Robustness: Only cache successful assistant responses.
        // Guard against caching upstream error objects returned with 200 OK or empty responses.
        const json = capturedNonStreamResponse as any;
        if (json.id && Array.isArray(json.choices) && json.choices.length > 0) {
          cacheSet(responseCacheKey, capturedNonStreamResponse, selectedModel);
        }
      }
      finishInflight?.(); // unblock any concurrent identical requests
      const duration = Date.now() - startTime;
      recordCallStat(backendLabel, duration, result.promptTokens, result.completionTokens, result.ttftMs, selectedModel, result.cacheReadTokens, result.cacheWriteTokens);
      const priceUSD = estimateCostUSD(selectedModel, result.promptTokens, result.completionTokens, result.cacheReadTokens, result.cacheWriteTokens);
      recordCostStat(backendLabel, priceUSD);
      pushRequestLog({
        method: req.method, path: req.path, model: selectedModel,
        backend: backendLabel, status: 200, duration, stream: shouldStream,
        promptTokens: result.promptTokens, completionTokens: result.completionTokens,
        cacheReadTokens: result.cacheReadTokens, cacheWriteTokens: result.cacheWriteTokens,
        cacheTier: result.cacheTier || undefined,
        msgSummary: result.msgSummary || undefined,
        priceUSD,
        level: "info",
      });
      req.log.info({
        model: selectedModel,
        cacheTier: result.cacheTier || "none",
        cacheRead: result.cacheReadTokens,
        cacheWrite: result.cacheWriteTokens,
        promptTok: result.promptTokens,
        completionTok: result.completionTokens,
        priceUSD,
        msgs: result.msgSummary,
        durationMs: duration,
      }, "request done");
      break;
    } catch (err: unknown) {
      // ❌ Failure — record error, decide whether to retry on a different node
      recordErrorStat(backendLabel);

      const httpStatus = err instanceof FriendProxyHttpError ? err.status : 0;
      const is5xx = httpStatus >= 500;
      const isRateLimit = httpStatus === 429 || httpStatus === 402;
      // 400/404 from a sub-node usually means that specific sub-node can't route the
      // model (misconfigured AI Integration, unsupported model, etc.) — not a real
      // client error. Whitelist only these two codes; all other 4xx (422, 413, 415…)
      // are genuine client errors and must NOT be retried on another node.
      const is4xxRetryable = httpStatus === 400 || httpStatus === 404;
      const errMsg = err instanceof Error ? err.message : "";
      // FriendProxyHttpError means we received an HTTP response — not a network failure.
      // Only inspect errMsg keywords for non-HTTP errors (TypeError, ECONNRESET, etc.).
      const isNetworkErr = !(err instanceof FriendProxyHttpError) && (
        err instanceof TypeError
        || ["fetch", "aborted", "terminated", "closed", "ECONNRESET", "socket hang up", "UND_ERR"]
          .some((kw) => errMsg.includes(kw)));

      if (is5xx || isNetworkErr) {
        markUnhealthy(backend.url, backend.apiKey);
        req.log.warn({ url: backend.url, attempt, is5xx, isNetworkErr }, "Friend backend marked unhealthy (probe scheduled), considering retry");
      }

      if (isRateLimit) {
        markRateLimited(backend.url, httpStatus);
        req.log.warn({ url: backend.url, attempt, status: httpStatus }, "Friend backend rate-limited / quota exhausted — cooldown applied, trying next node");
      }

      if (is4xxRetryable) {
        req.log.warn({ url: backend.url, attempt, status: httpStatus }, "Friend backend returned retryable 4xx (provider error) — trying next node");
      }

      if ((is5xx || isNetworkErr || isRateLimit || is4xxRetryable) && attempt < MAX_FRIEND_RETRIES && !res.headersSent) {
        const next = pickBackendForCacheExcluding(cacheFingerprint, triedFriendUrls, ccLockedSlug);
        if (next) {
          backend = next;
          continue;
        }
      }

      req.log.error({ err }, "Proxy request failed");
      const errStatus = httpStatus || 500;
      pushRequestLog({
        method: req.method, path: req.path, model: selectedModel,
        backend: backendLabel, status: errStatus, duration: Date.now() - startTime,
        stream: shouldStream, level: errStatus >= 500 ? "error" : "warn",
        error: errMsg || "Unknown error",
      });
      // Unblock any concurrent identical requests regardless of error type —
      // they will fall through to cacheGet() and get a miss, then try upstream.
      finishInflight?.();
      if (!res.headersSent) {
        // Forward the upstream status code for 4xx client errors (e.g. 400 bad request,
        // 401 auth, 403 forbidden, 404 not found) rather than masking them as 500.
        const clientStatus = (httpStatus >= 400 && httpStatus < 500) ? httpStatus : 500;
        res.status(clientStatus).json({ error: { message: errMsg || "Unknown error", type: "server_error" } });
      } else if (!res.writableEnded) {
        writeAndFlush(res, `data: ${JSON.stringify({ error: { message: errMsg || "Unknown error" } })}\n\n`);
        writeAndFlush(res, "data: [DONE]\n\n");
        res.end();
      }
      break;
    }
  }
});

// ---------------------------------------------------------------------------
// /v1/embeddings — transparent pass-through to friend proxy sub-nodes.
// Supports text embeddings (text-embedding-3-small, text-embedding-3-large, etc.)
// and multimodal embeddings (e.g. nvidia/llama-nemotron-embed-vl-* on OpenRouter).
// The entire request body is forwarded as-is so non-standard input formats
// (e.g. content arrays for image embeddings) pass through without transformation.
// ---------------------------------------------------------------------------

router.post("/v1/embeddings", requireApiKey, async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;

  if (typeof body["model"] !== "string" || !(body["model"] as string).trim()) {
    res.status(400).json({ error: { message: "'model' must be a non-empty string", type: "invalid_request_error" } });
    return;
  }
  if (body["input"] === undefined || body["input"] === null) {
    res.status(400).json({ error: { message: "'input' is required", type: "invalid_request_error" } });
    return;
  }

  const selectedModel = body["model"] as string;
  const startTime = Date.now();
  // Try ALL configured backends — a 400/404 from one sub-node usually means
  // "this sub-node can't route the embedding model", not "bad request".
  // We keep trying until we find a sub-node that can handle the model.
  const allBackends = buildBackendPool();
  if (allBackends.length === 0) {
    res.status(503).json({ error: { code: "no_backends_available", message: "No available backends. Add friend proxy sub-nodes via /v1/admin/backends.", type: "service_unavailable" } });
    return;
  }

  // Prioritise non-rate-limited backends, then fall back to all
  const preferred = allBackends.filter((b) => !isRateLimited(b.url));
  const pool = preferred.length > 0 ? preferred : allBackends;

  let lastErrStatus = 502;
  let lastErrText   = "All sub-nodes failed for /v1/embeddings";

  for (let i = 0; i < pool.length; i++) {
    const backend = pool[(requestCounter + i) % pool.length];
    req.log.info({ model: selectedModel, backend: backend.label, attempt: i }, "Embeddings request");

    try {
      const fetchRes = await fetch(`${backend.url}/v1/embeddings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(GATEWAY_TIMEOUTS.upstreamEmbeddingsMs),
      });

      if (!fetchRes.ok) {
        const errText = await fetchRes.text().catch(() => "unknown");
        const status  = fetchRes.status;
        lastErrStatus = status;
        lastErrText   = errText;

        if (status >= 500) markUnhealthy(backend.url, backend.apiKey);
        if (status === 429 || status === 402) markRateLimited(backend.url, status);

        // Auth errors are definitive — no point trying other sub-nodes.
        if (status === 401 || status === 403) {
          res.status(status).json({ error: { message: `Upstream auth error ${status}: ${errText}`, type: "authentication_error" } });
          return;
        }

        // 400/404/5xx: this sub-node can't route this model — try the next one.
        req.log.warn({ url: backend.url, status, attempt: i }, `Embeddings: sub-node returned ${status}, trying next backend`);
        continue;
      }

      const json = await fetchRes.json() as Record<string, unknown>;
      res.json(json);
      setHealth(backend.url, true);
      requestCounter++;
      recordCallStat(backend.label, Date.now() - startTime, 0, 0, undefined, selectedModel);
      pushRequestLog({ method: req.method, path: req.path, model: selectedModel, backend: backend.label, status: 200, duration: Date.now() - startTime, stream: false, level: "info" });
      return; // success
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      const isNetworkErr = err instanceof TypeError
        || ["fetch", "aborted", "terminated", "closed", "ECONNRESET", "UND_ERR"]
            .some((kw) => errMsg.includes(kw));
      lastErrText = errMsg;
      if (isNetworkErr) {
        markUnhealthy(backend.url, backend.apiKey);
        req.log.warn({ url: backend.url, attempt: i, err: errMsg }, "Embeddings: network error, trying next backend");
        continue; // retry on a different backend
      }
      req.log.error({ err }, "/v1/embeddings request failed");
      if (!res.headersSent) {
        res.status(502).json({ error: { message: errMsg, type: "upstream_error" } });
      }
      return;
    }
  }

  // All backends exhausted
  if (!res.headersSent) {
    const clientStatus = lastErrStatus >= 400 && lastErrStatus < 500 ? lastErrStatus : 503;
    res.status(clientStatus).json({ error: { message: `All sub-nodes failed for /v1/embeddings: ${lastErrText}`, type: "service_unavailable" } });
  }
});

// ---------------------------------------------------------------------------
// /v1/rerank — transparent pass-through to friend proxy sub-nodes.
// Mirrors child proxy commit 1e6f7b6a (Cohere/Jina rerank-style scoring).
// Mother does not call OpenRouter directly; rerank requests are forwarded to
// whichever sub-node has rerank capability (typically the child gateway with
// OPENROUTER_API_KEY configured).
// ---------------------------------------------------------------------------

router.post("/v1/rerank", requireApiKey, async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;

  if (typeof body["model"] !== "string" || !(body["model"] as string).trim()) {
    res.status(400).json({ error: { message: "'model' must be a non-empty string", type: "invalid_request_error" } });
    return;
  }
  if (!body["query"] || !body["documents"]) {
    res.status(400).json({ error: { message: "'query' and 'documents' are required", type: "invalid_request_error" } });
    return;
  }

  const selectedModel = body["model"] as string;
  const startTime = Date.now();
  const allBackends = buildBackendPool();
  if (allBackends.length === 0) {
    res.status(503).json({ error: { code: "no_backends_available", message: "No available backends. Add friend proxy sub-nodes via /v1/admin/backends.", type: "service_unavailable" } });
    return;
  }

  const preferred = allBackends.filter((b) => !isRateLimited(b.url));
  const pool = preferred.length > 0 ? preferred : allBackends;

  let lastErrStatus = 502;
  let lastErrText   = "All sub-nodes failed for /v1/rerank";

  for (let i = 0; i < pool.length; i++) {
    const backend = pool[(requestCounter + i) % pool.length];
    req.log.info({ model: selectedModel, backend: backend.label, attempt: i }, "Rerank request");

    try {
      const fetchRes = await fetch(`${backend.url}/v1/rerank`, {
        method: "POST",
        headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(GATEWAY_TIMEOUTS.upstreamEmbeddingsMs),
      });

      if (!fetchRes.ok) {
        const errText = await fetchRes.text().catch(() => "unknown");
        const status  = fetchRes.status;
        lastErrStatus = status;
        lastErrText   = errText;

        if (status >= 500) markUnhealthy(backend.url, backend.apiKey);
        if (status === 429 || status === 402) markRateLimited(backend.url, status);

        if (status === 401 || status === 403) {
          res.status(status).json({ error: { message: `Upstream auth error ${status}: ${errText}`, type: "authentication_error" } });
          return;
        }

        req.log.warn({ url: backend.url, status, attempt: i }, `Rerank: sub-node returned ${status}, trying next backend`);
        continue;
      }

      const json = await fetchRes.json() as Record<string, unknown>;
      res.json(json);
      setHealth(backend.url, true);
      requestCounter++;
      recordCallStat(backend.label, Date.now() - startTime, 0, 0, undefined, selectedModel);
      pushRequestLog({ method: req.method, path: req.path, model: selectedModel, backend: backend.label, status: 200, duration: Date.now() - startTime, stream: false, level: "info" });
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      const isNetworkErr = err instanceof TypeError
        || ["fetch", "aborted", "terminated", "closed", "ECONNRESET", "UND_ERR"]
            .some((kw) => errMsg.includes(kw));
      lastErrText = errMsg;
      if (isNetworkErr) {
        markUnhealthy(backend.url, backend.apiKey);
        req.log.warn({ url: backend.url, attempt: i, err: errMsg }, "Rerank: network error, trying next backend");
        continue;
      }
      req.log.error({ err }, "/v1/rerank request failed");
      if (!res.headersSent) {
        res.status(502).json({ error: { message: errMsg, type: "upstream_error" } });
      }
      return;
    }
  }

  if (!res.headersSent) {
    const clientStatus = lastErrStatus >= 400 && lastErrStatus < 500 ? lastErrStatus : 503;
    res.status(clientStatus).json({ error: { message: `All sub-nodes failed for /v1/rerank: ${lastErrText}`, type: "service_unavailable" } });
  }
});

// ---------------------------------------------------------------------------
// Anthropic-native /v1/messages endpoint
// Accepts Anthropic API format directly (for clients like Cherry Studio, Claude.ai compatible tools)
// ---------------------------------------------------------------------------

// /v1/messages — Anthropic-native endpoint, forwarded to a friend proxy sub-node.
// Local Anthropic calls are permanently disabled; all traffic must go through sub-nodes.
// Retry policy:
//   Non-streaming: full retry loop (up to all configured backends).
//   Streaming:     no retry once headers are committed; single-shot to the
//                  cache-affinity backend (same as before).
router.post("/v1/messages", requireApiKey, async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const rawModel = (body.model as string) ?? "claude-sonnet-4-5";
  const selectedModel = applyModelRoute(rawModel);
  if (selectedModel !== rawModel) {
    req.log.info({ originalModel: rawModel, resolvedModel: selectedModel }, "model route applied (/v1/messages)");
    body.model = selectedModel;
  }
  const shouldStream = (body.stream as boolean) ?? false;
  const startTime = Date.now();

  // ── Absolute provider routing (model-prefix lock) ─────────────────────────
  // Same contract as /v1/chat/completions: a routing prefix on the model id
  // forces `provider.only` + `allow_fallbacks: false` on the wire so the
  // sub-node hits exactly one OpenRouter sub-channel.  Anthropic-native
  // /v1/messages is a thin pass-through, so we mutate the body in-place.
  const messagesRoute = detectAbsoluteProviderRoute(selectedModel);
  const messagesLockedSlug = messagesRoute?.provider;
  if (messagesRoute) {
    body["provider"] = buildAbsoluteProviderBlock(messagesRoute, body["provider"]);
    req.log.info({
      model: selectedModel,
      providerPrefix: messagesRoute.prefix,
      providerOnly: messagesRoute.only,
    }, "/v1/messages: absolute provider routing locked");
  }
  // Capability gate — refuse 422 when no sub-node reports support for the
  // locked OpenRouter provider slug (mirror of /v1/chat/completions).
  if (messagesLockedSlug) {
    const cap = checkAbsoluteRoutingCapability(messagesLockedSlug);
    if (!cap.canServe && cap.poolSize > 0) {
      req.log.warn({
        model: selectedModel,
        providerPrefix: messagesRoute?.prefix,
        providerSlug: messagesLockedSlug,
        poolSize: cap.poolSize,
      }, "Absolute routing: no sub-node reports capability for locked provider (/v1/messages)");
      res.status(422).json({
        error: {
          type: "provider_capability_missing",
          message:
            `No registered sub-node can serve provider "${messagesLockedSlug}" ` +
            `(model "${selectedModel}" hard-locks to it via prefix "${messagesRoute?.prefix}"). ` +
            `Add a sub-node whose OpenRouter account has access to this provider, ` +
            `or remove the routing prefix to allow OpenRouter's default selection.`,
          providerPrefix: messagesRoute?.prefix,
          providerSlug: messagesLockedSlug,
        },
      });
      return;
    }
  }

  const anthropicFP = buildCacheFingerprintAnthropic(selectedModel, body.system);
  req.log.info({ model: selectedModel, stream: shouldStream, cacheHash: fnv1aHash(anthropicFP) }, "Anthropic /v1/messages → forwarding to friend proxy (cache-affinity)");

  // ── Three-tier Anthropic prompt cache strategy (same as /v1/chat/completions) ──
  let anthropicCacheDiagnostics: CacheDecisionDiagnostics | null = null;
  if (!body["cache_control"] && selectedModel.toLowerCase().includes("claude")) {
    const sysRaw = body.system;
    let sysText = "";
    let hasExistingBlockCache = false;
    if (typeof sysRaw === "string") {
      sysText = sysRaw;
    } else if (Array.isArray(sysRaw)) {
      hasExistingBlockCache = (sysRaw as Array<Record<string, unknown>>).some((b) => !!b.cache_control);
      if (!hasExistingBlockCache) {
        sysText = (sysRaw as Array<{ type?: string; text?: string }>)
          .filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      }
    }

    if (sysText && !hasExistingBlockCache) {
      const stableKey = `msg|${selectedModel}|${sysText.slice(0, 256)}`;
      const prepared = prepareLayeredSystemCachePlan(stableKey, sysText, (body.messages as unknown[]) || []);
      anthropicCacheDiagnostics = prepared.diagnostics;

      body.messages = prepared.messages as typeof body.messages;

      if (prepared.stable) {
        body.system = typeof sysRaw === "string"
          ? prepared.system
          : [{ type: "text", text: prepared.system }];
        body["cache_control"] = { type: "ephemeral", ttl: "1h" };
        anthropicCacheDiagnostics.cachePlan = Array.isArray(body.messages) && body.messages !== prepared.messages ? "T1" : "T1";
      } else if (prepared.lcpResult) {
        body.system = [
          { type: "text", text: prepared.lcpResult.stable, cache_control: { type: "ephemeral", ttl: "1h" } },
          { type: "text", text: prepared.lcpResult.dynamic },
        ];
        anthropicCacheDiagnostics.cachePlan = "T2";
      } else {
        body.system = typeof sysRaw === "string"
          ? prepared.system
          : [{ type: "text", text: prepared.system }];
      }

      let anthropicHistoryDiagnostics: HistoryBreakpointDiagnostics | null = null;
      if (Array.isArray(body.messages)) {
        const historyResult = injectHistoryBreakpoint(body.messages as unknown[]);
        body.messages = historyResult.messages as typeof body.messages;
        anthropicHistoryDiagnostics = historyResult.diagnostics;
        if (historyResult.diagnostics.applied || historyResult.diagnostics.alreadyCached) {
          anthropicCacheDiagnostics.cachePlan = anthropicCacheDiagnostics.cachePlan
            ? `${anthropicCacheDiagnostics.cachePlan}+P2`
            : "P2";
        }
      }

      req.log.info({
        model: selectedModel,
        cachePlan: anthropicCacheDiagnostics.cachePlan || "none",
        systemTotalLength: anthropicCacheDiagnostics.systemTotalLength,
        stableLayerLength: anthropicCacheDiagnostics.stableLayerLength,
        dynamicLayerLength: anthropicCacheDiagnostics.dynamicLayerLength,
        lcpEffectiveLength: anthropicCacheDiagnostics.lcpEffectiveLength,
        firstDivergenceSource: anthropicCacheDiagnostics.firstDivergenceSource,
        historyAnchorUserIdx: anthropicHistoryDiagnostics?.anchorUserIdx ?? -1,
        historyAnchorMode: anthropicHistoryDiagnostics?.anchorMode ?? "none",
        historyAnchorBlockIndex: anthropicHistoryDiagnostics?.anchorBlockIndex ?? -1,
        historyBridgeMessageCount: anthropicHistoryDiagnostics?.bridgeMessageCount ?? 0,
        historyPrefixApproxChars: anthropicHistoryDiagnostics?.prefixApproxChars ?? 0,
        historyBridgeApproxChars: anthropicHistoryDiagnostics?.bridgeApproxChars ?? 0,
        historyApplied: anthropicHistoryDiagnostics?.applied ?? false,
        historyAlreadyCached: anthropicHistoryDiagnostics?.alreadyCached ?? false,
        historyReason: anthropicHistoryDiagnostics?.reason ?? "not_run",
      }, "Anthropic layered cache diagnostics");
    }
  }

  const MAX_MSG_RETRIES = Math.max(3, getFriendProxyConfigs().length - 1);
  const triedMsgUrls = new Set<string>();

  let backend = pickBackendForCache(anthropicFP, messagesLockedSlug);
  if (!backend) {
    res.status(503).json({ error: { code: "no_backends_available", type: "service_unavailable", message: "No available backends. Add friend proxy sub-nodes via /v1/admin/backends." } });
    return;
  }

  for (let attempt = 0; ; attempt++) {
    triedMsgUrls.add(backend.url);
    req.log.info({ model: selectedModel, stream: shouldStream, backend: backend.label, attempt, cacheHash: fnv1aHash(anthropicFP) }, "Anthropic /v1/messages attempt");

    const msgAbort = new AbortController();
    const onMsgClose = (): void => { if (!res.writableEnded && !msgAbort.signal.aborted) msgAbort.abort("client_disconnected"); };
    res.on("close", onMsgClose);

    let msgIdleTimer: ReturnType<typeof setTimeout> | null = null;
    const resetMsgIdle = (): void => {
      if (msgIdleTimer) clearTimeout(msgIdleTimer);
      // Idle watchdog only — not a total task timeout. Allow long silent reasoning gaps
      // without killing legitimate 30–50 min jobs, while still cleaning dead sockets.
      msgIdleTimer = setTimeout(() => {
        if (!msgAbort.signal.aborted) msgAbort.abort("idle_timeout");
      }, GATEWAY_TIMEOUTS.streamIdleMs);
    };
    if (shouldStream) resetMsgIdle();

    try {
      const fetchRes = await fetch(`${backend.url}/v1/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${backend.apiKey}`,
          "Content-Type": "application/json",
          "anthropic-version": (req.headers["anthropic-version"] as string | undefined) ?? "2023-06-01",
          ...(req.headers["anthropic-beta"] ? { "anthropic-beta": req.headers["anthropic-beta"] as string } : {}),
        },
        body: JSON.stringify(body),
        signal: msgAbort.signal,
      });

      if (!fetchRes.ok) {
      const errText = await fetchRes.text().catch(() => "unknown");
      const fsStatus = fetchRes.status;
      req.log.warn({ backend: backend.label, status: fsStatus, errText }, "/v1/messages: sub-node returned error");
      if (fsStatus === 429 || fsStatus === 402) markRateLimited(backend.url, fsStatus);
      if (fsStatus >= 500 || fsStatus === 429 || fsStatus === 402) {
        if (attempt < MAX_MSG_RETRIES && !res.headersSent) {
          markUnhealthy(backend.url, backend.apiKey);
          const next = pickBackendForCacheExcluding(anthropicFP, triedMsgUrls, messagesLockedSlug);
          if (next) {
            backend = next;
            // Clean up this iteration's abort/idle resources before retrying.
            if (msgIdleTimer) clearTimeout(msgIdleTimer);
            res.removeListener("close", onMsgClose);
            continue;
          }
        }
      }
      throw new FriendProxyHttpError(fsStatus, `Friend proxy error ${fsStatus}: ${errText}`);
    }

    if (shouldStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      let inputTokens = 0;
      let outputTokens = 0;
      let msgCacheRead = 0;
      let msgCacheWrite = 0;
      const reader = fetchRes.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      // Use Anthropic-format "ping" event rather than an SSE comment so that
      // any upstream reverse proxy counts it as data activity (comments can be
      // treated as idle by some proxies and trigger premature disconnection).
      const keepalive = setInterval(() => {
        if (!res.writableEnded) writeAndFlush(res, "event: ping\ndata: {\"type\":\"ping\"}\n\n");
      }, GATEWAY_TIMEOUTS.keepaliveAnthropicMs);
      req.on("close", () => clearInterval(keepalive));

      try {
        while (true) {
          const { done, value } = await reader.read();
          resetMsgIdle(); // reset idle watchdog on every received chunk
          if (done) {
            // Flush any content remaining in buf — the stream may have ended
            // without a trailing newline, which would otherwise drop the last line.
            if (buf) {
              const remaining = buf.split(/\r?\n/);
              for (const line of remaining) {
                if (!line) continue;
                writeAndFlush(res, line + "\n");
                if (line.startsWith("data:")) {
                  try {
                    const data = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
                    if (data.type === "message_start") {
                      const msg = data.message as Record<string, unknown>;
                      const u = (msg?.usage as Record<string, unknown>) ?? {};
                      inputTokens = (u.input_tokens as number) ?? 0;
                      msgCacheRead = (u.cache_read_input_tokens as number) ?? 0;
                      msgCacheWrite = (u.cache_creation_input_tokens as number) ?? 0;
                    }
                    if (data.type === "message_delta") {
                      outputTokens = ((data.usage as Record<string, unknown>)?.output_tokens as number) ?? 0;
                    }
                  } catch { /* skip malformed */ }
                }
              }
              buf = "";
            }
            break;
          }
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            writeAndFlush(res, line + "\n");
            if (line.startsWith("data:")) {
              try {
                const data = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
                if (data.type === "message_start") {
                  const msg = data.message as Record<string, unknown>;
                  const u = (msg?.usage as Record<string, unknown>) ?? {};
                  inputTokens = (u.input_tokens as number) ?? 0;
                  msgCacheRead = (u.cache_read_input_tokens as number) ?? 0;
                  msgCacheWrite = (u.cache_creation_input_tokens as number) ?? 0;
                }
                if (data.type === "message_delta") {
                  outputTokens = ((data.usage as Record<string, unknown>)?.output_tokens as number) ?? 0;
                }
              } catch { /* skip malformed */ }
            }
          }
        }
      } finally {
        clearInterval(keepalive);
        if (msgIdleTimer) clearTimeout(msgIdleTimer);
        res.removeListener("close", onMsgClose);
        reader.releaseLock();
      }
      res.end();

      const dur = Date.now() - startTime;
      setHealth(backend.url, true);
      const totalInputTokens = inputTokens + msgCacheRead + msgCacheWrite;
      recordCallStat(backend.label, dur, totalInputTokens, outputTokens, undefined, selectedModel, msgCacheRead, msgCacheWrite);
      recordCostStat(backend.label, estimateCostUSD(selectedModel, totalInputTokens, outputTokens, msgCacheRead, msgCacheWrite));
      pushRequestLog({ method: req.method, path: req.path, model: selectedModel, backend: backend.label, status: 200, duration: dur, stream: true, promptTokens: totalInputTokens, completionTokens: outputTokens, level: "info" });
      break; // streaming success — exit retry loop

    } else {
      if (msgIdleTimer) clearTimeout(msgIdleTimer);
      res.removeListener("close", onMsgClose);
      const json = await fetchRes.json() as Record<string, unknown>;
      res.json(json);
      const usage = (json.usage as Record<string, unknown>) ?? {};
      const nonStreamCache = extractCacheTokens(usage);
      const dur = Date.now() - startTime;
      setHealth(backend.url, true);
      const nonStreamInputTokens = ((usage.input_tokens as number) ?? 0) + nonStreamCache.cacheRead + nonStreamCache.cacheWrite;
      recordCallStat(backend.label, dur, nonStreamInputTokens, (usage.output_tokens as number) ?? 0, undefined, selectedModel, nonStreamCache.cacheRead, nonStreamCache.cacheWrite);
      recordCostStat(backend.label, estimateCostUSD(selectedModel, nonStreamInputTokens, (usage.output_tokens as number) ?? 0, nonStreamCache.cacheRead, nonStreamCache.cacheWrite));
      pushRequestLog({ method: req.method, path: req.path, model: selectedModel, backend: backend.label, status: 200, duration: dur, stream: false, promptTokens: nonStreamInputTokens, completionTokens: (usage.output_tokens as number) ?? 0, level: "info" });
      break; // non-streaming success — exit retry loop
    }

  } catch (err: unknown) {
    if (msgIdleTimer) clearTimeout(msgIdleTimer);
    res.removeListener("close", onMsgClose);

    // Client disconnected cleanly before the sub-node responded — not a backend failure.
    // The abort reason is the raw string "client_disconnected" (set via AbortController.abort(reason)).
    const isClientDisconnect = err === "client_disconnected"
      || (err instanceof Error && err.name === "AbortError" && String(msgAbort.signal.reason) === "client_disconnected");
    if (isClientDisconnect) {
      req.log.info({ attempt }, "/v1/messages: client disconnected before response, request cancelled");
      break; // exit retry loop without sending a 500
    }

    recordErrorStat(backend.label);
    const errMsg = err instanceof Error ? err.message : (typeof err === "string" ? err : "Unknown error");
    const httpStatus = err instanceof FriendProxyHttpError ? err.status : 0;
    const is5xx = httpStatus >= 500;
    const isRateLimit = httpStatus === 429 || httpStatus === 402;
    // Whitelist only 400/404 as retryable — all other 4xx are genuine client errors.
    const is4xxRetryable = httpStatus === 400 || httpStatus === 404;
    const isNetworkErr = err instanceof TypeError
      || ["fetch", "aborted", "terminated", "closed", "upstream", "ECONNRESET", "socket hang up", "UND_ERR"]
          .some((kw) => errMsg.includes(kw));

    if (is5xx || isNetworkErr) {
      markUnhealthy(backend.url, backend.apiKey);
      req.log.warn({ url: backend.url, attempt }, "/v1/messages: backend marked unhealthy (probe scheduled)");
    }
    if (isRateLimit) {
      req.log.warn({ url: backend.url, status: httpStatus, attempt }, "/v1/messages: backend rate-limited — cooldown applied");
    }
    if (is4xxRetryable) {
      req.log.warn({ url: backend.url, attempt, status: httpStatus }, "/v1/messages: backend returned retryable 4xx (provider error) — trying next node");
    }

    // Retry on a different backend for non-streaming when possible
    if ((is5xx || isNetworkErr || isRateLimit || is4xxRetryable) && attempt < MAX_MSG_RETRIES && !res.headersSent) {
      const next = pickBackendForCacheExcluding(anthropicFP, triedMsgUrls, messagesLockedSlug);
      if (next) {
        req.log.info({ from: backend.label, to: next.label, attempt }, "/v1/messages: retrying on different backend");
        backend = next;
        continue; // next iteration of for loop
      }
    }

    // No more retries — surface the error
    req.log.error({ err, attempt }, "/v1/messages request failed");
    const errStatus = httpStatus || 500;
    pushRequestLog({ method: req.method, path: req.path, model: selectedModel, backend: backend.label, status: errStatus, duration: Date.now() - startTime, stream: shouldStream, level: errStatus >= 500 ? "error" : "warn", error: errMsg });
    if (!res.headersSent) {
      res.status(errStatus).json({ error: { type: "server_error", message: errMsg } });
    } else {
      writeAndFlush(res, `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "server_error", message: errMsg } })}\n\n`);
      res.end();
    }
    break; // exit retry loop on unrecoverable error
  }
  } // end for retry loop
});

// ---------------------------------------------------------------------------
// Gemini-native /v1beta/models/:modelAction endpoint
// Accepts native Gemini SDK format (generateContent / streamGenerateContent),
// pass-through forwarded to a friend proxy sub-node. Mother does no body
// transformation here — the sub-node owns the Gemini request shape.
// Retry policy mirrors /v1/messages: full retry on 5xx/429 before headers
// are committed; single-shot once streaming has begun.
// ---------------------------------------------------------------------------
router.post("/v1beta/models/:modelAction", requireApiKey, async (req: Request, res: Response) => {
  const modelAction = String(req.params["modelAction"] ?? "");
  const colonIdx    = modelAction.lastIndexOf(":");
  const modelName   = colonIdx >= 0 ? modelAction.slice(0, colonIdx) : modelAction;
  const action      = colonIdx >= 0 ? modelAction.slice(colonIdx + 1) : "generateContent";
  const isStream    = action === "streamGenerateContent";

  if (!modelName) {
    res.status(400).json({ error: { code: 400, message: "model name is required in the path", status: "INVALID_ARGUMENT" } });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const fp   = `gem|${modelName}|${action}`;

  const MAX_RETRIES = Math.max(3, getFriendProxyConfigs().length - 1);
  const tried = new Set<string>();

  let backend = pickBackendForCache(fp);
  if (!backend || backend.kind !== "friend") {
    res.status(503).json({ error: { code: 503, message: "No available friend-proxy backend for Gemini-native path", status: "UNAVAILABLE" } });
    return;
  }

  for (let attempt = 0; ; attempt++) {
    tried.add(backend.url);
    req.log.info({ model: modelName, action, stream: isStream, backend: backend.label, attempt }, "Gemini /v1beta → forwarding to friend proxy");

    const abort   = new AbortController();
    const onClose = (): void => { if (!res.writableEnded && !abort.signal.aborted) abort.abort("client_disconnected"); };
    res.on("close", onClose);

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const resetIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { if (!abort.signal.aborted) abort.abort("idle_timeout"); }, GATEWAY_TIMEOUTS.streamIdleMs);
    };
    if (isStream) resetIdle();

    try {
      const fetchRes = await fetch(`${backend.url}/v1beta/models/${encodeURIComponent(modelAction)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${backend.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: abort.signal,
      });

      if (!fetchRes.ok) {
        const errText = await fetchRes.text().catch(() => "unknown");
        const fsStatus = fetchRes.status;
        req.log.warn({ backend: backend.label, status: fsStatus, errText }, "/v1beta: sub-node returned error");
        if (fsStatus === 429 || fsStatus === 402) markRateLimited(backend.url, fsStatus);
        if ((fsStatus >= 500 || fsStatus === 429 || fsStatus === 402) && attempt < MAX_RETRIES && !res.headersSent) {
          markUnhealthy(backend.url, backend.apiKey);
          const next = pickBackendForCacheExcluding(fp, tried);
          if (next && next.kind === "friend") {
            backend = next;
            if (idleTimer) clearTimeout(idleTimer);
            res.removeListener("close", onClose);
            continue;
          }
        }
        if (!res.headersSent) {
          res.status(fsStatus).type("application/json").send(errText);
        } else if (!res.writableEnded) {
          res.end();
        }
        break;
      }

      if (isStream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const reader = fetchRes.body?.getReader();
        if (!reader) { res.end(); break; }
        const decoder = new TextDecoder();
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length) {
            resetIdle();
            res.write(decoder.decode(value, { stream: true }));
          }
        }
        if (!res.writableEnded) res.end();
        break;
      } else {
        const buf = await fetchRes.arrayBuffer();
        res.status(fetchRes.status).type(fetchRes.headers.get("content-type") ?? "application/json").send(Buffer.from(buf));
        break;
      }
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError" || abort.signal.aborted;
      req.log.warn({ err: (err as Error)?.message, aborted, backend: backend.label, attempt }, "/v1beta: fetch failed");
      if (!aborted && attempt < MAX_RETRIES && !res.headersSent) {
        markUnhealthy(backend.url, backend.apiKey);
        const next = pickBackendForCacheExcluding(fp, tried);
        if (next && next.kind === "friend") {
          backend = next;
          if (idleTimer) clearTimeout(idleTimer);
          res.removeListener("close", onClose);
          continue;
        }
      }
      if (!res.headersSent) {
        res.status(502).json({ error: { code: 502, message: aborted ? "client_disconnected" : ((err as Error)?.message ?? "upstream_error"), status: "UNAVAILABLE" } });
      } else if (!res.writableEnded) {
        res.end();
      }
      break;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      res.removeListener("close", onClose);
    }
  }
});

// ---------------------------------------------------------------------------
// Real-time request log ring buffer + SSE
// ---------------------------------------------------------------------------

interface RequestLog {
  id: number;
  time: string;
  method: string;
  path: string;
  model?: string;
  backend?: string;
  status: number;
  duration: number;
  stream: boolean;
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheTier?: string;
  msgSummary?: string;
  priceUSD?: number;
  level: "info" | "warn" | "error";
  error?: string;
}

const REQUEST_LOG_MAX = 200;
const requestLogs: RequestLog[] = [];
let logIdCounter = 0;
const logSSEClients: Set<Response> = new Set();

export function pushRequestLog(entry: Omit<RequestLog, "id" | "time">): void {
  const log: RequestLog = { id: ++logIdCounter, time: new Date().toISOString(), ...entry };
  requestLogs.push(log);
  if (requestLogs.length > REQUEST_LOG_MAX) requestLogs.shift();
  const data = `data: ${JSON.stringify(log)}\n\n`;
  for (const client of logSSEClients) {
    try { client.write(data); } catch { logSSEClients.delete(client); }
  }
}

router.get("/v1/admin/logs", requireApiKey, (_req: Request, res: Response) => {
  res.json({ logs: requestLogs });
});

router.get("/v1/admin/logs/stream", requireApiKeyWithQuery, (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  logSSEClients.add(res);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 20000);
  req.on("close", () => { clearInterval(heartbeat); logSSEClients.delete(res); });
});

router.get("/v1/stats", requireApiKey, async (_req: Request, res: Response) => {
  const allConfigs = getAllFriendProxyConfigs();
  const allLabels = allConfigs.map((c) => c.label);
  const result: Record<string, unknown> = {};
  for (const label of allLabels) {
    const s = getStat(label);
    const cfg = allConfigs.find((c) => c.label === label);
    result[label] = {
      calls: s.calls,
      errors: s.errors,
      streamingCalls: s.streamingCalls,
      promptTokens: s.promptTokens,
      completionTokens: s.completionTokens,
      cacheReadTokens: s.cacheReadTokens,
      cacheWriteTokens: s.cacheWriteTokens,
      totalTokens: s.promptTokens + s.completionTokens,
      totalCostUSD: s.totalCostUSD,
      avgDurationMs: s.calls > 0 ? Math.round(s.totalDurationMs / s.calls) : 0,
      avgTtftMs: s.streamingCalls > 0 ? Math.round(s.totalTtftMs / s.streamingCalls) : null,
      health: getCachedHealth(cfg?.apiBaseUrl ?? "") === false ? "down" : "healthy",
      publicBaseUrl: cfg?.publicBaseUrl ?? null,
      apiBaseUrl: cfg?.apiBaseUrl ?? null,
      source: cfg?.source ?? "dynamic",
      dynamic: cfg?.source === "dynamic",
      enabled: cfg ? cfg.enabled : true,
      nodeId: cfg?.nodeId ?? null,
      version: cfg?.version ?? null,
      integrationsAllReady: cfg?.integrationsAllReady ?? null,
      lastHeartbeatAt: cfg?.lastHeartbeatAt ?? null,
    };
  }
  const modelStats: Record<string, ModelStat> = Object.fromEntries(modelStatsMap.entries());
  res.json({
    stats: result,
    modelStats,
    uptimeSeconds: Math.round(process.uptime()),
    routing: routingSettings,
    responseCache: await getCacheStats(),
  });
});

router.post("/v1/admin/stats/reset", requireApiKey, (_req: Request, res: Response) => {
  statsMap.clear();
  modelStatsMap.clear();
  scheduleSave();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin: response cache management
// ---------------------------------------------------------------------------

// GET /v1/admin/cache — return current cache statistics
router.get("/v1/admin/cache", requireApiKey, async (_req: Request, res: Response) => {
  res.json(await getCacheStats());
});

// PATCH /v1/admin/cache — configure cache settings
// Body: { enabled?: boolean, ttlMinutes?: number, maxEntries?: number }
router.patch("/v1/admin/cache", requireApiKey, async (req: Request, res: Response) => {
  const { enabled, ttlMinutes, maxEntries } = req.body as {
    enabled?: unknown;
    ttlMinutes?: unknown;
    maxEntries?: unknown;
  };
  if (typeof enabled === "boolean") setCacheEnabled(enabled);
  if (typeof ttlMinutes === "number" && ttlMinutes > 0) setCacheTtl(ttlMinutes);
  if (typeof maxEntries === "number" && maxEntries > 0) setCacheMaxEntries(maxEntries);
  res.json({ ok: true, ...(await getCacheStats()) });
});

// DELETE /v1/admin/cache — clear all cached responses and reset hit/miss counters
router.delete("/v1/admin/cache", requireApiKey, async (_req: Request, res: Response) => {
  await cacheClear();
  res.json({ ok: true, ...(await getCacheStats()) });
});

// ---------------------------------------------------------------------------
// Admin: manage dynamic backends at runtime (no restart / redeploy required)
// ---------------------------------------------------------------------------

router.get("/v1/admin/backends", requireApiKey, (_req: Request, res: Response) => {
  const allConfigs = getAllFriendProxyConfigs();
  res.json({
    env: allConfigs
      .filter((c) => c.source === "env")
      .map((c) => ({
        label: c.label,
        publicBaseUrl: c.publicBaseUrl,
        apiBaseUrl: c.apiBaseUrl,
        source: c.source,
        enabled: c.enabled,
        health: getCachedHealth(c.apiBaseUrl) === false ? "down" : "healthy",
      })),
    dynamic: allConfigs
      .filter((c) => c.source === "dynamic")
      .map((c) => ({
        label: c.label,
        publicBaseUrl: c.publicBaseUrl,
        apiBaseUrl: c.apiBaseUrl,
        source: c.source,
        enabled: c.enabled,
        health: getCachedHealth(c.apiBaseUrl) === false ? "down" : "healthy",
      })),
    register: getRegisteredNodesSnapshot().map((node) => ({
      nodeId: node.nodeId,
      label: node.label,
      publicBaseUrl: node.publicBaseUrl,
      apiBaseUrl: node.apiBaseUrl,
      source: node.source,
      enabled: node.enabled,
      version: node.version,
      configured: node.configured,
      integrationsAllReady: node.integrationsAllReady,
      lastHeartbeatAt: node.lastHeartbeatAt,
      capabilities: node.capabilities ?? [],
      health: getCachedHealth(node.apiBaseUrl) === false ? "down" : "healthy",
    })),
    auth: {
      acceptedAuth: ["Authorization: Bearer <key>", "x-goog-api-key", "x-api-key", "query:key"],
      keySource: "PROXY_API_KEY",
    },
  });
});

router.post("/v1/admin/backends", requireApiKey, (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    res.status(400).json({ error: "Valid https URL required" });
    return;
  }
  const cleanUrl = url.replace(/\/+$/, "");
  const normalizedUrl = normalizeSubNodeUrl(cleanUrl);
  const allUrls = getFriendProxyConfigs().map((c) => c.apiBaseUrl);
  if (allUrls.includes(normalizedUrl)) { res.status(409).json({ error: "URL already in pool" }); return; }
  const label = `DYNAMIC_${++dynamicLabelCounter}`;
  dynamicBackends.push({ label, url: cleanUrl });
  saveDynamicBackends(dynamicBackends);
  probeAndSetHealth(normalizedUrl, getProxyApiKey());
  // Trigger an async model refresh so newly-added backend's OpenRouter models appear immediately.
  setTimeout(() => fetchOpenRouterModels(), 2_000);
  res.json({ label, url: cleanUrl, source: "dynamic" });
});

router.delete("/v1/admin/backends/:label", requireApiKey, (req: Request, res: Response) => {
  const { label } = req.params;
  const before = dynamicBackends.length;
  dynamicBackends = dynamicBackends.filter((d) => d.label !== label);
  if (dynamicBackends.length === before) { res.status(404).json({ error: "Dynamic backend not found" }); return; }
  saveDynamicBackends(dynamicBackends);
  res.json({ deleted: true, label });
});

// PATCH /v1/admin/backends/:label — 切换单个节点启用/禁用
router.patch("/v1/admin/backends/:label", requireApiKey, (req: Request, res: Response) => {
  const { label } = req.params;
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") { res.status(400).json({ error: "enabled (boolean) required" }); return; }
  const target = dynamicBackends.find((d) => d.label === label);
  if (!target) { res.status(404).json({ error: "Dynamic backend not found" }); return; }
  target.enabled = enabled;
  saveDynamicBackends(dynamicBackends);
  res.json({ label, enabled });
});

// PATCH /v1/admin/backends — 批量切换（labels 数组 + enabled 布尔值）
router.patch("/v1/admin/backends", requireApiKey, (req: Request, res: Response) => {
  const { labels, enabled } = req.body as { labels?: string[]; enabled?: boolean };
  if (!Array.isArray(labels) || typeof enabled !== "boolean") {
    res.status(400).json({ error: "labels (string[]) and enabled (boolean) required" });
    return;
  }
  const set = new Set(labels);
  let updated = 0;
  for (const d of dynamicBackends) {
    if (set.has(d.label)) { d.enabled = enabled; updated++; }
  }
  persistDynamicBackends(dynamicBackends);
  res.json({ updated, enabled });
});

router.post("/v1/internal/nodes/register", requireApiKey, (req: Request, res: Response) => {
  const body = req.body as {
    nodeId?: string;
    label?: string;
    publicBaseUrl?: string;
    version?: string;
    integrationsAllReady?: boolean;
    capabilities?: string[];
    configured?: boolean;
    reportedModelsDigest?: string;
    reportedModels?: ManualOverlayModel[];
  };

  if (!body.nodeId || !body.label || !body.publicBaseUrl) {
    res.status(400).json({ error: "nodeId, label and publicBaseUrl are required" });
    return;
  }

  const node = registerOrUpdateNode({
    nodeId: body.nodeId,
    label: body.label,
    publicBaseUrl: body.publicBaseUrl,
    version: body.version,
    integrationsAllReady: body.integrationsAllReady,
    capabilities: body.capabilities,
    configured: body.configured,
    reportedModelsDigest: body.reportedModelsDigest,
    reportedModels: body.reportedModels,
    healthy: true,
    enabled: true,
  });
  refreshUnifiedRegistryCache();
  rebuildModelIndex();

  void probeAndSetHealth(node.apiBaseUrl, node.apiKey);
  req.log.info({ nodeId: node.nodeId, label: node.label, source: node.source, publicBaseUrl: node.publicBaseUrl }, "Registered child node");

  res.json({
    ok: true,
    node: {
      nodeId: node.nodeId,
      label: node.label,
      source: node.source,
      publicBaseUrl: node.publicBaseUrl,
      apiBaseUrl: node.apiBaseUrl,
      version: node.version,
      configured: node.configured,
      integrationsAllReady: node.integrationsAllReady,
      capabilities: node.capabilities ?? [],
      enabled: node.enabled,
      reportedModelsDigest: node.reportedModelsDigest ?? null,
      reportedModelsCount: node.reportedModels?.length ?? 0,
      registeredAt: node.registeredAt,
      lastHeartbeatAt: node.lastHeartbeatAt,
    },
  });
});

router.post("/v1/internal/nodes/heartbeat", requireApiKey, (req: Request, res: Response) => {
  const body = req.body as {
    nodeId?: string;
    version?: string;
    publicBaseUrl?: string;
    healthy?: boolean;
    integrationsAllReady?: boolean;
    configured?: boolean;
    timestamp?: number;
    capabilities?: string[];
    reportedModelsDigest?: string;
    reportedModels?: ManualOverlayModel[];
  };

  if (!body.nodeId) {
    res.status(400).json({ error: "nodeId is required" });
    return;
  }

  const node = heartbeatNode({
    nodeId: body.nodeId,
    version: body.version,
    publicBaseUrl: body.publicBaseUrl,
    healthy: body.healthy,
    integrationsAllReady: body.integrationsAllReady,
    configured: body.configured,
    capabilities: body.capabilities,
    reportedModelsDigest: body.reportedModelsDigest,
    reportedModels: body.reportedModels,
    lastHeartbeatAt: typeof body.timestamp === "number" ? body.timestamp : Date.now(),
  });

  if (!node) {
    res.status(404).json({ error: "registered node not found" });
    return;
  }

  if (body.healthy === false) setHealth(node.apiBaseUrl, false);
  else void probeAndSetHealth(node.apiBaseUrl, node.apiKey);

  refreshUnifiedRegistryCache();
  rebuildModelIndex();

  req.log.info({ nodeId: node.nodeId, label: node.label, healthy: body.healthy !== false }, "Heartbeat received from child node");

  res.json({
    ok: true,
    node: {
      nodeId: node.nodeId,
      label: node.label,
      source: node.source,
      publicBaseUrl: node.publicBaseUrl,
      apiBaseUrl: node.apiBaseUrl,
      version: node.version,
      configured: node.configured,
      integrationsAllReady: node.integrationsAllReady,
      enabled: node.enabled,
      reportedModelsDigest: node.reportedModelsDigest ?? null,
      reportedModelsCount: node.reportedModels?.length ?? 0,
      lastHeartbeatAt: node.lastHeartbeatAt,
    },
  });
});

router.get("/v1/admin/routing", requireApiKey, (_req: Request, res: Response) => {
  res.json({
    fakeStream: routingSettings.fakeStream,
  });
});

router.patch("/v1/admin/routing", requireApiKey, (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  if (typeof body.fakeStream === "boolean") routingSettings.fakeStream = body.fakeStream;
  saveRoutingSettings();
  res.json({ fakeStream: routingSettings.fakeStream });
});

// ---------------------------------------------------------------------------
// Admin: model enable/disable management
// ---------------------------------------------------------------------------

// GET /v1/admin/models — list all models with provider + enabled status
router.get("/v1/admin/models", requireApiKey, async (_req: Request, res: Response) => {
  const staticIds = new Set(ALL_MODELS.map((m) => m.id));
  const dynamicEntries = openrouterDynamicModels
    .filter((m) => !staticIds.has(m.id))
    .map((m) => ({ id: m.id, description: m.name ?? "OpenRouter model" }));

  const knownIds = new Set([...staticIds, ...openrouterDynamicModels.map((m) => m.id)]);
  const customEntries = customOpenRouterModels
    .filter((m) => !knownIds.has(m.id))
    .map((m) => ({ id: m.id, description: m.name ?? "OpenRouter (custom)" }));

  const allModelIds = [
    ...ALL_MODELS.map((m) => m.id),
    ...dynamicEntries.map((m) => m.id),
    ...customEntries.map((m) => m.id),
  ];
  const models = await Promise.all(allModelIds.map(async (id) => ({
    id,
    provider: MODEL_PROVIDER_MAP.get(id) ?? (id.includes("/") ? "openrouter" : "openai"),
    enabled: await isModelEnabled(id),
    custom: customOpenRouterModels.some((c) => c.id === id),
  })));
  const summary: Record<string, { total: number; enabled: number }> = {};
  for (const m of models) {
    if (!summary[m.provider]) summary[m.provider] = { total: 0, enabled: 0 };
    summary[m.provider].total++;
    if (m.enabled) summary[m.provider].enabled++;
  }
  res.json({ models, summary, openrouterTotal: openrouterDynamicModels.length, customTotal: customOpenRouterModels.length });
});

// ---------------------------------------------------------------------------
// Admin: live OpenRouter pricing (fetched from OR models API, per-million USD)
// ---------------------------------------------------------------------------

// GET /v1/admin/model-pricing — return { pricing: Record<modelId, {input,output,cacheReadPerM?,cacheWritePerM?}> }
// The portal uses this to show accurate, live cost estimates for OR models.
// Non-OR models (OpenAI, Anthropic direct, Gemini) are NOT in this map;
// the portal falls back to its hardcoded table for those.
router.get("/v1/admin/model-pricing", requireApiKey, (_req: Request, res: Response) => {
  const pricing: Record<string, ORPricing> = {};
  for (const [id, p] of openrouterPricingCache) pricing[id] = p;
  res.json({ pricing, updatedModels: openrouterPricingCache.size });
});

// ---------------------------------------------------------------------------
// Admin: custom OpenRouter models CRUD
// ---------------------------------------------------------------------------

// GET /v1/admin/models/custom — list all custom OpenRouter models
router.get("/v1/admin/models/custom", requireApiKey, (_req: Request, res: Response) => {
  res.json({ models: customOpenRouterModels });
});

router.get("/v1/admin/models/manual", requireApiKey, async (_req: Request, res: Response) => {
  const models = [...persistedManualOverlayRegistryCache.values()];
  res.json({
    object: "list",
    data: models,
    _meta: {
      persisted: persistedManualOverlayRegistryCache.size,
      env: envManualOverlayRegistryCache.size,
      merged: manualOverlayRegistryCache.size,
      precedence: "env_overrides_store",
    },
  });
});

router.put("/v1/admin/models/manual", requireApiKey, async (req: Request, res: Response) => {
  const body = req.body as unknown;
  if (!Array.isArray(body)) {
    res.status(400).json({ error: { message: "Request body must be a JSON array of mother manual model declarations", type: "invalid_request_error" } });
    return;
  }

  const invalidIndex = body.findIndex((entry) => !entry || typeof entry !== "object" || typeof (entry as { id?: unknown }).id !== "string" || !(entry as { id: string }).id.trim());
  if (invalidIndex >= 0) {
    res.status(400).json({ error: { message: `Manual model entry at index ${invalidIndex} must contain a non-empty id`, type: "invalid_request_error" } });
    return;
  }

  const nextEntries = (body as Array<Record<string, unknown>>).map((entry) => ({
    ...entry,
    id: String(entry.id).trim(),
    origin: "mother_manual" as const,
    source: "manual" as const,
  })) as ManualOverlayModel[];

  const saved = await writeManualModelStore(nextEntries);
  setPersistedManualOverlayRegistryCache(saved);
  await reloadMotherManualRegistryCache();

  res.json({
    ok: true,
    replaced: saved.length,
    persisted: persistedManualOverlayRegistryCache.size,
    env: envManualOverlayRegistryCache.size,
    merged: manualOverlayRegistryCache.size,
  });
});

// mother manual persistence phase
router.post("/v1/admin/models/manual", requireApiKey, async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown> | null | undefined;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ error: { message: "Request body must be a JSON object", type: "invalid_request_error" } });
    return;
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    res.status(400).json({ error: { message: "Manual model id is required", type: "invalid_request_error" } });
    return;
  }

  const result = await upsertManualModelStoreEntry({
    ...(body as unknown as ManualOverlayModel),
    id,
    origin: "mother_manual",
    source: "manual",
  });
  setPersistedManualOverlayRegistryCache(result.entries);
  await reloadMotherManualRegistryCache();

  res.status(201).json({
    ok: true,
    item: result.entry,
    persisted: persistedManualOverlayRegistryCache.size,
    env: envManualOverlayRegistryCache.size,
    merged: manualOverlayRegistryCache.size,
  });
});

router.delete("/v1/admin/models/manual/:id", requireApiKey, async (req: Request, res: Response) => {
  const id = decodeURIComponent(String(req.params.id ?? "")).trim();
  if (!id) {
    res.status(400).json({ error: { message: "Manual model id is required", type: "invalid_request_error" } });
    return;
  }

  const result = await deleteManualModelStoreEntry(id);
  if (!result.deleted) {
    res.status(404).json({ error: { message: `Manual model '${id}' not found`, type: "not_found" } });
    return;
  }

  setPersistedManualOverlayRegistryCache(result.entries);
  await reloadMotherManualRegistryCache();

  res.json({
    ok: true,
    deleted: result.deleted.id,
    persisted: persistedManualOverlayRegistryCache.size,
    env: envManualOverlayRegistryCache.size,
    merged: manualOverlayRegistryCache.size,
  });
});

// POST /v1/admin/models/custom — add a custom OpenRouter model
// Body: { id: string, name?: string }
router.post("/v1/admin/models/custom", requireApiKey, (req: Request, res: Response) => {
  const { id, name } = req.body as { id?: string; name?: string };
  if (!id || typeof id !== "string" || !id.trim()) {
    res.status(400).json({ error: "Model id (string) required" });
    return;
  }
  const cleanId = id.trim();
  if (customOpenRouterModels.some((m) => m.id === cleanId)) {
    res.status(409).json({ error: "Model already exists in custom list" });
    return;
  }
  const entry: CustomOpenRouterModel = { id: cleanId, ...(name ? { name: name.trim() } : {}) };
  customOpenRouterModels.push(entry);
  if (!MODEL_PROVIDER_MAP.has(cleanId)) MODEL_PROVIDER_MAP.set(cleanId, "openrouter");
  saveCustomOpenRouterModels();
  console.log(`[custom-models] added: ${cleanId}`);
  res.json({ ok: true, model: entry });
});

// DELETE /v1/admin/models/custom/:id — remove a custom OpenRouter model
router.delete("/v1/admin/models/custom/:id", requireApiKey, (req: Request, res: Response) => {
  const id = decodeURIComponent(String(req.params.id));
  const before = customOpenRouterModels.length;
  customOpenRouterModels = customOpenRouterModels.filter((m) => m.id !== id);
  if (customOpenRouterModels.length === before) {
    res.status(404).json({ error: "Custom model not found" });
    return;
  }
  saveCustomOpenRouterModels();
  rebuildModelIndex();
  console.log(`[custom-models] removed: ${id}`);
  res.json({ ok: true, deleted: id });
});

// ---------------------------------------------------------------------------
// Admin: managed model lists CRUD (OpenAI / Anthropic / Gemini / OpenRouter)
// ---------------------------------------------------------------------------

const MANAGED_PROVIDERS = ["openai", "anthropic", "gemini", "openrouter"] as const;
type ManagedProvider = typeof MANAGED_PROVIDERS[number];

function getManagedList(provider: ManagedProvider): string[] {
  if (provider === "openai") return managedOpenAI;
  if (provider === "anthropic") return managedAnthropic;
  if (provider === "gemini") return managedGemini;
  return managedOpenRouter;
}

function setManagedList(provider: ManagedProvider, list: string[]): void {
  if (provider === "openai") managedOpenAI = list;
  else if (provider === "anthropic") managedAnthropic = list;
  else if (provider === "gemini") managedGemini = list;
  else managedOpenRouter = list;
  rebuildModelIndex();
  saveManagedModels();
}

// GET /v1/admin/models/managed — list all managed model lists per provider
router.get("/v1/admin/models/managed", requireApiKey, (_req: Request, res: Response) => {
  res.json({
    openai: managedOpenAI,
    anthropic: managedAnthropic,
    gemini: managedGemini,
    openrouter: managedOpenRouter,
    defaults: {
      openai: DEFAULT_OPENAI_MODELS,
      anthropic: DEFAULT_ANTHROPIC_MODELS,
      gemini: DEFAULT_GEMINI_MODELS,
      openrouter: DEFAULT_OPENROUTER_MODELS,
    },
  });
});

// POST /v1/admin/models/managed/:provider — add a model to a provider list
// Body: { id: string }
router.post("/v1/admin/models/managed/:provider", requireApiKey, (req: Request, res: Response) => {
  const provider = req.params.provider as ManagedProvider;
  if (!MANAGED_PROVIDERS.includes(provider)) {
    res.status(400).json({ error: `Unknown provider. Use: ${MANAGED_PROVIDERS.join(", ")}` });
    return;
  }
  const { id } = req.body as { id?: string };
  if (!id || typeof id !== "string" || !id.trim()) {
    res.status(400).json({ error: "Model id (string) required" });
    return;
  }
  const cleanId = id.trim();
  const list = getManagedList(provider);
  if (list.includes(cleanId)) {
    res.status(409).json({ error: "Model already in list" });
    return;
  }
  setManagedList(provider, [...list, cleanId]);
  console.log(`[managed-models] added ${cleanId} to ${provider}`);
  res.json({ ok: true, provider, id: cleanId });
});

// DELETE /v1/admin/models/managed/:provider/:id — remove a model from a provider list
router.delete("/v1/admin/models/managed/:provider/:id", requireApiKey, (req: Request, res: Response) => {
  const provider = req.params.provider as ManagedProvider;
  if (!MANAGED_PROVIDERS.includes(provider)) {
    res.status(400).json({ error: `Unknown provider. Use: ${MANAGED_PROVIDERS.join(", ")}` });
    return;
  }
  const id = decodeURIComponent(String(req.params.id));
  const list = getManagedList(provider);
  const newList = list.filter((m) => m !== id);
  if (newList.length === list.length) {
    res.status(404).json({ error: "Model not found in list" });
    return;
  }
  setManagedList(provider, newList);
  console.log(`[managed-models] removed ${id} from ${provider}`);
  res.json({ ok: true, provider, deleted: id });
});

// POST /v1/admin/models/managed/:provider/reset — reset a provider to defaults
router.post("/v1/admin/models/managed/:provider/reset", requireApiKey, (req: Request, res: Response) => {
  const provider = req.params.provider as ManagedProvider;
  if (!MANAGED_PROVIDERS.includes(provider)) {
    res.status(400).json({ error: `Unknown provider. Use: ${MANAGED_PROVIDERS.join(", ")}` });
    return;
  }
  const defaults: Record<ManagedProvider, string[]> = {
    openai: DEFAULT_OPENAI_MODELS,
    anthropic: DEFAULT_ANTHROPIC_MODELS,
    gemini: DEFAULT_GEMINI_MODELS,
    openrouter: DEFAULT_OPENROUTER_MODELS,
  };
  setManagedList(provider, [...defaults[provider]]);
  console.log(`[managed-models] reset ${provider} to defaults`);
  res.json({ ok: true, provider, models: getManagedList(provider) });
});

// ---------------------------------------------------------------------------
// Model Route Rules — admin CRUD
// A route rule remaps an incoming model ID to a different actual model ID.
// Example: { from: "gpt-5.2", to: "meta-llama/llama-4-maverick" }
// ---------------------------------------------------------------------------

// GET /v1/admin/models/routes — list all route rules
router.get("/v1/admin/models/routes", requireApiKey, (_req: Request, res: Response) => {
  res.json({ routes: modelRoutes });
});

// POST /v1/admin/models/routes — add or update a route rule
// Body: { from: string, to: string, note?: string }
router.post("/v1/admin/models/routes", requireApiKey, (req: Request, res: Response) => {
  const { from, to, note } = req.body as { from?: string; to?: string; note?: string };
  const fromId = typeof from === "string" ? from.trim() : "";
  const toId = typeof to === "string" ? to.trim() : "";
  if (!fromId || !toId) { res.status(400).json({ error: "'from' and 'to' (string) required" }); return; }
  if (fromId === toId) { res.status(400).json({ error: "'from' and 'to' must be different" }); return; }
  // Upsert
  const existing = modelRoutes.findIndex((r) => r.from === fromId);
  const rule: ModelRoute = { from: fromId, to: toId, ...(note ? { note } : {}) };
  if (existing >= 0) {
    modelRoutes[existing] = rule;
  } else {
    modelRoutes.push(rule);
  }
  saveModelRoutes();
  console.log(`[model-routes] upsert: ${fromId} → ${toId}`);
  res.json({ ok: true, route: rule });
});

// DELETE /v1/admin/models/routes/:from — delete a route rule by its 'from' ID
router.delete("/v1/admin/models/routes/:from", requireApiKey, (req: Request, res: Response) => {
  const fromId = decodeURIComponent(String(req.params.from));
  const before = modelRoutes.length;
  modelRoutes = modelRoutes.filter((r) => r.from !== fromId);
  if (modelRoutes.length === before) {
    res.status(404).json({ error: `No route rule found for '${fromId}'` });
    return;
  }
  saveModelRoutes();
  console.log(`[model-routes] deleted route from: ${fromId}`);
  res.json({ ok: true, deleted: fromId });
});

// DELETE /v1/admin/models/routes — clear all route rules
router.delete("/v1/admin/models/routes", requireApiKey, (_req: Request, res: Response) => {
  const count = modelRoutes.length;
  modelRoutes = [];
  saveModelRoutes();
  console.log(`[model-routes] cleared ${count} route rule(s)`);
  res.json({ ok: true, cleared: count });
});

// POST /v1/admin/models/refresh — manually trigger OpenRouter dynamic model list refresh.
// Useful after adding new sub-nodes or when the model list is stale.
router.post("/v1/admin/models/refresh", requireApiKey, (_req: Request, res: Response) => {
  fetchOpenRouterModels().then(async () => {
    await refreshManualOverlayRegistryCache();
    refreshNewapiImportedRegistryCache();
    refreshUnifiedRegistryCache();
    rebuildModelIndex();
    res.json({
      ok: true,
      dynamicModels: openrouterDynamicModels.length,
      manualModels: manualOverlayRegistryCache.size,
      manualStoreModels: persistedManualOverlayRegistryCache.size,
      manualEnvModels: envManualOverlayRegistryCache.size,
      childReportedModels: childReportedRegistryCache.size,
      newapiImportedModels: newapiImportedRegistryCache.size,
      totalModels: ALL_MODELS.length,
    });
  }).catch((err: unknown) => {
    res.status(500).json({ error: String(err) });
  });
});

// PATCH /v1/admin/models — bulk enable/disable by ids or by provider
// Body: { ids?: string[], provider?: string, enabled: boolean }
router.patch("/v1/admin/models", requireApiKey, async (req: Request, res: Response) => {
  const { ids, provider, enabled } = req.body as { ids?: string[]; provider?: string; enabled?: boolean };
  if (typeof enabled !== "boolean") { res.status(400).json({ error: "enabled (boolean) required" }); return; }

  let targets: string[] = [];
  if (Array.isArray(ids) && ids.length > 0) {
    targets = ids.filter((id) => MODEL_PROVIDER_MAP.has(id));
  } else if (typeof provider === "string") {
    targets = ALL_MODELS.map((m) => m.id).filter((id) => MODEL_PROVIDER_MAP.get(id) === provider);
  } else {
    res.status(400).json({ error: "ids (string[]) or provider (string) required" }); return;
  }

  await Promise.all(targets.map(id => enabled ? enableModel(id) : disableModel(id)));
  res.json({ updated: targets.length, enabled, ids: targets });
});

// ---------------------------------------------------------------------------
// Job API — background runner (runs on SUB-NODE when it receives a POST /v1/jobs)
// ---------------------------------------------------------------------------

/**
 * Runs a streaming completion entirely in the background — not tied to any HTTP
 * response, so no platform incoming-proxy limit applies.  Pushes SSE chunks to
 * job.chunks and handles its own continuation loop.
 */
// ---------------------------------------------------------------------------
// Leg A via Sub-Node Job API
// ---------------------------------------------------------------------------
// Submits the request to the sub-node's /v1/jobs endpoint.  The sub-node runs
// the LLM call in its own background (outgoing connection to AI provider is NOT
// subject to the platform's incoming-proxy limit).  We reconnect to the sub-node's
// /v1/jobs/:id/stream with Last-Event-ID before the platform's outgoing cut —
// zero new LLM calls, zero accumulated-text re-input, zero token waste.
//
// Returns true if the sub-node supported Job API and the job completed (or was
// aborted).  Returns false if the sub-node has no Job API (404 / network error
// on the submit step) so the caller can fall back to direct streaming.
async function runLegAViaSubNodeJobApi(
  job: StreamJobEntry,
  body: Record<string, unknown>,
  backend: Extract<Backend, { kind: "friend" }>,
): Promise<boolean> {
  // ── 1. Submit job to sub-node ────────────────────────────────────────────
  let submitRes: globalThis.Response;
  try {
    submitRes = await fetch(`${backend.url}/v1/jobs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUTS.subNodeJobSubmitMs),
    });
  } catch {
    return false; // sub-node unreachable or no Job API
  }
  if (!submitRes.ok) return false; // 404 = no Job API, other = error → fallback

  let jobId: string;
  try {
    const j = await submitRes.json() as { job_id?: string };
    if (!j.job_id) return false;
    jobId = j.job_id;
  } catch {
    return false;
  }

    // ── 2. Reconnect loop — keep one logical job alive across SSE reconnects ──
  let lastEventId: string | undefined;
  let streamDone = false;
  while (!streamDone && !job.abort.signal.aborted) {
    const streamHeaders: Record<string, string> = {
      Authorization: `Bearer ${backend.apiKey}`,
    };
    if (lastEventId) streamHeaders["Last-Event-ID"] = lastEventId;

    // Per-connection abort: wall fires before the platform's outgoing-connection cut
    // (default 270s, configurable via GATEWAY_SUBNODE_STREAM_WALL_MS).
    // If this fires, we reconnect to the same job using Last-Event-ID and keep streaming.
    const connAbort = new AbortController();
    const propagate  = (): void => { if (!connAbort.signal.aborted) connAbort.abort("job_abort"); };
    job.abort.signal.addEventListener("abort", propagate, { once: true });
    const wallTimer  = setTimeout(() => { if (!connAbort.signal.aborted) connAbort.abort("wall"); }, GATEWAY_TIMEOUTS.subNodeStreamWallMs);

    let connEnded = false;
    try {
      const streamRes = await fetch(`${backend.url}/v1/jobs/${jobId}/stream`, {
        headers: streamHeaders,
        signal:  connAbort.signal,
      });

      if (!streamRes.ok) {
        if (streamRes.status === 404) {
          // 404 is definitive: job is gone from sub-node.
          // If we haven't received any chunks yet, return false to allow fallback to direct streaming.
          if (job.chunks.length === 0) return false;
          // If we already have chunks, we can't fall back (would cause duplicates).
          throw new Error(`Sub-node job disappeared after ${job.chunks.length} chunks`);
        } else {
          // Other errors (5xx, 429, etc.): fall back if no progress made.
          if (job.chunks.length === 0) return false;
          throw new Error(`Sub-node stream error ${streamRes.status}`);
        }
      }

      const reader  = streamRes.body!.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";
      let   curId   = "";
      let   curData = "";

      while (true) {
        const { done, value } = await reader.read();
        // Flush TextDecoder internal buffer on stream end (handles split multi-byte UTF-8).
        buf += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        if (done) connEnded = true;

        // Process complete SSE events (delimited by blank line "\n\n").
        // On done, also process any trailing content without a final "\n\n".
        const events = buf.split("\n\n");
        buf = done ? "" : (events.pop() ?? "");

        for (const event of events) {
          curId   = "";
          curData = "";
          for (const line of event.split("\n")) {
            if (line.startsWith("id:"))   curId   = line.slice(3).trim();
            if (line.startsWith("data:")) curData = line.slice(5).trim();
          }
          if (curId) lastEventId = curId;
          if (curData) {
            if (curData === "[DONE]") { streamDone = true; break; }
            try {
              const parsed = JSON.parse(curData) as Record<string, unknown>;
              // Detect sub-node error chunks (e.g. "Provider ended the request: 400 ...")
              // Call failJob() so handleFriendProxy() can retry on another backend.
              if (parsed.error != null && parsed.choices == null) {
                const errMsg = typeof (parsed.error as Record<string, unknown>)?.message === "string"
                  ? (parsed.error as Record<string, unknown>).message as string
                  : "Sub-node job stream error";
                // Mark as provider error if message starts with a 4xx code or contains
                // known provider-error strings — backend is healthy, model was rejected.
                const isProviderErr = /^4\d\d[\s:]/.test(errMsg)
                  || errMsg.includes("Provider returned error")
                  || errMsg.includes("model_not_found")
                  || errMsg.includes("model not found")
                  || errMsg.includes("is not a valid model ID")
                  || errMsg.includes("UNSUPPORTED_MODEL");
                // ── Auto-fallback to direct /v1/chat/completions ─────────────
                // Sub-node's /v1/jobs endpoint sometimes diverges from its
                // /v1/chat/completions endpoint (e.g. doesn't strip -thinking
                // suffix, rejects models that the chat endpoint accepts).
                // If the Job API rejects with a provider-level 4xx BEFORE any
                // chunks arrive, abandon Job API and let the caller fall back
                // to direct streaming — same backend, same payload, working
                // endpoint.  Cancel the (possibly already-failed) sub-node job
                // best-effort so it doesn't sit around in the sub-node's store.
                if (isProviderErr && job.chunks.length === 0) {
                  fetch(`${backend.url}/v1/jobs/${jobId}`, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${backend.apiKey}` },
                    signal: AbortSignal.timeout(GATEWAY_TIMEOUTS.subNodeJobCancelMs),
                  }).catch(() => { /* best-effort */ });
                  clearTimeout(wallTimer);
                  job.abort.signal.removeEventListener("abort", propagate);
                  return false;
                }
                failJob(job, errMsg, isProviderErr);
                streamDone = true;
                break;
              }
              appendJobChunk(job, parsed);
            } catch { /* skip malformed */ }
          }
          if (streamDone) break;
        }
        if (streamDone || done) break;
      }
    } catch {
      // connAbort fired (wall or job abort) or network error — check below
    }

    clearTimeout(wallTimer);
    job.abort.signal.removeEventListener("abort", propagate);

    if (job.abort.signal.aborted) break;
    if (streamDone) break;
    if (connEnded) {
      // Connection ended cleanly — reconnect immediately with Last-Event-ID
      await new Promise<void>((r) => setTimeout(r, GATEWAY_TIMEOUTS.streamReconnectDelayMs));
      continue;
    }
    // Wall timer or network error — short pause then reconnect to preserve the stream
    await new Promise<void>((r) => setTimeout(r, GATEWAY_TIMEOUTS.streamRecoverDelayMs));
  }

  // Cancel the sub-node job if we aborted early (client disconnect etc.)
  if (!streamDone && jobId) {
    fetch(`${backend.url}/v1/jobs/${jobId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${backend.apiKey}` },
      signal: AbortSignal.timeout(GATEWAY_TIMEOUTS.subNodeJobCancelMs),
    }).catch(() => { /* best-effort */ });
  }

  return true; // Job API path completed (success or abort)
}

async function runStreamJobBackground(
  job: StreamJobEntry,
  messages: OAIMessage[],
  originalBody: Record<string, unknown>,
  backend: Extract<Backend, { kind: "friend" }>,
  skipJobApi = false,
): Promise<void> {
  // ── Strategy: prefer sub-node Job API (zero token waste) ──────────────────
  // The sub-node runs the LLM call in its own background.  Its outgoing
  // connection to the AI provider is NOT subject to the platform's HTTP limit.
  // We reconnect to the sub-node's job stream before the platform cut with
  // Last-Event-ID — no accumulated text re-input, no 3× token waste.
  //
  // skipJobApi=true when this node is ITSELF handling a POST /v1/jobs request
  // (i.e. we are the sub-node).  In that case we skip Job API to avoid infinite
  // recursion: sub-node → sub-sub-node → … forever.
  //
  // Falls back to direct streaming + text continuation for sub-nodes that do
  // not expose the /v1/jobs endpoint (external / older nodes).
  if (!skipJobApi) {
    const subNodeJobBody: Record<string, unknown> = {
      ...originalBody,
      messages: (originalBody.messages as OAIMessage[] | undefined) ?? messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    try {
      const usedJobApi = await runLegAViaSubNodeJobApi(job, subNodeJobBody, backend);
      if (usedJobApi) {
        finishJob(job);
        return;
      }
    } catch (e) {
      if (job.abort.signal.aborted) { finishJob(job); return; }
      // Unexpected error in Job API path — fall through to direct streaming
      void e;
    }
  }

  // ── Fallback / sub-node mode: direct /v1/chat/completions streaming ────────
  // When skipJobApi=true (sub-node mode): this IS the terminal LLM caller, so
  // we stream directly to the AI provider with text continuation on TCP cuts.
  // When skipJobApi=false and Job API failed: same fallback for legacy nodes.
  const MAX_CONT = 50;
  const baseMessages: OAIMessage[] = (originalBody.messages as OAIMessage[] | undefined) ?? messages;
  let currentMessages = [...baseMessages];
  let totalAccumulated = "";

  try {
    for (let contId = 0; contId <= MAX_CONT; contId++) {
      if (job.abort.signal.aborted) break;

      let contAccumulated = "";
      let contAnyOutput   = false;
      let finishReason: string | null = null;

      const bodyToSend: Record<string, unknown> = {
        ...originalBody,
        messages: currentMessages,
        stream: true,
        stream_options: { include_usage: true },
      };

      try {
        const fetchRes = await fetch(`${backend.url}/v1/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(bodyToSend),
          signal: job.abort.signal,
        });

        if (!fetchRes.ok) {
          const errText = await fetchRes.text().catch(() => "unknown");
          throw new Error(`sub-node ${fetchRes.status}: ${errText}`);
        }

        // ── fakeStream / JSON response ────────────────────────────────────
        const ct = fetchRes.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const json = await fetchRes.json() as Record<string, unknown>;
          type MsgShape = { content?: string | null; tool_calls?: unknown[] };
          const msg     = (json.choices as Array<{ message?: MsgShape; finish_reason?: string }>)?.[0]?.message;
          const content = msg?.content ?? "";
          const toolCalls = msg?.tool_calls;
          const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

          if (content || hasToolCalls) {
            contAnyOutput = true;
            const msgId  = `job-${Date.now()}`;
            const created = Math.floor(Date.now() / 1000);
            const fr      = (json.choices as Array<{ finish_reason?: string }>)?.[0]?.finish_reason
              ?? (hasToolCalls ? "tool_calls" : "stop");
            // Role opener
            appendJobChunk(job, { id: msgId, object: "chat.completion.chunk", created, model: job.model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
            // tool_calls delta — must come before content so clients see tool intent first
            if (hasToolCalls) {
              appendJobChunk(job, { id: msgId, object: "chat.completion.chunk", created, model: job.model, choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }] });
            }
            // text content (may be empty when tools are used)
            if (content) {
              appendJobChunk(job, { id: msgId, object: "chat.completion.chunk", created, model: job.model, choices: [{ index: 0, delta: { content }, finish_reason: null }] });
            }
            // finish chunk
            appendJobChunk(job, { id: msgId, object: "chat.completion.chunk", created, model: job.model, choices: [{ index: 0, delta: {}, finish_reason: fr }], usage: json.usage });
          }
          break; // JSON path — never continues
        }

        // ── Real SSE streaming ──────────────────────────────────────────────
        const reader  = fetchRes.body!.getReader();
        const decoder = new TextDecoder();
        let   buf     = "";

        // ── finish_reason routing ─────────────────────────────────────────────
        //
        // Two distinct cases require different handling:
        //
        //   A) finish_reason = "length" (model explicitly hit max_tokens)
        //      → Forward the chunk DIRECTLY to the client right away.
        //        Do NOT auto-continue. Let the client (e.g. SillyTavern) decide
        //        whether to continue. Auto-continuing here re-sends the full
        //        accumulated text as input every round — 3 rounds = 3× input tokens.
        //
        //   B) finish_reason = null (stream closed without reason)
        //      → The platform cuts the mother-proxy → sub-node TCP connection.
        //        The model was still generating. Auto-continue silently so the
        //        client sees an unbroken stream with no extra token overhead.
        //
        // finish_reason = "stop" is always buffered until final emit (unchanged).
        // usage-only chunks are buffered for final emit (unchanged).
        //
        // wasExplicitLength tracks whether the model itself sent finish_reason=length
        // so the post-loop continuation condition can distinguish case A from case B.
        let wasExplicitLength = false;

        // Buffer stop/usage-only chunks for final emit (NOT length — see above).
        const pendingFinalChunks: Record<string, unknown>[] = [];

        while (true) {
          const { done, value } = await reader.read();
          // On done, flush any bytes still buffered inside the TextDecoder
          // (a split multi-byte UTF-8 sequence) and any incomplete SSE line
          // sitting in `buf` (sub-node sent last line without trailing \n).
          buf += decoder.decode(value ?? new Uint8Array(), { stream: !done });
          const lines = buf.split(/\r?\n/);
          buf = done ? "" : (lines.pop() ?? "");

          for (const rawLine of lines) {
            const trimmed = rawLine.trimEnd();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;
            if (!data) continue;

            try {
              const chunk = JSON.parse(data) as Record<string, unknown>;

              // ── Sub-node error chunk detection ──────────────────────────────
              // Sub-nodes (friend proxies) sometimes embed provider errors inside
              // the SSE stream instead of returning a non-2xx HTTP status.
              // Example: {"error": {"message": "400 Provider returned error"}}
              // Without this check these chunks get forwarded to the client as-is.
              // By throwing a typed error here, the error propagates to the outer
              // catch → failJob().  handleFriendProxy() then sees !headersSent and
              // throws FriendProxyHttpError with the appropriate status:
              //   - Provider/model errors (4xx) → FriendProxyHttpError(400) so the
              //     backend is NOT marked unhealthy (it returned a valid error, just
              //     for that specific model/prompt).  is4xxRetryable lets the retry
              //     loop try the next node, or returns 4xx to the caller cleanly.
              //   - Genuine backend failures → FriendProxyHttpError(502) as before.
              if (chunk.error != null && chunk.choices == null) {
                const errMsg = typeof (chunk.error as Record<string, unknown>)?.message === "string"
                  ? (chunk.error as Record<string, unknown>).message as string
                  : "Sub-node stream error";
                // Detect provider-level errors embedded by the sub-node.
                // Pattern: message starts with a 4xx code OR contains known phrases.
                const isProviderErr = /^4\d\d[\s:]/.test(errMsg)
                  || errMsg.includes("Provider returned error")
                  || errMsg.includes("model_not_found")
                  || errMsg.includes("model not found");
                // Tag the error so handleFriendProxy can choose the right HTTP status.
                const tagged = new Error(errMsg) as Error & { isProviderErr?: boolean };
                tagged.isProviderErr = isProviderErr;
                throw tagged;
              }

              type CC = { delta?: { content?: string; reasoning?: string; tool_calls?: unknown[] }; finish_reason?: string | null };
              const choices = chunk.choices as CC[] | undefined;
              const dc = choices?.[0]?.delta?.content;
              const dr = choices?.[0]?.delta?.reasoning;
              const dtc = choices?.[0]?.delta?.tool_calls;
              const fr = choices?.[0]?.finish_reason;

              if (dc || dr || (Array.isArray(dtc) && dtc.length > 0)) contAnyOutput = true;
              if (dc) contAccumulated += dc;
              if (fr != null && finishReason === null) finishReason = fr as string;

              // Hoist: mark wasExplicitLength whenever the model sends finish_reason=length,
              // regardless of whether the same chunk also carries content (dc).
              // If we only checked inside `if (fr==="length" && !dc)`, a combined
              // content+length chunk would fall through with wasExplicitLength=false,
              // causing a spurious continuation round.
              if (fr === "length") wasExplicitLength = true;

              if (fr === "length" && !dc && !dr) {
                // Case A: model hit max_tokens — forward directly, let client decide.
                appendJobChunk(job, chunk);
                continue;
              }
              if (fr === "stop" && !dc && !dr) {
                // Normal end — buffer until final emit.
                pendingFinalChunks.push(chunk);
                continue;
              }
              if (chunk.usage != null && !dc && !dr && (fr == null || fr === "")) {
                pendingFinalChunks.push(chunk);
                continue;
              }

              appendJobChunk(job, chunk);
            } catch (innerErr) {
              // Only swallow JSON parse errors (malformed SSE data).
              // Re-throw everything else — especially sub-node error chunks detected above,
              // which must propagate to the outer catch so failJob() / retry logic fires.
              if (!(innerErr instanceof SyntaxError)) throw innerErr;
            }
          }

          if (done) break;
        }

        // Case B: stream closed with no finish_reason → platform TCP cut, model still running.
        // Treat as implicit length so the continuation loop fires.
        // We allow continuation even if contAnyOutput is false to handle cuts during thinking.
        if (finishReason === null) finishReason = "length";

        // Only auto-continue for Case B (connection drop). Case A (explicit length) goes
        // straight to the else-branch, emitting pendingFinalChunks and breaking, because
        // the client has already received the finish_reason=length chunk directly above.
        if (finishReason === "length" && !wasExplicitLength && contId < MAX_CONT) {
          totalAccumulated += contAccumulated;
          // Use baseMessages (cache-injected) so cache_control is preserved on every round.
          currentMessages = totalAccumulated
            ? [...baseMessages, { role: "assistant" as const, content: totalAccumulated }]
            : [...baseMessages];
          // pendingFinalChunks discarded — intermediate round, don't confuse client
        } else {
          // Final round: emit all buffered finish/usage chunks in order
          for (const c of pendingFinalChunks) appendJobChunk(job, c);
          break;
        }
      } catch (e) {
        if (job.abort.signal.aborted) break;
        // Network error (ECONNRESET etc.) — retry if we received anything
        if (contAnyOutput && contId < MAX_CONT) {
          totalAccumulated += contAccumulated;
          // Use baseMessages (cache-injected) so cache_control is preserved on retry rounds.
          currentMessages = totalAccumulated
            ? [...baseMessages, { role: "assistant" as const, content: totalAccumulated }]
            : [...baseMessages];
          // continue
        } else {
          throw e;
        }
      }
    }

    finishJob(job);
  } catch (e) {
    if (!job.abort.signal.aborted) {
      // Remove from liveJobMap so next retry starts fresh
      for (const [fp, j] of liveJobMap.entries()) {
        if (j === job) { liveJobMap.delete(fp); break; }
      }
      const isProvider = !!(e as Error & { isProviderErr?: boolean }).isProviderErr;
      failJob(job, (e as Error).message ?? String(e), isProvider);
    } else {
      finishJob(job);
    }
  }
}

// ---------------------------------------------------------------------------
// Job API routes — POST /v1/jobs, GET /v1/jobs/:id, DELETE /v1/jobs/:id
// ---------------------------------------------------------------------------

// POST /v1/jobs — submit async job, returns immediately with job_id
router.post("/v1/jobs", requireApiKey, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body     = req.body as Record<string, unknown>;
    const model    = (body.model as string | undefined) ?? "";
    const messages = (body.messages as OAIMessage[] | undefined) ?? [];

    const backend = pickBackend();
    if (!backend || backend.kind !== "friend") {
      res.status(503).json({ error: { message: "No available backend", type: "server_error" } });
      return;
    }

    const jobId = makeJobId();
    const emitter = new EventEmitter();
    emitter.setMaxListeners(32);
    const job: StreamJobEntry = {
      id: jobId, model, chunks: [], done: false, error: null, errorIsProvider: false,
      emitter, createdAt: Date.now(), lastAccessAt: Date.now(),
      abort: new AbortController(),
    };
    jobStore.set(jobId, job);

    // skipJobApi=true: this node IS the sub-node executing the job — go straight
    // to direct LLM streaming, do NOT recurse into the Job API path again.
    runStreamJobBackground(job, messages, body, backend as Extract<Backend, { kind: "friend" }>, true);

    res.json({ job_id: jobId, status: "running", model });
    return;
  } catch (err) {
    next(err);
    return;
  }
});

// GET /v1/jobs/:id/stream — SSE stream with Last-Event-ID reconnect support
// Keepalive cadence (default 200s, configurable via GATEWAY_KEEPALIVE_JOB_MS)
// so the upstream proxy doesn't cut idle connections.
router.get("/v1/jobs/:id/stream", requireApiKey, async (req: Request, res: Response) => {
  const job = jobStore.get(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: { message: "Job not found or expired", type: "not_found" } });
    return;
  }
  job.lastAccessAt = Date.now();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  if (res.socket) { res.socket.setNoDelay(true); res.socket.setTimeout(0); }

  // Keepalive cadence — must stay below the platform's idle-connection cut
  // (default 200s, configurable via GATEWAY_KEEPALIVE_JOB_MS)
  const keepalive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ id: `ka-${Date.now()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: job.model, choices: [] })}\n\n`);
    }
  }, GATEWAY_TIMEOUTS.keepaliveJobMs);

  const lastEventIdHdr = req.headers["last-event-id"] as string | undefined;
  const resume         = parseLastEventId(lastEventIdHdr);
  const fromIdx        = (resume?.jobId === job.id) ? Math.max(0, resume.lastIdx + 1) : 0;

  try {
    await streamJobToResponse(res, job, fromIdx);
  } finally {
    clearInterval(keepalive);
    if (!res.writableEnded) res.end();
  }
});

// GET /v1/jobs/:id — non-streaming status check
router.get("/v1/jobs/:id", requireApiKey, (req: Request, res: Response) => {
  const job = jobStore.get(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: { message: "Job not found or expired", type: "not_found" } });
    return;
  }
  job.lastAccessAt = Date.now();
  res.json({
    job_id:      job.id,
    status:      job.error ? "error" : job.done ? "done" : "running",
    model:       job.model,
    done:        job.done,
    error:       job.error,
    chunk_count: job.chunks.length,
  });
  return;
});

// DELETE /v1/jobs/:id — cancel a job
router.delete("/v1/jobs/:id", requireApiKey, (req: Request, res: Response) => {
  const jobId = String(req.params.id);
  const job = jobStore.get(jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  job.abort.abort("cancelled");
  finishJob(job);
  jobStore.delete(jobId);
  res.json({ ok: true });
  return;
});

// ---------------------------------------------------------------------------
// Dynamic Sinking Engine — Prompt Caching Optimisation
// ---------------------------------------------------------------------------
/**
 * Extracts only high-volatility content from system text and appends it to the
 * last user message. Low-frequency candidate layers stay in system so LCP can
 * still operate on them instead of sinking everything indiscriminately.
 */
function applyDynamicSinking(system: string, messages: unknown[]): LayeredSinkingResult {
  const analysis = analyzeSystemLayers(system);

  if (!analysis.volatileText.trim()) {
    return { system, messages, sunk: false, analysis };
  }

  const newMsgs = [...messages];
  let lastUserIdx = -1;
  for (let i = newMsgs.length - 1; i >= 0; i--) {
    if ((newMsgs[i] as { role?: string }).role === "user") { lastUserIdx = i; break; }
  }

  if (lastUserIdx === -1) {
    return { system, messages, sunk: false, analysis };
  }

  const sunkContent = analysis.volatileText.trim();
  const lastMsg = { ...(newMsgs[lastUserIdx] as { content?: unknown }) } as { content?: unknown };

  if (typeof lastMsg.content === "string") {
    lastMsg.content = `${lastMsg.content}\n\n${sunkContent}`.trim();
  } else if (Array.isArray(lastMsg.content)) {
    lastMsg.content = [...lastMsg.content, { type: "text", text: sunkContent }];
  } else {
    return { system, messages, sunk: false, analysis };
  }

  newMsgs[lastUserIdx] = {
    ...(newMsgs[lastUserIdx] as Record<string, unknown>),
    ...lastMsg,
  };

  return {
    system: analysis.systemWithoutVolatile,
    messages: newMsgs,
    sunk: true,
    analysis,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// Distinguishes upstream HTTP errors (5xx) from network/timeout errors so the
// retry logic can make the right decision about whether to try another node.
class FriendProxyHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "FriendProxyHttpError";
  }
}

// handleFriendProxy — raw fetch (bypasses SDK SSE parsing) so chunk.usage is
// captured reliably regardless of the friend proxy's SDK version or chunk format.
// SSE headers are committed only after the first chunk arrives, which preserves
// the retry window in case the upstream connection fails immediately.
//
// Streaming robustness design:
//  • No absolute wall-clock timeout — only idle timeout (60 s of zero bytes from upstream).
//    As long as data keeps arriving (thinking, long output, etc.) the stream never times out.
//  • Client disconnect is propagated immediately: res "close" → AbortController → upstream fetch abort.
//  • Auto-continuation: when finish_reason==="length" we append the accumulated assistant text
//    to the conversation and request continuation transparently (up to MAX_CONTINUATIONS rounds).
//    The client sees a seamless, uninterrupted SSE stream.
//  • SSE keepalive comment (": keep-alive") is sent to the client every 15 s to prevent
//    intermediate proxies / browsers from closing the idle connection during thinking phases.

function countMsgChars(msgs: OAIMessage[]): number {
  return msgs.reduce((acc, m) => {
    if (typeof m.content === "string") return acc + m.content.length;
    if (Array.isArray(m.content))
      return acc + (m.content as Array<{ type: string; text?: string }>)
        .filter((p) => p.type === "text").reduce((a, p) => a + (p.text?.length ?? 0), 0);
    return acc;
  }, 0);
}

// ---------------------------------------------------------------------------
// Debug helpers for logging
// ---------------------------------------------------------------------------

/** Compact summary of message-array structure — roles + char counts, no content.
 *  Example: "S:4521 U:892 A:1203 U:45"  (S=system U=user A=assistant T=tool)
 */
function describeMsgs(msgs: unknown[]): string {
  return msgs.map((m) => {
    const msg = m as { role?: string; content?: unknown };
    const role = ({ system: "S", user: "U", assistant: "A", tool: "T" }[msg.role ?? ""] ?? "?");
    let chars = 0;
    if (typeof msg.content === "string") {
      chars = msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const b of msg.content as Array<{ text?: string }>) chars += b.text?.length ?? 0;
    }
    return `${role}:${chars}`;
  }).join(" ");
}

/** Estimated USD cost for a single request using unified registry pricing.
 *  Returns undefined when pricing data is unavailable or incomplete for the observed token mix. */
function estimateCostUSD(
  model: string,
  promptTok: number,
  completionTok: number,
  cacheReadTok: number,
  cacheWriteTok: number,
): number | undefined {
  const pricing = getEffectiveRegistryPricingSummary(model);
  if (!pricing) return undefined;

  const nonCachedInput = Math.max(0, promptTok - cacheReadTok - cacheWriteTok);
  let total = 0;

  if (nonCachedInput > 0) {
    if (pricing.input_per_mtok_usd === null) return undefined;
    total += (nonCachedInput / 1_000_000) * pricing.input_per_mtok_usd;
  }

  if (completionTok > 0) {
    if (pricing.output_per_mtok_usd === null) return undefined;
    total += (completionTok / 1_000_000) * pricing.output_per_mtok_usd;
  }

  if (cacheReadTok > 0) {
    if (pricing.cache_read_per_mtok_usd === null) return undefined;
    total += (cacheReadTok / 1_000_000) * pricing.cache_read_per_mtok_usd;
  }

  if (cacheWriteTok > 0) {
    if (pricing.cache_write_per_mtok_usd === null) return undefined;
    total += (cacheWriteTok / 1_000_000) * pricing.cache_write_per_mtok_usd;
  }

  return Math.round(total * 1_000_000) / 1_000_000;
}

// autoInjectPromptCaching — injects cache_control into the last user message's
// last text content block.  This is the "explicit breakpoints" approach supported
// by ALL Claude providers on OpenRouter (Anthropic, Bedrock, Vertex).
//
// The alternative "automatic" mode (top-level cache_control) is only supported by
// Anthropic direct routing — Bedrock and Vertex ignore it.  Block-level is safer.
//
// TTL "1h" (string per OpenRouter spec) extends cache from 5 min to 1 hour.
// Cost: cache write at 2× base vs 1.25× for 5-min, but saves repeated write cost
// across long multi-turn conversations.
//
// Minimum cacheable prompt size: 4096 tokens for Opus 4.x, 2048 for Sonnet 4.x.
// Injecting on the last user turn covers the entire conversation history above it.
type OAICBlock = { type: string; text?: string; cache_control?: { type: string; ttl?: string } } & Record<string, unknown>;

const CACHE_CTRL: { type: string; ttl: string } = { type: "ephemeral", ttl: "1h" };

function autoInjectPromptCaching(msgs: OAIMessage[]): OAIMessage[] {
  const result = msgs.map((m) => ({ ...m }));
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].role !== "user") continue;
    const content = result[i].content;
    if (typeof content === "string" && content.length > 0) {
      result[i] = {
        ...result[i],
        content: [{ type: "text", text: content, cache_control: CACHE_CTRL } as OAICBlock],
      };
      return result;
    }
    if (Array.isArray(content) && content.length > 0) {
      const blocks = [...(content as OAICBlock[])];
      // Inject on the last text block; skip image/tool_result blocks
      for (let j = blocks.length - 1; j >= 0; j--) {
        if (blocks[j].type === "text") {
          blocks[j] = { ...blocks[j], cache_control: CACHE_CTRL };
          result[i] = { ...result[i], content: blocks };
          return result;
        }
      }
    }
    break; // last user msg found but no text block — stop
  }
  return result;
}

interface CacheTokenInfo { cacheRead: number; cacheWrite: number }

interface OpenAICompatSystemNormalizationResult {
  messages: OAIMessage[];
  flattenedSystemArray: boolean;
  droppedSystemBlockCache: boolean;
}

function flattenOpenAICompatSystemContent(content: string | OAIContentPart[] | null | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);

  return content.map((part) => {
    if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
      return ((part as { text?: string }).text ?? "");
    }
    try {
      return JSON.stringify(part);
    } catch {
      return String(part);
    }
  }).join("");
}

function normalizeOpenAICompatSystemMessages(messages: OAIMessage[]): OpenAICompatSystemNormalizationResult {
  let flattenedSystemArray = false;
  let droppedSystemBlockCache = false;

  const normalized = messages.map((msg) => {
    if (msg.role !== "system" || !Array.isArray(msg.content)) return msg;

    flattenedSystemArray = true;
    if ((msg.content as Array<Record<string, unknown>>).some((part) => !!part?.cache_control)) {
      droppedSystemBlockCache = true;
    }

    return {
      ...msg,
      content: flattenOpenAICompatSystemContent(msg.content),
    } as OAIMessage;
  });

  return { messages: normalized, flattenedSystemArray, droppedSystemBlockCache };
}

function extractCacheTokens(usage: Record<string, unknown> | null | undefined): CacheTokenInfo {
  if (!usage || typeof usage !== "object") return { cacheRead: 0, cacheWrite: 0 };

  // ── Anthropic native fields (highest priority) ─────────────────────────────
  // cache_read_input_tokens:     tokens served from cache (cheap, 0.1x)
  // cache_creation_input_tokens: tokens written to cache (expensive, 1.25x / 2x)
  const anthropicRead  = Number(usage["cache_read_input_tokens"])     || 0;
  const anthropicWrite = Number(usage["cache_creation_input_tokens"]) || 0;
  if (anthropicRead > 0 || anthropicWrite > 0) {
    return { cacheRead: anthropicRead, cacheWrite: anthropicWrite };
  }

  // ── OpenAI / OpenRouter format ─────────────────────────────────────────────
  // prompt_tokens_details.cached_tokens:     cache read  (0.5x for OpenAI, 0.25x for Gemini)
  // prompt_tokens_details.cache_write_tokens: cache write (0x for OpenAI, varies)
  const ptd = usage["prompt_tokens_details"] as Record<string, unknown> | undefined;
  if (ptd && typeof ptd === "object") {
    return {
      cacheRead:  Number(ptd["cached_tokens"])      || 0,
      cacheWrite: Number(ptd["cache_write_tokens"]) || 0,
    };
  }

  return { cacheRead: 0, cacheWrite: 0 };
}

async function handleFriendProxy({
  req, res, backend, model, messages, stream, maxTokens, tools, toolChoice, extraParams, startTime, captureResponseFn,
}: {
  req: Request;
  res: Response;
  backend: Extract<Backend, { kind: "friend" }>;
  model: string;
  messages: OAIMessage[];
  stream: boolean;
  maxTokens?: number;
  tools?: OAITool[];
  toolChoice?: unknown;
  extraParams?: Record<string, unknown>;
  startTime: number;
  /** Optional callback invoked with the raw JSON response body before it is sent
   *  to the client.  Used by the response-cache layer to capture non-streaming
   *  responses without re-reading a response that was already sent. */
  captureResponseFn?: (data: unknown) => void;
}): Promise<{ promptTokens: number; completionTokens: number; cacheReadTokens: number; cacheWriteTokens: number; ttftMs?: number; cacheTier: string; msgSummary: string }> {

  // IMPORTANT: Do NOT strip the "-thinking" / "-thinking-visible" suffix here.
  // The mother proxy is a transparent relay — the sub-node's own stripClaudeSuffix()
  // (for direct Anthropic calls) and getOpenRouterReasoningDefault() (for OpenRouter)
  // already handle thinking enablement correctly.  If we strip the suffix and inject
  // a bare `reasoning` field, the sub-node never sees the suffix and therefore never
  // enables `thinking: { type: "enabled", budget_tokens: ... }` on its Anthropic call,
  // silently dropping extended thinking entirely.

  // ── Build request body ────────────────────────────────────────────────────
  // • All extra client-supplied params (temperature, top_p, seed, stop, etc.) are
  //   spread first so our controlled fields (model, messages, max_tokens) always win.
  // • model is forwarded AS-IS — sub-node strips its own suffixes (-thinking etc.).
  // • Anthropic auto-caching: top-level cache_control:{type:"ephemeral"} activates
  //   Anthropic's automatic breakpoint on the last cacheable block, auto-advancing
  //   as the conversation grows.  OpenRouter passes this field through verbatim.
  //   Does NOT conflict with sub-node's block-level autoInjectPromptCaching() —
  //   they use separate breakpoint slots (top-level = 1 slot, sub-node = up to 3).

  // Closure variables filled by buildBody; read after any call to it.
  let cacheDecision = "";  // e.g. "T1+P2", "T2+P2", "P2", ""
  let msgSummaryStr = "";  // e.g. "S:4521 U:892 A:1203 U:45"
  let systemCompatFallback = false;

  // ── Bare-name dot→dash normalization (Claude-only) ───────────────────────
  // Mother's /v1/models exposes BOTH dot-form (e.g. claude-opus-4.6-thinking)
  // AND dash-form (claude-opus-4-6-thinking) bare Claude aliases.  Child's
  // bare-name registry, however, only contains the DASH form for Claude —
  // sending the dot form yields {"code":"UNSUPPORTED_MODEL"}.
  //
  // CRITICAL: do NOT apply this to gemini-* / gpt-* / other vendors — child
  // stores those bare names with the DOT preserved (e.g. gemini-2.5-pro,
  // gemini-3.1-pro-preview, gpt-3.5-turbo).  An earlier blanket dot→dash
  // rule mangled them into gemini-2-5-pro / gpt-3-5-turbo and caused 400
  // UNSUPPORTED_MODEL on every Gemini bare-name request.
  // Provider-prefixed ids (anthropic/, bedrock/, vertex/, …) keep both forms
  // in the sub-node registry, so we only touch slash-less Claude names.
  const normalizedModel = (() => {
    if (model.includes("/")) return model;
    if (!/^claude-/i.test(model)) return model;
    if (!/\d+\.\d/.test(model)) return model;
    return model.replace(/(\d+)\.(\d)/g, "$1-$2");
  })();
  if (normalizedModel !== model) {
    req.log.info({ original: model, normalized: normalizedModel }, "bare model dot→dash normalized for sub-node");
  }

  const buildBody = (msgs: OAIMessage[]): Record<string, unknown> => {
    let finalMsgs = msgs;
    // Deep-clone `extraParams` per buildBody call so the two invocations per
    // request (probe at 6397, real fetch at 6481) cannot share nested object
    // references (`reasoning`, `tools`, `cache_control`, vendor extras) and
    // also so any mutation here cannot propagate back to the IR / req.body
    // tree held by Express logger / inflight dedup snapshots. structuredClone
    // is safe for JSON-only HTTP bodies; falls back to a shallow copy on the
    // pathological case it cannot handle.
    let safeExtraParams: Record<string, unknown>;
    if (!extraParams) {
      safeExtraParams = {};
    } else {
      try {
        safeExtraParams = structuredClone(extraParams);
      } catch {
        safeExtraParams = { ...extraParams };
      }
    }
    const b: Record<string, unknown> = { ...safeExtraParams, model: normalizedModel, stream };
    // Only provide an Anthropic-safe default when the caller omitted every explicit
    // output cap. Never override a user-supplied token limit from the incoming request.
    if (typeof maxTokens === "number") {
      b["max_tokens"] = maxTokens;
    } else if (model.toLowerCase().includes("claude") && b["max_tokens"] === undefined) {
      b["max_tokens"] = GATEWAY_DEFAULTS.anthropicRequiredMaxTokens;
    }
    if (stream) b["stream_options"] = { include_usage: true };
    if (tools?.length) b["tools"] = tools;
    if (toolChoice !== undefined) b["tool_choice"] = toolChoice;

    // ── verbosity:"max" + reasoning auto-injection for adaptive Claude models ─────
    // Two complementary parameters for maximum quality + extended thinking:
    //
    //   1. verbosity:"max"  → output_config.effort:"max" (Anthropic via OR)
    //      Controls response detail/comprehensiveness.  Valid for Opus 4.6+, Sonnet 4.6+.
    //      Produces richer, more thorough assistant responses.
    //
    //   2. reasoning param — Anthropic thinking API split (per OR docs 2025-04):
    //
    //      Adaptive models (Opus 4.6+, Sonnet 4.6+, Mythos):
    //        → reasoning: { effort: "high" }   (normal)
    //        → reasoning: { effort: "xhigh" }  (Opus 4.7+ / Mythos with -max suffix)
    //        OR maps effort → thinking:{type:"adaptive"} + output_config.effort
    //
    //      Non-adaptive models (Opus 4.5, Sonnet 4.5, older):
    //        → reasoning: { max_tokens: N }
    //        OR maps max_tokens → Anthropic budget_tokens
    //
    //      ⚠ Do NOT use reasoning.effort for non-adaptive Anthropic — use max_tokens.
    //      ⚠ Do NOT use reasoning.effort for Bedrock non-adaptive — Bedrock rejects it.
    //
    // Client-supplied values in extraParams take precedence (already spread into b).
    {
      // Strip -max/-thinking/-thinking-visible suffixes for model family detection.
      // Double-strip handles combos like claude-opus-4-7-thinking-max.
      let bareModel = model.toLowerCase();
      const wantsMax = bareModel.endsWith("-max");
      bareModel = bareModel.replace(/-(max|thinking-visible|thinking)$/, "");
      bareModel = bareModel.replace(/-(max|thinking-visible|thinking)$/, "");
      // Strip OR backend prefix (anthropic/, bedrock/, vertex/, amazon/) before regex.
      const bareModelNoPrefix = bareModel.replace(/^(anthropic|bedrock|vertex|amazon)\//, "");

      // Adaptive thinking: Opus 4.6+, Sonnet 4.6+, Claude Mythos
      // Accept both dash and dot separators (anthropic/ slugs use dots; bedrock/ uses dashes).
      const isAdaptiveClaude = (
        /^claude-opus-4[-.][6-9](\D|$)|^claude-opus-[5-9]/.test(bareModelNoPrefix) ||
        /^claude-sonnet-4[-.][6-9](\D|$)|^claude-sonnet-[5-9]/.test(bareModelNoPrefix) ||
        /^claude-mythos/.test(bareModelNoPrefix)
      );

      // xhigh effort: Opus 4.7+ and Mythos only (Opus 4.6 / Sonnet 4.6 cap at "max" effort).
      const isXHighClaude = (
        /^claude-opus-4[-.][7-9](\D|$)|^claude-opus-[5-9]/.test(bareModelNoPrefix) ||
        /^claude-mythos/.test(bareModelNoPrefix)
      );

      // OR-routed Anthropic: covers anthropic/, bedrock/claude, vertex/claude, amazon/claude.
      const isORAnthropicAny = /^(anthropic|bedrock|vertex|amazon)\/claude/.test(model.toLowerCase());

      if (isAdaptiveClaude && isORAnthropicAny) {
        // Adaptive thinking models — use reasoning.effort (NOT max_tokens).
        // OR maps effort → thinking:{type:"adaptive"} which is the only valid
        // thinking mode for these models.
        if (b["verbosity"] === undefined) b["verbosity"] = "max";
        if (b["reasoning"] === undefined) {
          const effort = (isXHighClaude && wantsMax) ? "xhigh" : "high";
          b["reasoning"] = { effort };
        }
      } else if (isORAnthropicAny && !isAdaptiveClaude && b["reasoning"] === undefined) {
        // Non-adaptive Anthropic (Opus 4.5, Sonnet 4.5, older):
        // Use reasoning.max_tokens — OR maps this to Anthropic budget_tokens.
        const effectiveMax = typeof b["max_tokens"] === "number" ? (b["max_tokens"] as number) : null;
        const targetBudget = wantsMax ? 32_000 : 8_000;
        const budget = effectiveMax !== null ? Math.min(targetBudget, effectiveMax - 200) : targetBudget;
        if (budget >= 100) {
          b["reasoning"] = { max_tokens: budget };
        }
      }
    }

    // ── Absolute provider routing (model-prefix lock) ────────────────────────
    // Every model id forwarded through handleFriendProxy is checked for an
    // absolute-routing prefix (bedrock/, vertex/, anthropic/, openai/, groq/,
    // …).  When matched, the request is hard-locked to that single
    // OpenRouter sub-channel:
    //   • provider.only        = [<canonical slug>]
    //   • provider.allow_fallbacks = false
    //   • provider.order       = [<canonical slug>]   (for log clarity)
    // Any client-supplied `only`/`allow_fallbacks` is overwritten so callers
    // cannot escape the lock.  See ROUTING_AUDIT.md §5.
    //
    // For ids without a routing prefix we fall back to the historical default
    // — pin `anthropic/...` ids to amazon-bedrock so high-volume Claude
    // traffic keeps the Bedrock cache benefits.
    {
      const route = detectAbsoluteProviderRoute(model);
      if (route) {
        b["provider"] = buildAbsoluteProviderBlock(route, b["provider"]);
      } else {
        const isORClaude = model.toLowerCase().startsWith("anthropic/");
        if (isORClaude && !b["provider"]) {
          b["provider"] = { order: ["amazon-bedrock"], allow_fallbacks: false };
        }
      }
    }

    // ── Three-tier Anthropic prompt cache strategy ──────────────────────────
    // Tier 1: top-level cache_control — Anthropic direct only (Bedrock/Vertex ignore it)
    // Tier 2: block-level LCP split — works on ALL providers including Bedrock/Vertex
    // Phase 2: conversation history breakpoint — works on ALL providers
    // Detect Bedrock routing — check b["provider"] which may now include injected value
    const providerPref = b["provider"] as { order?: string[]; only?: string[] } | undefined;
    const isBedrockRouted = !!(
      providerPref?.order?.some((p) => p.toLowerCase().includes("bedrock")) ||
      providerPref?.only?.some((p) => p.toLowerCase().includes("bedrock"))
    );
    const isClaude = model.toLowerCase().includes("claude");
    cacheDecision = "";
    if (isClaude && !b["cache_control"]) {
      const sysText = msgs.filter((m) => m.role === "system").map((m) => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content))
          return (m.content as Array<{ type: string; text?: string }>)
            .filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
        return "";
      }).join("\n");

      const stableKey = `oai|${model}|${sysText.slice(0, 256)}`;
      const prepared = prepareLayeredSystemCachePlan(stableKey, sysText, finalMsgs);
      finalMsgs = prepared.messages as OAIMessage[];

      if (prepared.stable) {
        // Tier 1: top-level auto-cache — Anthropic direct only.
        // Bedrock/Vertex ignore top-level cache_control; skip it to avoid confusion.
        // Block-level injection (Tier 2 / Phase 2) handles those providers.
        if (!isBedrockRouted) {
          b["cache_control"] = { type: "ephemeral", ttl: "1h" };
          cacheDecision = "T1";
        }

        const consolidated: OAIMessage[] = [];
        let foundFirst = false;
        for (const m of finalMsgs) {
          if (m.role === "system") {
            if (!foundFirst) {
              consolidated.push({ ...m, content: prepared.system } as OAIMessage);
              foundFirst = true;
            }
          } else {
            consolidated.push(m);
          }
        }
        finalMsgs = consolidated;
      } else if (prepared.lcpResult) {
        const consolidated: OAIMessage[] = [];
        let foundFirst = false;
        for (const m of finalMsgs) {
          if (m.role === "system") {
            if (!foundFirst) {
              consolidated.push({
                ...m,
                content: [
                  { type: "text", text: prepared.lcpResult.stable, cache_control: { type: "ephemeral", ttl: "1h" } },
                  { type: "text", text: prepared.lcpResult.dynamic },
                ],
              } as OAIMessage);
              foundFirst = true;
            }
          } else {
            consolidated.push(m);
          }
        }
        finalMsgs = consolidated;
        cacheDecision = "T2";
      } else if (prepared.analysis.volatileLength > 0) {
        const consolidated: OAIMessage[] = [];
        let foundFirst = false;
        for (const m of finalMsgs) {
          if (m.role === "system") {
            if (!foundFirst) {
              consolidated.push({ ...m, content: prepared.system } as OAIMessage);
              foundFirst = true;
            }
          } else {
            consolidated.push(m);
          }
        }
        finalMsgs = consolidated;
      }

      const historyResult = injectHistoryBreakpoint(finalMsgs);
      finalMsgs = historyResult.messages as OAIMessage[];
      if (historyResult.diagnostics.applied || historyResult.diagnostics.alreadyCached) {
        cacheDecision = cacheDecision ? `${cacheDecision}+P2` : "P2";
      }

      const normalizedSystem = normalizeOpenAICompatSystemMessages(finalMsgs);
      finalMsgs = normalizedSystem.messages;
      systemCompatFallback = normalizedSystem.flattenedSystemArray;

      if (normalizedSystem.droppedSystemBlockCache) {
        if (cacheDecision === "T2") cacheDecision = "";
        else if (cacheDecision.startsWith("T2+")) cacheDecision = cacheDecision.slice(3);
      }

      req.log.info({
        model,
        cachePlan: cacheDecision || "none",
        systemCompatFallback,
        droppedSystemBlockCache: normalizedSystem.droppedSystemBlockCache,
        systemTotalLength: prepared.diagnostics.systemTotalLength,
        stableLayerLength: prepared.diagnostics.stableLayerLength,
        dynamicLayerLength: prepared.diagnostics.dynamicLayerLength,
        lcpEffectiveLength: prepared.diagnostics.lcpEffectiveLength,
        firstDivergenceSource: prepared.diagnostics.firstDivergenceSource,
        historyAnchorUserIdx: historyResult.diagnostics.anchorUserIdx,
        historyAnchorMode: historyResult.diagnostics.anchorMode,
        historyAnchorBlockIndex: historyResult.diagnostics.anchorBlockIndex,
        historyBridgeMessageCount: historyResult.diagnostics.bridgeMessageCount,
        historyPrefixApproxChars: historyResult.diagnostics.prefixApproxChars,
        historyBridgeApproxChars: historyResult.diagnostics.bridgeApproxChars,
        historyApplied: historyResult.diagnostics.applied,
        historyAlreadyCached: historyResult.diagnostics.alreadyCached,
        historyReason: historyResult.diagnostics.reason,
      }, "OpenAI-compatible layered cache diagnostics");
    }
    b.messages = finalMsgs;
    // Snapshot message structure AFTER injection (roles + char counts, no content).
    msgSummaryStr = describeMsgs(finalMsgs as unknown[]);

    // Final pass: strip Claude sampling params that the upstream rejects.
    //   • opus-4-7+ / mythos: temperature, top_p, top_k, presence_penalty
    //     are deprecated unconditionally (Replit ai-integrations-anthropic
    //     skill: "Setting any of these to a non-default value will return
    //     a 400 error").
    //   • other Claude with reasoning enabled: temperature must be 1.0 and
    //     top_p / top_k / presence_penalty are forbidden (Anthropic
    //     extended-thinking docs).
    // Shared single source of truth with `buildOpenRouterRequest`, exported
    // from `lib/gateway/openrouter.ts`. Must run BEFORE `hashRequest(body)`
    // at line 6482 so the cache key reflects the post-sanitization body —
    // otherwise two callers sending different `temperature` values for the
    // same opus-4-7 prompt would produce different cache keys despite
    // identical upstream requests, wasting tokens on avoidable misses.
    sanitizeClaudeSamplingParams(b);

    return b;
  };

  // ── Non-streaming ─────────────────────────────────────────────────────────
  if (!stream) {
    // True upstream task lifetime for non-streaming inference. This is intentionally
    // decoupled from SSE reconnect windows so long reasoning jobs are not hard-killed.
    const fetchRes = await fetch(`${backend.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${backend.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(messages)),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUTS.upstreamLongPollMs),
    });
    if (!fetchRes.ok) {
      const errText = await fetchRes.text().catch(() => "unknown");
      throw new FriendProxyHttpError(fetchRes.status, `Friend proxy error ${fetchRes.status}: ${errText}`);
    }
    const json = await fetchRes.json() as Record<string, unknown>;

    // Guard: detect genuinely-broken upstream responses without manufacturing
    // false 5xxs.  Some providers legitimately return 200 OK with empty content
    // (e.g. claude-opus-4.6-fast at very small max_tokens budgets where the
    // model spends the budget on adaptive reasoning and emits no visible text,
    // or any model that returned only a finish_reason).  Treat as broken ONLY
    // when the provider also reports zero completion tokens — i.e. the model
    // produced nothing at all upstream.  Otherwise pass the response through
    // and let the client decide; never reframe a valid 200 as a 502.
    const choices = json["choices"] as any[];
    const usageObj = json["usage"] as Record<string, unknown> | null | undefined;
    const completionTokens = (usageObj as { completion_tokens?: number } | undefined)?.completion_tokens ?? 0;
    const hasContent    = !!choices?.[0]?.message?.content?.trim();
    const hasToolCalls  = !!choices?.[0]?.message?.tool_calls?.length;
    const hasReasoning  = !!(choices?.[0]?.message as any)?.reasoning_content || !!(choices?.[0]?.message as any)?.reasoning;
    const finishReason  = choices?.[0]?.finish_reason;

    if (!hasContent && !hasToolCalls && !hasReasoning) {
      // Sub-node returned 200 but the body has no visible payload.  Pure
      // pass-through — never reframe a sub-node 200 as a mother 5xx, even
      // when the body is empty.  Common legitimate causes:
      //   • Adaptive reasoning consumed the entire max_tokens budget (no
      //     visible content but completion_tokens>0).
      //   • Provider returned a degenerate 200 (e.g. openai/o3 at tiny
      //     max_tokens, certain niche/deprecated OR backends).
      // The mother proxy's contract is: full consumption of sub-node
      // capability — if the sub-node says 200, the client gets 200.  The
      // client can detect emptiness and retry with a larger budget or a
      // different model.  Reframing as 5xx would (a) hide real upstream
      // behaviour and (b) trigger unwanted client retries that waste
      // cache_write tokens.
      req.log.warn(
        { model, completionTokens, finishReason },
        "upstream 200 with empty visible payload — passing through (no synthetic 5xx)"
      );
    }

    captureResponseFn?.(json);
    res.json(json);
    const usage = json["usage"] as Record<string, unknown> | null | undefined;
    const cache = extractCacheTokens(usage);
    if (((usage as { prompt_tokens?: number })?.prompt_tokens ?? 0) === 0) {
      const outputChars = (json["choices"] as Array<{ message?: { content?: string } }>)?.[0]?.message?.content?.length ?? 0;
      return { promptTokens: Math.ceil(countMsgChars(messages) / 4), completionTokens: Math.ceil(outputChars / 4), cacheReadTokens: cache.cacheRead, cacheWriteTokens: cache.cacheWrite, cacheTier: cacheDecision, msgSummary: msgSummaryStr };
    }
    return { promptTokens: (usage as { prompt_tokens?: number })?.prompt_tokens ?? 0, completionTokens: (usage as { completion_tokens?: number })?.completion_tokens ?? 0, cacheReadTokens: cache.cacheRead, cacheWriteTokens: cache.cacheWrite, cacheTier: cacheDecision, msgSummary: msgSummaryStr };
  }

  // ── Streaming — "中间层" (Middleware Buffer) Architecture ──────────────────
  //
  // Decouples the two connection legs so neither can kill the other:
  //
  //  Leg A  (Mother proxy → Sub-node)  managed by runStreamJobBackground:
  //    • Calls sub-node's standard /v1/chat/completions — no special endpoints needed.
  //    • On ECONNRESET / network error (platform outgoing cut): automatically
  //      retries with a continuation message.  Up to MAX_CONT rounds.
  //    • All received chunks are stored in an internal job store (in-memory).
  //
  //  Leg B  (Mother proxy → SillyTavern / client)  managed below:
  //    • Reads chunks from the internal job store via EventEmitter push.
  //    • Sends 15 s SSE keepalive so intermediate proxies don't close the idle leg.
  //    • Leg B wall timer (default 570s, configurable via GATEWAY_LEG_B_WALL_MS):
  //      fires before the platform's hard incoming-HTTP cut.
  //      When it fires: closes TCP cleanly (FIN only, no finish_reason) while
  //      Leg A keeps running.  Next identical request re-attaches to the same
  //      job and replays buffered chunks — ZERO new LLM calls.
  //    • On genuine client disconnect (user pressed stop): abort Leg A immediately.
  //
  // Result: one LLM call per user turn, unlimited HTTP reconnects across any
  // platform's hard HTTP limit.  Completely transparent to SillyTavern / NewAPI.
  //

  // ── Leg A: Create or re-attach to existing job ────────────────────────────
  // Fingerprint = SHA-256 of (model + messages + max_tokens + tools).
  // If a live job exists for this fingerprint (previous connection hit 570 s
  // wall), skip Leg A creation and replay buffered chunks directly.
  const body      = buildBody(messages);
  const liveFp    = hashRequest(body);
  const existing  = liveJobMap.get(liveFp);
  const isReuse   = !!(existing && !existing.abort.signal.aborted);
  const streamJob: StreamJobEntry = isReuse ? existing! : (() => {
    const jobId      = makeJobId();
    const jobEmitter = new EventEmitter();
    jobEmitter.setMaxListeners(64);
    const j: StreamJobEntry = {
      id: jobId, model, chunks: [], done: false, error: null, errorIsProvider: false,
      emitter: jobEmitter, createdAt: Date.now(), lastAccessAt: Date.now(),
      abort: new AbortController(),
    };
    jobStore.set(jobId, j);
    liveJobMap.set(liveFp, j);
    runStreamJobBackground(j, messages, body, backend);
    return j;
  })();

  streamJob.lastAccessAt = Date.now();

  // Client close handler — only abort Leg A on genuine user cancel,
  // not when our own wall timer fires (wall sets legBWallFired first).
  let legBWallFired = false;
  const clientAbort = new AbortController();
  const onClientClose = (): void => {
    if (legBWallFired) return; // wall-fired clean close — keep Leg A alive
    if (!clientAbort.signal.aborted) clientAbort.abort("client_disconnected");
    // Genuine cancel: stop Leg A and remove from live map so next request starts fresh.
    // Guard with identity check: a new job may have already claimed this fingerprint
    // between onClientClose firing and now (e.g. rapid reconnect after cancel).
    if (!streamJob.abort.signal.aborted) streamJob.abort.abort("client_disconnected");
    if (liveJobMap.get(liveFp) === streamJob) liveJobMap.delete(liveFp);
  };
  res.on("close", onClientClose);

  // ── Leg B: Stream internal job store → SillyTavern / client ───────────────

  // ── Leg B state ───────────────────────────────────────────────────────────
  let headersSent = false;
  const ensureHeaders = () => {
    if (!headersSent && !res.headersSent) {
      setSseHeaders(res);
      headersSent = true;
    }
  };

  let promptTokens     = 0;
  let completionTokens = 0;
  let cacheReadTokens  = 0;
  let cacheWriteTokens = 0;
  let ttftMs:  number | undefined;
  let outputChars      = 0;

  // 增强 safeWrite: 在写入前确保 headers 已发送，并记录最后写入的 chunk ID（用于续接）
  let lastWrittenChunkId: string | null = null;
  const safeWrite = (data: string): void => {
    try { if (!res.writableEnded && !res.destroyed) writeAndFlush(res, data); } catch { /* ignore */ }
    // 尝试从写入的数据中提取 id: 字段，用于续接
    const idMatch = data.match(/^id: (.+?)\n/);
    if (idMatch) lastWrittenChunkId = idMatch[1];
  };

  const processJobChunk = (jsonStr: string): void => {
    ensureHeaders();
    safeWrite(`data: ${jsonStr}\n\n`);
    outputChars += jsonStr.length;
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      type CC = { delta?: { content?: string; reasoning?: string; tool_calls?: unknown[] } };
      const d = (parsed.choices as CC[])?.[0]?.delta;
      const hasToolCalls = Array.isArray(d?.tool_calls) && (d.tool_calls as unknown[]).length > 0;
      if (d?.content || d?.reasoning || hasToolCalls) ttftMs ??= Date.now() - startTime;
      const usage = parsed.usage as Record<string, unknown> | undefined;
      if (usage) {
        if (usage.prompt_tokens)     promptTokens     = usage.prompt_tokens as number;
        if (usage.completion_tokens) completionTokens = usage.completion_tokens as number;
        const cc = extractCacheTokens(usage);
        if (cc.cacheRead)  cacheReadTokens  = cc.cacheRead;
        if (cc.cacheWrite) cacheWriteTokens = cc.cacheWrite;
      }
    } catch { /* skip malformed */ }
  };

  // 5 s keepalive data chunk — prevents intermediate proxies and aggressive clients
  // from cutting the idle SSE during long thinking phases.
  // Empty-choices chunks are safe: compliant OAI clients check choices.length before processing.
  const keepaliveTimer = setInterval(() => {
    // 保持心跳，但不生成 id 字段，避免干扰续接
    safeWrite(`data: ${JSON.stringify({ object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [] })}\n\n`);
  }, GATEWAY_TIMEOUTS.keepaliveClientMs);

  // ── Leg B wall timer ───────────────────────────────────────────────────────
  // Many hosting platforms enforce a hard absolute limit on incoming HTTP
  // connections (Replit: 600s). Fire before that limit so we can:
  // set legBWallFired, emit "legb_wall" to exit the drain loop, then close
  // TCP with FIN only — no finish_reason, no [DONE]. Leg A keeps running.
  // Next identical POST → same liveFp → liveJobMap hit → replay buffered
  // chunks at full speed → ZERO new LLM calls.
  // Default 570s, configurable via GATEWAY_LEG_B_WALL_MS.
  const LEG_B_WALL_MS = GATEWAY_TIMEOUTS.legBWallMs;
  const legBWallTimer = setTimeout(() => {
    legBWallFired = true;
    // 在墙触发时，确保发送一个明确的、可续接的最后一个事件 ID
    if (lastWrittenChunkId) {
      console.log(`[Leg B Wall] 触发墙，最后写入的 Chunk ID: ${lastWrittenChunkId}`);
      // 可以选择在这里发送一个带有明确 ID 的心跳，帮助客户端续接
      safeWrite(`id: ${lastWrittenChunkId}\ndata: ${JSON.stringify({ object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [] })}\n\n`);
    }
    streamJob.emitter.emit("legb_wall");
  }, LEG_B_WALL_MS);

  // ── Drain: replay buffer then stream live chunks ───────────────────────────
  // Re-attach path: nextIdx=0 → replays all buffered chunks first (network
  // speed), then blocks on "chunk" events for new real-time chunks.
  let nextIdx = 0;

  const drain = (): void => {
    while (nextIdx < streamJob.chunks.length) {
      processJobChunk(streamJob.chunks[nextIdx]);
      nextIdx++;
    }
  };

  await new Promise<void>((resolve) => {
    const onChunk = (): void => { drain(); };
    const onDone  = (): void => {
      drain();
      streamJob.emitter.off("chunk",     onChunk);
      streamJob.emitter.off("done",      onDone);
      streamJob.emitter.off("legb_wall", onWall);
      resolve();
    };
    const onWall  = (): void => {
      // Wall fired: exit loop.  Leg A stays alive for reconnect.
      // Must remove all three listeners including legb_wall itself —
      // omitting self-removal leaks one stale listener per reconnect.
      streamJob.emitter.off("chunk",     onChunk);
      streamJob.emitter.off("done",      onDone);
      streamJob.emitter.off("legb_wall", onWall);
      resolve();
    };
    const onAbort = (): void => {
      streamJob.emitter.off("chunk",     onChunk);
      streamJob.emitter.off("done",      onDone);
      streamJob.emitter.off("legb_wall", onWall);
      resolve();
    };

    drain(); // flush already-buffered chunks before subscribing
    if (streamJob.done) { onDone(); return; }

    streamJob.emitter.on("chunk",     onChunk);
    streamJob.emitter.on("done",      onDone);
    streamJob.emitter.on("legb_wall", onWall);
    clientAbort.signal.addEventListener("abort", onAbort, { once: true });
  });

  clearInterval(keepaliveTimer);
  clearTimeout(legBWallTimer);

  if (legBWallFired) {
    res.removeListener("close", onClientClose);
    return { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheTier: cacheDecision, msgSummary: msgSummaryStr };
  }

  // Natural completion or error — clean up both maps.
  // Identity guard: onClientClose may have already deleted this entry, and a new
  // request may have already claimed the fingerprint for a different job.
  // Only delete if the map still points to OUR job.
  if (liveJobMap.get(liveFp) === streamJob) liveJobMap.delete(liveFp);
  if (!isReuse) jobStore.delete(streamJob.id);

  if (streamJob.error) {
    if (!headersSent && !res.headersSent) {
      // If we haven't sent any data yet, throw so the caller can retry on another node.
      // Remove the close listener before throwing — otherwise every failed attempt leaks
      // a listener on `res`, eventually triggering MaxListenersExceededWarning.
      res.removeListener("close", onClientClose);
      // Provider/model errors (4xx embedded in the stream) must NOT mark the backend
      // as unhealthy — the node is healthy, the model/prompt was rejected upstream.
      // Use 400 so is5xx=false and markUnhealthy() is skipped; is4xxRetryable=true
      // lets the retry loop try another node (or return the 4xx cleanly if none).
      const errStatus = streamJob.errorIsProvider ? 400 : 502;
      throw new FriendProxyHttpError(errStatus, streamJob.error);
    }
    safeWrite(`data: ${JSON.stringify({ error: { message: streamJob.error, type: "job_error" } })}\n\n`);
  }

  // Guard: If stream finished but we never got any content/reasoning (no TTFT), it's a failed response.
  if (!ttftMs && !streamJob.error && !legBWallFired) {
    if (!headersSent) {
      res.removeListener("close", onClientClose);
      throw new FriendProxyHttpError(502, "Upstream stream ended with no content");
    }
    safeWrite(`data: ${JSON.stringify({ error: { message: "Upstream stream ended with no content", type: "job_error" } })}\n\n`);
  }

  ensureHeaders();
  safeWrite("data: [DONE]\n\n");
  try { if (!res.writableEnded) res.end(); } catch { /* ignore */ }
  res.removeListener("close", onClientClose);

  // Leg A may still be winding down; StreamJobEntry is kept alive by its closure.
  if (promptTokens === 0 && outputChars > 0) {
    promptTokens     = Math.ceil(countMsgChars(messages) / 4);
    completionTokens = Math.ceil(outputChars / 4);
  }

  return { promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens, ttftMs, cacheTier: cacheDecision, msgSummary: msgSummaryStr };
}

// ---------------------------------------------------------------------------
// Video Generation  —  /v1/videos/*  (OpenRouter async video API)
//
// Workflow:
//   1. Client POSTs /v1/videos → we forward to a healthy sub-node.
//   2. Sub-node calls OpenRouter POST /api/v1/videos with its own key and
//      returns { id, polling_url, status }.
//   3. We store { ourId → { subNodeUrl, subNodeKey, orJobId } } and rewrite
//      the response so that polling_url points back through our own proxy.
//   4. Client GETs /v1/videos/:jobId → we look up the sub-node and forward.
//      Same for /v1/videos/:jobId/content (binary video stream).
//
// IMPORTANT: GET /v1/videos/models is registered BEFORE /:jobId so that the
// literal segment "models" is never captured as a job ID.
//
// Embeddings model list:
//   GET /v1/embeddings/models → transparent forward to first healthy sub-node.
//
// TTL: video job entries are kept for 6 hours then swept.
// ---------------------------------------------------------------------------

interface VideoJobEntry {
  ourId:       string;
  subNodeUrl:  string;
  subNodeKey:  string;
  orJobId:     string;   // job ID as returned by the sub-node / OpenRouter
  createdAt:   number;
}
const videoJobStore = new Map<string, VideoJobEntry>();
setInterval(() => {
  const cutoff = Date.now() - GATEWAY_TIMEOUTS.videoJobTtlMs;
  for (const [k, v] of videoJobStore) {
    if (v.createdAt < cutoff) videoJobStore.delete(k);
  }
}, GATEWAY_TIMEOUTS.videoJobGcIntervalMs).unref();

// GET /v1/videos/models — list video generation models available on sub-nodes.
// GET /v1/embeddings/models — list embedding models available on sub-nodes.
// Both are registered as explicit routes so they win over /:jobId.
for (const modelsPath of ["/v1/videos/models", "/v1/embeddings/models"]) {
  router.get(modelsPath, requireApiKey, async (req: Request, res: Response) => {
    const allBackends = buildBackendPool();
    if (allBackends.length === 0) {
      res.status(503).json({ error: { message: "No sub-nodes available", type: "service_unavailable" } });
      return;
    }
    let lastErr = "all sub-nodes failed";
    for (let i = 0; i < allBackends.length; i++) {
      const backend = allBackends[(requestCounter + i) % allBackends.length];
      try {
        const fetchRes = await fetch(`${backend.url}${req.path}`, {
          headers: { Authorization: `Bearer ${backend.apiKey}` },
          signal: AbortSignal.timeout(GATEWAY_TIMEOUTS.upstreamPricingMs),
        });
        const json = await fetchRes.json();
        res.status(fetchRes.status).json(json);
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }
    res.status(502).json({ error: { message: lastErr, type: "upstream_error" } });
  });
}

// POST /v1/videos — submit async video generation request.
router.post("/v1/videos", requireApiKey, async (req: Request, res: Response) => {
  const allBackends = buildBackendPool();
  if (allBackends.length === 0) {
    res.status(503).json({ error: { message: "No sub-nodes available", type: "service_unavailable" } });
    return;
  }
  const preferred = allBackends.filter((b) => !isRateLimited(b.url));
  const pool = preferred.length > 0 ? preferred : allBackends;

  let lastErrStatus = 502;
  let lastErrBody: unknown = { error: { message: "All sub-nodes failed", type: "upstream_error" } };

  for (let i = 0; i < pool.length; i++) {
    const backend = pool[(requestCounter + i) % pool.length];
    try {
      const fetchRes = await fetch(`${backend.url}/v1/videos`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${backend.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(GATEWAY_TIMEOUTS.upstreamPricingMs),
      });
      const json = await fetchRes.json() as Record<string, unknown>;

      if (!fetchRes.ok) {
        lastErrStatus = fetchRes.status;
        lastErrBody   = json;
        if (fetchRes.status === 401 || fetchRes.status === 403) {
          res.status(fetchRes.status).json(json);
          return;
        }
        continue;
      }

      // Rewrite id + polling_url so the client polls back through us.
      const ourId   = `vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const orJobId = (json["id"] as string | undefined) ?? ourId;

      videoJobStore.set(ourId, {
        ourId,
        subNodeUrl: backend.url,
        subNodeKey: backend.apiKey,
        orJobId,
        createdAt: Date.now(),
      });

      // Build polling_url from the incoming request so it survives any
      // upstream reverse proxy (x-forwarded-proto / x-forwarded-host).
      const proto    = ((req.headers["x-forwarded-proto"] as string | undefined) ?? "https").split(",")[0].trim();
      const host     = (req.headers["x-forwarded-host"] as string | undefined) ?? req.get("host") ?? "localhost";
      const mount    = req.path.endsWith("/v1/videos") ? req.path.slice(0, -"/v1/videos".length) : "";
      const pollingUrl = `${proto}://${host}${mount}/v1/videos/${ourId}`;

      requestCounter++;
      req.log.info({ backend: backend.label, ourId, orJobId }, "Video generation: job submitted");
      res.status(fetchRes.status).json({ ...json, id: ourId, polling_url: pollingUrl });
      return;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.warn({ backend: backend.url, attempt: i, err: msg }, "Video generation: sub-node error, trying next");
    }
  }

  res.status(lastErrStatus >= 400 && lastErrStatus < 500 ? lastErrStatus : 502).json(lastErrBody);
});

// GET /v1/videos/:jobId — poll video generation status.
router.get("/v1/videos/:jobId", requireApiKey, async (req: Request, res: Response) => {
  const entry = videoJobStore.get(String(req.params.jobId));
  if (!entry) {
    res.status(404).json({ error: { message: "Video job not found or expired (6 h TTL)", type: "not_found" } });
    return;
  }
  entry.createdAt = Date.now(); // refresh TTL on every poll

  try {
    const fetchRes = await fetch(`${entry.subNodeUrl}/v1/videos/${entry.orJobId}`, {
      headers: { Authorization: `Bearer ${entry.subNodeKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    const json = await fetchRes.json() as Record<string, unknown>;
    // Keep our stable job ID so the client stays consistent.
    res.status(fetchRes.status).json({ ...json, id: entry.ourId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: { message: msg, type: "upstream_error" } });
  }
});

// GET /v1/videos/:jobId/content — stream generated video binary.
router.get("/v1/videos/:jobId/content", requireApiKey, async (req: Request, res: Response) => {
  const entry = videoJobStore.get(String(req.params.jobId));
  if (!entry) {
    res.status(404).json({ error: { message: "Video job not found or expired (6 h TTL)", type: "not_found" } });
    return;
  }
  const index = typeof req.query["index"] === "string" ? req.query["index"] : "0";

  try {
    const fetchRes = await fetch(
      `${entry.subNodeUrl}/v1/videos/${entry.orJobId}/content?index=${index}`,
      {
        headers: { Authorization: `Bearer ${entry.subNodeKey}` },
        signal: AbortSignal.timeout(120_000),
      },
    );

    if (!fetchRes.ok) {
      const errText = await fetchRes.text().catch(() => "unknown");
      res.status(fetchRes.status).json({ error: { message: errText, type: "upstream_error" } });
      return;
    }

    const ct = fetchRes.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);
    const cl = fetchRes.headers.get("content-length");
    if (cl) res.setHeader("Content-Length", cl);
    const cd = fetchRes.headers.get("content-disposition");
    if (cd) res.setHeader("Content-Disposition", cd);
    res.status(200);

    if (fetchRes.body) {
      const reader = fetchRes.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.writableEnded) res.write(value);
      }
    }
    if (!res.writableEnded) res.end();

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) res.status(502).json({ error: { message: msg, type: "upstream_error" } });
  }
});

// ---------------------------------------------------------------------------
// Generic transparent pass-through for all other OpenAI-compatible endpoints.
//
// Covers endpoints NewAPI may call that don't have dedicated handlers:
//   • POST /v1/images/generations      — DALL-E, Stable Diffusion, Flux, etc.
//   • POST /v1/images/edits            — image editing
//   • POST /v1/images/variations       — image variations
//   • POST /v1/audio/speech            — TTS (text-to-speech)
//   • POST /v1/audio/transcriptions    — Whisper (speech-to-text, multipart)
//   • POST /v1/audio/translations      — Whisper translation
//   • POST /v1/completions             — legacy text completions
//   • POST /v1/moderations             — content moderation
//   • Any future OpenAI-compatible endpoints
//
// Strategy:
//   • Try all sub-node backends in round-robin order, stop at first success.
//   • Request body forwarded as JSON (req.body already parsed); Content-Type
//     preserved.  Multipart (audio transcriptions) is proxied via raw stream.
//   • Response is piped back verbatim (JSON or binary); Content-Type from
//     upstream is preserved so clients get image/png, audio/mpeg etc. directly.
//   • Timeout: 90 s — image generation <60 s; audio <30 s; legacy <10 s.
//     Video generation that requires >90 s should use a dedicated job route.
//
// IMPORTANT: This handler must stay last — Express matches routes in
// registration order, so all specific routes above take priority.
// ---------------------------------------------------------------------------

router.all(/^\/v1\/(?!admin|jobs)/, requireApiKey, async (req: Request, res: Response) => {
  const path = req.path; // e.g. "/v1/images/generations"
  const startTime = Date.now();

  const allBackends = buildBackendPool();
  if (allBackends.length === 0) {
    res.status(503).json({ error: { message: "No available sub-nodes", type: "service_unavailable" } });
    return;
  }

  const preferred = allBackends.filter((b) => !isRateLimited(b.url));
  const pool = preferred.length > 0 ? preferred : allBackends;

  const isGetOrHead = req.method === "GET" || req.method === "HEAD";
  const ct = req.headers["content-type"] ?? "application/json";
  const isMultipart = ct.includes("multipart/form-data");

  // Multipart bodies (audio transcription) are Node.js readable streams that can
  // only be consumed once.  After the first fetch attempt the stream is exhausted,
  // so retry against a second backend would hang/fail.  Restrict to a single backend.
  const effectivePool = isMultipart ? [pool[requestCounter % pool.length]] : pool;

  let lastErrStatus = 502;
  let lastErrText   = `All sub-nodes failed for ${path}`;

  for (let i = 0; i < effectivePool.length; i++) {
    const backend = effectivePool[i];

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${backend.apiKey}`,
      };

      let body: BodyInit | undefined;
      if (!isGetOrHead) {
        if (isMultipart) {
          // For multipart (audio transcriptions): forward raw request stream.
          // Cannot re-use req after it has been read, so pipe directly.
          headers["Content-Type"] = ct; // preserve multipart boundary
          body = req as unknown as BodyInit;
        } else {
          headers["Content-Type"] = "application/json";
          body = JSON.stringify(req.body);
        }
      }

      const fetchRes = await fetch(`${backend.url}${path}`, {
        method: req.method,
        headers,
        body,
        signal: AbortSignal.timeout(90_000),
        duplex: isMultipart ? "half" : undefined,
      });

      if (!fetchRes.ok) {
        const errText = await fetchRes.text().catch(() => "unknown");
        lastErrStatus = fetchRes.status;
        lastErrText   = errText;

        if (fetchRes.status >= 500) markUnhealthy(backend.url, backend.apiKey);
        if (fetchRes.status === 429 || fetchRes.status === 402) markRateLimited(backend.url, fetchRes.status);
        if (fetchRes.status === 401 || fetchRes.status === 403) {
          res.status(fetchRes.status).json({ error: { message: errText, type: "authentication_error" } });
          return;
        }
        // 400/404/4xx: this backend can't handle the endpoint — try next
        req.log.warn({ url: backend.url, path, status: fetchRes.status, attempt: i }, "Pass-through: sub-node failed, trying next");
        continue;
      }

      // ── Pipe response verbatim (JSON or binary) ──────────────────────────
      const resCt = fetchRes.headers.get("content-type");
      if (resCt) res.setHeader("Content-Type", resCt);
      const resLen = fetchRes.headers.get("content-length");
      if (resLen) res.setHeader("Content-Length", resLen);
      res.status(fetchRes.status);

      if (fetchRes.body) {
        const reader = fetchRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.writableEnded) res.write(value);
        }
      }
      if (!res.writableEnded) res.end();

      setHealth(backend.url, true);
      requestCounter++;
      req.log.info({ path, backend: backend.label, status: fetchRes.status, ms: Date.now() - startTime }, "Pass-through: success");
      return;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastErrText = msg;
      markUnhealthy(backend.url, backend.apiKey);
      req.log.warn({ url: backend.url, path, attempt: i, err: msg }, "Pass-through: network error, trying next");
      // continue to next backend
    }
  }

  if (!res.headersSent) {
    const clientStatus = lastErrStatus >= 400 && lastErrStatus < 500 ? lastErrStatus : 503;
    res.status(clientStatus).json({ error: { message: `${lastErrText}`, type: "upstream_error" } });
  }
});

// ---------------------------------------------------------------------------
// handleOpenAI / handleGemini / handleClaude — PERMANENTLY REMOVED.
// All traffic goes through handleFriendProxy (friend proxy sub-nodes only).
// Local AI SDK calls are banned at the architecture level.
// ---------------------------------------------------------------------------

export default router;
