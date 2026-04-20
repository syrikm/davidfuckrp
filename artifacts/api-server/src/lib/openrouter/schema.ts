export type OpenRouterApiSurface =
  | "chat_completions"
  | "messages"
  | "embeddings"
  | "videos"
  | "models";

export type OpenRouterRole =
  | "system"
  | "user"
  | "assistant"
  | "tool";

export type OpenRouterContentBlockType =
  | "text"
  | "image_url"
  | "input_text"
  | "input_image"
  | "input_file"
  | "audio"
  | "tool_result"
  | "tool_use";

export interface OpenRouterCacheControl {
  type: "ephemeral";
  ttl?: "5m" | "1h";
}

export interface OpenRouterTextContentBlock {
  type: "text" | "input_text";
  text: string;
  cache_control?: OpenRouterCacheControl;
}

export interface OpenRouterImageUrlDescriptor {
  url: string;
  detail?: "low" | "high" | "auto";
}

export interface OpenRouterImageUrlContentBlock {
  type: "image_url";
  image_url: OpenRouterImageUrlDescriptor;
  cache_control?: OpenRouterCacheControl;
}

export interface OpenRouterInputImageContentBlock {
  type: "input_image";
  image_url: string;
  mime_type?: string;
  cache_control?: OpenRouterCacheControl;
}

export interface OpenRouterInputFileContentBlock {
  type: "input_file";
  filename?: string;
  media_type?: string;
  file_data?: string;
  file_url?: string;
  cache_control?: OpenRouterCacheControl;
}

export interface OpenRouterAudioContentBlock {
  type: "audio";
  input_audio?: string;
  audio_url?: string;
  format?: string;
  transcript?: string;
  cache_control?: OpenRouterCacheControl;
}

export interface OpenRouterToolUseContentBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface OpenRouterToolResultContentBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  cache_control?: OpenRouterCacheControl;
}

export type OpenRouterMessageContentBlock =
  | OpenRouterTextContentBlock
  | OpenRouterImageUrlContentBlock
  | OpenRouterInputImageContentBlock
  | OpenRouterInputFileContentBlock
  | OpenRouterAudioContentBlock
  | OpenRouterToolUseContentBlock
  | OpenRouterToolResultContentBlock;

export type OpenRouterMessageContent =
  | string
  | OpenRouterMessageContentBlock[];

export interface OpenRouterToolFunctionCall {
  name: string;
  arguments: string;
}

export interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: OpenRouterToolFunctionCall;
}

export interface OpenRouterMessage {
  role: OpenRouterRole;
  content: OpenRouterMessageContent | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenRouterToolCall[];
  refusal?: string | null;
}

export interface OpenRouterFunctionToolDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface OpenRouterToolDefinition {
  type: "function";
  function: OpenRouterFunctionToolDefinition;
}

export type OpenRouterToolChoice =
  | "none"
  | "auto"
  | "required"
  | {
      type: "function";
      function: {
        name: string;
      };
    };

export interface OpenRouterReasoningConfig {
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  max_tokens?: number;
  exclude?: boolean;
  enabled?: boolean;
}

export interface OpenRouterPromptTokensDetails {
  cached_tokens?: number;
  cache_write_tokens?: number;
  audio_tokens?: number;
}

export interface OpenRouterCompletionTokensDetails {
  reasoning_tokens?: number;
  audio_tokens?: number;
}

export interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: OpenRouterPromptTokensDetails;
  completion_tokens_details?: OpenRouterCompletionTokensDetails;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface OpenRouterReasoningDetails {
  effort?: string;
  max_tokens?: number;
  summary?: string | null;
  tokens?: number;
}

export interface OpenRouterChatCompletionRequest {
  model: string;
  messages: OpenRouterMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  seed?: number;
  tools?: OpenRouterToolDefinition[];
  tool_choice?: OpenRouterToolChoice;
  response_format?: Record<string, unknown>;
  reasoning?: OpenRouterReasoningConfig;
  verbosity?: "low" | "medium" | "high" | "max";
  modalities?: string[];
  audio?: Record<string, unknown>;
  prediction?: Record<string, unknown>;
  provider?: Record<string, unknown>;
  cache_control?: OpenRouterCacheControl;
  user?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OpenRouterChatCompletionChoice {
  index: number;
  message: OpenRouterMessage;
  finish_reason: string | null;
  logprobs?: unknown;
  reasoning?: string | null;
  reasoning_details?: OpenRouterReasoningDetails;
}

export interface OpenRouterChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenRouterChatCompletionChoice[];
  usage?: OpenRouterUsage;
  system_fingerprint?: string;
}

export interface OpenRouterChatCompletionDelta {
  role?: "assistant";
  content?: string;
  reasoning?: string;
  tool_calls?: OpenRouterToolCall[];
  refusal?: string | null;
}

export interface OpenRouterChatCompletionChunkChoice {
  index: number;
  delta: OpenRouterChatCompletionDelta;
  finish_reason: string | null;
}

export interface OpenRouterChatCompletionStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: OpenRouterChatCompletionChunkChoice[];
  usage?: OpenRouterUsage;
}

export interface OpenRouterAnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export interface OpenRouterMessageRequest {
  model: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string | OpenRouterMessageContentBlock[];
  }>;
  system?: string | OpenRouterMessageContentBlock[];
  max_tokens: number;
  stream?: boolean;
  tools?: OpenRouterAnthropicToolDefinition[];
  tool_choice?: OpenRouterToolChoice | Record<string, unknown>;
  metadata?: Record<string, unknown>;
  reasoning?: OpenRouterReasoningConfig;
  cache_control?: OpenRouterCacheControl;
  provider?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OpenRouterMessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: OpenRouterMessageContentBlock[];
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: OpenRouterUsage;
}

export interface OpenRouterMessageStreamChunk {
  type:
    | "message_start"
    | "content_block_start"
    | "content_block_delta"
    | "content_block_stop"
    | "message_delta"
    | "message_stop"
    | "ping"
    | "error";
  message?: OpenRouterMessageResponse;
  index?: number;
  delta?: Record<string, unknown>;
  usage?: OpenRouterUsage;
  error?: {
    type?: string;
    message: string;
  };
}

export type OpenRouterStreamChunkEnvelope =
  | OpenRouterChatCompletionStreamChunk
  | OpenRouterMessageStreamChunk;

export type OpenRouterEmbeddingInput =
  | string
  | string[]
  | OpenRouterMessageContentBlock[]
  | Array<string | OpenRouterMessageContentBlock[]>;

export interface OpenRouterEmbeddingRequest {
  model: string;
  input: OpenRouterEmbeddingInput;
  dimensions?: number;
  encoding_format?: "float" | "base64";
  user?: string;
  [key: string]: unknown;
}

export interface OpenRouterEmbeddingVector {
  object: "embedding";
  index: number;
  embedding: number[] | string;
}

export interface OpenRouterEmbeddingResponse {
  object: "list";
  data: OpenRouterEmbeddingVector[];
  model: string;
  usage?: OpenRouterUsage;
}

export interface OpenRouterVideoGenerationRequest {
  model: string;
  prompt: string;
  image_url?: string;
  video_url?: string;
  duration_seconds?: number;
  aspect_ratio?: string;
  fps?: number;
  seed?: number;
  webhook_url?: string;
  [key: string]: unknown;
}

export interface OpenRouterVideoJob {
  id: string;
  status: "queued" | "processing" | "completed" | "failed" | string;
  model?: string;
  polling_url?: string;
  created_at?: number | string;
  updated_at?: number | string;
  result?: Record<string, unknown>;
  error?: {
    message: string;
    type?: string;
  } | null;
}

export interface OpenRouterVideoContentDescriptor {
  url?: string;
  mime_type?: string;
  filename?: string;
  size_bytes?: number;
}

export interface OpenRouterModelArchitecture {
  modality?: string;
  tokenizer?: string;
  instruct_type?: string;
  input_modalities?: string[];
  output_modalities?: string[];
}

export interface OpenRouterModelPricing {
  prompt?: string;
  completion?: string;
  image?: string;
  request?: string;
  input_cache_read?: string;
  input_cache_write?: string;
}

export interface OpenRouterModelCapabilityFlags {
  chat?: boolean;
  messages?: boolean;
  streaming?: boolean;
  tool_calling?: boolean;
  reasoning?: boolean;
  prompt_caching?: boolean;
  multimodal_image_input?: boolean;
  multimodal_pdf_input?: boolean;
  audio_io?: boolean;
  video_jobs?: boolean;
  embeddings?: boolean;
}

export interface OpenRouterModelMetadata {
  id: string;
  name?: string;
  canonical_slug?: string;
  description?: string;
  created?: number;
  context_length?: number;
  max_completion_tokens?: number;
  architecture?: OpenRouterModelArchitecture;
  pricing?: OpenRouterModelPricing;
  top_provider?: Record<string, unknown>;
  per_request_limits?: Record<string, unknown>;
  capabilities?: OpenRouterModelCapabilityFlags;
  endpoints?: OpenRouterApiSurface[];
}