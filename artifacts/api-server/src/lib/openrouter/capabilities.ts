import type { OpenRouterApiSurface } from "./schema";

export const OPENROUTER_CAPABILITIES = [
  "chat",
  "messages",
  "streaming",
  "tool_calling",
  "reasoning",
  "prompt_caching",
  "multimodal_image_input",
  "multimodal_pdf_input",
  "audio_io",
  "video_jobs",
  "embeddings",
  "model_endpoints",
] as const;

export type OpenRouterCapability = typeof OPENROUTER_CAPABILITIES[number];

export type OpenRouterCapabilityStatus =
  | "supported"
  | "planned"
  | "unconfirmed";

export interface OpenRouterCapabilityDescriptor {
  key: OpenRouterCapability;
  status: OpenRouterCapabilityStatus;
  surfaces: OpenRouterApiSurface[];
  summary: string;
  notes?: string;
}

export type OpenRouterCapabilityRegistry = Record<
  OpenRouterCapability,
  OpenRouterCapabilityDescriptor
>;

export const OPENROUTER_CAPABILITY_LABELS: Record<OpenRouterCapability, string> = {
  chat: "Chat Completions",
  messages: "Anthropic Messages Compat",
  streaming: "Streaming",
  tool_calling: "Tool Calling",
  reasoning: "Reasoning",
  prompt_caching: "Prompt Caching",
  multimodal_image_input: "Image Input",
  multimodal_pdf_input: "PDF Input",
  audio_io: "Audio I/O",
  video_jobs: "Video Jobs",
  embeddings: "Embeddings",
  model_endpoints: "Model Metadata Endpoints",
};