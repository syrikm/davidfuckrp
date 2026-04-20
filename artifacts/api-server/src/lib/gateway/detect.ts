import type { GatewayDetectResult, GatewayProtocol } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasArray(value: Record<string, unknown>, key: string): boolean {
  return Array.isArray(value[key]);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string" && value[key].length > 0;
}

export function detectGatewayProtocol(body: unknown): GatewayDetectResult {
  if (!isRecord(body)) {
    return {
      protocol: "unknown",
      confidence: 0,
      reasons: ["body is not an object"],
    };
  }

  const reasons: string[] = [];

  if (hasArray(body, "contents")) {
    reasons.push("contains contents array");
    if (hasArray(body, "tools")) reasons.push("contains gemini-style tools");
    if (isRecord(body.generationConfig)) reasons.push("contains generationConfig");
    return {
      protocol: "gemini-generate-content",
      confidence: 0.98,
      reasons,
    };
  }

  if (hasArray(body, "messages")) {
    if (hasString(body, "anthropic_version")) {
      reasons.push("contains messages array");
      reasons.push("contains anthropic_version");
      return {
        protocol: "anthropic-messages",
        confidence: 0.99,
        reasons,
      };
    }

    const messages = body.messages as unknown[];
    const hasAnthropicContentBlocks = messages.some((message) => {
      if (!isRecord(message) || !Array.isArray(message.content)) return false;
      return message.content.some((part) => isRecord(part) && typeof part.type === "string");
    });

    if (hasAnthropicContentBlocks && (body.system !== undefined || hasArray(body, "tools"))) {
      reasons.push("contains messages array");
      reasons.push("contains anthropic-style content blocks");
      return {
        protocol: "anthropic-messages",
        confidence: 0.82,
        reasons,
      };
    }

    reasons.push("contains messages array");
    if (hasString(body, "model")) reasons.push("contains model");
    if (body.response_format !== undefined) reasons.push("contains response_format");
    return {
      protocol: "openai-chat",
      confidence: 0.92,
      reasons,
    };
  }

  return {
    protocol: "unknown",
    confidence: 0.1,
    reasons: ["no known protocol markers detected"],
  };
}

export function isKnownGatewayProtocol(protocol: GatewayProtocol): boolean {
  return protocol !== "unknown";
}