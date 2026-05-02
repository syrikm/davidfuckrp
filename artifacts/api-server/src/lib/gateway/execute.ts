import type { Request, Response } from "express";
import type { GatewayBridgeRequest, GatewayDetectResult, GatewayIRSummary } from "./types";
import {
  GatewayStreamEventInspector,
  type GatewaySseEvent,
  type GatewayStreamFormat,
  decodeGatewaySseChunk,
  serializeGatewaySseEvent,
} from "./stream";
import { hashRequest } from "../responseCache";
import {
  buildBackendPool,
  filterBackendPoolByProvider,
  getDynamicBackendsSnapshot,
  loadDynamicBackends,
  type BackendPoolEntry,
} from "../backendPool";

declare const fetch: any;
declare const AbortSignal: any;

class GatewayExecutionError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GatewayExecutionError";
    this.status = status;
  }
}

type FriendBackend = BackendPoolEntry;

type GatewayBridgeMessage = GatewayBridgeRequest["messages"][number];

interface GatewayExecuteOptions {
  req: Request;
  res: Response;
  request: GatewayBridgeRequest;
  debug: {
    detection: GatewayDetectResult;
    irSummary: GatewayIRSummary;
    upstreamSummary: {
      requestedModel?: string;
      logicalModel?: string;
      resolvedModel: string;
      model: string;
      stream: boolean;
      messageCount: number;
      toolCount: number;
      responseFormatType?: string;
      providerRoute?: {
        prefix: string;
        provider: string;
      };
      preservedKeys: string[];
    };
  };
}

interface GatewayStreamRelayStats {
  frames: number;
  contentEvents: number;
  reasoningEvents: number;
  toolEvents: number;
  usageEvents: number;
  errorEvents: number;
  doneEvents: number;
}

interface GatewayStreamRelayResult {
  path: string;
  format: GatewayStreamFormat;
  stats: GatewayStreamRelayStats;
}

const GATEWAY_EXECUTION_TIMEOUTS = {
  upstreamLongPollMs: 3_600_000,
  subNodeJobSubmitMs: 15_000,
  subNodeJobCancelMs: 5_000,
  subNodeStreamWallMs: 270_000,
  liveJobSoftTtlMs: 45 * 60_000,
  liveJobHardTtlMs: 3 * 60 * 60_000,
  liveJobCompletedTtlMs: 6 * 60 * 60_000,
  liveJobGcIntervalMs: 5 * 60_000,
} as const;

const GATEWAY_EXECUTION_DEFAULTS = {
  anthropicRequiredMaxTokens: 128_000,
} as const;

void loadDynamicBackends().catch(() => undefined);

function fnv1aHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function buildCacheFingerprint(model: string, messages: GatewayBridgeMessage[]): string {
  let fp = model;
  const sysText = messages
    .filter((m) => m.role === "system")
    .map((m) => {
      const content = m.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return (content as Array<{ type?: string; text?: string }>)
          .filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("");
      }
      return "";
    })
    .join("");

  if (sysText) fp += `|${sysText.slice(0, 256)}`;
  return fp;
}

function pickBackendForCache(
  fingerprint: string,
  providerSlug?: string,
): { backend: FriendBackend | null; poolSize: number; eligibleSize: number } {
  const pool = buildBackendPool(getDynamicBackendsSnapshot());
  const eligible = providerSlug ? filterBackendPoolByProvider(pool, providerSlug) : pool;
  let best: FriendBackend | null = null;
  let bestScore = -1;

  for (const backend of eligible) {
    const score = fnv1aHash(`${fingerprint}|${backend.url}`);
    if (score > bestScore) {
      best = backend;
      bestScore = score;
    }
  }

  return { backend: best, poolSize: pool.length, eligibleSize: eligible.length };
}

function setSseHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (res.socket) {
    res.socket.setNoDelay(true);
    res.socket.setTimeout(0);
  }
  res.flushHeaders();
}

function writeAndFlush(res: Response, data: string): void {
  res.write(data);
  (res as unknown as { flush?: () => void }).flush?.();
}

function safeWrite(res: Response, data: string): void {
  const responseState = res as Response & { destroyed?: boolean };
  if (res.writableEnded || responseState.destroyed) return;
  writeAndFlush(res, data);
}

function createRelayStats(): GatewayStreamRelayStats {
  return {
    frames: 0,
    contentEvents: 0,
    reasoningEvents: 0,
    toolEvents: 0,
    usageEvents: 0,
    errorEvents: 0,
    doneEvents: 0,
  };
}

function recordRelayEvents(stats: GatewayStreamRelayStats, events: ReturnType<GatewayStreamEventInspector["consumeSseEvent"]>): void {
  for (const event of events) {
    if (event.type === "content") stats.contentEvents++;
    else if (event.type === "reasoning") stats.reasoningEvents++;
    else if (event.type === "tool") stats.toolEvents++;
    else if (event.type === "usage") stats.usageEvents++;
    else if (event.type === "error") stats.errorEvents++;
    else if (event.type === "done") stats.doneEvents++;
  }
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setResponseHeader(res: Response, key: string, value: string): void {
  if (!res.headersSent) res.setHeader(key, value);
}

type GatewayOpenAICompatMessage = GatewayBridgeRequest["messages"][number];
type GatewayOpenAICompatPart = Record<string, unknown> & {
  type?: string;
  text?: string;
  cache_control?: {
    type?: string;
    ttl?: string;
  };
};

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
  messages: GatewayOpenAICompatMessage[];
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
  messages: GatewayOpenAICompatMessage[];
  stable: boolean;
  sunk: boolean;
  lcpResult: LCPSplitResult | null;
  diagnostics: CacheDecisionDiagnostics;
  analysis: LayeredSystemAnalysis;
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
  messages: GatewayOpenAICompatMessage[];
  diagnostics: HistoryBreakpointDiagnostics;
}

interface GatewayOpenAICacheDiagnostics {
  cachePlan: string;
  layeredCache: boolean;
  dynamicSinking: boolean;
  historyBreakpoint: boolean;
  systemCompatFallback: boolean;
  droppedSystemBlockCache: boolean;
  systemTotalLength: number;
  stableLayerLength: number;
  lowFrequencyLayerLength: number;
  dynamicLayerLength: number;
  comparableSystemLength: number;
  lcpEffectiveLength: number;
  firstDivergenceSource: string;
  historyAnchorUserIdx: number;
  historyAnchorMode: "string" | "array" | "none";
  historyAnchorBlockIndex: number;
  historyBridgeMessageCount: number;
  historyApplied: boolean;
  historyAlreadyCached: boolean;
  historyReason: string;
}

interface GatewayPreparedOpenAICompatBody {
  body: Record<string, unknown>;
  cacheDiagnostics: GatewayOpenAICacheDiagnostics;
  semanticFingerprint: string;
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

const systemStabilityCache = new Map<string, string>();
const previousSystemTextCache = new Map<string, string>();

function cloneGatewayOpenAICompatMessages(messages: GatewayBridgeRequest["messages"]): GatewayOpenAICompatMessage[] {
  return messages.map((message) => {
    if (Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map((part) => (
          part && typeof part === "object"
            ? { ...(part as Record<string, unknown>) }
            : part
        )),
      };
    }
    return { ...message };
  });
}

function extractSystemTextFromOpenAICompatMessages(messages: GatewayBridgeRequest["messages"]): string {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => {
      const content = message.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return (content as GatewayOpenAICompatPart[])
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("");
      }
      return "";
    })
    .join("\n");
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

function countUnknownMessagesChars(messages: GatewayOpenAICompatMessage[], start: number, end: number): number {
  let total = 0;
  for (let i = Math.max(0, start); i < Math.min(messages.length, end); i++) {
    total += countUnknownContentChars(messages[i]?.content);
  }
  return total;
}

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

function checkSystemStability(key: string, text: string): boolean {
  const hash = String(fnv1aHash(text));
  const previous = systemStabilityCache.get(key);
  systemStabilityCache.set(key, hash);
  return !!previous && previous === hash;
}

function computeLCPSplit(
  key: string,
  currentText: string,
  analysis?: LayeredSystemAnalysis,
): LCPSplitResult | null {
  const previous = previousSystemTextCache.get(key);
  previousSystemTextCache.set(key, currentText);

  if (!previous || previous === currentText) return null;

  const minLen = Math.min(previous.length, currentText.length);
  let divergeIdx = 0;
  while (divergeIdx < minLen && previous.charCodeAt(divergeIdx) === currentText.charCodeAt(divergeIdx)) {
    divergeIdx++;
  }

  let boundary = currentText.lastIndexOf("\n", divergeIdx);
  if (boundary <= 0) return null;
  boundary += 1;

  if (boundary < 4_000) return null;

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

function applyDynamicSinking(system: string, messages: GatewayOpenAICompatMessage[]): LayeredSinkingResult {
  const analysis = analyzeSystemLayers(system);

  if (!analysis.volatileText.trim()) {
    return { system, messages, sunk: false, analysis };
  }

  const newMessages = cloneGatewayOpenAICompatMessages(messages);
  let lastUserIdx = -1;
  for (let i = newMessages.length - 1; i >= 0; i--) {
    if (newMessages[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  if (lastUserIdx === -1) {
    return { system, messages, sunk: false, analysis };
  }

  const sunkContent = analysis.volatileText.trim();
  const targetMessage = { ...newMessages[lastUserIdx] };
  const content = targetMessage.content;

  if (typeof content === "string") {
    targetMessage.content = `${content}\n\n${sunkContent}`.trim();
  } else if (Array.isArray(content)) {
    targetMessage.content = [
      ...content.map((part) => (
        part && typeof part === "object"
          ? { ...(part as Record<string, unknown>) }
          : part
      )),
      { type: "text", text: sunkContent },
    ];
  } else {
    return { system, messages, sunk: false, analysis };
  }

  newMessages[lastUserIdx] = targetMessage;

  return {
    system: analysis.systemWithoutVolatile,
    messages: newMessages,
    sunk: true,
    analysis,
  };
}

function prepareLayeredSystemCachePlan(
  key: string,
  system: string,
  messages: GatewayOpenAICompatMessage[],
): PreparedLayeredCachePlan {
  const sinkResult = applyDynamicSinking(system, messages);
  const comparableSystem = sinkResult.analysis.comparableSystem;
  const stable = comparableSystem.length > 0 ? checkSystemStability(key, comparableSystem) : false;
  const lcpResult = comparableSystem.length > 0 ? computeLCPSplit(key, comparableSystem, sinkResult.analysis) : null;
  const diagnostics: CacheDecisionDiagnostics = {
    systemTotalLength: sinkResult.analysis.totalLength,
    stableLayerLength: sinkResult.analysis.stableLength,
    lowFrequencyLayerLength: sinkResult.analysis.lowFrequencyLength,
    dynamicLayerLength: sinkResult.analysis.volatileLength,
    comparableSystemLength: comparableSystem.length,
    lcpEffectiveLength: lcpResult?.lcpLength ?? 0,
    firstDivergenceSource: lcpResult?.divergenceSource ?? (sinkResult.analysis.volatileLabels[0] ?? "none"),
    cachePlan: "none",
  };

  return {
    system: sinkResult.system,
    messages: sinkResult.messages,
    stable,
    sunk: sinkResult.sunk,
    lcpResult,
    diagnostics,
    analysis: sinkResult.analysis,
  };
}

/**
 * Minimum character count for a text block to be eligible for cache_control injection
 * on Claude backends (Anthropic direct, Amazon Bedrock, Google Vertex).
 *
 * All three reject cache_control on blocks below the model's minimum cacheable prompt
 * token threshold when extended thinking is active. We apply a conservative char-count
 * proxy (tokens × 3) uniformly to avoid provider 400 errors.
 *
 * Thresholds per OR docs:
 *   4096 tokens → Claude Opus 4.5+, Claude Haiku 4.5+
 *   2048 tokens → Claude Sonnet 4.6+, Claude Haiku 3.5
 *   1024 tokens → Claude Sonnet 4/4.5, Claude Opus 4/4.1, Claude Sonnet 3.7
 */
function getMinCacheCharsForClaudeBackend(model: string): number {
  const bare = model
    .replace(/^(anthropic|bedrock|vertex|azure|aistudio)\//, "")
    .replace(/-thinking-visible$/, "")
    .replace(/-thinking$/, "")
    .replace(/-max$/, "");
  if (
    /^claude-opus-(4\.[5-9]|4-[5-9]|[5-9])/.test(bare) ||
    /^claude-haiku-[4-9]/.test(bare)
  ) return 12288;
  if (
    /^claude-sonnet-(4\.[6-9]|4-[6-9])/.test(bare) ||
    /^claude-haiku-3\.5/.test(bare) || /^claude-haiku-3-5/.test(bare)
  ) return 6144;
  return 3072;
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
    const block = content[i] as GatewayOpenAICompatPart | null | undefined;
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

function injectHistoryBreakpoint(messages: GatewayOpenAICompatMessage[], model?: string): HistoryBreakpointResult {
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

  if (!messages || messages.length < 3) {
    return { messages, diagnostics: { ...baseDiagnostics, reason: "too_short" } };
  }

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx <= 0) {
    return { messages, diagnostics: { ...baseDiagnostics, lastUserIdx, reason: "no_final_user" } };
  }

  let anchorUserIdx = -1;
  let anchorProbe: HistoryCacheProbeResult = { mode: "none", blockIndex: -1, cacheable: false, alreadyCached: false };
  for (let i = lastUserIdx - 1; i >= 0; i--) {
    if (messages[i]?.role !== "user") continue;
    const probe = probeHistoryCacheAnchor(messages[i]?.content);
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
    prefixApproxChars: anchorUserIdx >= 0 ? countUnknownMessagesChars(messages, 0, anchorUserIdx + 1) : 0,
    bridgeApproxChars: anchorUserIdx >= 0 ? countUnknownMessagesChars(messages, anchorUserIdx + 1, lastUserIdx) : 0,
    reason: "no_cacheable_anchor",
  };

  if (anchorUserIdx < 0) {
    return { messages, diagnostics };
  }

  const newMessages = cloneGatewayOpenAICompatMessages(messages);
  const anchorMessage = { ...newMessages[anchorUserIdx] };

  // Guard: all Claude providers (Anthropic direct, Bedrock, Vertex) reject cache_control
  // on text blocks shorter than the model's minimum cacheable prompt length when extended
  // thinking is active. Apply the conservative char-count check before injecting.
  const isAnyClaude = model ? /^(anthropic|bedrock|vertex)\/claude-|claude-/.test(model.toLowerCase()) : false;
  const minChars = (isAnyClaude && model) ? getMinCacheCharsForClaudeBackend(model) : 0;

  if (anchorProbe.mode === "string" && typeof anchorMessage.content === "string" && anchorMessage.content.length > 0) {
    if (minChars > 0 && anchorMessage.content.length < minChars) {
      return { messages, diagnostics: { ...diagnostics, reason: "anchor_not_mutated" } };
    }
    anchorMessage.content = [{
      type: "text",
      text: anchorMessage.content,
      cache_control: { type: "ephemeral", ttl: "1h" },
    }];
    newMessages[anchorUserIdx] = anchorMessage;
    return {
      messages: newMessages,
      diagnostics: { ...diagnostics, applied: true, reason: "wrapped_string_user_anchor" },
    };
  }

  if (anchorProbe.mode === "array" && Array.isArray(anchorMessage.content) && anchorProbe.blockIndex >= 0) {
    const content = anchorMessage.content.map((part) => (
      part && typeof part === "object"
        ? { ...(part as Record<string, unknown>) }
        : part
    )) as GatewayOpenAICompatPart[];
    const targetBlock = content[anchorProbe.blockIndex];
    if (targetBlock?.cache_control) {
      return {
        messages,
        diagnostics: { ...diagnostics, reason: "already_cached_anchor" },
      };
    }
    // Per-block length guard: ensure the specific injected block meets the minChar threshold.
    // Cumulative length can be inflated by other parts (e.g. images); recheck individually.
    if (minChars > 0) {
      const blockText = typeof (targetBlock as { text?: string })?.text === "string"
        ? (targetBlock as { text: string }).text
        : "";
      if (blockText.length < minChars) {
        return { messages, diagnostics: { ...diagnostics, reason: "anchor_not_mutated" } };
      }
    }
    content[anchorProbe.blockIndex] = {
      ...targetBlock,
      cache_control: { type: "ephemeral", ttl: "1h" },
    };
    anchorMessage.content = content;
    newMessages[anchorUserIdx] = anchorMessage;
    return {
      messages: newMessages,
      diagnostics: {
        ...diagnostics,
        applied: true,
        reason: targetBlock?.type === "tool_result" ? "tool_result_anchor" : "text_block_anchor",
      },
    };
  }

  return { messages, diagnostics: { ...diagnostics, reason: "anchor_not_mutated" } };
}

function flattenOpenAICompatSystemContent(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);

  return content.map((part) => {
    if (part && typeof part === "object" && (part as GatewayOpenAICompatPart).type === "text") {
      return ((part as GatewayOpenAICompatPart).text ?? "");
    }
    try {
      return JSON.stringify(part);
    } catch {
      return String(part);
    }
  }).join("");
}

function normalizeOpenAICompatSystemMessages(messages: GatewayOpenAICompatMessage[]): {
  messages: GatewayOpenAICompatMessage[];
  flattenedSystemArray: boolean;
  droppedSystemBlockCache: boolean;
} {
  let flattenedSystemArray = false;
  let droppedSystemBlockCache = false;

  const normalized = messages.map((message) => {
    if (message.role !== "system" || !Array.isArray(message.content)) return message;

    flattenedSystemArray = true;
    if ((message.content as GatewayOpenAICompatPart[]).some((part) => !!part?.cache_control)) {
      droppedSystemBlockCache = true;
    }

    return {
      ...message,
      content: flattenOpenAICompatSystemContent(message.content),
    };
  });

  return { messages: normalized, flattenedSystemArray, droppedSystemBlockCache };
}

function consolidateSystemMessages(
  messages: GatewayOpenAICompatMessage[],
  systemContent: string | GatewayOpenAICompatPart[],
): GatewayOpenAICompatMessage[] {
  const consolidated: GatewayOpenAICompatMessage[] = [];
  let foundFirst = false;

  for (const message of messages) {
    if (message.role === "system") {
      if (!foundFirst) {
        consolidated.push({ ...message, content: systemContent });
        foundFirst = true;
      }
      continue;
    }
    consolidated.push(message);
  }

  return foundFirst ? consolidated : messages;
}

function buildOpenAICompatBody(request: GatewayBridgeRequest): GatewayPreparedOpenAICompatBody {
  let finalMessages = cloneGatewayOpenAICompatMessages(request.messages);
  const extraParams: Record<string, unknown> = { ...request.extraParams };
  const diagnostics: GatewayOpenAICacheDiagnostics = {
    cachePlan: "",
    layeredCache: false,
    dynamicSinking: false,
    historyBreakpoint: false,
    systemCompatFallback: false,
    droppedSystemBlockCache: false,
    systemTotalLength: 0,
    stableLayerLength: 0,
    lowFrequencyLayerLength: 0,
    dynamicLayerLength: 0,
    comparableSystemLength: 0,
    lcpEffectiveLength: 0,
    firstDivergenceSource: "none",
    historyAnchorUserIdx: -1,
    historyAnchorMode: "none",
    historyAnchorBlockIndex: -1,
    historyBridgeMessageCount: 0,
    historyApplied: false,
    historyAlreadyCached: false,
    historyReason: "not_run",
  };

  const providerPreference = extraParams.provider as { order?: string[]; only?: string[] } | undefined;
  const isBedrockRouted = !!(
    providerPreference?.order?.some((provider) => provider.toLowerCase().includes("bedrock")) ||
    providerPreference?.only?.some((provider) => provider.toLowerCase().includes("bedrock"))
  );
  const isClaudeModel = request.model.toLowerCase().includes("claude");

  if (isClaudeModel && !extraParams.cache_control) {
    const systemText = extractSystemTextFromOpenAICompatMessages(finalMessages);
    if (systemText) {
      const stableKey = `gateway-oai|${request.protocol}|${request.model}|${systemText.slice(0, 256)}`;
      const prepared = prepareLayeredSystemCachePlan(stableKey, systemText, finalMessages);
      diagnostics.systemTotalLength = prepared.diagnostics.systemTotalLength;
      diagnostics.stableLayerLength = prepared.diagnostics.stableLayerLength;
      diagnostics.lowFrequencyLayerLength = prepared.diagnostics.lowFrequencyLayerLength;
      diagnostics.dynamicLayerLength = prepared.diagnostics.dynamicLayerLength;
      diagnostics.comparableSystemLength = prepared.diagnostics.comparableSystemLength;
      diagnostics.lcpEffectiveLength = prepared.diagnostics.lcpEffectiveLength;
      diagnostics.firstDivergenceSource = prepared.diagnostics.firstDivergenceSource;
      diagnostics.layeredCache = prepared.stable || !!prepared.lcpResult;
      diagnostics.dynamicSinking = prepared.sunk;

      finalMessages = prepared.messages;

      if (prepared.stable) {
        if (!isBedrockRouted) {
          extraParams.cache_control = { type: "ephemeral", ttl: "1h" };
          diagnostics.cachePlan = "T1";
        }
        finalMessages = consolidateSystemMessages(finalMessages, prepared.system);
      } else if (prepared.lcpResult) {
        finalMessages = consolidateSystemMessages(finalMessages, [
          { type: "text", text: prepared.lcpResult.stable, cache_control: { type: "ephemeral", ttl: "1h" } },
          { type: "text", text: prepared.lcpResult.dynamic },
        ]);
        diagnostics.cachePlan = "T2";
      } else if (prepared.analysis.volatileLength > 0) {
        finalMessages = consolidateSystemMessages(finalMessages, prepared.system);
      }

      const historyResult = injectHistoryBreakpoint(finalMessages, request.model);
      finalMessages = historyResult.messages;
      diagnostics.historyBreakpoint = historyResult.diagnostics.applied || historyResult.diagnostics.alreadyCached;
      diagnostics.historyAnchorUserIdx = historyResult.diagnostics.anchorUserIdx;
      diagnostics.historyAnchorMode = historyResult.diagnostics.anchorMode;
      diagnostics.historyAnchorBlockIndex = historyResult.diagnostics.anchorBlockIndex;
      diagnostics.historyBridgeMessageCount = historyResult.diagnostics.bridgeMessageCount;
      diagnostics.historyApplied = historyResult.diagnostics.applied;
      diagnostics.historyAlreadyCached = historyResult.diagnostics.alreadyCached;
      diagnostics.historyReason = historyResult.diagnostics.reason;

      if (diagnostics.historyBreakpoint) {
        diagnostics.cachePlan = diagnostics.cachePlan ? `${diagnostics.cachePlan}+P2` : "P2";
      }

      const normalizedSystem = normalizeOpenAICompatSystemMessages(finalMessages);
      finalMessages = normalizedSystem.messages;
      diagnostics.systemCompatFallback = normalizedSystem.flattenedSystemArray;
      diagnostics.droppedSystemBlockCache = normalizedSystem.droppedSystemBlockCache;

      if (normalizedSystem.droppedSystemBlockCache) {
        if (diagnostics.cachePlan === "T2") diagnostics.cachePlan = "";
        else if (diagnostics.cachePlan.startsWith("T2+")) diagnostics.cachePlan = diagnostics.cachePlan.slice(3);
      }
    }
  }

  const body: Record<string, unknown> = {
    ...extraParams,
    model: request.model,
    messages: finalMessages,
    stream: request.stream,
    ...(typeof request.maxTokens === "number" ? { max_tokens: request.maxTokens } : {}),
    ...(request.tools?.length ? { tools: request.tools } : {}),
    ...(request.toolChoice !== undefined ? { tool_choice: request.toolChoice } : {}),
  };

  const semanticFingerprint = String(hashRequest({
    protocol: request.protocol,
    target: "openrouter-compatible",
    model: request.model,
    stream: request.stream,
    max_tokens: typeof request.maxTokens === "number" ? request.maxTokens : undefined,
    messages: finalMessages,
    tools: request.tools ?? undefined,
    tool_choice: request.toolChoice ?? undefined,
    extra: extraParams,
  }));

  return {
    body,
    cacheDiagnostics: diagnostics,
    semanticFingerprint,
  };
}

function toAnthropicBody(request: GatewayBridgeRequest): Record<string, unknown> {
  const systemBlocks: Record<string, unknown>[] = [];
  const messages: Record<string, unknown>[] = [];

  for (const message of request.messages) {
    if (message.role === "system") {
      const content = message.content;
      if (typeof content === "string") {
        if (content) systemBlocks.push({ type: "text", text: content });
      } else if (Array.isArray(content)) {
        const text = (content as Array<{ type?: string; text?: string }>)
          .map((part) => {
            if (part.type === "text") return part.text ?? "";
            return JSON.stringify(part);
          })
          .join("");
        if (text) systemBlocks.push({ type: "text", text });
      }
      continue;
    }

    messages.push({
      role: message.role === "tool" ? "user" : message.role,
      content: message.content,
    });
  }

  const body: Record<string, unknown> = {
    ...request.extraParams,
    model: request.model,
    messages,
    stream: request.stream,
    max_tokens: request.maxTokens ?? GATEWAY_EXECUTION_DEFAULTS.anthropicRequiredMaxTokens,
    anthropic_version: request.anthropicVersion ?? "2023-06-01",
  };

  if (systemBlocks.length === 1) body.system = systemBlocks[0].text;
  else if (systemBlocks.length > 1) body.system = systemBlocks;

  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => {
      const fn = tool.function as Record<string, unknown> | undefined;
      return {
        name: typeof fn?.name === "string" ? fn.name : "tool",
        description: typeof fn?.description === "string" ? fn.description : "",
        input_schema: (fn?.parameters as Record<string, unknown> | undefined) ?? { type: "object", properties: {} },
      };
    });
  }

  if (request.anthropicBeta) body.anthropic_beta = request.anthropicBeta;
  return body;
}

async function pipeJsonResponse(fetchRes: any, res: Response): Promise<void> {
  const json = await fetchRes.json();
  res.status(fetchRes.status).json(json);
}

async function relayGatewaySseBody(
  body: any,
  res: Response,
  inspector: GatewayStreamEventInspector,
  stats: GatewayStreamRelayStats,
  onFrame?: (frame: GatewaySseEvent) => void,
): Promise<boolean> {
  if (!body) return false;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawTerminalDone = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      const chunkText = decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const decoded = decodeGatewaySseChunk(buffer, chunkText, done);
      buffer = decoded.buffer;

      for (const frame of decoded.events) {
        stats.frames++;
        onFrame?.(frame);
        const events = inspector.consumeSseEvent(frame);
        recordRelayEvents(stats, events);
        safeWrite(res, serializeGatewaySseEvent(frame));
        if (frame.data === "[DONE]") {
          sawTerminalDone = true;
          return true;
        }
      }

      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }

  if (!sawTerminalDone) {
    safeWrite(res, "data: [DONE]\n\n");
    stats.frames++;
    recordRelayEvents(stats, inspector.consumeSseEvent({ data: "[DONE]", raw: "data: [DONE]" }));
    return true;
  }

  return false;
}

async function pipeGatewayParsedSseResponse(options: {
  req: Request;
  res: Response;
  fetchRes: any;
  path: string;
  format: GatewayStreamFormat;
  model: string;
}): Promise<GatewayStreamRelayResult> {
  const { req, res, fetchRes, path, format, model } = options;
  const inspector = new GatewayStreamEventInspector({ format, model });
  const stats = createRelayStats();

  setResponseHeader(res, "X-Gateway-SSE-Canonical", "true");
  setSseHeaders(res);
  await relayGatewaySseBody(fetchRes.body, res, inspector, stats);

  if (!res.writableEnded) res.end();

  req.log.info({
    gatewayStreamPath: path,
    gatewayStreamFormat: format,
    gatewayStreamStats: stats,
    resolvedModel: model,
  }, "Unified gateway parsed stream completed");

  return { path, format, stats };
}

function shortFingerprint(value: string): string {
  return value.slice(0, 16);
}

function setGatewayOpenAICacheHeaders(res: Response, diagnostics: GatewayOpenAICacheDiagnostics): void {
  setResponseHeader(res, "X-Gateway-Cache-Plan", diagnostics.cachePlan || "none");
  setResponseHeader(res, "X-Gateway-Layered-Cache", diagnostics.layeredCache ? "applied" : "none");
  setResponseHeader(
    res,
    "X-Gateway-History-Breakpoint",
    diagnostics.historyBreakpoint
      ? (diagnostics.historyApplied ? "applied" : "existing")
      : "none",
  );
  setResponseHeader(res, "X-Gateway-Dynamic-Sinking", diagnostics.dynamicSinking ? "applied" : "none");
  setResponseHeader(
    res,
    "X-Gateway-System-Compat",
    diagnostics.systemCompatFallback ? "flattened" : "native",
  );
}

interface GatewayLiveJobEntry {
  fingerprint: string;
  jobId: string;
  backendLabel: string;
  backendUrl: string;
  apiKey: string;
  protocol: GatewayBridgeRequest["protocol"];
  model: string;
  streamFormat: GatewayStreamFormat;
  createdAt: number;
  lastAccessAt: number;
  expiresAt: number;
  resumeUntil: number;
  completedAt?: number;
  attachCount: number;
  status: "running" | "completed" | "failed";
  lastDisconnectReason?: string;
  semanticFingerprint: string;
  taskResumeCapable: boolean;
  thinkingState: "unknown" | "preserved" | "not_preserved";
}

interface GatewayLiveJobAcquireResult {
  fingerprint: string;
  entry: GatewayLiveJobEntry;
  reused: boolean;
}

const LIVE_GATEWAY_JOB_SOFT_TTL_MS = GATEWAY_EXECUTION_TIMEOUTS.liveJobSoftTtlMs;
const LIVE_GATEWAY_JOB_HARD_TTL_MS = GATEWAY_EXECUTION_TIMEOUTS.liveJobHardTtlMs;
const LIVE_GATEWAY_JOB_COMPLETED_TTL_MS = GATEWAY_EXECUTION_TIMEOUTS.liveJobCompletedTtlMs;
const liveGatewayJobs = new Map<string, GatewayLiveJobEntry>();
const liveGatewayJobCreates = new Map<string, Promise<GatewayLiveJobAcquireResult | null>>();

function buildGatewayLiveJobFingerprint(
  backend: FriendBackend,
  request: GatewayBridgeRequest,
  semanticFingerprint: string,
): string {
  return String(hashRequest({
    gatewayTarget: "openrouter-compatible",
    backend: backend.url,
    protocol: request.protocol,
    stream: request.stream,
    model: request.model,
    semanticFingerprint,
  }));
}

function getGatewayLiveJob(fingerprint: string): GatewayLiveJobEntry | null {
  const entry = liveGatewayJobs.get(fingerprint);
  if (!entry) return null;
  const now = Date.now();
  if (now > entry.expiresAt) {
    liveGatewayJobs.delete(fingerprint);
    return null;
  }
  return entry;
}

function invalidateGatewayLiveJob(fingerprint: string, jobId?: string): void {
  const current = liveGatewayJobs.get(fingerprint);
  if (!current) return;
  if (jobId && current.jobId !== jobId) return;
  liveGatewayJobs.delete(fingerprint);
}

function touchGatewayLiveJob(entry: GatewayLiveJobEntry): void {
  const now = Date.now();
  entry.lastAccessAt = now;
  entry.attachCount += 1;
  entry.resumeUntil = now + LIVE_GATEWAY_JOB_SOFT_TTL_MS;
  entry.expiresAt = Math.max(entry.expiresAt, now + (entry.status === "running" ? LIVE_GATEWAY_JOB_HARD_TTL_MS : LIVE_GATEWAY_JOB_COMPLETED_TTL_MS));
}

async function submitGatewayStreamJob(
  req: Request,
  backend: FriendBackend,
  request: GatewayBridgeRequest,
  body: Record<string, unknown>,
): Promise<string | null> {
  let submitRes: any;
  try {
    submitRes = await fetch(`${backend.url}/v1/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${backend.apiKey}`,
        "Content-Type": "application/json",
        "X-Gateway-Protocol": request.protocol,
        "X-Gateway-Target": "openrouter-compatible",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GATEWAY_EXECUTION_TIMEOUTS.subNodeJobSubmitMs),
    });
  } catch (error) {
    req.log.warn({
      backend: backend.label,
      err: error instanceof Error ? error.message : String(error),
    }, "Unified gateway job submit failed, falling back to direct stream");
    return null;
  }

  if (!submitRes.ok) {
    req.log.info({
      backend: backend.label,
      status: submitRes.status,
    }, "Unified gateway job API unavailable, falling back to direct stream");
    return null;
  }

  try {
    const submitJson = await submitRes.json() as { job_id?: string };
    return submitJson.job_id ?? null;
  } catch {
    return null;
  }
}

async function acquireGatewayLiveJob(options: {
  req: Request;
  backend: FriendBackend;
  request: GatewayBridgeRequest;
  body: Record<string, unknown>;
  semanticFingerprint: string;
  forceNew?: boolean;
}): Promise<GatewayLiveJobAcquireResult | null> {
  const { req, backend, request, body, semanticFingerprint, forceNew = false } = options;
  const fingerprint = buildGatewayLiveJobFingerprint(backend, request, semanticFingerprint);

  if (!forceNew) {
    const existing = getGatewayLiveJob(fingerprint);
    if (existing) {
      touchGatewayLiveJob(existing);
      return { fingerprint, entry: existing, reused: true };
    }

    const inflight = liveGatewayJobCreates.get(fingerprint);
    if (inflight) {
      const acquired = await inflight;
      if (acquired?.entry) touchGatewayLiveJob(acquired.entry);
      return acquired ? { ...acquired, reused: true } : null;
    }
  }

  const createPromise = (async (): Promise<GatewayLiveJobAcquireResult | null> => {
    const jobId = await submitGatewayStreamJob(req, backend, request, body);
    if (!jobId) return null;

    const now = Date.now();
    const extraParams = body as Record<string, unknown>;
    const requestMessages = Array.isArray(extraParams.messages) ? extraParams.messages as Array<Record<string, unknown>> : [];
    const hasReasoningDetails = requestMessages.some((message) => Array.isArray(message.reasoning_details) && message.reasoning_details.length > 0);
    const hasReasoningString = requestMessages.some((message) => typeof message.reasoning === "string" || typeof message.reasoning_content === "string");

    const entry: GatewayLiveJobEntry = {
      fingerprint,
      jobId,
      backendLabel: backend.label,
      backendUrl: backend.url,
      apiKey: backend.apiKey,
      protocol: request.protocol,
      model: request.model,
      streamFormat: "openai-compatible",
      createdAt: now,
      lastAccessAt: now,
      expiresAt: now + LIVE_GATEWAY_JOB_HARD_TTL_MS,
      resumeUntil: now + LIVE_GATEWAY_JOB_SOFT_TTL_MS,
      attachCount: 1,
      status: "running",
      semanticFingerprint,
      taskResumeCapable: true,
      thinkingState: hasReasoningDetails || hasReasoningString ? "preserved" : "unknown",
    };
    liveGatewayJobs.set(fingerprint, entry);

    return {
      fingerprint,
      entry,
      reused: false,
    };
  })();

  if (!forceNew) liveGatewayJobCreates.set(fingerprint, createPromise);

  try {
    return await createPromise;
  } finally {
    if (!forceNew) liveGatewayJobCreates.delete(fingerprint);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [fingerprint, entry] of liveGatewayJobs.entries()) {
    if (now <= entry.expiresAt) continue;
    liveGatewayJobs.delete(fingerprint);
    if (entry.status === "running") {
      void cancelGatewayJob({
        kind: "friend",
        label: entry.backendLabel,
        url: entry.backendUrl,
        apiKey: entry.apiKey,
        publicBaseUrl: entry.backendUrl.replace(/\/api$/i, ""),
        apiBaseUrl: entry.backendUrl,
        source: "register",
      }, entry.jobId);
    }
  }
}, GATEWAY_EXECUTION_TIMEOUTS.liveJobGcIntervalMs).unref();

async function cancelGatewayJob(backend: FriendBackend, jobId: string): Promise<void> {
  await fetch(`${backend.url}/v1/jobs/${jobId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${backend.apiKey}` },
    signal: AbortSignal.timeout(GATEWAY_EXECUTION_TIMEOUTS.subNodeJobCancelMs),
  }).catch(() => undefined);
}

async function tryStreamOpenAICompatViaJobApi(options: {
  req: Request;
  res: Response;
  request: GatewayBridgeRequest;
  backend: FriendBackend;
  prepared: GatewayPreparedOpenAICompatBody;
}): Promise<GatewayStreamRelayResult | null> {
  const { req, res, request, backend, prepared } = options;

  let acquired = await acquireGatewayLiveJob({
    req,
    backend,
    request,
    body: prepared.body,
    semanticFingerprint: prepared.semanticFingerprint,
  });
  if (!acquired) return null;

  let jobId = acquired.entry.jobId;
  let liveJobFingerprint = acquired.fingerprint;
  let liveJobMode: "attach" | "create" = acquired.reused ? "attach" : "create";
  let streamPath = acquired.reused ? "subnode-job-live-reattach" : "subnode-job-resumable";
  let retriedFreshAfterStaleAttach = false;

  const applyStreamHeaders = (): void => {
    const currentEntry = acquired?.entry;
    setResponseHeader(res, "X-Gateway-Stream-Path", streamPath);
    setResponseHeader(res, "X-Gateway-Stream-Format", "openai-compatible");
    setResponseHeader(res, "X-Gateway-Stream-Parsed", "normalized");
    setResponseHeader(res, "X-Gateway-Stream-Resumable", "job-api");
    setResponseHeader(res, "X-Gateway-Job-Id", jobId);
    setResponseHeader(res, "X-Gateway-Live-Job", liveJobMode);
    setResponseHeader(res, "X-Gateway-Live-Job-Reused", liveJobMode === "attach" ? "hit" : "miss");
    setResponseHeader(res, "X-Gateway-Live-Job-Fingerprint", shortFingerprint(liveJobFingerprint));
    setResponseHeader(res, "X-Gateway-Direct-Fallback", "none");
    setResponseHeader(res, "X-Gateway-Task-Resume", currentEntry?.taskResumeCapable ? "available" : "unavailable");
    setResponseHeader(res, "X-Gateway-Task-Resume-Until", String(currentEntry?.resumeUntil ?? 0));
    setResponseHeader(res, "X-Gateway-Live-Job-Expires-At", String(currentEntry?.expiresAt ?? 0));
    setResponseHeader(res, "X-Gateway-Thinking-Preserved", currentEntry?.thinkingState ?? "unknown");
    setResponseHeader(res, "X-Gateway-Resume-Path", liveJobMode === "attach" ? "reattach" : "fresh");
  };
  applyStreamHeaders();

  req.log.info({
    backend: backend.label,
    jobId,
    gatewayLiveJobMode: liveJobMode,
    gatewayLiveJobFingerprint: shortFingerprint(liveJobFingerprint),
    gatewaySemanticFingerprint: shortFingerprint(prepared.semanticFingerprint),
  }, "Unified gateway stream job acquired");

  const inspector = new GatewayStreamEventInspector({ format: "openai-compatible", model: request.model });
  const stats = createRelayStats();
  let lastEventId: string | undefined;
  let streamDone = false;
  let headersFlushed = false;
  let reconnectFailures = 0;

  const clientAbort = new AbortController();
  const onClientClose = (): void => {
    if (!res.writableEnded && !clientAbort.signal.aborted) {
      clientAbort.abort("client_disconnected");
    }
  };
  res.on("close", onClientClose);

  try {
    while (!streamDone && !clientAbort.signal.aborted) {
      const connAbort = new AbortController();
      const propagateAbort = (): void => {
        if (!connAbort.signal.aborted) {
          connAbort.abort((clientAbort.signal as { reason?: unknown }).reason ?? "client_disconnected");
        }
      };

      clientAbort.signal.addEventListener("abort", propagateAbort, { once: true });
      const wallTimer = setTimeout(() => {
        if (!connAbort.signal.aborted) connAbort.abort("job_stream_wall");
      }, GATEWAY_EXECUTION_TIMEOUTS.subNodeStreamWallMs);

      let connectionEnded = false;

      try {
        const streamHeaders: Record<string, string> = {
          Authorization: `Bearer ${backend.apiKey}`,
        };
        if (lastEventId) streamHeaders["Last-Event-ID"] = lastEventId;

        const streamRes = await fetch(`${backend.url}/v1/jobs/${jobId}/stream`, {
          headers: streamHeaders,
          signal: connAbort.signal,
        });

        if (!streamRes.ok) {
          if (!headersFlushed) {
            if (liveJobMode === "attach" && !retriedFreshAfterStaleAttach) {
              req.log.warn({
                backend: backend.label,
                status: streamRes.status,
                staleJobId: jobId,
                gatewayLiveJobFingerprint: shortFingerprint(liveJobFingerprint),
              }, "Unified gateway stale live job attach failed before first chunk, creating a fresh job");
              invalidateGatewayLiveJob(liveJobFingerprint, jobId);

              const fresh = await acquireGatewayLiveJob({
                req,
                backend,
                request,
                body: prepared.body,
                semanticFingerprint: prepared.semanticFingerprint,
                forceNew: true,
              });
              if (!fresh) return null;

              acquired = fresh;
              jobId = fresh.entry.jobId;
              liveJobFingerprint = fresh.fingerprint;
              liveJobMode = "create";
              streamPath = "subnode-job-resumable";
              lastEventId = undefined;
              reconnectFailures = 0;
              retriedFreshAfterStaleAttach = true;
              applyStreamHeaders();
              continue;
            }

            if (liveJobMode === "create") {
              invalidateGatewayLiveJob(liveJobFingerprint, jobId);
              await cancelGatewayJob(backend, jobId);
            }

            req.log.info({
              backend: backend.label,
              status: streamRes.status,
              jobId,
              gatewayLiveJobMode: liveJobMode,
            }, "Unified gateway job stream unavailable before first chunk, falling back");
            return null;
          }

          reconnectFailures++;
          if (reconnectFailures > 5) {
            invalidateGatewayLiveJob(liveJobFingerprint, jobId);
            safeWrite(res, `data: ${JSON.stringify({ error: { message: `Unified gateway job stream error ${streamRes.status}`, type: "upstream_error" } })}\n\n`);
            safeWrite(res, "data: [DONE]\n\n");
            streamDone = true;
            break;
          }

          await waitFor(500);
          continue;
        }

        if (!headersFlushed) {
          setSseHeaders(res);
          headersFlushed = true;
        }

        const completed = await relayGatewaySseBody(streamRes.body, res, inspector, stats, (frame) => {
          if (frame.id) lastEventId = frame.id;
        });

        streamDone = completed;
        connectionEnded = true;
        reconnectFailures = 0;

        if (completed) {
          invalidateGatewayLiveJob(liveJobFingerprint, jobId);
        }
      } catch (error) {
        const abortReason = String((connAbort.signal as { reason?: unknown }).reason ?? "");
        if (abortReason === "client_disconnected") break;

        if (!headersFlushed) {
          if (liveJobMode === "attach" && !retriedFreshAfterStaleAttach) {
            req.log.warn({
              backend: backend.label,
              jobId,
              err: error instanceof Error ? error.message : String(error),
              gatewayLiveJobFingerprint: shortFingerprint(liveJobFingerprint),
            }, "Unified gateway live job attach errored before first chunk, creating a fresh job");
            invalidateGatewayLiveJob(liveJobFingerprint, jobId);

            const fresh = await acquireGatewayLiveJob({
              req,
              backend,
              request,
              body: prepared.body,
              semanticFingerprint: prepared.semanticFingerprint,
              forceNew: true,
            });
            if (!fresh) return null;

            acquired = fresh;
            jobId = fresh.entry.jobId;
            liveJobFingerprint = fresh.fingerprint;
            liveJobMode = "create";
            streamPath = "subnode-job-resumable";
            lastEventId = undefined;
            reconnectFailures = 0;
            retriedFreshAfterStaleAttach = true;
            applyStreamHeaders();
            continue;
          }

          if (liveJobMode === "create") {
            invalidateGatewayLiveJob(liveJobFingerprint, jobId);
            await cancelGatewayJob(backend, jobId);
          }

          req.log.warn({
            backend: backend.label,
            jobId,
            err: error instanceof Error ? error.message : String(error),
            gatewayLiveJobMode: liveJobMode,
          }, "Unified gateway job stream failed before first chunk, falling back");
          return null;
        }

        reconnectFailures++;
        if (reconnectFailures > 5) {
          invalidateGatewayLiveJob(liveJobFingerprint, jobId);
          safeWrite(res, `data: ${JSON.stringify({ error: { message: error instanceof Error ? error.message : "Unified gateway job stream failed", type: "upstream_error" } })}\n\n`);
          safeWrite(res, "data: [DONE]\n\n");
          streamDone = true;
          break;
        }

        await waitFor(abortReason === "job_stream_wall" ? 300 : 500);
      } finally {
        clearTimeout(wallTimer);
        clientAbort.signal.removeEventListener("abort", propagateAbort);
      }

      if (clientAbort.signal.aborted) break;
      if (streamDone) break;
      if (connectionEnded) {
        await waitFor(300);
        continue;
      }
    }
  } finally {
    res.removeListener("close", onClientClose);
    const currentLiveJob = liveGatewayJobs.get(liveJobFingerprint);
    if (currentLiveJob && currentLiveJob.jobId === jobId) {
      currentLiveJob.lastAccessAt = Date.now();
      currentLiveJob.lastDisconnectReason = String((clientAbort.signal as { reason?: unknown }).reason ?? "");
      if (streamDone) {
        currentLiveJob.status = "completed";
        currentLiveJob.completedAt = Date.now();
        currentLiveJob.expiresAt = Date.now() + LIVE_GATEWAY_JOB_COMPLETED_TTL_MS;
      }
    }
  }

  if ((clientAbort.signal as { reason?: unknown }).reason === "client_disconnected" && !streamDone) {
    req.log.info({
      backend: backend.label,
      jobId,
      gatewayLiveJobMode: liveJobMode,
      gatewayLiveJobFingerprint: shortFingerprint(liveJobFingerprint),
    }, "Unified gateway client disconnected; keeping live job for future reattach");
  }

  if (!res.writableEnded) res.end();

  req.log.info({
    gatewayStreamPath: streamPath,
    gatewayStreamFormat: "openai-compatible",
    gatewayStreamStats: stats,
    resolvedModel: request.model,
    jobId,
    gatewayLiveJobMode: liveJobMode,
    gatewayLiveJobFingerprint: shortFingerprint(liveJobFingerprint),
    gatewaySemanticFingerprint: shortFingerprint(prepared.semanticFingerprint),
  }, "Unified gateway parsed resumable stream completed");

  return {
    path: streamPath,
    format: "openai-compatible",
    stats,
  };
}

async function forwardOpenAICompat(
  req: Request,
  request: GatewayBridgeRequest,
  backend: FriendBackend,
  res: Response,
): Promise<void> {
  const prepared = buildOpenAICompatBody(request);
  setGatewayOpenAICacheHeaders(res, prepared.cacheDiagnostics);
  setResponseHeader(res, "X-Gateway-Semantic-Fingerprint", shortFingerprint(prepared.semanticFingerprint));

  req.log.info({
    resolvedModel: request.model,
    gatewayCachePlan: prepared.cacheDiagnostics.cachePlan || "none",
    gatewayLayeredCache: prepared.cacheDiagnostics.layeredCache,
    gatewayDynamicSinking: prepared.cacheDiagnostics.dynamicSinking,
    gatewayHistoryBreakpoint: prepared.cacheDiagnostics.historyBreakpoint,
    gatewaySystemCompatFallback: prepared.cacheDiagnostics.systemCompatFallback,
    gatewaySemanticFingerprint: shortFingerprint(prepared.semanticFingerprint),
  }, "Unified gateway prepared OpenAI-compatible request");

  if (request.stream) {
    const jobRelay = await tryStreamOpenAICompatViaJobApi({ req, res, request, backend, prepared });
    if (jobRelay) return;
  }

  const response = await fetch(`${backend.url}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${backend.apiKey}`,
      "Content-Type": "application/json",
      "X-Gateway-Protocol": request.protocol,
      "X-Gateway-Target": "openrouter-compatible",
    },
    body: JSON.stringify(prepared.body),
    signal: AbortSignal.timeout(GATEWAY_EXECUTION_TIMEOUTS.upstreamLongPollMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "unknown");
    throw new GatewayExecutionError(response.status, `Unified gateway upstream error ${response.status}: ${text}`);
  }

  if (request.stream) {
    if (!res.headersSent) {
      res.setHeader("X-Gateway-Stream-Path", "direct-sse-fallback");
      res.setHeader("X-Gateway-Stream-Format", "openai-compatible");
      res.setHeader("X-Gateway-Stream-Parsed", "normalized");
      res.setHeader("X-Gateway-Stream-Resumable", "direct-fallback");
      res.setHeader("X-Gateway-Live-Job", "direct-fallback");
      res.setHeader("X-Gateway-Live-Job-Reused", "miss");
      res.setHeader("X-Gateway-Job-Id", "none");
      res.setHeader("X-Gateway-Live-Job-Fingerprint", "none");
      res.setHeader("X-Gateway-Direct-Fallback", "active");
      res.setHeader("X-Gateway-Upstream-Task-TTL-Ms", String(GATEWAY_EXECUTION_TIMEOUTS.upstreamLongPollMs));
      res.setHeader("X-Gateway-Stream-Reconnect-Window-Ms", String(GATEWAY_EXECUTION_TIMEOUTS.subNodeStreamWallMs));
      res.setHeader("X-Gateway-Live-Job-TTL-Ms", String(GATEWAY_EXECUTION_TIMEOUTS.liveJobSoftTtlMs));
    }
    await pipeGatewayParsedSseResponse({
      req,
      res,
      fetchRes: response,
      path: "direct-sse-fallback",
      format: "openai-compatible",
      model: request.model,
    });
    return;
  }

  await pipeJsonResponse(response, res);
}

async function forwardAnthropicCompat(
  req: Request,
  request: GatewayBridgeRequest,
  backend: FriendBackend,
  res: Response,
): Promise<void> {
  const response = await fetch(`${backend.url}/v1/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${backend.apiKey}`,
      "Content-Type": "application/json",
      "anthropic-version": request.anthropicVersion ?? "2023-06-01",
      ...(request.anthropicBeta ? { "anthropic-beta": request.anthropicBeta } : {}),
      "X-Gateway-Protocol": request.protocol,
      "X-Gateway-Target": "openrouter-compatible",
    },
    body: JSON.stringify(toAnthropicBody(request)),
    signal: AbortSignal.timeout(3_600_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "unknown");
    throw new GatewayExecutionError(response.status, `Unified gateway upstream error ${response.status}: ${text}`);
  }

  if (request.stream) {
    if (!res.headersSent) {
      res.setHeader("X-Gateway-Stream-Path", "direct-anthropic-sse");
      res.setHeader("X-Gateway-Stream-Format", "anthropic-sse");
      res.setHeader("X-Gateway-Stream-Parsed", "normalized");
      res.setHeader("X-Gateway-Stream-Resumable", "direct");
      res.setHeader("X-Gateway-Live-Job", "direct");
      res.setHeader("X-Gateway-Live-Job-Reused", "miss");
      res.setHeader("X-Gateway-Job-Id", "none");
      res.setHeader("X-Gateway-Live-Job-Fingerprint", "none");
      res.setHeader("X-Gateway-Direct-Fallback", "none");
    }
    await pipeGatewayParsedSseResponse({
      req,
      res,
      fetchRes: response,
      path: "direct-anthropic-sse",
      format: "anthropic-sse",
      model: request.model,
    });
    return;
  }

  await pipeJsonResponse(response, res);
}

export async function executeGatewayRequest(options: GatewayExecuteOptions): Promise<void> {
  const { req, res, request, debug } = options;
  const fingerprint = buildCacheFingerprint(request.model, request.messages);
  const lockedProviderSlug = request.providerRoute?.provider;
  const { backend, poolSize, eligibleSize } = pickBackendForCache(fingerprint, lockedProviderSlug);

  if (!backend) {
    // No eligible sub-node.  Distinguish two failure modes so callers can
    // diagnose: (a) pool empty entirely → 503; (b) pool non-empty but no
    // node reports support for the locked provider → 422 (request can't be
    // satisfied without violating the absolute-routing contract).
    if (lockedProviderSlug && poolSize > 0 && eligibleSize === 0) {
      req.log.warn({
        providerPrefix: request.providerRoute?.prefix,
        providerSlug: lockedProviderSlug,
        poolSize,
      }, "Absolute routing: no sub-node reports capability for locked provider");
      res.status(422).json({
        error: {
          message:
            `No registered sub-node can serve provider "${lockedProviderSlug}" ` +
            `(model "${request.model}" hard-locks to it via prefix "${request.providerRoute?.prefix}"). ` +
            `Add a sub-node whose OpenRouter account has access to this provider, ` +
            `or remove the routing prefix to allow OpenRouter's default selection.`,
          type: "provider_capability_missing",
          providerPrefix: request.providerRoute?.prefix,
          providerSlug: lockedProviderSlug,
        },
      });
      return;
    }
    res.status(503).json({
      error: {
        message: "No available sub-nodes for unified gateway",
        type: "service_unavailable",
      },
    });
    return;
  }

  if (!res.headersSent) {
    res.setHeader("X-Gateway-Backend", backend.label);
    if (lockedProviderSlug) {
      res.setHeader("X-Gateway-Locked-Provider", lockedProviderSlug);
      res.setHeader("X-Gateway-Allow-Fallbacks", "false");
      if (request.providerRoute?.prefix) {
        res.setHeader("X-Gateway-Provider-Prefix", request.providerRoute.prefix);
      }
    }
    res.setHeader("X-Gateway-Cache-Affinity", "rendezvous");
    res.setHeader("X-Gateway-Upstream-Task-TTL-Ms", String(GATEWAY_EXECUTION_TIMEOUTS.upstreamLongPollMs));
    res.setHeader("X-Gateway-Stream-Reconnect-Window-Ms", String(GATEWAY_EXECUTION_TIMEOUTS.subNodeStreamWallMs));
    res.setHeader("X-Gateway-Live-Job-TTL-Ms", String(GATEWAY_EXECUTION_TIMEOUTS.liveJobSoftTtlMs));
  }

  req.log.info({
    gatewayProtocol: request.protocol,
    gatewayTarget: "openrouter-compatible",
    requestedModel: request.requestedModel,
    logicalModel: request.logicalModel,
    resolvedModel: request.resolvedModel,
    model: request.model,
    providerRoute: request.providerRoute?.provider,
    providerPrefix: request.providerRoute?.prefix,
    backend: backend.label,
    stream: request.stream,
    messageCount: request.messages.length,
    toolCount: request.tools?.length ?? 0,
    preservedKeys: debug.upstreamSummary.preservedKeys,
    detectedProtocol: debug.detection.protocol,
    normalizedProtocol: debug.irSummary.metadata.protocol,
  }, "Unified gateway execution");

  try {
    if (request.protocol === "anthropic-messages") {
      await forwardAnthropicCompat(req, request, backend, res);
      return;
    }

    await forwardOpenAICompat(req, request, backend, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown unified gateway error";
    const status = error instanceof GatewayExecutionError ? error.status : 502;
    req.log.error({
      gatewayProtocol: request.protocol,
      requestedModel: request.requestedModel,
      resolvedModel: request.resolvedModel,
      providerRoute: request.providerRoute?.provider,
      backend: backend.label,
      err: message,
      status,
    }, "Unified gateway execution failed");

    if (!res.headersSent) {
      res.status(status >= 400 && status < 600 ? status : 502).json({
        error: {
          message,
          type: "upstream_error",
        },
      });
      return;
    }

    if (!res.writableEnded) {
      writeAndFlush(res, `data: ${JSON.stringify({ error: { message, type: "upstream_error" } })}\n\n`);
      writeAndFlush(res, "data: [DONE]\n\n");
      res.end();
    }
  }
}