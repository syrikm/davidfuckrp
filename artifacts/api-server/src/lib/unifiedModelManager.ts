/**
 * Unified model management module.
 *
 * Merges the parent proxy's simple disabled_models.json approach with the
 * child proxy's model-groups.json group-based management.
 *
 * Features:
 *   - Supports both disabled_models.json (Set-based deny list) and
 *     model-groups.json (structured group-based allow/deny list)
 *   - Backward compatible API: isModelEnabled(), getDisabledModels(), etc.
 *   - Unified configuration: when both files exist, model-groups.json takes
 *     precedence for listed models; disabled_models.json acts as an
 *     additional override for models not in any group.
 *   - Async-first: all file I/O is non-blocking with mutex-protected caches.
 *   - Debounced batch writes to reduce disk I/O frequency.
 *
 * This module is shared between:
 *   - davidfuckrp-github (v1.1.9)
 *   - vcpfuckcachefork-github (v1.2.0)
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelEntry {
  id: string;
  enabled: boolean;
}

export interface ModelGroup {
  id: string;
  name: string;
  enabled: boolean;
  models: ModelEntry[];
}

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

const DISABLED_MODELS_PATH = path.join(process.cwd(), "disabled_models.json");
const MODEL_GROUPS_PATH = path.join(process.cwd(), "model-groups.json");

// ---------------------------------------------------------------------------
// Async Mutex (lightweight, no external dependencies)
// ---------------------------------------------------------------------------

class AsyncMutex {
  private _queue: Array<() => void> = [];
  private _locked = false;

  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this._locked) {
        this._locked = true;
        resolve();
      } else {
        this._queue.push(resolve);
      }
    });
  }

  release(): void {
    if (this._queue.length > 0) {
      const next = this._queue.shift()!;
      next();
    } else {
      this._locked = false;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// ---------------------------------------------------------------------------
// In-process cache (protected by mutexes)
// ---------------------------------------------------------------------------

let _disabledModelsCache: Set<string> | null = null;
let _modelGroupsCache: ModelGroup[] | null = null;

const _groupsMutex = new AsyncMutex();
const _disabledMutex = new AsyncMutex();

// ---------------------------------------------------------------------------
// Default model groups (source of truth when model-groups.json is absent)
// ---------------------------------------------------------------------------

const CLAUDE_BASE = [
  "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1",
  "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5",
];
const CLAUDE_MODELS: string[] = [];
for (const b of CLAUDE_BASE) {
  CLAUDE_MODELS.push(b, `${b}-thinking`, `${b}-thinking-visible`);
}

const OPENAI_MODELS = [
  "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-5-nano",
  "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
  "gpt-4o", "gpt-4o-mini",
  "o4-mini", "o3", "o3-mini",
  "o4-mini-thinking", "o3-thinking", "o3-mini-thinking",
  "gpt-image-1", "gpt-audio", "gpt-audio-mini", "gpt-4o-mini-transcribe",
];

const GEMINI_BASE = [
  "gemini-3.1-pro-preview", "gemini-3-pro-preview", "gemini-3-flash-preview",
  "gemini-3-pro-image-preview", "gemini-2.5-pro", "gemini-2.5-flash",
  "gemini-2.5-flash-image",
];
const GEMINI_MODELS: string[] = [];
for (const b of GEMINI_BASE) {
  if (b.includes("image")) {
    GEMINI_MODELS.push(b);
  } else {
    GEMINI_MODELS.push(b, `${b}-thinking`, `${b}-thinking-visible`);
  }
}

const OPENROUTER_MODELS = [
  "x-ai/grok-4.20", "x-ai/grok-4.20-multi-agent", "x-ai/grok-4",
  "x-ai/grok-4-fast", "x-ai/grok-4.1-fast", "x-ai/grok-code-fast-1",
  "x-ai/grok-3", "x-ai/grok-3-mini",
  "meta-llama/llama-4-maverick", "meta-llama/llama-4-scout",
  "deepseek/deepseek-v3.2", "deepseek/deepseek-v3.2-speciale",
  "deepseek/deepseek-chat-v3.1", "deepseek/deepseek-r1",
  "deepseek/deepseek-r1-0528", "deepseek/deepseek-r1-distill-qwen-32b",
  "deepseek/deepseek-r1-distill-llama-70b",
  "mistralai/mistral-large-2512", "mistralai/mistral-medium-3.1",
  "mistralai/mistral-small-2603", "mistralai/mistral-small-3.2-24b-instruct",
  "mistralai/devstral-2512", "mistralai/devstral-medium",
  "mistralai/codestral-2508",
  "qwen/qwen3.5-122b-a10b", "qwen/qwen3.5-397b-a17b",
  "qwen/qwen3-235b-a22b", "qwen/qwen3-235b-a22b-thinking-2507",
  "qwen/qwen3-max", "qwen/qwen3-coder", "qwen/qwen3-coder-next",
  "qwen/qwq-32b",
  "google/gemini-3.1-pro-preview", "google/gemini-3-flash-preview",
  "google/gemini-3-pro-image-preview", "google/gemini-2.5-pro",
  "google/gemini-2.5-flash", "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-flash-image",
  "anthropic/claude-opus-4.7", "anthropic/claude-opus-4.6",
  "anthropic/claude-sonnet-4.6", "anthropic/claude-haiku-4.5",
  "microsoft/phi-4",
  "amazon/nova-premier-v1", "amazon/nova-pro-v1", "amazon/nova-2-lite-v1",
  "amazon/nova-lite-v1", "amazon/nova-micro-v1",
  "cohere/command-a", "cohere/command-r-plus-08-2024",
];

export const DEFAULT_GROUPS: ModelGroup[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    enabled: true,
    models: CLAUDE_MODELS.map(id => ({ id, enabled: true })),
  },
  {
    id: "openai",
    name: "OpenAI (GPT / o-series)",
    enabled: true,
    models: OPENAI_MODELS.map(id => ({ id, enabled: true })),
  },
  {
    id: "gemini",
    name: "Google (Gemini)",
    enabled: true,
    models: GEMINI_MODELS.map(id => ({ id, enabled: true })),
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    enabled: true,
    models: OPENROUTER_MODELS.map(id => ({ id, enabled: true })),
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeWithDefaults(saved: ModelGroup[]): ModelGroup[] {
  return DEFAULT_GROUPS.map(defaultGroup => {
    const savedGroup = saved.find(g => g.id === defaultGroup.id);
    if (!savedGroup) return defaultGroup;
    return {
      ...defaultGroup,
      enabled: savedGroup.enabled,
      models: defaultGroup.models.map(dm => {
        const sm = savedGroup.models.find(m => m.id === dm.id);
        return sm ?? dm;
      }),
    };
  });
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await fs.promises.rename(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Debounced batch writer for disk I/O reduction
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 1500;

let _pendingWrite: Promise<void> | null = null;
let _writeTimer: NodeJS.Timeout | null = null;
let _pendingGroups: ModelGroup[] | null = null;
let _pendingDisabled: Set<string> | null = null;

/**
 * Schedule a debounced write to disk. Coalesces multiple rapid updates into
 * a single I/O operation, reducing disk pressure under high concurrency.
 */
function scheduleBatchWrite(): void {
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    flushBatchWrite();
  }, DEBOUNCE_MS);
}

async function flushBatchWrite(): Promise<void> {
  if (_pendingWrite) return _pendingWrite;
  _pendingWrite = (async () => {
    const groupsToWrite = _pendingGroups;
    const disabledToWrite = _pendingDisabled;
    _pendingGroups = null;
    _pendingDisabled = null;

    const writes: Promise<void>[] = [];
    if (groupsToWrite) {
      writes.push(writeJsonFile(MODEL_GROUPS_PATH, groupsToWrite));
    }
    if (disabledToWrite) {
      writes.push(writeJsonFile(DISABLED_MODELS_PATH, [...disabledToWrite]));
    }
    await Promise.all(writes);
  })().finally(() => {
    _pendingWrite = null;
  });
  return _pendingWrite;
}

// ---------------------------------------------------------------------------
// Disabled models (legacy simple deny list)
// ---------------------------------------------------------------------------

async function loadDisabledModels(): Promise<Set<string>> {
  if (_disabledModelsCache) return _disabledModelsCache;
  return _disabledMutex.run(async () => {
    if (_disabledModelsCache) return _disabledModelsCache;
    const raw = await readJsonFile<string[]>(DISABLED_MODELS_PATH);
    _disabledModelsCache = new Set(raw ?? []);
    return _disabledModelsCache;
  });
}

function scheduleDisabledModelsWrite(set: Set<string>): void {
  _pendingDisabled = set;
  scheduleBatchWrite();
}

async function saveDisabledModels(set: Set<string>): Promise<void> {
  _disabledModelsCache = null;
  _pendingDisabled = null;
  await writeJsonFile(DISABLED_MODELS_PATH, [...set]);
}

// ---------------------------------------------------------------------------
// Model groups (structured group-based management)
// ---------------------------------------------------------------------------

async function loadModelGroups(): Promise<ModelGroup[]> {
  if (_modelGroupsCache) return _modelGroupsCache;
  return _groupsMutex.run(async () => {
    if (_modelGroupsCache) return _modelGroupsCache;
    const saved = await readJsonFile<ModelGroup[]>(MODEL_GROUPS_PATH);
    _modelGroupsCache = saved ? mergeWithDefaults(saved) : DEFAULT_GROUPS.map(g => ({ ...g, models: g.models.map(m => ({ ...m })) }));
    return _modelGroupsCache;
  });
}

function scheduleGroupsWrite(groups: ModelGroup[]): void {
  _pendingGroups = groups;
  scheduleBatchWrite();
}

async function saveModelGroups(groups: ModelGroup[]): Promise<void> {
  _modelGroupsCache = null;
  _pendingGroups = null;
  await writeJsonFile(MODEL_GROUPS_PATH, groups);
}

// ---------------------------------------------------------------------------
// Unified public API
// ---------------------------------------------------------------------------

/**
 * Returns true if a model is allowed to handle requests.
 *
 * Uses cached model groups and disabled models for performance.
 * Pass forceReload=true to bypass caches and re-read from disk.
 *
 * Priority order:
 *   1. If model-groups.json exists and the model is listed in an enabled group,
 *      the group-level enabled flag takes precedence.
 *   2. If the model is not in any group (or model-groups.json doesn't exist),
 *      check disabled_models.json as a fallback deny list.
 *   3. If neither file lists the model, it is allowed (default: enabled).
 */
export async function isModelEnabled(modelId: string, forceReload?: boolean): Promise<boolean> {
  if (forceReload) { _modelGroupsCache = null; _disabledModelsCache = null; }
  const groups = await loadModelGroups();
  for (const group of groups) {
    if (!group.enabled) continue;
    const model = group.models.find(m => m.id === modelId);
    if (model) return model.enabled;
  }
  // Model exists in groups file but not in any enabled group → disabled
  const allModelIds = new Set(groups.flatMap(g => g.models.map(m => m.id)));
  if (allModelIds.has(modelId)) return false;

  // 2. Check disabled_models.json (legacy fallback)
  const disabledModels = await loadDisabledModels();
  if (disabledModels.has(modelId)) return false;

  // 3. Default: enabled
  return true;
}

/**
 * Returns all model IDs that are currently enabled.
 */
export async function getEnabledModelIds(): Promise<string[]> {
  const groups = await loadModelGroups();
  const ids: string[] = [];
  for (const group of groups) {
    if (!group.enabled) continue;
    for (const m of group.models) {
      if (m.enabled) ids.push(m.id);
    }
  }
  if (ids.length > 0) return ids;

  // Fallback: if no model-groups.json, use defaults minus disabled_models.json
  const disabled = await loadDisabledModels();
  const allIds = DEFAULT_GROUPS.flatMap(g => g.models.map(m => m.id));
  return allIds.filter(id => !disabled.has(id));
}

/**
 * Returns the set of disabled model IDs (from disabled_models.json).
 * For model-groups.json, returns disabled models within enabled groups.
 * Uses cached data for performance.
 */
export async function getDisabledModels(): Promise<Set<string>> {
  const disabled = new Set<string>();

  // From disabled_models.json (cached)
  const simpleDisabled = await loadDisabledModels();
  for (const id of simpleDisabled) disabled.add(id);

  // From model-groups.json (cached): disabled models within enabled groups
  const groups = await loadModelGroups();
  for (const group of groups) {
    if (!group.enabled) {
      // Entire group disabled → all models are disabled
      for (const m of group.models) disabled.add(m.id);
    } else {
      for (const m of group.models) {
        if (!m.enabled) disabled.add(m.id);
      }
    }
  }

  return disabled;
}

/**
 * Adds a model to the disabled list.
 */
export async function disableModel(modelId: string): Promise<void> {
  // If model-groups.json exists, update the specific model entry
  const groups = await loadModelGroups();
  let updated = false;
  for (const group of groups) {
    for (const model of group.models) {
      if (model.id === modelId && model.enabled) {
        model.enabled = false;
        updated = true;
      }
    }
  }
  if (updated) {
    scheduleGroupsWrite([...groups]);
  }

  // Also add to disabled_models.json for backward compatibility
  const disabled = await loadDisabledModels();
  if (!disabled.has(modelId)) {
    disabled.add(modelId);
    scheduleDisabledModelsWrite(new Set(disabled));
  }
}

/**
 * Removes a model from the disabled list.
 */
export async function enableModel(modelId: string): Promise<void> {
  // If model-groups.json exists, update the specific model entry
  const groups = await loadModelGroups();
  let updated = false;
  for (const group of groups) {
    for (const model of group.models) {
      if (model.id === modelId && !model.enabled) {
        model.enabled = true;
        updated = true;
      }
    }
  }
  if (updated) {
    scheduleGroupsWrite([...groups]);
  }

  // Also remove from disabled_models.json for backward compatibility
  const disabled = await loadDisabledModels();
  if (disabled.has(modelId)) {
    disabled.delete(modelId);
    scheduleDisabledModelsWrite(new Set(disabled));
  }
}

// ---------------------------------------------------------------------------
// Model groups CRUD (for admin endpoints)
// ---------------------------------------------------------------------------

export async function readGroups(): Promise<ModelGroup[]> {
  return loadModelGroups();
}

export async function writeGroups(groups: ModelGroup[]): Promise<void> {
  await saveModelGroups(groups);
}

/**
 * Invalidate all caches — called after any config file modification.
 */
export function invalidateCache(): void {
  _disabledModelsCache = null;
  _modelGroupsCache = null;
}