import { useState, useEffect, useCallback } from "react";
import SetupWizard from "./components/SetupWizard";
import PageLogs from "./components/PageLogs";
import PageDocs from "./components/PageDocs";
import PagePlayground from "./components/PagePlayground";

// ---------------------------------------------------------------------------
// Model registry
// ---------------------------------------------------------------------------

type Provider = "openai" | "anthropic" | "gemini" | "openrouter";

interface ModelEntry {
  id: string;
  label: string;
  provider: Provider;
  desc: string;
  badge?: "thinking" | "thinking-visible" | "tools" | "reasoning";
  context?: string;
}

const OPENAI_MODELS: ModelEntry[] = [
  { id: "gpt-5.2", label: "GPT-5.2", provider: "openai", desc: "最新旗舰多模态模型", context: "128K", badge: "tools" },
  { id: "gpt-5.1", label: "GPT-5.1", provider: "openai", desc: "旗舰多模态模型", context: "128K", badge: "tools" },
  { id: "gpt-5", label: "GPT-5", provider: "openai", desc: "旗舰多模态模型", context: "128K", badge: "tools" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", provider: "openai", desc: "高性价比快速模型", context: "128K", badge: "tools" },
  { id: "gpt-5-nano", label: "GPT-5 Nano", provider: "openai", desc: "超轻量边缘模型", context: "128K", badge: "tools" },
  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai", desc: "稳定通用旗舰模型", context: "1M", badge: "tools" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", provider: "openai", desc: "均衡速度与质量", context: "1M", badge: "tools" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", provider: "openai", desc: "超高速轻量模型", context: "1M", badge: "tools" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", desc: "多模态旗舰（图文音）", context: "128K", badge: "tools" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai", desc: "轻量多模态模型", context: "128K", badge: "tools" },
  { id: "o4-mini", label: "o4 Mini", provider: "openai", desc: "推理模型，快速高效", context: "200K", badge: "reasoning" },
  { id: "o4-mini-thinking", label: "o4 Mini (thinking)", provider: "openai", desc: "o4 Mini 思考别名", context: "200K", badge: "thinking" },
  { id: "o3", label: "o3", provider: "openai", desc: "强推理旗舰模型", context: "200K", badge: "reasoning" },
  { id: "o3-thinking", label: "o3 (thinking)", provider: "openai", desc: "o3 思考别名", context: "200K", badge: "thinking" },
  { id: "o3-mini", label: "o3 Mini", provider: "openai", desc: "高效推理模型", context: "200K", badge: "reasoning" },
  { id: "o3-mini-thinking", label: "o3 Mini (thinking)", provider: "openai", desc: "o3 Mini 思考别名", context: "200K", badge: "thinking" },
];

const ANTHROPIC_MODELS: ModelEntry[] = [
  { id: "claude-opus-4.6", label: "Claude Opus 4.6", provider: "anthropic", desc: "顶级推理与智能体任务", context: "200K", badge: "tools" },
  { id: "claude-opus-4.6-thinking", label: "Claude Opus 4.6 (thinking)", provider: "anthropic", desc: "扩展思考（隐藏）", context: "200K", badge: "thinking" },
  { id: "claude-opus-4.6-thinking-visible", label: "Claude Opus 4.6 (thinking visible)", provider: "anthropic", desc: "扩展思考（可见）", context: "200K", badge: "thinking-visible" },
  { id: "claude-opus-4.6-fast", label: "Claude Opus 4.6 Fast", provider: "anthropic", desc: "顶级推理高速版", context: "200K", badge: "tools" },
  { id: "claude-opus-4.5", label: "Claude Opus 4.5", provider: "anthropic", desc: "旗舰推理模型", context: "200K", badge: "tools" },
  { id: "claude-opus-4.5-thinking", label: "Claude Opus 4.5 (thinking)", provider: "anthropic", desc: "扩展思考（隐藏）", context: "200K", badge: "thinking" },
  { id: "claude-opus-4.5-thinking-visible", label: "Claude Opus 4.5 (thinking visible)", provider: "anthropic", desc: "扩展思考（可见）", context: "200K", badge: "thinking-visible" },
  { id: "claude-opus-4.1", label: "Claude Opus 4.1", provider: "anthropic", desc: "旗舰模型（稳定版）", context: "200K", badge: "tools" },
  { id: "claude-opus-4.1-thinking", label: "Claude Opus 4.1 (thinking)", provider: "anthropic", desc: "扩展思考（隐藏）", context: "200K", badge: "thinking" },
  { id: "claude-opus-4.1-thinking-visible", label: "Claude Opus 4.1 (thinking visible)", provider: "anthropic", desc: "扩展思考（可见）", context: "200K", badge: "thinking-visible" },
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", provider: "anthropic", desc: "速度与智能最佳平衡", context: "200K", badge: "tools" },
  { id: "claude-sonnet-4.6-thinking", label: "Claude Sonnet 4.6 (thinking)", provider: "anthropic", desc: "扩展思考（隐藏）", context: "200K", badge: "thinking" },
  { id: "claude-sonnet-4.6-thinking-visible", label: "Claude Sonnet 4.6 (thinking visible)", provider: "anthropic", desc: "扩展思考（可见）", context: "200K", badge: "thinking-visible" },
  { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", provider: "anthropic", desc: "均衡性价比旗舰", context: "200K", badge: "tools" },
  { id: "claude-sonnet-4.5-thinking", label: "Claude Sonnet 4.5 (thinking)", provider: "anthropic", desc: "扩展思考（隐藏）", context: "200K", badge: "thinking" },
  { id: "claude-sonnet-4.5-thinking-visible", label: "Claude Sonnet 4.5 (thinking visible)", provider: "anthropic", desc: "扩展思考（可见）", context: "200K", badge: "thinking-visible" },
  { id: "claude-haiku-4.5", label: "Claude Haiku 4.5", provider: "anthropic", desc: "超快速轻量模型", context: "200K", badge: "tools" },
  { id: "claude-haiku-4.5-thinking", label: "Claude Haiku 4.5 (thinking)", provider: "anthropic", desc: "扩展思考（隐藏）", context: "200K", badge: "thinking" },
  { id: "claude-haiku-4.5-thinking-visible", label: "Claude Haiku 4.5 (thinking visible)", provider: "anthropic", desc: "扩展思考（可见）", context: "200K", badge: "thinking-visible" },
];

const GEMINI_MODELS: ModelEntry[] = [
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", provider: "gemini", desc: "最新旗舰多模态模型", context: "2M", badge: "tools" },
  { id: "gemini-3.1-pro-preview-thinking", label: "Gemini 3.1 Pro Preview (thinking)", provider: "gemini", desc: "扩展思考（隐藏）", context: "2M", badge: "thinking" },
  { id: "gemini-3.1-pro-preview-thinking-visible", label: "Gemini 3.1 Pro Preview (thinking visible)", provider: "gemini", desc: "扩展思考（可见）", context: "2M", badge: "thinking-visible" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", provider: "gemini", desc: "极速多模态模型", context: "1M", badge: "tools" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "gemini", desc: "推理旗舰，强代码能力", context: "1M", badge: "tools" },
  { id: "gemini-2.5-pro-thinking", label: "Gemini 2.5 Pro (thinking)", provider: "gemini", desc: "扩展思考（隐藏）", context: "1M", badge: "thinking" },
  { id: "gemini-2.5-pro-thinking-visible", label: "Gemini 2.5 Pro (thinking visible)", provider: "gemini", desc: "扩展思考（可见）", context: "1M", badge: "thinking-visible" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "gemini", desc: "速度与质量兼备", context: "1M", badge: "tools" },
  { id: "gemini-2.5-flash-thinking", label: "Gemini 2.5 Flash (thinking)", provider: "gemini", desc: "扩展思考（隐藏）", context: "1M", badge: "thinking" },
  { id: "gemini-2.5-flash-thinking-visible", label: "Gemini 2.5 Flash (thinking visible)", provider: "gemini", desc: "扩展思考（可见）", context: "1M", badge: "thinking-visible" },
];

const OPENROUTER_MODELS: ModelEntry[] = [
  { id: "x-ai/grok-4.20", label: "Grok 4.20", provider: "openrouter", desc: "xAI 最新旗舰推理模型", badge: "tools" },
  { id: "x-ai/grok-4.1-fast", label: "Grok 4.1 Fast", provider: "openrouter", desc: "xAI 高速对话模型", badge: "tools" },
  { id: "x-ai/grok-4-fast", label: "Grok 4 Fast", provider: "openrouter", desc: "xAI 快速模型", badge: "tools" },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", provider: "openrouter", desc: "Meta 多模态旗舰" },
  { id: "meta-llama/llama-4-scout", label: "Llama 4 Scout", provider: "openrouter", desc: "Meta 长上下文模型", context: "10M" },
  { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", provider: "openrouter", desc: "中文/代码强模型", badge: "tools" },
  { id: "deepseek/deepseek-r1", label: "DeepSeek R1", provider: "openrouter", desc: "开源强推理模型", badge: "reasoning" },
  { id: "deepseek/deepseek-r1-0528", label: "DeepSeek R1 0528", provider: "openrouter", desc: "R1 最新版本", badge: "reasoning" },
  { id: "mistralai/mistral-small-2603", label: "Mistral Small 2603", provider: "openrouter", desc: "轻量高效模型", badge: "tools" },
  { id: "qwen/qwen3.5-122b-a10b", label: "Qwen 3.5 122B", provider: "openrouter", desc: "Alibaba 大参数旗舰" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (OR)", provider: "openrouter", desc: "通过 OpenRouter 的 Gemini" },
  { id: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6 (OR)", provider: "openrouter", desc: "通过 OpenRouter 的 Claude", badge: "tools" },
  { id: "cohere/command-a", label: "Command A", provider: "openrouter", desc: "Cohere 企业级模型", badge: "tools" },
  { id: "amazon/nova-premier-v1", label: "Nova Premier V1", provider: "openrouter", desc: "Amazon 旗舰多模态" },
  { id: "baidu/ernie-4.5-300b-a47b", label: "ERNIE 4.5 300B", provider: "openrouter", desc: "百度 MoE 大参数模型" },
];

// ---------------------------------------------------------------------------
// Styles / shared sub-components
// ---------------------------------------------------------------------------

const PROVIDER_COLORS: Record<Provider, { bg: string; border: string; dot: string; text: string; label: string }> = {
  openai: { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.25)", dot: "#60a5fa", text: "#93c5fd", label: "OpenAI" },
  anthropic: { bg: "rgba(251,146,60,0.1)", border: "rgba(251,146,60,0.25)", dot: "#fb923c", text: "#fdba74", label: "Anthropic" },
  gemini: { bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.25)", dot: "#34d399", text: "#6ee7b7", label: "Google Gemini" },
  openrouter: { bg: "rgba(167,139,250,0.08)", border: "rgba(167,139,250,0.2)", dot: "#a78bfa", text: "#c4b5fd", label: "OpenRouter" },
};

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      style={{
        background: copied ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.07)",
        border: `1px solid ${copied ? "rgba(74,222,128,0.4)" : "rgba(255,255,255,0.12)"}`,
        color: copied ? "#4ade80" : "#94a3b8",
        borderRadius: "6px",
        padding: "4px 10px",
        fontSize: "12px",
        cursor: "pointer",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {copied ? "已复制!" : (label ?? "复制")}
    </button>
  );
}

function CodeBlock({ code, copyText }: { code: string; copyText?: string }) {
  return (
    <div style={{ position: "relative", marginTop: "8px" }}>
      <pre
        style={{
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "8px",
          padding: "12px 16px",
          paddingRight: "72px",
          fontFamily: "Menlo, monospace",
          fontSize: "12.5px",
          color: "#e2e8f0",
          overflowX: "auto",
          margin: 0,
          lineHeight: "1.6",
        }}
      >
        {code}
      </pre>
      <div style={{ position: "absolute", top: "8px", right: "8px" }}>
        <CopyButton text={copyText ?? code} />
      </div>
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: "12px",
        padding: "24px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: "11px",
        fontWeight: 700,
        color: "#64748b",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        marginBottom: "16px",
        marginTop: 0,
      }}
    >
      {children}
    </h2>
  );
}

function Badge({ variant }: { variant: string }) {
  const styles: Record<string, { color: string; bg: string; border: string }> = {
    thinking: { color: "#c084fc", bg: "rgba(192,132,252,0.15)", border: "rgba(192,132,252,0.35)" },
    "thinking-visible": { color: "#34d399", bg: "rgba(52,211,153,0.12)", border: "rgba(52,211,153,0.3)" },
    tools: { color: "#fbbf24", bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.3)" },
    reasoning: { color: "#f472b6", bg: "rgba(244,114,182,0.1)", border: "rgba(244,114,182,0.3)" },
  };
  const labels: Record<string, string> = { thinking: "思考", "thinking-visible": "思考可见", tools: "工具", reasoning: "推理" };
  const s = styles[variant] ?? styles.tools;
  return (
    <span
      style={{
        fontSize: "10px",
        fontWeight: 600,
        color: s.color,
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: "4px",
        padding: "1px 5px",
        flexShrink: 0,
      }}
    >
      {labels[variant] ?? variant}
    </span>
  );
}

function MethodBadge({ method }: { method: "GET" | "POST" | "DELETE" }) {
  const cfg =
    method === "GET"
      ? { bg: "rgba(34,197,94,0.15)", color: "#4ade80", border: "rgba(34,197,94,0.3)" }
      : method === "DELETE"
      ? { bg: "rgba(248,113,113,0.15)", color: "#f87171", border: "rgba(248,113,113,0.3)" }
      : { bg: "rgba(99,102,241,0.2)", color: "#818cf8", border: "rgba(99,102,241,0.3)" };
  return (
    <span
      style={{
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        borderRadius: "5px",
        padding: "2px 8px",
        fontSize: "11px",
        fontWeight: 700,
        fontFamily: "Menlo, monospace",
        flexShrink: 0,
      }}
    >
      {method}
    </span>
  );
}

function SurfaceButton({
  children,
  onClick,
  active = false,
  tone = "default",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  tone?: "default" | "primary" | "danger";
}) {
  const styles =
    tone === "primary"
      ? {
          background: active ? "rgba(99,102,241,0.22)" : "rgba(99,102,241,0.14)",
          border: "rgba(99,102,241,0.32)",
          color: "#c7d2fe",
        }
      : tone === "danger"
      ? {
          background: active ? "rgba(248,113,113,0.18)" : "rgba(248,113,113,0.08)",
          border: "rgba(248,113,113,0.24)",
          color: "#fca5a5",
        }
      : {
          background: active ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)",
          border: "rgba(255,255,255,0.10)",
          color: active ? "#e2e8f0" : "#94a3b8",
        };
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: "8px",
        border: `1px solid ${styles.border}`,
        background: styles.background,
        color: styles.color,
        fontSize: "12px",
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.2s",
      }}
    >
      {children}
    </button>
  );
}

function KpiCard({
  title,
  value,
  sub,
  accent,
}: {
  title: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div
      style={{
        background: "rgba(0,0,0,0.22)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "12px",
        padding: "16px 18px",
      }}
    >
      <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {title}
      </div>
      <div style={{ fontSize: "24px", fontWeight: 700, color: accent, fontFamily: "'JetBrains Mono', Menlo, monospace" }}>{value}</div>
      {sub && <div style={{ marginTop: "4px", fontSize: "12px", color: "#475569", lineHeight: "1.6" }}>{sub}</div>}
    </div>
  );
}

function HintCard({
  title,
  children,
  accent = "#818cf8",
}: {
  title: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div
      style={{
        background: "rgba(0,0,0,0.2)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: "10px",
        padding: "14px 16px",
      }}
    >
      <div style={{ fontSize: "12px", fontWeight: 700, color: "#cbd5e1", marginBottom: "6px" }}>{title}</div>
      <div style={{ fontSize: "12.5px", color: "#64748b", lineHeight: "1.7" }}>{children}</div>
    </div>
  );
}

function TutorialSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card style={{ marginBottom: "14px" }}>
      <div style={{ marginBottom: "14px" }}>
        <div style={{ fontSize: "12px", color: "#818cf8", fontWeight: 700, marginBottom: "4px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {title}
        </div>
        {subtitle && <div style={{ fontSize: "13px", color: "#64748b", lineHeight: "1.7" }}>{subtitle}</div>}
      </div>
      {children}
    </Card>
  );
}

function ModelGroup({
  title,
  models,
  provider,
  expanded,
  onToggle,
}: {
  title: string;
  models: ModelEntry[];
  provider: Provider;
  expanded: boolean;
  onToggle: () => void;
}) {
  const c = PROVIDER_COLORS[provider];
  const base = models.filter((m) => !m.badge || (m.badge !== "thinking" && m.badge !== "thinking-visible"));
  const thinking = models.filter((m) => m.badge === "thinking" || m.badge === "thinking-visible");
  return (
    <div style={{ marginBottom: "10px" }}>
      <button
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          width: "100%",
          background: c.bg,
          border: `1px solid ${c.border}`,
          borderRadius: "8px",
          padding: "10px 14px",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, color: c.text, fontSize: "13px", flex: 1 }}>{title}</span>
        <span style={{ fontSize: "12px", color: "#475569" }}>{base.length} 基础 · {thinking.length > 0 ? `${thinking.length} 思考变体` : "–"}</span>
        <span style={{ fontSize: "11px", color: "#475569", marginLeft: "4px" }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div style={{ marginTop: "5px", display: "flex", flexDirection: "column", gap: "3px" }}>
          {models.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                background: "rgba(0,0,0,0.2)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: "7px",
                padding: "7px 12px",
              }}
            >
              <code style={{ fontFamily: "Menlo, monospace", fontSize: "12px", color: c.text, flex: 1, wordBreak: "break-all" }}>{m.id}</code>
              <span style={{ fontSize: "12px", color: "#475569", flexShrink: 0, minWidth: "100px", textAlign: "right" }}>{m.desc}</span>
              {m.context && (
                <span
                  style={{
                    fontSize: "10px",
                    color: "#334155",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: "3px",
                    padding: "1px 5px",
                    flexShrink: 0,
                  }}
                >
                  {m.context}
                </span>
              )}
              {m.badge && <Badge variant={m.badge} />}
              <CopyButton text={m.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

type BackendStat = {
  calls: number;
  errors: number;
  streamingCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgDurationMs: number;
  avgTtftMs: number | null;
  health: string;
  url?: string;
  dynamic?: boolean;
  enabled?: boolean;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalCostUSD?: number;
  publicBaseUrl?: string | null;
  apiBaseUrl?: string | null;
};

type ModelStat = { calls: number; promptTokens: number; completionTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };
type GroupSummary = { total: number; enabled: number };
interface ModelStatus { id: string; provider: string; enabled: boolean }

function normalizeBackendUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, "");
  if (!url) return url;
  return /\/api$/i.test(url) ? url : url + "/api";
}

// ---------------------------------------------------------------------------
// Page components
// ---------------------------------------------------------------------------

type Tab = "dashboard" | "cluster" | "models" | "playground" | "tutorial" | "settings" | "system";

function PageDashboard({
  displayUrl,
  online,
  totalModels,
  stats,
  onNavigate,
}: {
  displayUrl: string;
  online: boolean | null;
  totalModels: number;
  stats: Record<string, BackendStat> | null;
  onNavigate: (tab: Tab) => void;
}) {
  const clusterEntries = stats ? Object.entries(stats).filter(([label]) => label !== "local") : [];
  const healthyCount = clusterEntries.filter(([, s]) => s.enabled !== false && s.health === "healthy").length;
  const enabledCount = clusterEntries.filter(([, s]) => s.enabled !== false).length;
  const totalCalls = stats ? Object.values(stats).reduce((sum, item) => sum + item.calls, 0) : 0;

  return (
    <>
      <Card style={{ marginBottom: "18px" }}>
        <SectionTitle>Dashboard</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "26px", fontWeight: 700, color: "#f8fafc", marginBottom: "8px", letterSpacing: "-0.02em" }}>
              一个入口，给客户端直接接入所有模型
            </div>
            <div style={{ fontSize: "13.5px", color: "#64748b", lineHeight: "1.8", marginBottom: "16px" }}>
              先区分站点根地址与客户端接入地址：这里显示的是站点根地址；大多数 OpenAI Compatible 客户端真正应填写的是 <code style={{ color: "#a78bfa" }}>{`${displayUrl}/v1`}</code>。部署、节点、模型、客户端接入都已经在 Portal 内分面整理好。
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
              <code
                style={{
                  flex: 1,
                  minWidth: "260px",
                  background: "rgba(0,0,0,0.35)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "10px",
                  padding: "11px 14px",
                  fontSize: "13px",
                  color: "#a78bfa",
                  fontFamily: "Menlo, monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {displayUrl}
              </code>
              <CopyButton text={displayUrl} label="复制站点根地址" />
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <SurfaceButton tone="primary" onClick={() => onNavigate("tutorial")}>去 Tutorial</SurfaceButton>
              <SurfaceButton onClick={() => onNavigate("cluster")}>查看 Cluster</SurfaceButton>
              <SurfaceButton onClick={() => onNavigate("models")}>浏览 Models</SurfaceButton>
            </div>
          </div>

          <div style={{ display: "grid", gap: "10px" }}>
            <HintCard title="在线状态" accent={online ? "#4ade80" : "#f87171"}>
              当前网关状态：
              <strong style={{ color: online === null ? "#94a3b8" : online ? "#4ade80" : "#f87171", marginLeft: "6px" }}>
                {online === null ? "检测中" : online ? "在线" : "离线"}
              </strong>
            </HintCard>
            <HintCard title="接入建议" accent="#34d399">
              优先使用 OpenAI Compatible / Custom OpenAI 接入；Bearer Token 为默认推荐认证方式。
            </HintCard>
            <HintCard title="Portal 结构" accent="#f59e0b">
              Dashboard 负责总览；Cluster 承接节点、日志与路由；Tutorial 承接文档、Setup 和客户端接入。
            </HintCard>
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "18px" }}>
        <KpiCard title="模型目录" value={String(totalModels)} sub="当前内置模型条目" accent="#818cf8" />
        <KpiCard title="Cluster 节点" value={String(enabledCount)} sub={clusterEntries.length > 0 ? `${healthyCount} 个健康` : "尚未读取节点状态"} accent="#34d399" />
        <KpiCard title="请求累计" value={String(totalCalls)} sub="来自 Cluster 汇总" accent="#f59e0b" />
      </div>

      <Card>
        <SectionTitle>核心能力摘要</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
          {[
            { title: "统一入口", desc: "客户端优先按一个 Base URL + 一个访问密码接入。", accent: "#818cf8" },
            { title: "模型发现", desc: "先从 /v1/models 复制模型 ID，再填入客户端。", accent: "#34d399" },
            { title: "节点集群", desc: "Cluster 分面集中处理节点、路由、Fleet 与运行日志。", accent: "#f59e0b" },
            { title: "客户端接入", desc: "Tutorial 分面按 URL / Key / Model 三项给出接入说明。", accent: "#f472b6" },
          ].map((item) => (
            <HintCard key={item.title} title={item.title} accent={item.accent}>
              {item.desc}
            </HintCard>
          ))}
        </div>
      </Card>
    </>
  );
}

function MaintenanceCenter({ baseUrl }: { baseUrl: string }) {
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  const buildPrompt = () =>
    `请帮我把 AI 网关更新到最新版本。\n从 GitHub 仓库拉取最新代码，覆盖当前项目文件，然后运行 pnpm install，最后重启 "artifacts/api-server: API Server" 和 "artifacts/api-portal: web" 两个工作流。`;

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildPrompt());
    } catch {
      const el = document.createElement("textarea");
      el.value = buildPrompt();
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const manualCheck = async () => {
    setChecking(true);
    try {
      await fetch(`${baseUrl}/api/update/version`);
    } catch {}
    setChecking(false);
  };

  return (
    <Card>
      <SectionTitle>更新与维护</SectionTitle>
      <div style={{ display: "grid", gap: "12px" }}>
        <HintCard title="维护入口" accent="#fbbf24">
          更新提示已收敛到 Settings，不再长期占用首页空间。需要时可在这里手动检测并复制维护提示词。
        </HintCard>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <SurfaceButton onClick={manualCheck}>{checking ? "检测中…" : "重新检测"}</SurfaceButton>
          <SurfaceButton tone="primary" onClick={copyPrompt}>{copied ? "已复制提示词" : "复制更新提示词"}</SurfaceButton>
        </div>
      </div>
    </Card>
  );
}

function FleetManager() {
  const [instances, setInstances] = useState<Array<{ id: string; name: string; url: string; key: string }>>([]);
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addKey, setAddKey] = useState("");

  const addInst = () => {
    if (!addUrl.trim() || !addKey.trim()) return;
    setInstances((prev) => [...prev, { id: Math.random().toString(36).slice(2, 9), name: addName.trim() || addUrl.trim(), url: addUrl.trim(), key: addKey.trim() }]);
    setAddName("");
    setAddUrl("");
    setAddKey("");
  };

  const removeInst = (id: string) => setInstances((prev) => prev.filter((i) => i.id !== id));

  const inp: React.CSSProperties = {
    background: "rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "7px",
    padding: "7px 11px",
    color: "#e2e8f0",
    fontFamily: "Menlo, monospace",
    fontSize: "12.5px",
    outline: "none",
  };

  return (
    <Card style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", gap: "10px", flexWrap: "wrap" }}>
        <div>
          <SectionTitle>Fleet 管理</SectionTitle>
          <div style={{ fontSize: "12.5px", color: "#475569", marginTop: "-8px" }}>批量查看多个部署实例的版本状态与更新日志</div>
        </div>
      </div>

      <div style={{ marginBottom: "14px" }}>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <input style={{ ...inp, flex: "0 0 110px" }} placeholder="名称" value={addName} onChange={(e) => setAddName(e.target.value)} />
          <input style={{ ...inp, flex: "2 1 180px" }} placeholder="https://your-proxy.replit.app（根地址）" value={addUrl} onChange={(e) => setAddUrl(e.target.value)} />
          <input type="password" style={{ ...inp, flex: "1 1 130px" }} placeholder="PROXY_API_KEY" value={addKey} onChange={(e) => setAddKey(e.target.value)} />
          <button
            onClick={addInst}
            disabled={!addUrl || !addKey}
            style={{
              background: "rgba(99,102,241,0.7)",
              border: "1px solid rgba(99,102,241,0.6)",
              color: "#e0e7ff",
              borderRadius: "7px",
              padding: "7px 16px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: (!addUrl || !addKey) ? "not-allowed" : "pointer",
              opacity: (!addUrl || !addKey) ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            添加实例
          </button>
        </div>
      </div>

      {instances.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: "#334155", fontSize: "13px" }}>暂无 Fleet 实例，请在上方添加</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {instances.map((inst) => (
            <div key={inst.id} style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "9px", padding: "11px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#cbd5e1", minWidth: "80px" }}>{inst.name}</span>
                <span style={{ fontSize: "11px", color: "#334155", fontFamily: "Menlo, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, maxWidth: "240px" }}>{inst.url}</span>
                <SurfaceButton tone="danger" onClick={() => removeInst(inst.id)}>删除</SurfaceButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PageCluster({
  baseUrl,
  apiKey,
  stats,
  statsError,
  onRefresh,
  addUrl,
  setAddUrl,
  addState,
  addMsg,
  onAddBackend,
  onRemoveBackend,
  onToggleBackend,
  onBatchToggle,
  onBatchRemove,
  routing,
  onToggleRouting,
}: {
  baseUrl: string;
  apiKey: string;
  stats: Record<string, BackendStat> | null;
  statsError: false | "auth" | "server";
  onRefresh: () => void;
  addUrl: string;
  setAddUrl: (u: string) => void;
  addState: "idle" | "loading" | "ok" | "err";
  addMsg: string;
  onAddBackend: (e: React.FormEvent) => void;
  onRemoveBackend: (label: string) => void;
  onToggleBackend: (label: string, enabled: boolean) => void;
  onBatchToggle: (labels: string[], enabled: boolean) => void;
  onBatchRemove: (labels: string[]) => void;
  routing: { fakeStream: boolean };
  onToggleRouting: (field: "fakeStream", value: boolean) => void;
  modelStats: Record<string, ModelStat> | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [envPromptCopied, setEnvPromptCopied] = useState(false);
  const [resetting, setResetting] = useState(false);

  const ENV_NODE_PROMPT =
    `请在当前 Replit 项目中添加一个环境变量，将子节点注册为永久 ENV 节点（Publish 后不会丢失）：\n\n` +
    `步骤 1：检查以下环境变量名，按顺序找到第一个尚未设置的空位：\n` +
    `   FRIEND_PROXY_URL → FRIEND_PROXY_URL_2 → FRIEND_PROXY_URL_3 → … → FRIEND_PROXY_URL_20\n` +
    `   （可在 Secrets 面板或 viewEnvVars() 中查看已占用的名称）\n\n` +
    `步骤 2：通过 Replit Secrets 面板为该空位添加 Secret，值填写子节点 Publish 后的站点根地址：\n` +
    `   https://【填入你的子节点 Publish 后的站点】\n` +
    `   示例：https://my-proxy.replit.app\n\n` +
    `步骤 3：重启服务器（Shell 中执行重启，或点击 Replit Run 按钮）\n\n` +
    `说明：\n` +
    `• 只填子节点根地址即可，不要手动追加 /api\n` +
    `• 重启后该节点会出现在 Cluster 页面\n` +
    `• ENV 节点与动态节点会一起参与集群路由`;

  const copyEnvPrompt = () => {
    navigator.clipboard.writeText(ENV_NODE_PROMPT).then(() => {
      setEnvPromptCopied(true);
      setTimeout(() => setEnvPromptCopied(false), 2000);
    });
  };

  const resetStats = () => {
    setResetting(true);
    fetch(`${baseUrl}/api/v1/admin/stats/reset`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    }).then(() => {
      onRefresh();
      setResetting(false);
    }).catch(() => setResetting(false));
  };

  const allSubNodes = stats ? Object.entries(stats).filter(([l]) => l !== "local") : [];
  const dynamicNodes = allSubNodes.filter(([, s]) => s.dynamic);
  const allSelected = allSubNodes.length > 0 && allSubNodes.every(([l]) => selected.has(l));
  const someSelected = selected.size > 0;

  const toggleSelect = (label: string) =>
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(label) ? s.delete(label) : s.add(label);
      return s;
    });

  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(allSubNodes.map(([l]) => l)));

  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toString());

  const totals = stats
    ? Object.values(stats).reduce(
        (acc, s) => ({
          calls: acc.calls + s.calls,
          errors: acc.errors + s.errors,
          streamingCalls: acc.streamingCalls + (s.streamingCalls ?? 0),
          promptTokens: acc.promptTokens + s.promptTokens,
          completionTokens: acc.completionTokens + s.completionTokens,
          totalTokens: acc.totalTokens + s.totalTokens,
          totalCostUSD: acc.totalCostUSD + (s.totalCostUSD ?? 0),
        }),
        { calls: 0, errors: 0, streamingCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, totalCostUSD: 0 }
      )
    : null;

  const fmtCost = (usd: number) => usd >= 1 ? `$${usd.toFixed(2)}` : usd >= 0.001 ? `$${usd.toFixed(4)}` : usd > 0 ? `<$0.001` : "$0.00";

  return (
    <>
      <Card style={{ marginBottom: "16px" }}>
        <SectionTitle>Cluster</SectionTitle>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "22px", fontWeight: 700, color: "#f8fafc", marginBottom: "6px" }}>节点 / 路由 / Fleet / 日志</div>
            <div style={{ fontSize: "13px", color: "#64748b", lineHeight: "1.7" }}>
              Cluster 负责承接网关运行面：节点健康、集群开销、路由策略、节点接入和运行日志都集中在这里。
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <SurfaceButton onClick={onRefresh}>刷新 Cluster</SurfaceButton>
            <SurfaceButton tone="danger" onClick={resetStats}>{resetting ? "重置中…" : "重置统计"}</SurfaceButton>
          </div>
        </div>
      </Card>

      {!apiKey ? (
        <Card><p style={{ margin: 0, fontSize: "13px", color: "#475569" }}>请先在 Settings 中填入 API Key 后查看 Cluster。</p></Card>
      ) : statsError === "server" ? (
        <Card><p style={{ margin: 0, fontSize: "13px", color: "#f87171" }}>服务器未配置 PROXY_API_KEY，请先在 Tutorial 中完成初始化。</p></Card>
      ) : statsError === "auth" ? (
        <Card>
          <div style={{ fontSize: "13px", color: "#f87171", lineHeight: "1.7" }}>
            <div style={{ fontWeight: 600, marginBottom: "6px" }}>认证失败（API Key 不匹配）</div>
            <div style={{ color: "#94a3b8", fontSize: "12.5px" }}>
              这里读取的是集群管理接口，请确认 Settings 中保存的访问密码与 PROXY_API_KEY 一致。
            </div>
          </div>
        </Card>
      ) : !stats || !totals ? (
        <Card><p style={{ margin: 0, fontSize: "13px", color: "#475569" }}>加载 Cluster 数据中...</p></Card>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "16px" }}>
            <KpiCard title="总请求" value={String(totals.calls)} sub={`流式 ${totals.streamingCalls} · 错误 ${totals.errors}`} accent="#818cf8" />
            <KpiCard title="Token 汇总" value={fmt(totals.totalTokens)} sub={`输入 ${fmt(totals.promptTokens)} · 输出 ${fmt(totals.completionTokens)}`} accent="#34d399" />
            <KpiCard title="子节点数量" value={String(allSubNodes.length)} sub="所有子节点" accent="#f59e0b" />
            <KpiCard title="预估总开销" value={fmtCost(totals.totalCostUSD)} sub="所有子节点累计" accent="#f472b6" />
          </div>

          <Card style={{ marginBottom: "16px" }}>
            <SectionTitle>节点状态</SectionTitle>
            {Object.entries(stats).length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <div style={{ fontSize: "40px", marginBottom: "8px", opacity: 0.3 }}>💬</div>
                <div style={{ color: "#64748b", fontSize: "14px", fontWeight: 600 }}>暂无节点统计</div>
                <div style={{ color: "#475569", fontSize: "12px", marginTop: "4px" }}>发起请求后会自动记录节点维度数据</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {/* Friend / sub-nodes */}
                {Object.entries(stats).filter(([label]) => label !== "local").map(([label, s]) => {
                  const isEnabled = s.enabled !== false;
                  const isHealthy = s.health === "healthy";
                  const displayUrl = s.url || s.publicBaseUrl || s.apiBaseUrl || "";
                  return (
                    <div
                      key={label}
                      style={{
                        background: isEnabled ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.35)",
                        border: `1px solid ${isEnabled ? "rgba(255,255,255,0.06)" : "rgba(248,113,113,0.15)"}`,
                        borderRadius: "10px",
                        padding: "14px 16px",
                        opacity: isEnabled ? 1 : 0.6,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", flexWrap: "wrap" }}>
                        <div
                          style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            background: !isEnabled ? "#64748b" : isHealthy ? "#4ade80" : "#f87171",
                          }}
                        />
                        <span style={{ fontSize: "13px", fontWeight: 700, color: isEnabled ? "#e2e8f0" : "#64748b", fontFamily: "'JetBrains Mono', Menlo, monospace" }}>
                          {label}
                        </span>
                        {s.dynamic && <span style={{ fontSize: "10px", color: "#a78bfa", background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.25)", borderRadius: "4px", padding: "1px 6px" }}>动态</span>}
                        {!isEnabled && <span style={{ fontSize: "10px", color: "#f87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "4px", padding: "1px 6px" }}>已禁用</span>}
                        {displayUrl && <span style={{ fontSize: "11px", color: "#334155", fontFamily: "Menlo, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{displayUrl}</span>}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: "12px" }}>
                        {[
                          { label: "请求", value: s.calls.toString(), color: "#818cf8" },
                          { label: "流式", value: (s.streamingCalls ?? 0).toString(), color: "#3b82f6" },
                          { label: "错误", value: s.errors.toString(), color: s.errors > 0 ? "#f87171" : "#4ade80" },
                          { label: "输入 Token", value: fmt(s.promptTokens), color: "#34d399" },
                          { label: "输出 Token", value: fmt(s.completionTokens), color: "#34d399" },
                          { label: "预估开销", value: fmtCost(s.totalCostUSD ?? 0), color: "#f472b6" },
                        ].map((item) => (
                          <div key={item.label}>
                            <div style={{ fontSize: "10px", color: "#475569", marginBottom: "2px" }}>{item.label}</div>
                            <div style={{ fontSize: "14px", fontWeight: 600, color: item.color, fontFamily: "'JetBrains Mono', Menlo, monospace" }}>{item.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card style={{ marginBottom: "16px" }}>
            <SectionTitle>路由策略</SectionTitle>
            <p style={{ margin: "0 0 12px", fontSize: "12px", color: "#475569", lineHeight: "1.7" }}>
              这里管理的是 Cluster 级运行行为。当前主要聚焦在节点路由和假流式策略。
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "rgba(0,0,0,0.2)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: "8px",
                  padding: "10px 14px",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#94a3b8" }}>假流式</div>
                  <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px" }}>当上游不支持流式或真实流式失败时，将完整响应模拟为 SSE 流式输出。</div>
                </div>
                <button
                  onClick={() => onToggleRouting("fakeStream", !routing.fakeStream)}
                  style={{
                    width: "40px",
                    height: "22px",
                    borderRadius: "11px",
                    border: "none",
                    cursor: "pointer",
                    background: routing.fakeStream ? "#6366f1" : "rgba(255,255,255,0.1)",
                    position: "relative",
                    transition: "background 0.2s",
                    flexShrink: 0,
                    marginLeft: "12px",
                  }}
                >
                  <div
                    style={{
                      width: "16px",
                      height: "16px",
                      borderRadius: "50%",
                      background: "#fff",
                      position: "absolute",
                      top: "3px",
                      left: routing.fakeStream ? "21px" : "3px",
                      transition: "left 0.2s",
                    }}
                  />
                </button>
              </div>
            </div>
          </Card>

          <Card style={{ marginBottom: "16px" }}>
            <SectionTitle>添加节点</SectionTitle>
            <p style={{ margin: "0 0 12px", fontSize: "12.5px", color: "#475569", lineHeight: "1.7" }}>
              动态节点会即时生效；ENV 节点适合长期保留的集群成员。两者都会进入同一个 Cluster。
            </p>

            <form onSubmit={onAddBackend} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <input
                type="url"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                placeholder="https://friend-proxy.replit.app"
                style={{
                  flex: 1,
                  minWidth: "260px",
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  color: "#e2e8f0",
                  fontFamily: "Menlo, monospace",
                  fontSize: "13px",
                  outline: "none",
                }}
              />
              <button
                type="submit"
                disabled={addState === "loading"}
                style={{
                  background: addState === "loading" ? "rgba(99,102,241,0.4)" : "rgba(99,102,241,0.7)",
                  border: "1px solid rgba(99,102,241,0.6)",
                  color: "#e0e7ff",
                  borderRadius: "8px",
                  padding: "8px 18px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: addState === "loading" ? "not-allowed" : "pointer",
                  flexShrink: 0,
                }}
              >
                {addState === "loading" ? "添加中…" : "添加动态节点"}
              </button>
            </form>

            <div style={{ marginTop: "14px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "14px" }}>
              <div style={{ fontSize: "12.5px", color: "#94a3b8", fontWeight: 600, marginBottom: "6px" }}>通过环境变量添加长期节点</div>
              <div style={{ fontSize: "11.5px", color: "#475569", lineHeight: "1.5", marginBottom: "8px" }}>
                动态节点会即时生效；ENV 节点适合长期保留的集群成员。这里给出的是根地址写法，不再混淆 root URL 和 /api URL。
              </div>
              <div
                style={{
                  background: "rgba(0,0,0,0.35)",
                  border: "1px solid rgba(99,102,241,0.3)",
                  borderRadius: "8px",
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    color: "#a5b4fc",
                    fontSize: "12px",
                    fontFamily: "Menlo, Consolas, monospace",
                    lineHeight: "1.6",
                    whiteSpace: "pre-wrap",
                    userSelect: "all",
                    wordBreak: "break-all",
                  }}
                >
                  {ENV_NODE_PROMPT}
                </span>
                <button
                  onClick={copyEnvPrompt}
                  title="复制"
                  style={{
                    flexShrink: 0,
                    background: envPromptCopied ? "rgba(74,222,128,0.12)" : "rgba(99,102,241,0.1)",
                    border: `1px solid ${envPromptCopied ? "rgba(74,222,128,0.4)" : "rgba(99,102,241,0.25)"}`,
                    borderRadius: "6px",
                    padding: "4px 10px",
                    color: envPromptCopied ? "#4ade80" : "#a78bfa",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    whiteSpace: "nowrap",
                  }}
                >
                  {envPromptCopied ? "✓ 已复制" : "📋 复制"}
                </button>
              </div>
            </div>

            {(() => {
              const raw = addUrl.trim();
              const normed = normalizeBackendUrl(raw);
              return raw && normed !== raw.replace(/\/+$/, "") ? (
                <p style={{ margin: "6px 0 0", fontSize: "11.5px", color: "#94a3b8" }}>
                  实际保存为：<code style={{ color: "#a78bfa", fontFamily: "Menlo, monospace" }}>{normed}</code>
                </p>
              ) : null;
            })()}
            {addState === "ok" && <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#4ade80" }}>{addMsg}</p>}
            {addState === "err" && <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#f87171" }}>{addMsg}</p>}

            {allSubNodes.length > 0 && (
              <div style={{ marginTop: "14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer", userSelect: "none" }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected; }}
                      onChange={toggleSelectAll}
                      style={{ accentColor: "#818cf8", width: "14px", height: "14px", cursor: "pointer" }}
                    />
                    <span style={{ fontSize: "11px", color: "#475569" }}>
                      {allSelected ? "取消全选" : "全选"}
                      {someSelected && !allSelected ? `（已选 ${selected.size} / ${allSubNodes.length}）` : `（共 ${allSubNodes.length} 个节点）`}
                    </span>
                  </label>

                  {someSelected && (
                    <>
                      <SurfaceButton onClick={() => { onBatchToggle([...selected], true); setSelected(new Set()); }}>启用选中</SurfaceButton>
                      <SurfaceButton onClick={() => { onBatchToggle([...selected], false); setSelected(new Set()); }}>禁用选中</SurfaceButton>
                      {[...selected].some((l) => dynamicNodes.find(([dl]) => dl === l)) && (
                        <SurfaceButton tone="danger" onClick={() => {
                          const dynamicSelected = [...selected].filter((l) => dynamicNodes.find(([dl]) => dl === l));
                          onBatchRemove(dynamicSelected);
                          setSelected(new Set());
                        }}>移除动态节点</SurfaceButton>
                      )}
                    </>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {allSubNodes.map(([label, s]) => {
                    const isEnabled = s.enabled !== false;
                    const isChecked = selected.has(label);
                    const isDynamic = !!s.dynamic;
                    return (
                      <div
                        key={label}
                        onClick={() => toggleSelect(label)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          background: isChecked ? "rgba(99,102,241,0.1)" : "rgba(0,0,0,0.2)",
                          border: `1px solid ${isChecked ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.05)"}`,
                          borderRadius: "7px",
                          padding: "8px 12px",
                          cursor: "pointer",
                          transition: "all 0.15s",
                          opacity: isEnabled ? 1 : 0.5,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelect(label)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ accentColor: "#818cf8", width: "14px", height: "14px", cursor: "pointer", flexShrink: 0 }}
                        />
                        <div style={{ width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0, background: isEnabled ? (s.health === "healthy" ? "#4ade80" : "#f87171") : "#475569" }} />
                        {!isDynamic && (
                          <span style={{ fontSize: "10px", color: "#64748b", background: "rgba(100,116,139,0.1)", border: "1px solid rgba(100,116,139,0.2)", borderRadius: "4px", padding: "1px 5px", flexShrink: 0 }}>ENV</span>
                        )}
                        <span style={{ flex: 1, fontSize: "12px", color: isEnabled ? "#94a3b8" : "#475569", fontFamily: "Menlo, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.url ?? label}
                        </span>
                        {!isEnabled && (
                          <span style={{ fontSize: "10px", color: "#64748b", background: "rgba(100,116,139,0.15)", border: "1px solid rgba(100,116,139,0.3)", borderRadius: "4px", padding: "1px 6px", flexShrink: 0 }}>已禁用</span>
                        )}
                        <span style={{ fontSize: "11px", color: "#475569", flexShrink: 0 }}>{s.calls} 次</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleBackend(label, !isEnabled); }}
                          style={{ background: "none", border: `1px solid ${isEnabled ? "rgba(251,191,36,0.3)" : "rgba(74,222,128,0.3)"}`, borderRadius: "4px", color: isEnabled ? "#fbbf24" : "#4ade80", fontSize: "11px", cursor: "pointer", padding: "1px 7px", flexShrink: 0 }}
                        >
                          {isEnabled ? "禁用" : "启用"}
                        </button>
                        {isDynamic && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onRemoveBackend(label); }}
                            style={{ background: "none", border: "none", color: "#f87171", fontSize: "13px", cursor: "pointer", padding: "0 2px", flexShrink: 0, lineHeight: 1 }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

          <FleetManager />

          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", gap: "10px", flexWrap: "wrap" }}>
              <div>
                <SectionTitle>运行日志</SectionTitle>
                <div style={{ fontSize: "12px", color: "#475569", marginTop: "-8px" }}>
                  Logs 已并入 Cluster，用于观察当前集群请求、错误与实时流。
                </div>
              </div>
            </div>
            <PageLogs baseUrl={baseUrl} apiKey={apiKey} />
          </Card>
        </>
      )}
    </>
  );
}

function QuickStartRecipe({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "14px 16px" }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#e2e8f0", marginBottom: "8px" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
        {steps.map((step, index) => (
          <div key={index} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
            <span
              style={{
                width: "20px",
                height: "20px",
                borderRadius: "50%",
                background: "rgba(99,102,241,0.18)",
                color: "#a5b4fc",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "11px",
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {index + 1}
            </span>
            <span style={{ fontSize: "12.5px", color: "#64748b", lineHeight: "1.7" }}>{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PageTutorial({
  displayUrl,
  totalModels,
  onOpenWizard,
  expandedGroups,
  onToggleGroup,
}: {
  displayUrl: string;
  totalModels: number;
  onOpenWizard: () => void;
  expandedGroups: Record<string, boolean>;
  onToggleGroup: (g: string) => void;
}) {
  const baseUrlWithV1 = `${displayUrl}/v1`;

  const docsSections = [
    {
      title: "先填什么",
      content: `推荐你先确认 3 项：

1. URL
大多数 OpenAI Compatible 客户端直接填写 ${baseUrlWithV1}

2. Key
填写你在配置向导中设定的 PROXY_API_KEY

3. Model
先请求 /v1/models，再从模型目录里复制模型 ID

如果客户端只接受一个 OpenAI Base URL，就优先填到 /v1。`,
    },
    {
      title: "推荐认证方式",
      content: `默认推荐：
Authorization: Bearer YOUR_PROXY_API_KEY

如果是 Gemini 风格客户端，再考虑：
x-goog-api-key: YOUR_PROXY_API_KEY

不再推荐混用 x-api-key 这类表达。`,
    },
    {
      title: "推荐端点",
      content: `推荐你优先记住这些端点：

GET /v1/models
- 读取模型目录并复制模型 ID

POST /v1/chat/completions
- 默认推荐端点
- 适合 new-api、SillyTavern、VCP、绝大多数 OpenAI 兼容客户端

POST /v1/messages
- Anthropic / Claude Messages 风格入口

POST /v1beta/models/:model:generateContent
POST /v1beta/models/:model:streamGenerateContent
- Gemini 原生格式入口（与 Google AI Studio / @google/genai SDK 一致）

POST /api
- 母代理统一入口
- 当你手动发送 OpenAI / Anthropic / Gemini 风格 body 时，由网关自动归一化
- 不要把 /api 当成 OpenAI Base URL；OpenAI Compatible 客户端仍优先填写 /v1

GET /api/healthz
- 健康检查，不需要认证

GET /api/setup-status
- Portal 初始化检测入口`,
    },
    {
      title: "模型 ID 从哪里复制",
      content: `不要自己猜模型 ID，也不要根据旧文档手打。
先请求 /v1/models，再直接从模型目录里复制。

Anthropic 4.x 统一使用点号版本，例如：
- claude-opus-4.6
- claude-sonnet-4.6

而不是旧式的 claude-opus-4-6。`,
    },
  ];

  return (
    <>
      <Card style={{ marginBottom: "16px" }}>
        <SectionTitle>Tutorial</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "22px", fontWeight: 700, color: "#f8fafc", marginBottom: "6px" }}>面向接入者的 Quick Start</div>
            <div style={{ fontSize: "13px", color: "#64748b", lineHeight: "1.8", marginBottom: "12px" }}>
              这里不再讲失真的架构故事，而是直接回答：URL 填哪里、Key 怎么用、Model 从哪里复制、不同客户端怎么接。
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <SurfaceButton tone="primary" onClick={onOpenWizard}>打开 Setup 向导</SurfaceButton>
              <CopyButton text={baseUrlWithV1} label="复制推荐 /v1 URL" />
            </div>
          </div>
          <div style={{ display: "grid", gap: "10px" }}>
            <HintCard title="推荐 Base URL" accent="#818cf8">
              <code style={{ color: "#a78bfa", fontFamily: "Menlo, monospace" }}>{baseUrlWithV1}</code>
            </HintCard>
            <HintCard title="推荐认证方式" accent="#34d399">
              Bearer Token 为默认推荐；Gemini 风格客户端可使用 <code style={{ color: "#cbd5e1" }}>x-goog-api-key</code>。
            </HintCard>
            <HintCard title="模型来源" accent="#f59e0b">
              当前模型目录共 {totalModels} 个内置条目，实际填写前仍建议先请求 <code style={{ color: "#cbd5e1" }}>/v1/models</code>。
            </HintCard>
          </div>
        </div>
      </Card>

      <TutorialSection title="Quick Start" subtitle="先把接入最常用的三项信息准备好：URL、访问密码、模型 ID。">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px", marginBottom: "14px" }}>
          <HintCard title="URL" accent="#818cf8">
            大多数 OpenAI Compatible 客户端直接填写 <code style={{ color: "#a78bfa" }}>{baseUrlWithV1}</code>
          </HintCard>
          <HintCard title="Key" accent="#34d399">
            填写你在 Setup 向导里设定的 <code style={{ color: "#cbd5e1" }}>PROXY_API_KEY</code>
          </HintCard>
          <HintCard title="Model" accent="#f59e0b">
            先请求 <code style={{ color: "#cbd5e1" }}>/v1/models</code>，再复制模型 ID
          </HintCard>
        </div>

        <CodeBlock code={`curl ${baseUrlWithV1}/models \\
  -H "Authorization: Bearer YOUR_PROXY_API_KEY"`} copyText={`curl ${baseUrlWithV1}/models \\\n  -H "Authorization: Bearer YOUR_PROXY_API_KEY"`} />

        <div style={{ marginTop: "14px" }}>
          <CodeBlock
            code={`curl ${baseUrlWithV1}/chat/completions \\
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4.1-mini","messages":[{"role":"user","content":"Hello!"}]}'`}
          />
        </div>
      </TutorialSection>

      <TutorialSection title="Client Recipes" subtitle="不做复杂配置器，直接把常见客户端真正要填的内容说清楚。">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
          <QuickStartRecipe title="new-api-main" steps={[`上游地址优先填写 ${baseUrlWithV1}`, "鉴权填写 PROXY_API_KEY", "模型列表优先从 /v1/models 拉取再选择"]} />
          <QuickStartRecipe
            title="SillyTavern-release"
            steps={[
              "连接方式选 OpenAI Compatible / Custom OpenAI",
              `Base URL 填 ${baseUrlWithV1}`,
              "API Key 填 PROXY_API_KEY",
              "如果遇到 Claude 角色顺序兼容问题，再去 Settings 开启 SillyTavern 兼容模式",
            ]}
          />
          <QuickStartRecipe
            title="aio-hub-main / VCP"
            steps={[
              "优先走 OpenAI Compatible 接入心智",
              `OpenAI Compatible Base URL 先填 ${baseUrlWithV1}`,
              "Key 统一填 PROXY_API_KEY",
              "Model 统一从 /v1/models 复制，不要手打旧别名",
              "如果你手动组 Anthropic / Gemini 风格 body，再看 Tutorial 里的 /v1/messages 与 /api 说明，不要把 /api 和 /v1 混填",
            ]}
          />
        </div>
      </TutorialSection>

      <TutorialSection title="API Reference" subtitle="保留真正常用的接口说明和认证表达。">
        <PageDocs sections={docsSections} />
        <div style={{ marginTop: "14px" }}>
          <Card style={{ background: "rgba(0,0,0,0.18)", borderColor: "rgba(255,255,255,0.06)", padding: "16px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#cbd5e1", marginBottom: "10px" }}>端点清单</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {([
                { method: "GET", path: "/v1/models", desc: "读取模型目录并复制模型 ID" },
                { method: "POST", path: "/v1/chat/completions", desc: "默认推荐端点，适合大多数客户端" },
                { method: "POST", path: "/v1/messages", desc: "Anthropic / Claude Messages 风格入口" },
                { method: "POST", path: "/api", desc: "统一多协议入口，接收 OpenAI / Anthropic / Gemini 风格 body" },
                { method: "GET", path: "/api/healthz", desc: "健康检查，无需认证" },
                { method: "GET", path: "/api/setup-status", desc: "Portal 初始化检测入口" },
              ] as { method: "GET" | "POST" | "DELETE"; path: string; desc: string }[]).map((ep) => (
                <div key={`${ep.method}:${ep.path}`} style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "10px 14px" }}>
                  <MethodBadge method={ep.method} />
                  <code style={{ color: "#e2e8f0", fontFamily: "Menlo, monospace", fontSize: "12.5px", flex: 1 }}>{ep.path}</code>
                  <span style={{ color: "#475569", fontSize: "12px", flexShrink: 0, maxWidth: "280px", textAlign: "right" }}>{ep.desc}</span>
                  <CopyButton text={`${displayUrl}${ep.path}`} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </TutorialSection>

      <TutorialSection title="Setup" subtitle="首次未配置时仍会自动弹出；这里提供常驻入口，方便后续重新初始化或重检。">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px", marginBottom: "14px" }}>
          <HintCard title="什么时候需要 Setup" accent="#818cf8">
            首次部署、重建环境、修改访问密码，或补齐云端存储时。
          </HintCard>
          <HintCard title="Setup 会做什么" accent="#34d399">
            为母代理设置 PROXY_API_KEY、检查云端存储，并给出发给 Replit Agent 的指令。
          </HintCard>
          <HintCard title="完成后做什么" accent="#f59e0b">
            回到 Portal 重新检测；随后去 Cluster 接入子节点，再去 Tutorial 复制 URL / Key / Model 给客户端。
          </HintCard>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <SurfaceButton tone="primary" onClick={onOpenWizard}>打开配置向导</SurfaceButton>
        </div>
      </TutorialSection>

      <TutorialSection title="模型目录预览" subtitle="接入前可以快速展开看一下各 provider 的默认模型组。真正使用时仍建议从 /v1/models 复制。">
        <ModelGroup title="OpenAI" models={OPENAI_MODELS} provider="openai" expanded={expandedGroups.openai} onToggle={() => onToggleGroup("openai")} />
        <ModelGroup title="Anthropic Claude" models={ANTHROPIC_MODELS} provider="anthropic" expanded={expandedGroups.anthropic} onToggle={() => onToggleGroup("anthropic")} />
        <ModelGroup title="Google Gemini" models={GEMINI_MODELS} provider="gemini" expanded={expandedGroups.gemini} onToggle={() => onToggleGroup("gemini")} />
        <ModelGroup title="OpenRouter" models={OPENROUTER_MODELS} provider="openrouter" expanded={expandedGroups.openrouter} onToggle={() => onToggleGroup("openrouter")} />
      </TutorialSection>
    </>
  );
}

function PageModels({
  baseUrl,
  apiKey,
  modelStatus,
  summary,
  onRefresh,
  onToggleProvider,
  onToggleModel,
}: {
  baseUrl: string;
  apiKey: string;
  modelStatus: ModelStatus[];
  summary: Record<string, GroupSummary>;
  onRefresh: () => void;
  onToggleProvider: (provider: string, enabled: boolean) => void;
  onToggleModel: (id: string, enabled: boolean) => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    openai: true,
    anthropic: true,
    gemini: true,
    openrouter: true,
  });
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");

  const statusMap = new Map(modelStatus.map((m) => [m.id, m.enabled]));
  const totalEnabled = modelStatus.filter((m) => m.enabled).length;
  const totalCount = modelStatus.length;

  const groups: { key: string; title: string; models: ModelEntry[]; provider: Provider }[] = [
    { key: "openai", title: "OpenAI", models: OPENAI_MODELS, provider: "openai" },
    { key: "anthropic", title: "Anthropic Claude", models: ANTHROPIC_MODELS, provider: "anthropic" },
    { key: "gemini", title: "Google Gemini", models: GEMINI_MODELS, provider: "gemini" },
    { key: "openrouter", title: "OpenRouter", models: OPENROUTER_MODELS, provider: "openrouter" },
  ];

  if (!apiKey) {
    return (
      <Card>
        <div style={{ textAlign: "center", color: "#475569", padding: "40px 0" }}>
          <div style={{ fontSize: "24px", marginBottom: "12px" }}>🔒</div>
          <div>请先在 Settings 中填写 API Key 才能管理模型开关</div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <SectionTitle>Models</SectionTitle>
          <div style={{ fontSize: "13px", color: "#475569" }}>
            已启用 <span style={{ color: "#a5b4fc", fontWeight: 700 }}>{totalEnabled}</span> / {totalCount} 个模型 · 禁用模型不会出现在 <code style={{ color: "#818cf8" }}>/v1/models</code>
          </div>
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          {(["all", "enabled", "disabled"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "5px 12px",
                borderRadius: "6px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: filter === f ? "rgba(99,102,241,0.2)" : "transparent",
                color: filter === f ? "#a5b4fc" : "#475569",
                fontSize: "12px",
                cursor: "pointer",
                fontWeight: filter === f ? 600 : 400,
              }}
            >
              {f === "all" ? "全部" : f === "enabled" ? "已启用" : "已禁用"}
            </button>
          ))}
        </div>
        <SurfaceButton onClick={onRefresh}>刷新</SurfaceButton>
      </Card>

      {groups.map(({ key, title, models, provider }) => {
        const c = PROVIDER_COLORS[provider];
        const grpSummary = summary[key] ?? { total: models.length, enabled: models.length };
        const isExpanded = expandedGroups[key];
        const filteredModels = models.filter((m) => {
          const en = statusMap.get(m.id) ?? true;
          if (filter === "enabled") return en;
          if (filter === "disabled") return !en;
          return true;
        });

        return (
          <div key={key} style={{ marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", background: c.bg, border: `1px solid ${c.border}`, borderRadius: "8px", padding: "10px 14px" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
              <button
                onClick={() => setExpandedGroups((p) => ({ ...p, [key]: !p[key] }))}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 600, color: c.text, fontSize: "13px", flex: 1, textAlign: "left" }}
              >
                {title}
              </button>
              <span style={{ fontSize: "12px", color: "#475569" }}>{grpSummary.enabled}/{grpSummary.total} 已启用</span>
              <SurfaceButton onClick={() => onToggleProvider(key, true)}>全部启用</SurfaceButton>
              <SurfaceButton tone="danger" onClick={() => onToggleProvider(key, false)}>全部禁用</SurfaceButton>
            </div>

            {isExpanded && filteredModels.length > 0 && (
              <div style={{ marginTop: "4px", display: "flex", flexDirection: "column", gap: "2px" }}>
                {filteredModels.map((m) => {
                  const enabled = statusMap.get(m.id) ?? true;
                  return (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "10px", background: enabled ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.35)", border: `1px solid ${enabled ? "rgba(255,255,255,0.05)" : "rgba(248,113,113,0.12)"}`, borderRadius: "7px", padding: "6px 12px", opacity: enabled ? 1 : 0.55 }}>
                      <code style={{ fontFamily: "Menlo, monospace", fontSize: "11.5px", color: enabled ? c.text : "#475569", flex: 1, wordBreak: "break-all" }}>{m.id}</code>
                      <span style={{ fontSize: "11.5px", color: "#334155", flexShrink: 0 }}>{m.desc}</span>
                      {m.context && <span style={{ fontSize: "10px", color: "#334155", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px", padding: "1px 5px", flexShrink: 0 }}>{m.context}</span>}
                      {m.badge && <Badge variant={m.badge} />}
                      <button
                        onClick={() => onToggleModel(m.id, !enabled)}
                        style={{
                          width: "36px",
                          height: "20px",
                          borderRadius: "10px",
                          border: "none",
                          background: enabled ? "rgba(99,102,241,0.7)" : "rgba(100,116,139,0.3)",
                          position: "relative",
                          cursor: "pointer",
                          flexShrink: 0,
                          transition: "background 0.15s",
                          padding: 0,
                        }}
                      >
                        <div
                          style={{
                            width: "14px",
                            height: "14px",
                            borderRadius: "50%",
                            background: "#fff",
                            position: "absolute",
                            top: "3px",
                            left: enabled ? "19px" : "3px",
                            transition: "left 0.15s",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                          }}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// System tab — version check + one-click update prompt for Replit Agent
// Mirrors child proxy commit 0f47820a SystemTab functionality.
// ---------------------------------------------------------------------------

// Matches the flat shape returned by GET /api/update/version
interface VersionResponse {
  version: string;
  hasUpdate: boolean;
  latestVersion?: string;
  latestReleaseNotes?: string;
  latestReleaseDate?: string;
  releaseNotes?: string;
  source?: string;
  checkError?: string;
}

const MOTHER_GITHUB_URL = "https://github.com/syrikm/davidfuckrp";

function SystemTab() {
  const [vData, setVData] = useState<VersionResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      // Correct endpoint: GET /api/update/version (not /api/version)
      const res = await fetch("/api/update/version");
      if (res.ok) {
        const d = await res.json() as VersionResponse;
        setVData(d);
      }
    } catch { /* ignore */ }
    finally { setChecking(false); }
  }, []);

  useEffect(() => { void check(); }, [check]);

  const buildPrompt = (remoteVer: string) =>
    `Please update this AI Proxy Gateway to the latest version (v${remoteVer}).\n\nSource repo: ${MOTHER_GITHUB_URL}\n\nSteps:\n1. Read and record .replit file content\n2. Run:\n   git fetch ${MOTHER_GITHUB_URL} main\n   git -c core.hooksPath=/dev/null reset --hard FETCH_HEAD\n3. Restore .replit file\n4. Run: pnpm install\n5. Restart "artifacts/api-server: API Server" workflow\n\nLet me know when done.`;

  const C = {
    bg: "hsl(222,47%,11%)",
    card: "rgba(15,18,30,0.7)",
    border: "rgba(255,255,255,0.07)",
    border2: "rgba(255,255,255,0.12)",
    text: "#e2e8f0",
    muted: "#475569",
    accent: "#6366f1",
    green: "#4ade80",
    purple: "#a78bfa",
    redDim: "rgba(248,113,113,0.08)",
    red: "#f87171",
  };

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>System</div>
        <div style={{ fontSize: 12, color: C.muted }}>Version info and one-click update prompt for Replit Agent</div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Gateway Version</span>
            {vData && (
              <span style={{ background: `${C.purple}20`, border: `1px solid ${C.purple}40`, color: C.purple, borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>
                v{vData.version}
              </span>
            )}
            {vData?.hasUpdate && vData.latestVersion && (
              <span style={{ background: `${C.green}15`, border: `1px solid ${C.green}40`, color: C.green, borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>
                v{vData.latestVersion} available
              </span>
            )}
            {vData && !vData.hasUpdate && !vData.checkError && (
              <span style={{ fontSize: 11, color: C.green }}>✓ Up to date</span>
            )}
            {vData?.checkError && (
              <span style={{ fontSize: 11, color: C.red }}>⚠ Check failed</span>
            )}
          </div>
          <button
            onClick={check}
            disabled={checking}
            style={{
              padding: "6px 16px", borderRadius: 7, border: `1px solid ${C.border2}`,
              background: "transparent", color: checking ? C.muted : C.accent,
              fontSize: 12, cursor: checking ? "not-allowed" : "pointer",
            }}
          >
            {checking ? "Checking…" : "Check for updates"}
          </button>
        </div>

        {(vData?.releaseNotes || vData?.latestReleaseNotes) && (
          <div style={{ padding: "14px 22px", borderBottom: vData?.hasUpdate ? `1px solid ${C.border}` : "none" }}>
            <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, fontWeight: 600 }}>
              {vData?.hasUpdate ? "Latest Release Notes" : "Current Release Notes"}
            </div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.65, paddingLeft: 12, borderLeft: `2px solid ${vData?.hasUpdate ? C.green : C.accent}40` }}>
              {vData?.hasUpdate ? (vData.latestReleaseNotes ?? "") : (vData?.releaseNotes ?? "")}
            </div>
          </div>
        )}

        {vData?.hasUpdate && vData.latestVersion && (
          <div style={{ padding: "18px 22px" }}>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.65, marginBottom: 14 }}>
              Copy the update prompt below and paste it to <strong style={{ color: C.text }}>Replit Agent</strong> to apply the update automatically.
            </div>
            <div style={{
              background: "rgba(0,0,0,0.3)", border: `1px solid ${C.border}`, borderRadius: 8,
              padding: "12px 14px", fontFamily: "monospace", fontSize: 11,
              color: C.muted, lineHeight: 1.8, whiteSpace: "pre-wrap", wordBreak: "break-all",
              maxHeight: 180, overflowY: "auto", marginBottom: 12,
            }}>
              {buildPrompt(vData.latestVersion)}
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(buildPrompt(vData!.latestVersion!)).then(() => {
                  setPromptCopied(true);
                  setTimeout(() => setPromptCopied(false), 2500);
                });
              }}
              style={{
                width: "100%", padding: "10px 0", borderRadius: 8, border: "none",
                background: promptCopied ? C.green : C.accent, color: "#fff",
                fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "background 0.2s",
              }}
            >
              {promptCopied ? "✓ Copied — paste to Agent" : "Copy update prompt"}
            </button>
          </div>
        )}
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 22px" }}>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Source Repository</div>
        <a href={MOTHER_GITHUB_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: C.accent, textDecoration: "none", wordBreak: "break-all" }}>
          {MOTHER_GITHUB_URL}
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [online, setOnline] = useState<boolean | null>(null);
  const [sillyTavernMode, setSillyTavernMode] = useState(false);
  const [stLoading, setStLoading] = useState(true);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("proxy_api_key") ?? "");
  const [showWizard, setShowWizard] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    openai: false,
    anthropic: false,
    gemini: false,
    openrouter: false,
  });
  const [stats, setStats] = useState<Record<string, BackendStat> | null>(null);
  const [statsError, setStatsError] = useState<false | "auth" | "server">(false);
  const [routing, setRouting] = useState<{ fakeStream: boolean }>({ fakeStream: true });
  const [addUrl, setAddUrl] = useState("");
  const [addState, setAddState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [addMsg, setAddMsg] = useState("");
  const [modelStatus, setModelStatus] = useState<ModelStatus[]>([]);
  const [modelSummary, setModelSummary] = useState<Record<string, GroupSummary>>({});

  const baseUrl = window.location.origin;
  const displayUrl: string = (import.meta.env.VITE_BASE_URL as string | undefined) ?? window.location.origin;
  const totalModels = OPENAI_MODELS.length + ANTHROPIC_MODELS.length + GEMINI_MODELS.length + OPENROUTER_MODELS.length;

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/api/healthz`, { signal: AbortSignal.timeout(5000) });
      setOnline(res.ok);
    } catch {
      setOnline(false);
    }
  }, [baseUrl]);

  const fetchSTMode = useCallback(async () => {
    try {
      const key = localStorage.getItem("proxy_api_key") ?? "";
      const res = await fetch(`${baseUrl}/api/settings/sillytavern`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
      });
      if (res.ok) {
        const d = await res.json();
        setSillyTavernMode(d.enabled);
      }
    } catch {}
    setStLoading(false);
  }, [baseUrl]);

  const toggleSTMode = async () => {
    const newVal = !sillyTavernMode;
    setSillyTavernMode(newVal);
    try {
      const res = await fetch(`${baseUrl}/api/settings/sillytavern`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ enabled: newVal }),
      });
      if (!res.ok) setSillyTavernMode(!newVal);
    } catch {
      setSillyTavernMode(!newVal);
    }
  };

  const fetchStats = useCallback(async (key: string) => {
    if (!key) {
      setStats(null);
      setStatsError(false);
      return;
    }
    try {
      const r = await fetch(`${baseUrl}/api/v1/stats`, { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) {
        setStatsError(r.status === 500 ? "server" : "auth");
        return;
      }
      const d = await r.json();
      const parsed: Record<string, BackendStat> = {};
      for (const [k, v] of Object.entries(d.stats as Record<string, Record<string, unknown>>)) {
        parsed[k] = { ...(v as unknown as BackendStat), streamingCalls: (v.streamingCalls as number) ?? 0 };
      }
      setStats(parsed);
      setStatsError(false);
      if (d.routing) setRouting(d.routing);
    } catch {
      setStatsError("auth");
    }
  }, [baseUrl]);

  const addBackend = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = normalizeBackendUrl(addUrl);
    if (!url) return;
    setAddState("loading");
    try {
      const r = await fetch(`${baseUrl}/api/v1/admin/backends`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await r.json();
      if (!r.ok) {
        setAddState("err");
        setAddMsg(data.error ?? "Failed");
        return;
      }
      setAddState("ok");
      setAddMsg(`已添加 ${data.label}`);
      setAddUrl("");
      setTimeout(() => setAddState("idle"), 3000);
      fetchStats(apiKey);
    } catch {
      setAddState("err");
      setAddMsg("网络错误");
    }
  };

  const removeBackend = async (label: string) => {
    await fetch(`${baseUrl}/api/v1/admin/backends/${label}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    fetchStats(apiKey);
  };

  const toggleBackend = async (label: string, enabled: boolean) => {
    await fetch(`${baseUrl}/api/v1/admin/backends/${label}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    fetchStats(apiKey);
  };

  const batchToggleBackends = async (labels: string[], enabled: boolean) => {
    await fetch(`${baseUrl}/api/v1/admin/backends`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ labels, enabled }),
    });
    fetchStats(apiKey);
  };

  const batchRemoveBackends = async (labels: string[]) => {
    await Promise.all(
      labels.map((l) =>
        fetch(`${baseUrl}/api/v1/admin/backends/${l}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${apiKey}` },
        })
      )
    );
    fetchStats(apiKey);
  };

  const toggleRouting = async (field: "fakeStream", value: boolean) => {
    setRouting((prev) => ({ ...prev, [field]: value }));
    try {
      await fetch(`${baseUrl}/api/v1/admin/routing`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
    } catch {}
  };

  const fetchModels = useCallback(async (key: string = apiKey) => {
    if (!key) return;
    try {
      const r = await fetch(`${baseUrl}/api/v1/admin/models`, { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) return;
      const d = await r.json();
      setModelStatus(d.models ?? []);
      setModelSummary(d.summary ?? {});
    } catch {}
  }, [baseUrl, apiKey]);

  const toggleModelProvider = async (provider: string, enabled: boolean) => {
    setModelStatus((prev) => prev.map((m) => (m.provider === provider ? { ...m, enabled } : m)));
    try {
      await fetch(`${baseUrl}/api/v1/admin/models`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ provider, enabled }),
      });
    } catch {}
    fetchModels();
  };

  const toggleModelById = async (id: string, enabled: boolean) => {
    setModelStatus((prev) => prev.map((m) => (m.id === id ? { ...m, enabled } : m)));
    try {
      await fetch(`${baseUrl}/api/v1/admin/models`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], enabled }),
      });
    } catch {}
    fetchModels();
  };

  useEffect(() => {
    checkHealth();
    fetchSTMode();
    fetchStats(apiKey);
    fetchModels(apiKey);

    const iv1 = setInterval(checkHealth, 30000);
    const iv2 = setInterval(() => fetchStats(apiKey), 15000);

    return () => {
      clearInterval(iv1);
      clearInterval(iv2);
    };
  }, [checkHealth, fetchSTMode, fetchStats, fetchModels, apiKey]);

  useEffect(() => {
    if (sessionStorage.getItem("wizard_dismissed") === "1") return;
    fetch(`${baseUrl}/api/setup-status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((status: { configured: boolean } | null) => {
        if (!status || status.configured) return;
        setShowWizard(true);
      })
      .catch(() => {});
  }, [baseUrl]);

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "dashboard", label: "Dashboard", icon: "&#127968;" },
    { id: "cluster", label: "Cluster", icon: "&#128200;" },
    { id: "models", label: "Models", icon: "&#129302;" },
    { id: "playground", label: "Playground", icon: "&#128172;" },
    { id: "tutorial", label: "Tutorial", icon: "&#128214;" },
    { id: "settings", label: "Settings", icon: "&#9881;" },
    { id: "system", label: "System", icon: "&#128736;" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "hsl(222,47%,11%)", color: "#e2e8f0", fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {showWizard && (
        <SetupWizard
          baseUrl={baseUrl}
          onComplete={(key) => {
            sessionStorage.setItem("wizard_dismissed", "1");
            setShowWizard(false);
            if (key) {
              setApiKey(key);
              localStorage.setItem("proxy_api_key", key);
            }
          }}
          onDismiss={() => {
            sessionStorage.setItem("wizard_dismissed", "1");
            setShowWizard(false);
          }}
        />
      )}

      <div style={{ maxWidth: "920px", margin: "0 auto", padding: "28px 24px 80px" }}>
        <div
          style={{
            marginBottom: "24px",
            background: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.06) 50%, rgba(59,130,246,0.04) 100%)",
            border: "1px solid rgba(99,102,241,0.12)",
            borderRadius: "16px",
            padding: "24px 28px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "10px" }}>
            <div
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "12px",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6, #3b82f6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px",
                boxShadow: "0 4px 16px rgba(99,102,241,0.3)",
              }}
            >
              ⚡
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.02em" }}>Replit2Api</h1>
              <p style={{ color: "#64748b", margin: "2px 0 0", fontSize: "12.5px" }}>AI Proxy Gateway · OpenAI / Anthropic / Gemini / OpenRouter</p>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowWizard(true)}
                style={{
                  padding: "6px 14px",
                  background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.15))",
                  border: "1px solid rgba(99,102,241,0.3)",
                  borderRadius: "100px",
                  color: "#a5b4fc",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                🚀 配置向导
              </button>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  background: online === null ? "rgba(100,116,139,0.15)" : online ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
                  border: `1px solid ${online === null ? "rgba(100,116,139,0.3)" : online ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)"}`,
                  borderRadius: "100px",
                  padding: "5px 12px 5px 8px",
                }}
              >
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: online === null ? "#64748b" : online ? "#4ade80" : "#f87171" }} />
                <span style={{ fontSize: "12px", color: online === null ? "#64748b" : online ? "#4ade80" : "#f87171", fontWeight: 600 }}>
                  {online === null ? "..." : online ? "在线" : "离线"}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "2px", marginBottom: "24px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "4px", backdropFilter: "blur(8px)" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                padding: "9px 8px",
                borderRadius: "8px",
                border: "none",
                background: tab === t.id ? "linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.2))" : "transparent",
                color: tab === t.id ? "#c7d2fe" : "#475569",
                fontSize: "12.5px",
                fontWeight: tab === t.id ? 600 : 400,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "5px",
              }}
            >
              <span dangerouslySetInnerHTML={{ __html: t.icon }} style={{ fontSize: "13px" }} />
              {t.label}
            </button>
          ))}
        </div>

        {tab === "dashboard" && <PageDashboard displayUrl={displayUrl} online={online} totalModels={totalModels} stats={stats} onNavigate={setTab} />}

        {tab === "cluster" && (
          <PageCluster
            baseUrl={baseUrl}
            apiKey={apiKey}
            stats={stats}
            statsError={statsError}
            onRefresh={() => fetchStats(apiKey)}
            addUrl={addUrl}
            setAddUrl={setAddUrl}
            addState={addState}
            addMsg={addMsg}
            onAddBackend={addBackend}
            onRemoveBackend={removeBackend}
            onToggleBackend={toggleBackend}
            onBatchToggle={batchToggleBackends}
            onBatchRemove={batchRemoveBackends}
            routing={routing}
            onToggleRouting={toggleRouting}
            modelStats={{}}
          />
        )}

        {tab === "models" && (
          <PageModels
            baseUrl={baseUrl}
            apiKey={apiKey}
            modelStatus={modelStatus}
            summary={modelSummary}
            onRefresh={() => fetchModels(apiKey)}
            onToggleProvider={toggleModelProvider}
            onToggleModel={toggleModelById}
          />
        )}

        {tab === "playground" && <PagePlayground baseUrl={baseUrl} apiKey={apiKey} />}

        {tab === "tutorial" && (
          <PageTutorial
            displayUrl={displayUrl}
            totalModels={totalModels}
            onOpenWizard={() => setShowWizard(true)}
            expandedGroups={expandedGroups}
            onToggleGroup={(g) => setExpandedGroups((p) => ({ ...p, [g]: !p[g] }))}
          />
        )}

        {tab === "settings" && (
          <>
            <Card style={{ marginBottom: "16px" }}>
              <SectionTitle>Settings</SectionTitle>
              <div style={{ display: "grid", gap: "14px" }}>
                <HintCard title="本地 API Key 缓存" accent="#818cf8">
                  当前访问密码保存在当前浏览器的 <code style={{ color: "#cbd5e1" }}>localStorage.proxy_api_key</code>，仅用于 Portal 管理接口与便捷调试。
                </HintCard>
                <div>
                  <label style={{ fontSize: "12px", color: "#64748b", display: "block", marginBottom: "6px" }}>API Key（PROXY_API_KEY）</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => { setApiKey(e.target.value); localStorage.setItem("proxy_api_key", e.target.value); }}
                    placeholder="输入你的 PROXY_API_KEY"
                    style={{
                      width: "100%",
                      background: "rgba(0,0,0,0.3)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "8px",
                      padding: "8px 12px",
                      color: "#e2e8f0",
                      fontFamily: "Menlo, monospace",
                      fontSize: "13px",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: "#cbd5e1", fontSize: "13.5px", marginBottom: "3px" }}>SillyTavern 兼容模式</div>
                    <p style={{ margin: 0, color: "#475569", fontSize: "12.5px", lineHeight: "1.5" }}>
                      启用后对 Claude 自动追加空 user 消息，修复角色顺序要求。
                    </p>
                  </div>
                  <button
                    onClick={toggleSTMode}
                    disabled={stLoading || !apiKey}
                    style={{
                      width: "52px",
                      height: "28px",
                      borderRadius: "14px",
                      border: "none",
                      background: sillyTavernMode ? "#6366f1" : "rgba(255,255,255,0.12)",
                      cursor: (stLoading || !apiKey) ? "not-allowed" : "pointer",
                      position: "relative",
                      transition: "background 0.2s",
                      flexShrink: 0,
                      opacity: (stLoading || !apiKey) ? 0.5 : 1,
                    }}
                  >
                    <div
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "50%",
                        background: "#fff",
                        position: "absolute",
                        top: "3px",
                        left: sillyTavernMode ? "27px" : "3px",
                        transition: "left 0.2s",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                      }}
                    />
                  </button>
                </div>
              </div>
            </Card>

            <MaintenanceCenter baseUrl={baseUrl} />
          </>
        )}

        {tab === "system" && (
          <SystemTab />
        )}

        <div style={{ marginTop: "32px", textAlign: "center", color: "#1e293b", fontSize: "12px" }}>
          OpenAI · Anthropic · Gemini · OpenRouter
        </div>
      </div>
    </div>
  );
}
