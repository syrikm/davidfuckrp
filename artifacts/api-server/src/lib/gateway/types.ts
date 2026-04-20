export type GatewayProtocol = "openai-chat" | "anthropic-messages" | "gemini-generate-content" | "unknown";

export type GatewayRole = "system" | "user" | "assistant" | "tool";

export type GatewayPartType =
  | "text"
  | "image_url"
  | "input_text"
  | "input_image"
  | "tool_call"
  | "tool_result"
  | "thinking"
  | "redacted_thinking"
  | "json";

export type GatewayThinkingDisplay = "summarized" | "omitted";
export type GatewayReasoningDetailFormat =
  | "unknown"
  | "openai-responses-v1"
  | "azure-openai-responses-v1"
  | "xai-responses-v1"
  | "anthropic-claude-v1"
  | "google-gemini-v1";

export interface GatewayTextPart {
  type: "text" | "input_text";
  text: string;
}

export interface GatewayImagePart {
  type: "image_url" | "input_image";
  url: string;
  mediaType?: string;
}

export interface GatewayToolCallPart {
  type: "tool_call";
  id?: string;
  name: string;
  arguments: Record<string, unknown> | unknown[] | string;
}

export interface GatewayToolResultPart {
  type: "tool_result";
  toolCallId?: string;
  name?: string;
  content: string;
  isError?: boolean;
}

export interface GatewayThinkingPart {
  type: "thinking";
  thinking: string;
  signature?: string;
  hidden?: boolean;
  display?: GatewayThinkingDisplay;
  format?: GatewayReasoningDetailFormat;
  id?: string | null;
  index?: number;
}

export interface GatewayRedactedThinkingPart {
  type: "redacted_thinking";
  data: string;
  format?: GatewayReasoningDetailFormat;
  id?: string | null;
  index?: number;
}

export interface GatewayJsonPart {
  type: "json";
  value: Record<string, unknown> | unknown[];
}

export type GatewayPart =
  | GatewayTextPart
  | GatewayImagePart
  | GatewayToolCallPart
  | GatewayToolResultPart
  | GatewayThinkingPart
  | GatewayRedactedThinkingPart
  | GatewayJsonPart;

export interface GatewayMessage {
  role: GatewayRole;
  parts: GatewayPart[];
  name?: string;
  reasoning?: string;
  reasoningDetails?: unknown[];
}

export interface GatewayToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface GatewayResponseFormat {
  type: "text" | "json_object" | "json_schema";
  jsonSchema?: Record<string, unknown>;
  name?: string;
}

export interface GatewayReasoningConfig {
  effort?: string;
  maxTokens?: number;
  exclude?: boolean;
  enabled?: boolean;
  includeReasoning?: boolean;
  display?: GatewayThinkingDisplay;
  interleaved?: boolean;
}

export interface GatewayVerbosityConfig {
  level?: string;
}

export interface GatewayProviderConfig {
  order?: string[];
  allowFallbacks?: boolean;
  sort?: string;
  only?: string[];
  routeLabel?: string;
  source?: string;
  raw?: Record<string, unknown>;
}

export interface GatewayCacheConfig {
  enabled?: boolean;
  ttl?: string;
  mode?: string;
  raw?: Record<string, unknown>;
}

export interface GatewayProviderRoute {
  prefix: string;
  provider: string;
  order?: string[];
  only?: string[];
  allowFallbacks?: boolean;
  source: "model-prefix";
}

export interface GatewayModelResolution {
  raw: string;
  original: string;
  logical: string;
  resolved: string;
  aliasCandidates: string[];
  routeApplied: boolean;
  prefix?: string;
  providerRoute?: GatewayProviderRoute;
  reasoning?: GatewayReasoningConfig;
  verbosity?: GatewayVerbosityConfig;
}

export interface GatewayMetadata {
  protocol: GatewayProtocol;
  endpoint?: string;
  requestId?: string;
  requestedModel?: string;
  resolvedModel?: string;
  providerRoute?: GatewayProviderRoute;
  rawHints: Record<string, unknown>;
}

export interface GatewayRequestIR {
  requestedModel: string;
  model: string;
  modelResolution?: GatewayModelResolution;
  messages: GatewayMessage[];
  tools: GatewayToolDefinition[];
  responseFormat?: GatewayResponseFormat;
  reasoning?: GatewayReasoningConfig;
  verbosity?: GatewayVerbosityConfig;
  provider?: GatewayProviderConfig;
  cache?: GatewayCacheConfig;
  stream: boolean;
  metadata: GatewayMetadata;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  stop?: string[];
  unknownFields: Record<string, unknown>;
}

export interface GatewayDetectResult {
  protocol: GatewayProtocol;
  confidence: number;
  reasons: string[];
}

export interface GatewayNormalizeResult {
  protocol: GatewayProtocol;
  ir: GatewayRequestIR;
}

export interface OpenRouterRequestBuildResult {
  body: Record<string, unknown>;
  summary: {
    requestedModel: string;
    logicalModel?: string;
    resolvedModel: string;
    model: string;
    stream: boolean;
    messageCount: number;
    toolCount: number;
    responseFormatType?: string;
    reasoning?: GatewayReasoningConfig;
    verbosity?: GatewayVerbosityConfig;
    provider?: GatewayProviderConfig;
    providerRoute?: GatewayProviderRoute;
    cache?: GatewayCacheConfig;
    preservedKeys: string[];
  };
}

export interface GatewayBridgeRequest {
  requestedModel: string;
  logicalModel?: string;
  resolvedModel: string;
  providerRoute?: GatewayProviderRoute;
  model: string;
  messages: Array<Record<string, unknown> & { role?: string; content?: unknown }>;
  stream: boolean;
  maxTokens?: number;
  tools?: Record<string, unknown>[];
  toolChoice?: unknown;
  extraParams: Record<string, unknown>;
  protocol: GatewayProtocol;
  originalBody: Record<string, unknown>;
  anthropicVersion?: string;
  anthropicBeta?: string;
  gatewayDebug?: {
    protocol: GatewayProtocol;
    normalizedProtocol: GatewayProtocol;
    target: "openrouter-compatible";
    requestedModel: string;
    logicalModel?: string;
    resolvedModel: string;
    providerRoute?: string;
  };
}

export interface GatewayIRSummary {
  requestedModel: string;
  logicalModel?: string;
  resolvedModel: string;
  model: string;
  stream: boolean;
  messageCount: number;
  toolCount: number;
  roles: GatewayRole[];
  partTypes: GatewayPartType[];
  responseFormatType?: string;
  reasoning?: GatewayReasoningConfig;
  verbosity?: GatewayVerbosityConfig;
  provider?: GatewayProviderConfig;
  providerRoute?: GatewayProviderRoute;
  cache?: GatewayCacheConfig;
  metadata: GatewayMetadata;
}

export type GatewayStreamEventType =
  | "content"
  | "reasoning"
  | "tool"
  | "content_block_start"
  | "content_block_delta"
  | "content_block_stop"
  | "usage"
  | "error"
  | "done";

export interface GatewayStreamBaseEvent {
  type: GatewayStreamEventType;
  index?: number;
  model?: string;
}

export interface GatewayContentEvent extends GatewayStreamBaseEvent {
  type: "content";
  delta: string;
}

export interface GatewayReasoningEvent extends GatewayStreamBaseEvent {
  type: "reasoning";
  delta: string;
}

export interface GatewayToolEvent extends GatewayStreamBaseEvent {
  type: "tool";
  name: string;
  toolCallId?: string;
  arguments?: Record<string, unknown> | unknown[] | string;
  result?: string;
}

export interface GatewayContentBlockStartEvent extends GatewayStreamBaseEvent {
  type: "content_block_start";
  blockType: GatewayPartType;
  blockId?: string;
  name?: string;
  signature?: string;
  hidden?: boolean;
}

export interface GatewayContentBlockDeltaEvent extends GatewayStreamBaseEvent {
  type: "content_block_delta";
  blockType: GatewayPartType;
  deltaType?:
    | "text_delta"
    | "thinking_delta"
    | "input_json_delta"
    | "signature_delta"
    | "reasoning_detail";
  delta: string;
  blockId?: string;
  name?: string;
  signature?: string;
  hidden?: boolean;
}

export interface GatewayContentBlockStopEvent extends GatewayStreamBaseEvent {
  type: "content_block_stop";
  blockType?: GatewayPartType;
  blockId?: string;
  name?: string;
  signature?: string;
  hidden?: boolean;
}

export interface GatewayUsageEvent extends GatewayStreamBaseEvent {
  type: "usage";
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface GatewayErrorEvent extends GatewayStreamBaseEvent {
  type: "error";
  message: string;
  code?: string;
}

export interface GatewayDoneEvent extends GatewayStreamBaseEvent {
  type: "done";
  finishReason?: string;
}

export type GatewayStreamEvent =
  | GatewayContentEvent
  | GatewayReasoningEvent
  | GatewayToolEvent
  | GatewayContentBlockStartEvent
  | GatewayContentBlockDeltaEvent
  | GatewayContentBlockStopEvent
  | GatewayUsageEvent
  | GatewayErrorEvent
  | GatewayDoneEvent;