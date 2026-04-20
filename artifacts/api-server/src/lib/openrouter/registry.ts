import type { OpenRouterModelCapabilityFlags } from "./schema";
import {
  OPENROUTER_CAPABILITIES,
  type OpenRouterCapability,
  type OpenRouterCapabilityDescriptor,
  type OpenRouterCapabilityRegistry,
} from "./capabilities";

const CAPABILITY_DESCRIPTORS: OpenRouterCapabilityDescriptor[] = [
  {
    key: "chat",
    status: "supported",
    surfaces: ["chat_completions"],
    summary: "Canonical chat completion request/response and chunk envelope are modeled.",
    notes: "Matches current /v1/chat/completions integration surface.",
  },
  {
    key: "messages",
    status: "supported",
    surfaces: ["messages"],
    summary: "Anthropic-compatible messages request/response and stream chunk shapes are modeled.",
    notes: "Targets /v1/messages compat without changing route logic yet.",
  },
  {
    key: "streaming",
    status: "supported",
    surfaces: ["chat_completions", "messages"],
    summary: "Streaming chunk envelopes are modeled for both chat and messages APIs.",
  },
  {
    key: "tool_calling",
    status: "supported",
    surfaces: ["chat_completions", "messages"],
    summary: "Function tool definitions, tool choice, tool calls, and tool result blocks are modeled.",
  },
  {
    key: "reasoning",
    status: "supported",
    surfaces: ["chat_completions", "messages"],
    summary: "Reasoning config, reasoning details, and reasoning-related usage fields are modeled.",
  },
  {
    key: "prompt_caching",
    status: "supported",
    surfaces: ["chat_completions", "messages"],
    summary: "Top-level and block-level cache control plus cache usage details are modeled.",
  },
  {
    key: "multimodal_image_input",
    status: "supported",
    surfaces: ["chat_completions", "messages"],
    summary: "Image URL and input_image style blocks are modeled for multimodal request payloads.",
  },
  {
    key: "multimodal_pdf_input",
    status: "supported",
    surfaces: ["chat_completions", "messages"],
    summary: "input_file style blocks cover PDF/file input at canonical schema level.",
  },
  {
    key: "audio_io",
    status: "planned",
    surfaces: ["chat_completions"],
    summary: "Audio-related request and content block fields are reserved in the canonical schema.",
    notes: "Business routing and full response normalization are not wired yet.",
  },
  {
    key: "video_jobs",
    status: "supported",
    surfaces: ["videos"],
    summary: "Async video generation job request/status/content metadata are modeled.",
  },
  {
    key: "embeddings",
    status: "supported",
    surfaces: ["embeddings"],
    summary: "Embedding request/response vectors and usage are modeled.",
  },
  {
    key: "model_endpoints",
    status: "supported",
    surfaces: ["models"],
    summary: "Model metadata, pricing, architecture, and capability flags are modeled.",
  },
];

export const OPENROUTER_CAPABILITY_REGISTRY: OpenRouterCapabilityRegistry =
  CAPABILITY_DESCRIPTORS.reduce((registry, descriptor) => {
    registry[descriptor.key] = descriptor;
    return registry;
  }, {} as OpenRouterCapabilityRegistry);

export const OPENROUTER_SUPPORTED_CAPABILITIES = OPENROUTER_CAPABILITIES.filter(
  (capability) => OPENROUTER_CAPABILITY_REGISTRY[capability].status === "supported",
);

export const OPENROUTER_PLANNED_CAPABILITIES = OPENROUTER_CAPABILITIES.filter(
  (capability) => OPENROUTER_CAPABILITY_REGISTRY[capability].status === "planned",
);

export const OPENROUTER_UNCONFIRMED_CAPABILITIES = OPENROUTER_CAPABILITIES.filter(
  (capability) => OPENROUTER_CAPABILITY_REGISTRY[capability].status === "unconfirmed",
);

export interface OpenRouterCapabilitySnapshot {
  supported: OpenRouterCapability[];
  planned: OpenRouterCapability[];
  unconfirmed: OpenRouterCapability[];
}

export const OPENROUTER_CAPABILITY_SNAPSHOT: OpenRouterCapabilitySnapshot = {
  supported: OPENROUTER_SUPPORTED_CAPABILITIES,
  planned: OPENROUTER_PLANNED_CAPABILITIES,
  unconfirmed: OPENROUTER_UNCONFIRMED_CAPABILITIES,
};

export const OPENROUTER_CANONICAL_REGISTRY = {
  capabilities: OPENROUTER_CAPABILITY_REGISTRY,
  snapshot: OPENROUTER_CAPABILITY_SNAPSHOT,
};

export function listOpenRouterCapabilitiesByStatus(
  status: OpenRouterCapabilityDescriptor["status"],
): OpenRouterCapabilityDescriptor[] {
  return OPENROUTER_CAPABILITIES
    .map((capability) => OPENROUTER_CAPABILITY_REGISTRY[capability])
    .filter((descriptor) => descriptor.status === status);
}

export function getOpenRouterCapability(
  capability: OpenRouterCapability,
): OpenRouterCapabilityDescriptor {
  return OPENROUTER_CAPABILITY_REGISTRY[capability];
}

export function createModelCapabilityFlags(
  capabilities: OpenRouterCapability[],
): OpenRouterModelCapabilityFlags {
  const flags: OpenRouterModelCapabilityFlags = {};
  for (const capability of capabilities) {
    flags[capability] = true;
  }
  return flags;
}