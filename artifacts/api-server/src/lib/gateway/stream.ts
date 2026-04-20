import type { GatewayStreamEvent } from "./types";

export type GatewayStreamFormat = "openai-compatible" | "anthropic-sse";

export interface GatewaySseEvent {
  event?: string;
  id?: string;
  retry?: number;
  data?: string;
  raw: string;
}

interface GatewayToolAccumulator {
  id?: string;
  name?: string;
  argumentsText: string;
  blockType?: "tool_call" | "thinking" | "redacted_thinking" | "text";
  signature?: string;
}

interface GatewayBlockAccumulator {
  type: "text" | "thinking" | "tool_call" | "redacted_thinking";
  id?: string;
  name?: string;
  signature?: string;
  hidden?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseBufferedArguments(value: string): Record<string, unknown> | unknown[] | string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parsed = safeParseJson(trimmed);
  return parsed !== undefined ? parsed as Record<string, unknown> | unknown[] : value;
}

function splitSseBlocks(input: string): { blocks: string[]; tail: string } {
  const blocks: string[] = [];
  let start = 0;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char !== "\n" && char !== "\r") continue;

    let cursor = i;
    if (input[cursor] === "\r" && input[cursor + 1] === "\n") cursor += 2;
    else cursor += 1;

    if (cursor >= input.length) break;

    if (input[cursor] === "\r" && input[cursor + 1] === "\n") {
      blocks.push(input.slice(start, i));
      start = cursor + 2;
      i = cursor + 1;
      continue;
    }

    if (input[cursor] === "\n") {
      blocks.push(input.slice(start, i));
      start = cursor + 1;
      i = cursor;
    }
  }

  return {
    blocks,
    tail: input.slice(start),
  };
}

function parseSseFieldLine(line: string): { field: string; value: string } {
  const separator = line.indexOf(":");
  if (separator === -1) {
    return { field: line, value: "" };
  }

  let value = line.slice(separator + 1);
  if (value.startsWith(" ")) value = value.slice(1);

  return {
    field: line.slice(0, separator),
    value,
  };
}

function parseSseEventBlock(block: string): GatewaySseEvent | null {
  const raw = block.replace(/\r/g, "");
  if (!raw.trim()) return null;

  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (!line) continue;
    if (line.startsWith(":")) continue;

    const { field, value } = parseSseFieldLine(line);

    if (field === "event") {
      event = value;
      continue;
    }
    if (field === "id") {
      id = value;
      continue;
    }
    if (field === "retry") {
      const parsedRetry = Number.parseInt(value, 10);
      if (Number.isFinite(parsedRetry) && parsedRetry >= 0) retry = parsedRetry;
      continue;
    }
    if (field === "data") {
      dataLines.push(value);
    }
  }

  return {
    event,
    id,
    retry,
    data: dataLines.length > 0 ? dataLines.join("\n") : undefined,
    raw,
  };
}

export function decodeGatewaySseChunk(buffer: string, chunk: string, flush = false): { events: GatewaySseEvent[]; buffer: string } {
  const combined = buffer + chunk;
  const split = splitSseBlocks(combined);
  const blocks = flush && split.tail ? [...split.blocks, split.tail] : split.blocks;
  const tail = flush ? "" : split.tail;

  const events = blocks
    .map(parseSseEventBlock)
    .filter((event): event is GatewaySseEvent => !!event);

  return { events, buffer: tail };
}

export function serializeGatewaySseEvent(event: GatewaySseEvent): string {
  const lines: string[] = [];
  if (event.event !== undefined) lines.push(`event: ${event.event}`);
  if (event.id !== undefined) lines.push(`id: ${event.id}`);
  if (typeof event.retry === "number" && Number.isFinite(event.retry)) lines.push(`retry: ${event.retry}`);

  if (event.data !== undefined) {
    const normalized = event.data.replace(/\r/g, "");
    const dataLines = normalized.split("\n");
    if (dataLines.length === 0) lines.push("data:");
    else {
      for (const dataLine of dataLines) {
        lines.push(`data: ${dataLine}`);
      }
    }
  }

  if (lines.length === 0) {
    const normalizedRaw = event.raw.replace(/\r/g, "");
    return normalizedRaw.endsWith("\n\n") ? normalizedRaw : `${normalizedRaw}\n\n`;
  }

  return `${lines.join("\n")}\n\n`;
}

export function createContentEvent(delta: string, index = 0, model?: string): GatewayStreamEvent {
  return { type: "content", delta, index, model };
}

export function createReasoningEvent(delta: string, index = 0, model?: string): GatewayStreamEvent {
  return { type: "reasoning", delta, index, model };
}

export function createContentBlockStartEvent(
  blockType: "text" | "thinking" | "tool_call" | "tool_result" | "redacted_thinking",
  options?: {
    index?: number;
    model?: string;
    blockId?: string;
    name?: string;
    signature?: string;
    hidden?: boolean;
  },
): GatewayStreamEvent {
  return {
    type: "content_block_start",
    blockType,
    index: options?.index,
    model: options?.model,
    blockId: options?.blockId,
    name: options?.name,
    signature: options?.signature,
    hidden: options?.hidden,
  };
}

export function createContentBlockDeltaEvent(
  blockType: "text" | "thinking" | "tool_call" | "tool_result" | "redacted_thinking",
  delta: string,
  options?: {
    index?: number;
    model?: string;
    blockId?: string;
    name?: string;
    deltaType?: "text_delta" | "thinking_delta" | "input_json_delta" | "signature_delta" | "reasoning_detail";
    signature?: string;
    hidden?: boolean;
  },
): GatewayStreamEvent {
  return {
    type: "content_block_delta",
    blockType,
    delta,
    index: options?.index,
    model: options?.model,
    blockId: options?.blockId,
    name: options?.name,
    deltaType: options?.deltaType,
    signature: options?.signature,
    hidden: options?.hidden,
  };
}

export function createContentBlockStopEvent(
  blockType: "text" | "thinking" | "tool_call" | "tool_result" | "redacted_thinking" | undefined,
  options?: {
    index?: number;
    model?: string;
    blockId?: string;
    name?: string;
    signature?: string;
    hidden?: boolean;
  },
): GatewayStreamEvent {
  return {
    type: "content_block_stop",
    blockType,
    index: options?.index,
    model: options?.model,
    blockId: options?.blockId,
    name: options?.name,
    signature: options?.signature,
    hidden: options?.hidden,
  };
}

export function createToolEvent(
  name: string,
  options?: {
    index?: number;
    model?: string;
    toolCallId?: string;
    arguments?: Record<string, unknown> | unknown[] | string;
    result?: string;
  },
): GatewayStreamEvent {
  return {
    type: "tool",
    name,
    index: options?.index,
    model: options?.model,
    toolCallId: options?.toolCallId,
    arguments: options?.arguments,
    result: options?.result,
  };
}

export function createUsageEvent(
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  },
  index = 0,
  model?: string,
): GatewayStreamEvent {
  return {
    type: "usage",
    index,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  };
}

export function createErrorEvent(message: string, code?: string, index = 0, model?: string): GatewayStreamEvent {
  return {
    type: "error",
    message,
    code,
    index,
    model,
  };
}

export function createDoneEvent(finishReason?: string, index = 0, model?: string): GatewayStreamEvent {
  return {
    type: "done",
    finishReason,
    index,
    model,
  };
}

export function serializeGatewayStreamEvent(event: GatewayStreamEvent): string {
  return JSON.stringify(event);
}

export class GatewayStreamEventInspector {
  private readonly openAITools = new Map<string, GatewayToolAccumulator>();
  private readonly anthropicTools = new Map<number, GatewayToolAccumulator>();
  private readonly anthropicBlocks = new Map<number, GatewayBlockAccumulator>();
  private readonly openAIReasoningBlocks = new Set<string>();

  constructor(
    private readonly options: {
      format: GatewayStreamFormat;
      model?: string;
    },
  ) {}

  consumeSseEvent(event: GatewaySseEvent): GatewayStreamEvent[] {
    if (!event.data) return [];

    if (event.data === "[DONE]") {
      return [createDoneEvent(undefined, 0, this.options.model)];
    }

    const payload = safeParseJson(event.data);
    if (!isRecord(payload)) return [];

    if (this.options.format === "anthropic-sse") {
      return this.consumeAnthropicPayload(payload, event.event);
    }

    return this.consumeOpenAICompatiblePayload(payload);
  }

  private consumeOpenAICompatiblePayload(payload: Record<string, unknown>): GatewayStreamEvent[] {
    const emitted: GatewayStreamEvent[] = [];

    if (isRecord(payload.error) && !Array.isArray(payload.choices)) {
      emitted.push(
        createErrorEvent(
          typeof payload.error.message === "string" ? payload.error.message : "Upstream stream error",
          typeof payload.error.type === "string" ? payload.error.type : undefined,
          0,
          this.options.model,
        ),
      );
      return emitted;
    }

    const usage = isRecord(payload.usage) ? payload.usage : undefined;
    if (usage) {
      const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : undefined;
      emitted.push(
        createUsageEvent(
          {
            inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
            outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined,
            cacheReadTokens: typeof promptDetails?.cached_tokens === "number" ? promptDetails.cached_tokens : undefined,
            cacheWriteTokens: typeof promptDetails?.cache_write_tokens === "number" ? promptDetails.cache_write_tokens : undefined,
          },
          0,
          this.options.model,
        ),
      );
    }

    if (!Array.isArray(payload.choices)) return emitted;

    for (const [choiceIndex, choiceValue] of payload.choices.entries()) {
      if (!isRecord(choiceValue)) continue;
      const delta = isRecord(choiceValue.delta) ? choiceValue.delta : {};

      if (typeof delta.content === "string" && delta.content.length > 0) {
        emitted.push(createContentBlockDeltaEvent("text", delta.content, {
          index: choiceIndex,
          model: this.options.model,
          deltaType: "text_delta",
        }));
        emitted.push(createContentEvent(delta.content, choiceIndex, this.options.model));
      }

      const reasoningDelta = typeof delta.reasoning === "string"
        ? delta.reasoning
        : typeof delta.reasoning_content === "string"
          ? delta.reasoning_content
          : typeof delta.reasoning_text === "string"
            ? delta.reasoning_text
            : undefined;

      if (reasoningDelta && reasoningDelta.length > 0) {
        emitted.push(createContentBlockDeltaEvent("thinking", reasoningDelta, {
          index: choiceIndex,
          model: this.options.model,
          deltaType: "thinking_delta",
        }));
        emitted.push(createReasoningEvent(reasoningDelta, choiceIndex, this.options.model));
      }

      if (Array.isArray(delta.reasoning_details)) {
        for (const [detailIndex, detailValue] of delta.reasoning_details.entries()) {
          if (!isRecord(detailValue) || typeof detailValue.type !== "string") continue;
          const detailId = typeof detailValue.id === "string" && detailValue.id
            ? detailValue.id
            : `choice:${choiceIndex}:reasoning:${detailIndex}`;
          const seenKey = `${choiceIndex}:${detailId}`;
          if (!this.openAIReasoningBlocks.has(seenKey)) {
            this.openAIReasoningBlocks.add(seenKey);
            emitted.push(createContentBlockStartEvent(
              detailValue.type === "reasoning.encrypted" ? "redacted_thinking" : "thinking",
              {
                index: choiceIndex,
                model: this.options.model,
                blockId: detailId,
              },
            ));
          }

          if (detailValue.type === "reasoning.encrypted" && typeof detailValue.data === "string") {
            emitted.push(createContentBlockDeltaEvent("redacted_thinking", detailValue.data, {
              index: choiceIndex,
              model: this.options.model,
              blockId: detailId,
              deltaType: "reasoning_detail",
            }));
          }

          if (detailValue.type === "reasoning.summary" && typeof detailValue.summary === "string") {
            emitted.push(createContentBlockDeltaEvent("thinking", detailValue.summary, {
              index: choiceIndex,
              model: this.options.model,
              blockId: detailId,
              deltaType: "reasoning_detail",
            }));
            emitted.push(createReasoningEvent(detailValue.summary, choiceIndex, this.options.model));
          }

          if (detailValue.type === "reasoning.text" && typeof detailValue.text === "string") {
            emitted.push(createContentBlockDeltaEvent("thinking", detailValue.text, {
              index: choiceIndex,
              model: this.options.model,
              blockId: detailId,
              deltaType: "reasoning_detail",
              signature: typeof detailValue.signature === "string" ? detailValue.signature : undefined,
            }));
            emitted.push(createReasoningEvent(detailValue.text, choiceIndex, this.options.model));
          }

          if (typeof choiceValue.finish_reason === "string" && choiceValue.finish_reason.length > 0) {
            emitted.push(createContentBlockStopEvent(
              detailValue.type === "reasoning.encrypted" ? "redacted_thinking" : "thinking",
              {
                index: choiceIndex,
                model: this.options.model,
                blockId: detailId,
                signature: typeof detailValue.signature === "string" ? detailValue.signature : undefined,
              },
            ));
          }
        }
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const [fallbackToolIndex, toolCallValue] of delta.tool_calls.entries()) {
          if (!isRecord(toolCallValue)) continue;
          const toolIndex = typeof toolCallValue.index === "number" ? toolCallValue.index : fallbackToolIndex;
          const toolId = typeof toolCallValue.id === "string" && toolCallValue.id
            ? toolCallValue.id
            : `choice:${choiceIndex}:tool:${toolIndex}`;
          const stateKey = `${choiceIndex}:${toolId}:${toolIndex}`;
          const state = this.openAITools.get(stateKey) ?? { argumentsText: "" };
          const fn = isRecord(toolCallValue.function) ? toolCallValue.function : undefined;

          if (typeof toolCallValue.id === "string" && toolCallValue.id) state.id = toolCallValue.id;
          if (typeof fn?.name === "string" && fn.name) state.name = fn.name;
          if (typeof fn?.arguments === "string") state.argumentsText += fn.arguments;

          this.openAITools.set(stateKey, state);

          emitted.push(createContentBlockStartEvent("tool_call", {
            index: choiceIndex,
            model: this.options.model,
            blockId: state.id,
            name: state.name,
          }));
          if (typeof fn?.arguments === "string" && fn.arguments.length > 0) {
            emitted.push(createContentBlockDeltaEvent("tool_call", fn.arguments, {
              index: choiceIndex,
              model: this.options.model,
              blockId: state.id,
              name: state.name,
              deltaType: "input_json_delta",
            }));
          }
          emitted.push(
            createToolEvent(state.name ?? "tool", {
              index: choiceIndex,
              model: this.options.model,
              toolCallId: state.id,
              arguments: parseBufferedArguments(state.argumentsText),
            }),
          );
          emitted.push(createContentBlockStopEvent("tool_call", {
            index: choiceIndex,
            model: this.options.model,
            blockId: state.id,
            name: state.name,
          }));
        }
      }

      if (typeof choiceValue.finish_reason === "string" && choiceValue.finish_reason.length > 0) {
        for (const seenKey of Array.from(this.openAIReasoningBlocks)) {
          if (!seenKey.startsWith(`${choiceIndex}:`)) continue;
          const blockId = seenKey.slice(seenKey.indexOf(":") + 1);
          emitted.push(createContentBlockStopEvent(undefined, {
            index: choiceIndex,
            model: this.options.model,
            blockId,
          }));
          this.openAIReasoningBlocks.delete(seenKey);
        }
        emitted.push(createDoneEvent(choiceValue.finish_reason, choiceIndex, this.options.model));
      }
    }

    return emitted;
  }

  private consumeAnthropicPayload(payload: Record<string, unknown>, eventName?: string): GatewayStreamEvent[] {
    const emitted: GatewayStreamEvent[] = [];
    const payloadType = typeof payload.type === "string" ? payload.type : eventName;

    if (payloadType === "error") {
      const error = isRecord(payload.error) ? payload.error : payload;
      emitted.push(
        createErrorEvent(
          typeof error.message === "string" ? error.message : "Anthropic stream error",
          typeof error.type === "string" ? error.type : undefined,
          0,
          this.options.model,
        ),
      );
      return emitted;
    }

    if (payloadType === "message_start") {
      const message = isRecord(payload.message) ? payload.message : undefined;
      const usage = isRecord(message?.usage) ? message.usage : undefined;
      if (usage) {
        emitted.push(
          createUsageEvent(
            {
              inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
              outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
              cacheReadTokens: typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : undefined,
              cacheWriteTokens: typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : undefined,
            },
            0,
            this.options.model,
          ),
        );
      }
      return emitted;
    }

    if (payloadType === "content_block_start") {
      const block = isRecord(payload.content_block) ? payload.content_block : undefined;
      const blockIndex = typeof payload.index === "number" ? payload.index : 0;
      if (!block || typeof block.type !== "string") return emitted;

      if (block.type === "text") {
        this.anthropicBlocks.set(blockIndex, { type: "text" });
        emitted.push(createContentBlockStartEvent("text", {
          index: blockIndex,
          model: this.options.model,
        }));
        if (typeof block.text === "string" && block.text.length > 0) {
          emitted.push(createContentBlockDeltaEvent("text", block.text, {
            index: blockIndex,
            model: this.options.model,
            deltaType: "text_delta",
          }));
          emitted.push(createContentEvent(block.text, blockIndex, this.options.model));
        }
      }

      if (block.type === "thinking") {
        const thinking = typeof block.thinking === "string" ? block.thinking : "";
        const hidden = thinking.length === 0;
        this.anthropicBlocks.set(blockIndex, {
          type: "thinking",
          signature: typeof block.signature === "string" ? block.signature : undefined,
          hidden,
        });
        emitted.push(createContentBlockStartEvent("thinking", {
          index: blockIndex,
          model: this.options.model,
          signature: typeof block.signature === "string" ? block.signature : undefined,
          hidden,
        }));
        if (thinking.length > 0) {
          emitted.push(createContentBlockDeltaEvent("thinking", thinking, {
            index: blockIndex,
            model: this.options.model,
            deltaType: "thinking_delta",
            signature: typeof block.signature === "string" ? block.signature : undefined,
          }));
          emitted.push(createReasoningEvent(thinking, blockIndex, this.options.model));
        }
      }

      if (block.type === "redacted_thinking") {
        this.anthropicBlocks.set(blockIndex, { type: "redacted_thinking" });
        emitted.push(createContentBlockStartEvent("redacted_thinking", {
          index: blockIndex,
          model: this.options.model,
        }));
        if (typeof block.data === "string" && block.data.length > 0) {
          emitted.push(createContentBlockDeltaEvent("redacted_thinking", block.data, {
            index: blockIndex,
            model: this.options.model,
            deltaType: "reasoning_detail",
          }));
        }
      }

      if (block.type === "tool_use") {
        const state = this.anthropicTools.get(blockIndex) ?? { argumentsText: "" };
        if (typeof block.id === "string" && block.id) state.id = block.id;
        if (typeof block.name === "string" && block.name) state.name = block.name;
        if (block.input !== undefined) {
          if (typeof block.input === "string") state.argumentsText = block.input;
          else if (isRecord(block.input) && Object.keys(block.input).length > 0) state.argumentsText = JSON.stringify(block.input);
        }
        this.anthropicTools.set(blockIndex, state);
        this.anthropicBlocks.set(blockIndex, {
          type: "tool_call",
          id: state.id,
          name: state.name,
        });
        emitted.push(createContentBlockStartEvent("tool_call", {
          index: blockIndex,
          model: this.options.model,
          blockId: state.id,
          name: state.name,
        }));
        emitted.push(
          createToolEvent(state.name ?? "tool", {
            index: blockIndex,
            model: this.options.model,
            toolCallId: state.id,
            arguments: parseBufferedArguments(state.argumentsText),
          }),
        );
      }

      return emitted;
    }

    if (payloadType === "content_block_delta") {
      const delta = isRecord(payload.delta) ? payload.delta : undefined;
      const blockIndex = typeof payload.index === "number" ? payload.index : 0;
      if (!delta || typeof delta.type !== "string") return emitted;

      if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
        emitted.push(createContentBlockDeltaEvent("text", delta.text, {
          index: blockIndex,
          model: this.options.model,
          deltaType: "text_delta",
        }));
        emitted.push(createContentEvent(delta.text, blockIndex, this.options.model));
      }

      if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking.length > 0) {
        emitted.push(createContentBlockDeltaEvent("thinking", delta.thinking, {
          index: blockIndex,
          model: this.options.model,
          deltaType: "thinking_delta",
        }));
        emitted.push(createReasoningEvent(delta.thinking, blockIndex, this.options.model));
      }

      if (delta.type === "signature_delta" && typeof delta.signature === "string") {
        const blockState = this.anthropicBlocks.get(blockIndex);
        if (blockState) blockState.signature = delta.signature;
        emitted.push(createContentBlockDeltaEvent("thinking", delta.signature, {
          index: blockIndex,
          model: this.options.model,
          deltaType: "signature_delta",
          signature: delta.signature,
        }));
      }

      if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        const state = this.anthropicTools.get(blockIndex) ?? { argumentsText: "" };
        state.argumentsText += delta.partial_json;
        this.anthropicTools.set(blockIndex, state);
        emitted.push(createContentBlockDeltaEvent("tool_call", delta.partial_json, {
          index: blockIndex,
          model: this.options.model,
          blockId: state.id,
          name: state.name,
          deltaType: "input_json_delta",
        }));
        emitted.push(
          createToolEvent(state.name ?? "tool", {
            index: blockIndex,
            model: this.options.model,
            toolCallId: state.id,
            arguments: parseBufferedArguments(state.argumentsText),
          }),
        );
      }

      return emitted;
    }

    if (payloadType === "content_block_stop") {
      const blockIndex = typeof payload.index === "number" ? payload.index : 0;
      const state = this.anthropicTools.get(blockIndex);
      if (state) {
        emitted.push(
          createToolEvent(state.name ?? "tool", {
            index: blockIndex,
            model: this.options.model,
            toolCallId: state.id,
            arguments: parseBufferedArguments(state.argumentsText),
          }),
        );
      }
      const blockState = this.anthropicBlocks.get(blockIndex);
      emitted.push(createContentBlockStopEvent(blockState?.type, {
        index: blockIndex,
        model: this.options.model,
        blockId: blockState?.id,
        name: blockState?.name,
        signature: blockState?.signature,
        hidden: blockState?.hidden,
      }));
      this.anthropicBlocks.delete(blockIndex);
      this.anthropicTools.delete(blockIndex);
      return emitted;
    }

    if (payloadType === "message_delta") {
      const usage = isRecord(payload.usage) ? payload.usage : undefined;
      if (usage) {
        emitted.push(
          createUsageEvent(
            {
              inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : undefined,
              outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : undefined,
              cacheReadTokens: typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : undefined,
              cacheWriteTokens: typeof usage.cache_creation_input_tokens === "number" ? usage.cache_creation_input_tokens : undefined,
            },
            0,
            this.options.model,
          ),
        );
      }

      if (typeof payload.stop_reason === "string" && payload.stop_reason.length > 0) {
        emitted.push(createDoneEvent(payload.stop_reason, 0, this.options.model));
      }
      return emitted;
    }

    if (payloadType === "message_stop") {
      emitted.push(createDoneEvent(undefined, 0, this.options.model));
      return emitted;
    }

    return emitted;
  }
}