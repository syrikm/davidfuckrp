import { readJson, writeJson } from "./cloudPersist";
import type { ManualOverlayModel } from "./modelRegistry";

const MANUAL_MODEL_STORE_FILE = "mother_manual_models.json";

// mother manual persistence phase
// 持久化的主键规则：优先 canonical_id，否则退回 id。
function getManualModelStoreKey(entry: Pick<ManualOverlayModel, "id" | "canonical_id">): string {
  const canonicalId = typeof entry.canonical_id === "string" ? entry.canonical_id.trim() : "";
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  return canonicalId || id;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cloneManualModel(entry: ManualOverlayModel): ManualOverlayModel {
  return {
    ...entry,
    id: entry.id.trim(),
    ...(normalizeString(entry.canonical_id) ? { canonical_id: entry.canonical_id!.trim() } : {}),
    ...(normalizeString(entry.display_name) ? { display_name: entry.display_name!.trim() } : {}),
    ...(normalizeString(entry.provider) ? { provider: entry.provider!.trim() } : {}),
    ...(normalizeString(entry.provider_family) ? { provider_family: entry.provider_family!.trim() } : {}),
    ...(typeof entry.description === "string" ? { description: entry.description } : {}),
    ...(entry.aliases ? { aliases: Array.isArray(entry.aliases) ? [...entry.aliases] : { ...entry.aliases } } : {}),
    ...(entry.context ? { context: { ...entry.context } } : {}),
    ...(entry.price ? { price: { ...entry.price } } : {}),
    ...(entry.capabilities ? { capabilities: { ...entry.capabilities } } : {}),
    ...(entry.modalities ? { modalities: { ...entry.modalities, input: entry.modalities.input ? [...entry.modalities.input] : undefined, output: entry.modalities.output ? [...entry.modalities.output] : undefined } } : {}),
    ...(entry.routing ? { routing: { ...entry.routing, preferred_providers: entry.routing.preferred_providers ? [...entry.routing.preferred_providers] : undefined } } : {}),
    ...(entry.metadata ? { metadata: { ...entry.metadata } } : {}),
    ...(entry.source_metadata ? { source_metadata: { ...entry.source_metadata } } : {}),
    origin: "mother_manual",
    source: "manual",
  };
}

function normalizeManualModelEntry(value: unknown): ManualOverlayModel | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = normalizeString(raw.id);
  if (!id) return null;

  const origin = raw.origin === "mother_manual" ? "mother_manual" : "mother_manual";
  const source = raw.source === "manual" ? "manual" : "manual";

  const normalized: ManualOverlayModel = {
    id,
    ...(normalizeString(raw.canonical_id) ? { canonical_id: String(raw.canonical_id).trim() } : {}),
    ...(normalizeString(raw.display_name) ? { display_name: String(raw.display_name).trim() } : {}),
    ...(normalizeString(raw.provider) ? { provider: String(raw.provider).trim() } : {}),
    ...(normalizeString(raw.provider_family) ? { provider_family: String(raw.provider_family).trim() } : {}),
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    ...(Array.isArray(raw.aliases)
      ? { aliases: raw.aliases.filter((entry): entry is string => typeof entry === "string" && !!entry.trim()).map((entry) => entry.trim()) }
      : (raw.aliases && typeof raw.aliases === "object" ? { aliases: raw.aliases as ManualOverlayModel["aliases"] } : {})),
    ...(raw.context && typeof raw.context === "object" ? { context: raw.context as ManualOverlayModel["context"] } : {}),
    ...(raw.price && typeof raw.price === "object" ? { price: raw.price as ManualOverlayModel["price"] } : {}),
    ...(raw.capabilities && typeof raw.capabilities === "object" ? { capabilities: raw.capabilities as ManualOverlayModel["capabilities"] } : {}),
    ...(raw.modalities && typeof raw.modalities === "object" ? { modalities: raw.modalities as ManualOverlayModel["modalities"] } : {}),
    ...(raw.routing && typeof raw.routing === "object" ? { routing: raw.routing as ManualOverlayModel["routing"] } : {}),
    ...(raw.metadata && typeof raw.metadata === "object" ? { metadata: raw.metadata as Record<string, unknown> } : {}),
    ...(raw.source_metadata && typeof raw.source_metadata === "object" ? { source_metadata: raw.source_metadata as Record<string, unknown> } : {}),
    origin,
    source,
  };

  return cloneManualModel(normalized);
}

function normalizeManualModelEntries(value: unknown): ManualOverlayModel[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Map<string, ManualOverlayModel>();

  for (const entry of value) {
    const normalized = normalizeManualModelEntry(entry);
    if (!normalized) continue;
    const key = getManualModelStoreKey(normalized);
    if (!key) continue;
    deduped.set(key, normalized);
  }

  return [...deduped.values()];
}

async function persistManualModelEntries(entries: ManualOverlayModel[]): Promise<void> {
  try {
    await writeJson(MANUAL_MODEL_STORE_FILE, entries.map(cloneManualModel));
  } catch (err) {
    console.error("[manual-model-store] failed to persist mother manual model entries:", err);
  }
}

export async function readManualModelStore(): Promise<ManualOverlayModel[]> {
  try {
    const stored = await readJson<unknown>(MANUAL_MODEL_STORE_FILE);
    if (stored === null) {
      await persistManualModelEntries([]);
      return [];
    }

    const normalized = normalizeManualModelEntries(stored);
    if (!Array.isArray(stored) || normalized.length !== stored.length) {
      console.warn("[manual-model-store] detected invalid mother manual model entries; persisted normalized subset");
      await persistManualModelEntries(normalized);
    }
    return normalized;
  } catch (err) {
    console.error("[manual-model-store] failed to read mother manual model store:", err);
    return [];
  }
}

export async function writeManualModelStore(entries: ManualOverlayModel[]): Promise<ManualOverlayModel[]> {
  const normalized = normalizeManualModelEntries(entries);
  await persistManualModelEntries(normalized);
  return normalized;
}

export async function upsertManualModelStoreEntry(entry: ManualOverlayModel): Promise<{ entries: ManualOverlayModel[]; entry: ManualOverlayModel }> {
  const normalized = normalizeManualModelEntry(entry);
  if (!normalized) {
    throw new Error("Invalid mother manual model entry");
  }

  const current = await readManualModelStore();
  const key = getManualModelStoreKey(normalized);
  const next = new Map(current.map((item) => [getManualModelStoreKey(item), item]));
  next.set(key, normalized);

  const entries = [...next.values()];
  await persistManualModelEntries(entries);
  return { entries, entry: normalized };
}

export async function deleteManualModelStoreEntry(id: string): Promise<{ entries: ManualOverlayModel[]; deleted: ManualOverlayModel | null }> {
  const targetId = typeof id === "string" ? id.trim() : "";
  if (!targetId) {
    throw new Error("Manual model id is required");
  }

  const current = await readManualModelStore();
  let deleted: ManualOverlayModel | null = null;
  const entries = current.filter((entry) => {
    const matches = entry.id === targetId || entry.canonical_id === targetId || getManualModelStoreKey(entry) === targetId;
    if (matches) deleted = entry;
    return !matches;
  });

  if (deleted) {
    await persistManualModelEntries(entries);
  }

  return { entries, deleted };
}

export { MANUAL_MODEL_STORE_FILE, getManualModelStoreKey };