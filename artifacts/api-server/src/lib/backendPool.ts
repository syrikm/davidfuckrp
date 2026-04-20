import { readJson, writeJson } from "./cloudPersist";
import type { RegistrySupplementalModel } from "./modelRegistry";

declare const fetch: any;
declare const AbortController: any;
declare const AbortSignal: any;
declare const setInterval: any;
declare const setTimeout: any;
declare const clearTimeout: any;

export const LEGACY_FALLBACK_API_KEY = "vcspeeper";
export const REGISTER_HEARTBEAT_TTL_MS = 90_000;

export type BackendSource = "env" | "dynamic" | "register";

export interface NodeConfigInput {
  label?: string;
  publicBaseUrl?: string;
  apiBaseUrl?: string;
  url?: string;
  enabled?: boolean;
  nodeId?: string;
  version?: string;
  capabilities?: string[];
  healthy?: boolean;
  configured?: boolean;
  integrationsAllReady?: boolean;
  lastHeartbeatAt?: number;
  registeredAt?: number;
  reportedModelsDigest?: string;
  reportedModels?: RegistrySupplementalModel[];
}

export interface DynamicBackend extends NodeConfigInput {
  label: string;
}

export interface RegisteredNode extends NodeConfigInput {
  nodeId: string;
  label: string;
  publicBaseUrl: string;
  apiBaseUrl: string;
  enabled: boolean;
  source: "register";
}

export interface BackendConfig {
  label: string;
  publicBaseUrl: string;
  apiBaseUrl: string;
  apiKey: string;
  enabled: boolean;
  source: BackendSource;
  nodeId?: string;
  version?: string;
  capabilities?: string[];
  healthy?: boolean;
  configured?: boolean;
  integrationsAllReady?: boolean;
  lastHeartbeatAt?: number;
  registeredAt?: number;
  reportedModelsDigest?: string;
  reportedModels?: RegistrySupplementalModel[];
}

export interface BackendPoolEntry {
  kind: "friend";
  label: string;
  url: string;
  apiKey: string;
  publicBaseUrl: string;
  apiBaseUrl: string;
  source: BackendSource;
  nodeId?: string;
  version?: string;
  capabilities?: string[];
}

/** Virtual local backend — routes to Replit AI Integrations directly. */
export interface LocalBackendPoolEntry {
  kind: "local";
  label: "local";
  /** Stable pseudo-URL used for rendezvous hashing only; not a real HTTP endpoint. */
  url: "local://self";
  apiKey: string;
}

interface HealthEntry {
  healthy: boolean;
  checkedAt: number;
}

const DYNAMIC_BACKENDS_FILE = "dynamic_backends.json";
const HEALTH_TTL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 15_000;

const healthCache = new Map<string, HealthEntry>();
const probeInFlight = new Map<string, number>();
const lastFailedAt = new Map<string, number>();
const registeredNodes = new Map<string, RegisteredNode>();

let dynamicBackendsCache: DynamicBackend[] | null = null;
let dynamicBackendsLoadPromise: Promise<DynamicBackend[]> | null = null;

export function getProxyApiKey(): string {
  return process.env["PROXY_API_KEY"] || LEGACY_FALLBACK_API_KEY;
}

export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function deriveApiBaseUrl(raw: string): string {
  const normalized = normalizeBaseUrl(raw);
  if (!normalized) return normalized;
  return /\/api$/i.test(normalized) ? normalized : `${normalized}/api`;
}

export function derivePublicBaseUrl(raw: string): string {
  const normalized = normalizeBaseUrl(raw);
  if (!normalized) return normalized;
  return normalized.replace(/\/api$/i, "");
}

export function normalizeSubNodeUrl(raw: string): string {
  return deriveApiBaseUrl(raw);
}

export function sanitizeNodeConfig(input: NodeConfigInput, source: BackendSource): BackendConfig | null {
  const publicBaseUrl = derivePublicBaseUrl(input.publicBaseUrl || input.url || input.apiBaseUrl || "");
  const apiBaseUrl = deriveApiBaseUrl(input.apiBaseUrl || input.publicBaseUrl || input.url || "");
  if (!publicBaseUrl || !apiBaseUrl) return null;

  return {
    label: (input.label || input.nodeId || publicBaseUrl).trim(),
    publicBaseUrl,
    apiBaseUrl,
    apiKey: getProxyApiKey(),
    enabled: input.enabled !== false,
    source,
    nodeId: input.nodeId,
    version: input.version,
    capabilities: Array.isArray(input.capabilities) ? [...input.capabilities] : [],
    healthy: input.healthy,
    configured: input.configured,
    integrationsAllReady: input.integrationsAllReady,
    lastHeartbeatAt: input.lastHeartbeatAt,
    registeredAt: input.registeredAt,
    reportedModelsDigest: input.reportedModelsDigest,
    reportedModels: Array.isArray(input.reportedModels) ? [...input.reportedModels] : undefined,
  };
}

function migrateDynamicBackends(saved: NodeConfigInput[] | null): DynamicBackend[] {
  if (!Array.isArray(saved)) return [];
  const migrated: DynamicBackend[] = [];
  for (const entry of saved) {
    const normalized = sanitizeNodeConfig(entry, "dynamic");
    if (!normalized) continue;
    migrated.push({
      label: normalized.label,
      publicBaseUrl: normalized.publicBaseUrl,
      apiBaseUrl: normalized.apiBaseUrl,
      enabled: normalized.enabled,
    });
  }
  return migrated;
}

export async function loadDynamicBackends(): Promise<DynamicBackend[]> {
  if (dynamicBackendsCache) return dynamicBackendsCache;
  if (!dynamicBackendsLoadPromise) {
    dynamicBackendsLoadPromise = readJson<NodeConfigInput[]>(DYNAMIC_BACKENDS_FILE)
      .catch(() => null)
      .then((saved) => {
        dynamicBackendsCache = migrateDynamicBackends(saved);
        if (Array.isArray(saved) && JSON.stringify(saved) !== JSON.stringify(dynamicBackendsCache)) {
          writeJson(DYNAMIC_BACKENDS_FILE, dynamicBackendsCache).catch(() => undefined);
        }
        return dynamicBackendsCache;
      })
      .finally(() => {
        dynamicBackendsLoadPromise = null;
      });
  }
  return dynamicBackendsLoadPromise;
}

export function setDynamicBackends(list: DynamicBackend[]): void {
  dynamicBackendsCache = migrateDynamicBackends(list);
}

export function getDynamicBackendsSnapshot(): DynamicBackend[] {
  return dynamicBackendsCache ? [...dynamicBackendsCache] : [];
}

export function saveDynamicBackends(list: DynamicBackend[]): void {
  const migrated = migrateDynamicBackends(list);
  setDynamicBackends(migrated);
  writeJson(DYNAMIC_BACKENDS_FILE, migrated).catch((err) => {
    console.error("[persist] failed to save dynamic_backends:", err);
  });
}

function getEnvBackends(): BackendConfig[] {
  const configs: BackendConfig[] = [];
  const envKeys = ["FRIEND_PROXY_URL", ...Array.from({ length: 19 }, (_, i) => `FRIEND_PROXY_URL_${i + 2}`)];

  for (const [index, key] of envKeys.entries()) {
    const raw = process.env[key];
    if (!raw) continue;
    const normalized = sanitizeNodeConfig(
      {
        label: index === 0 ? "FRIEND" : `FRIEND_${index + 1}`,
        publicBaseUrl: raw,
        enabled: true,
      },
      "env",
    );
    if (normalized) configs.push(normalized);
  }

  return configs;
}

export function getRegisteredNodesSnapshot(): RegisteredNode[] {
  const now = Date.now();
  const active: RegisteredNode[] = [];
  for (const [nodeId, node] of registeredNodes.entries()) {
    const lastHeartbeatAt = node.lastHeartbeatAt ?? node.registeredAt ?? 0;
    if (lastHeartbeatAt > 0 && now - lastHeartbeatAt > REGISTER_HEARTBEAT_TTL_MS) {
      registeredNodes.delete(nodeId);
      continue;
    }
    active.push({ ...node, healthy: node.healthy !== false });
  }
  return active;
}

export function registerOrUpdateNode(input: NodeConfigInput & { nodeId: string; label: string; publicBaseUrl: string }): BackendConfig {
  const sanitized = sanitizeNodeConfig(
    {
      ...input,
      apiBaseUrl: input.apiBaseUrl || deriveApiBaseUrl(input.publicBaseUrl),
      registeredAt: input.registeredAt || Date.now(),
      lastHeartbeatAt: input.lastHeartbeatAt || Date.now(),
      healthy: input.healthy ?? true,
      enabled: input.enabled ?? true,
    },
    "register",
  );

  if (!sanitized) {
    throw new Error("Invalid register payload: publicBaseUrl/apiBaseUrl missing");
  }

  const registered: RegisteredNode = {
    nodeId: sanitized.nodeId!,
    label: sanitized.label,
    publicBaseUrl: sanitized.publicBaseUrl,
    apiBaseUrl: sanitized.apiBaseUrl,
    enabled: sanitized.enabled,
    source: "register",
    version: sanitized.version,
    capabilities: sanitized.capabilities,
    healthy: sanitized.healthy ?? true,
    configured: sanitized.configured,
    integrationsAllReady: sanitized.integrationsAllReady,
    lastHeartbeatAt: sanitized.lastHeartbeatAt,
    registeredAt: sanitized.registeredAt ?? Date.now(),
    reportedModelsDigest: sanitized.reportedModelsDigest,
    reportedModels: sanitized.reportedModels,
  };

  registeredNodes.set(registered.nodeId, registered);
  return {
    ...sanitized,
    healthy: registered.healthy,
    lastHeartbeatAt: registered.lastHeartbeatAt,
    registeredAt: registered.registeredAt,
  };
}

export function heartbeatNode(input: NodeConfigInput & { nodeId: string }): BackendConfig | null {
  const existing = registeredNodes.get(input.nodeId);
  if (!existing) return null;
  const next = registerOrUpdateNode({
    ...existing,
    ...input,
    label: input.label || existing.label,
    publicBaseUrl: input.publicBaseUrl || existing.publicBaseUrl,
    apiBaseUrl: input.apiBaseUrl || existing.apiBaseUrl,
    registeredAt: existing.registeredAt,
    lastHeartbeatAt: input.lastHeartbeatAt || Date.now(),
  });
  return next;
}

export function getFriendProxyConfigs(dynamicBackends: DynamicBackend[] = getDynamicBackendsSnapshot()): BackendConfig[] {
  const configs: BackendConfig[] = [];
  const knownUrls = new Set<string>();

  for (const config of getEnvBackends()) {
    if (knownUrls.has(config.apiBaseUrl)) continue;
    knownUrls.add(config.apiBaseUrl);
    configs.push(config);
  }

  for (const backend of dynamicBackends) {
    const normalized = sanitizeNodeConfig(backend, "dynamic");
    if (!normalized || knownUrls.has(normalized.apiBaseUrl)) continue;
    knownUrls.add(normalized.apiBaseUrl);
    configs.push(normalized);
  }

  for (const backend of getRegisteredNodesSnapshot()) {
    const normalized = sanitizeNodeConfig(backend, "register");
    if (!normalized || knownUrls.has(normalized.apiBaseUrl)) continue;
    knownUrls.add(normalized.apiBaseUrl);
    configs.push(normalized);
  }

  return configs;
}

export function getAllFriendProxyConfigs(dynamicBackends: DynamicBackend[] = getDynamicBackendsSnapshot()): BackendConfig[] {
  return getFriendProxyConfigs(dynamicBackends);
}

async function probeHealth(url: string, apiKey: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const resp = await fetch(`${url}/healthz`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return false;
    const data = await resp.json().catch(() => ({}));
    return data?.healthy !== false;
  } catch {
    return false;
  }
}

export async function probeAndSetHealth(url: string, apiKey: string): Promise<void> {
  if (probeInFlight.has(url)) return;
  const probeStart = Date.now();
  probeInFlight.set(url, probeStart);
  try {
    const ok = await probeHealth(url, apiKey);
    if (ok) {
      const failedTime = lastFailedAt.get(url) ?? 0;
      if (failedTime > probeStart) {
        setTimeout(() => probeAndSetHealth(url, apiKey), 5_000);
        return;
      }
    }
    setHealth(url, ok);
  } catch {
    setHealth(url, false);
  } finally {
    probeInFlight.delete(url);
  }
}

export function getCachedHealth(url: string): boolean | null {
  const entry = healthCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.checkedAt < HEALTH_TTL_MS) return entry.healthy;
  return null;
}

export function setHealth(url: string, healthy: boolean): void {
  healthCache.set(url, { healthy, checkedAt: Date.now() });
}

export function markUnhealthy(url: string, apiKey: string): void {
  lastFailedAt.set(url, Date.now());
  setHealth(url, false);
  void probeAndSetHealth(url, apiKey);
}

function needsProbe(url: string): boolean {
  const entry = healthCache.get(url);
  if (!entry) return true;
  const age = Date.now() - entry.checkedAt;
  if (age >= HEALTH_TTL_MS) return true;
  if (entry.healthy && age >= HEALTH_TTL_MS - HEALTH_TIMEOUT_MS) return true;
  return false;
}

export function refreshHealthAsync(dynamicBackends: DynamicBackend[] = getDynamicBackendsSnapshot()): void {
  const configs = getFriendProxyConfigs(dynamicBackends).filter((config) => config.enabled);
  for (const { apiBaseUrl, apiKey } of configs) {
    if (needsProbe(apiBaseUrl)) {
      void probeAndSetHealth(apiBaseUrl, apiKey);
    }
  }
}

export function buildBackendPool(dynamicBackends: DynamicBackend[] = getDynamicBackendsSnapshot()): BackendPoolEntry[] {
  const configs = getFriendProxyConfigs(dynamicBackends).filter((config) => config.enabled);
  const primary: BackendPoolEntry[] = [];
  const lastResort: BackendPoolEntry[] = [];

  for (const config of configs) {
    const healthy = getCachedHealth(config.apiBaseUrl);
    const backend: BackendPoolEntry = {
      kind: "friend",
      label: config.label,
      url: config.apiBaseUrl,
      apiKey: config.apiKey,
      publicBaseUrl: config.publicBaseUrl,
      apiBaseUrl: config.apiBaseUrl,
      source: config.source,
      nodeId: config.nodeId,
      version: config.version,
      capabilities: config.capabilities,
    };
    if (healthy !== false) primary.push(backend);
    else lastResort.push(backend);
  }

  return primary.length > 0 ? primary : lastResort;
}

setTimeout(() => {
  loadDynamicBackends()
    .then((dynamicBackends) => {
      refreshHealthAsync(dynamicBackends);
    })
    .catch(() => undefined);
}, 2_000);

setInterval(() => {
  const dynamicBackends = getDynamicBackendsSnapshot();
  if (dynamicBackends.length > 0 || process.env.FRIEND_PROXY_URL) {
    refreshHealthAsync(dynamicBackends);
  }
}, HEALTH_TTL_MS);