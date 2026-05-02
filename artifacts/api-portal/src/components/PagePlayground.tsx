import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: number;
  role: "system" | "user" | "assistant";
  content: string;
  reasoning?: string;
  model?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  durationMs?: number;
  ttftMs?: number;
  error?: string;
  streaming?: boolean;
}

interface PresetModel {
  id: string;
  label: string;
  hint?: string;
}

const PRESET_MODELS: PresetModel[] = [
  { id: "gpt-5.1", label: "GPT-5.1", hint: "OpenAI 旗舰" },
  { id: "claude-opus-4-7-thinking-max", label: "Claude Opus 4.7 (thinking-max)", hint: "Anthropic native · 扩展思考" },
  { id: "claude-sonnet-4-6-thinking", label: "Claude Sonnet 4.6 (thinking)", hint: "Anthropic native · 思考" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Google native" },
  { id: "anthropic/claude-opus-4.7", label: "Claude Opus 4.7 (OR)", hint: "OpenRouter" },
  { id: "openai/gpt-5.1", label: "GPT-5.1 (OR)", hint: "OpenRouter" },
];

// ─── Mini Markdown parser (streaming-aware) ─────────────────────────────────

type MdNode =
  | { type: "code"; lang: string; content: string; closed: boolean }
  | { type: "think"; content: string; closed: boolean }
  | { type: "text"; content: string };

function parseMd(text: string): MdNode[] {
  const nodes: MdNode[] = [];
  let i = 0;
  while (i < text.length) {
    const codeOpen = text.indexOf("```", i);
    const thinkOpen = text.indexOf("<think>", i);
    let kind: "code" | "think" | null = null;
    let pos = -1;
    if (codeOpen !== -1 && (thinkOpen === -1 || codeOpen < thinkOpen)) {
      kind = "code";
      pos = codeOpen;
    } else if (thinkOpen !== -1) {
      kind = "think";
      pos = thinkOpen;
    }
    if (kind === null) {
      nodes.push({ type: "text", content: text.slice(i) });
      break;
    }
    if (pos > i) nodes.push({ type: "text", content: text.slice(i, pos) });
    if (kind === "code") {
      const after = pos + 3;
      const nl = text.indexOf("\n", after);
      const lang = nl === -1 ? text.slice(after).trim() : text.slice(after, nl).trim();
      const bodyStart = nl === -1 ? text.length : nl + 1;
      const close = text.indexOf("```", bodyStart);
      if (close === -1) {
        nodes.push({ type: "code", lang, content: text.slice(bodyStart), closed: false });
        break;
      }
      nodes.push({ type: "code", lang, content: text.slice(bodyStart, close), closed: true });
      i = close + 3;
    } else {
      const after = pos + "<think>".length;
      const close = text.indexOf("</think>", after);
      if (close === -1) {
        nodes.push({ type: "think", content: text.slice(after), closed: false });
        break;
      }
      nodes.push({ type: "think", content: text.slice(after, close), closed: true });
      i = close + "</think>".length;
    }
  }
  return nodes;
}

const inlineCodeStyle: React.CSSProperties = {
  background: "rgba(99,102,241,0.12)",
  border: "1px solid rgba(99,102,241,0.18)",
  borderRadius: "4px",
  padding: "0 5px",
  fontSize: "12.5px",
  color: "#c7d2fe",
  fontFamily: "'JetBrains Mono', monospace",
};
const linkStyle: React.CSSProperties = { color: "#a5b4fc", textDecoration: "underline" };

function renderInline(text: string, baseKey: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re =
    /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\n]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(<code key={`${baseKey}-${k++}`} style={inlineCodeStyle}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      out.push(<strong key={`${baseKey}-${k++}`} style={{ color: "#f1f5f9" }}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      out.push(<em key={`${baseKey}-${k++}`}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("[")) {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) out.push(<a key={`${baseKey}-${k++}`} href={lm[2]} target="_blank" rel="noreferrer" style={linkStyle}>{lm[1]}</a>);
      else out.push(tok);
    } else {
      out.push(tok);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function MdText({ text, baseKey }: { text: string; baseKey: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((ln, i) => (
        <span key={`${baseKey}-l-${i}`}>
          {renderInline(ln, `${baseKey}-l-${i}`)}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

function CodeBlock({ lang, content, closed }: { lang: string; content: string; closed: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div
      style={{
        margin: "8px 0",
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(0,0,0,0.45)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "5px 12px",
          background: "rgba(99,102,241,0.07)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          fontSize: "10.5px",
          color: "#a5b4fc",
          fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: "0.04em",
        }}
      >
        <span style={{ textTransform: "lowercase" }}>
          {lang || "text"}
          {!closed && <span style={{ color: "#fbbf24", marginLeft: "8px" }}>· streaming</span>}
        </span>
        <button
          onClick={copy}
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "4px",
            color: copied ? "#22c55e" : "#94a3b8",
            cursor: "pointer",
            fontSize: "10px",
            padding: "1px 8px",
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "10px 14px",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "12.5px",
          color: "#e2e8f0",
          overflow: "auto",
          maxHeight: "440px",
          whiteSpace: "pre",
          lineHeight: 1.55,
        }}
      >
        {content}
      </pre>
    </div>
  );
}

function ThinkBlock({ content, closed, defaultOpen }: { content: string; closed: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? !closed);
  return (
    <div
      style={{
        margin: "6px 0",
        borderRadius: "8px",
        border: "1px dashed rgba(168,162,238,0.25)",
        background: "rgba(99,102,241,0.04)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "rgba(99,102,241,0.05)",
          border: "none",
          padding: "5px 12px",
          fontSize: "10.5px",
          color: "#a5b4fc",
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>
          🧠 thinking{!closed && <span style={{ color: "#fbbf24", marginLeft: "8px" }}>· streaming</span>}
        </span>
        <span style={{ transform: open ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.18s" }}>›</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                padding: "8px 14px 10px",
                fontSize: "12.5px",
                color: "#a5b4cf",
                fontStyle: "italic",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                fontFamily: "'Inter', -apple-system, sans-serif",
              }}
            >
              {content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MdRender({ text, baseKey }: { text: string; baseKey: string }) {
  const nodes = useMemo(() => parseMd(text), [text]);
  return (
    <div>
      {nodes.map((n, i) => {
        const k = `${baseKey}-n${i}`;
        if (n.type === "code") return <CodeBlock key={k} lang={n.lang} content={n.content} closed={n.closed} />;
        if (n.type === "think") return <ThinkBlock key={k} content={n.content} closed={n.closed} />;
        return <MdText key={k} text={n.content} baseKey={k} />;
      })}
    </div>
  );
}

// ─── Message bubble ─────────────────────────────────────────────────────────

function MessageBubble({ msg, onCopy, onDelete }: { msg: ChatMessage; onCopy: () => void; onDelete: () => void }) {
  const [hover, setHover] = useState(false);
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";
  const align = isUser ? "flex-end" : "flex-start";

  if (isSystem) {
    return (
      <div style={{ textAlign: "center", color: "#64748b", fontSize: "11.5px", padding: "6px 0" }}>
        <span
          style={{
            background: "rgba(99,102,241,0.07)",
            border: "1px dashed rgba(99,102,241,0.2)",
            borderRadius: "100px",
            padding: "3px 12px",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          system: {msg.content || "(empty)"}
        </span>
      </div>
    );
  }

  const bg = isUser
    ? "linear-gradient(135deg, rgba(99,102,241,0.18), rgba(139,92,246,0.14))"
    : "rgba(0,0,0,0.32)";
  const border = isUser ? "1px solid rgba(99,102,241,0.28)" : "1px solid rgba(255,255,255,0.06)";

  return (
    <div
      style={{ display: "flex", justifyContent: align, padding: "4px 0" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ maxWidth: "min(720px, 92%)", display: "flex", flexDirection: "column", gap: "4px", alignItems: align }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "10.5px", color: "#64748b", padding: "0 6px" }}>
          <span style={{ fontWeight: 700, color: isUser ? "#a5b4fc" : "#94a3b8", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            {msg.role}
          </span>
          {msg.model && <span style={{ color: "#64748b", fontFamily: "'JetBrains Mono', monospace" }}>{msg.model}</span>}
          {msg.streaming && <span style={{ color: "#fbbf24" }}>· streaming</span>}
          {msg.usage && (
            <span style={{ color: "#475569", fontFamily: "'JetBrains Mono', monospace" }}>
              {msg.usage.promptTokens ?? "?"}↓ {msg.usage.completionTokens ?? "?"}↑
            </span>
          )}
          {typeof msg.ttftMs === "number" && (
            <span style={{ color: "#475569", fontFamily: "'JetBrains Mono', monospace" }}>ttft {msg.ttftMs}ms</span>
          )}
          {typeof msg.durationMs === "number" && !msg.streaming && (
            <span style={{ color: "#475569", fontFamily: "'JetBrains Mono', monospace" }}>{msg.durationMs}ms</span>
          )}
        </div>
        <div
          style={{
            background: bg,
            border,
            borderRadius: "12px",
            padding: "10px 14px",
            color: "#e2e8f0",
            fontSize: "13.5px",
            lineHeight: 1.65,
            wordBreak: "break-word",
            position: "relative",
          }}
        >
          {msg.reasoning && (
            <ThinkBlock content={msg.reasoning} closed={!msg.streaming} defaultOpen={!!msg.streaming} />
          )}
          {msg.content ? (
            <MdRender text={msg.content} baseKey={`m${msg.id}`} />
          ) : msg.streaming && !msg.reasoning ? (
            <div style={{ color: "#64748b", fontStyle: "italic" }}>等待回复…</div>
          ) : null}
          {msg.error && (
            <div
              style={{
                marginTop: msg.content ? "8px" : 0,
                padding: "6px 10px",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.25)",
                borderRadius: "6px",
                color: "#fca5a5",
                fontSize: "12px",
                fontFamily: "'JetBrains Mono', monospace",
                whiteSpace: "pre-wrap",
              }}
            >
              {msg.error}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            gap: "6px",
            opacity: hover ? 1 : 0,
            transition: "opacity 0.15s",
            padding: "0 6px",
          }}
        >
          <button
            onClick={onCopy}
            style={{
              fontSize: "10px",
              padding: "1px 8px",
              borderRadius: "4px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#94a3b8",
              cursor: "pointer",
            }}
          >
            copy
          </button>
          <button
            onClick={onDelete}
            style={{
              fontSize: "10px",
              padding: "1px 8px",
              borderRadius: "4px",
              background: "rgba(239,68,68,0.05)",
              border: "1px solid rgba(239,68,68,0.15)",
              color: "#f87171",
              cursor: "pointer",
            }}
          >
            delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function PagePlayground({ baseUrl, apiKey }: { baseUrl: string; apiKey: string }) {
  const [model, setModel] = useState<string>(() => localStorage.getItem("playground_model") || PRESET_MODELS[0]!.id);
  const [system, setSystem] = useState<string>(() => localStorage.getItem("playground_system") || "");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);

  useEffect(() => {
    localStorage.setItem("playground_model", model);
  }, [model]);
  useEffect(() => {
    localStorage.setItem("playground_system", system);
  }, [system]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, messages[messages.length - 1]?.content, messages[messages.length - 1]?.reasoning]);

  const appendMessage = useCallback((m: Omit<ChatMessage, "id">) => {
    const id = ++idCounter.current;
    setMessages((prev) => [...prev, { ...m, id }]);
    return id;
  }, []);

  const updateMessage = useCallback((id: number, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const updateMessageContent = useCallback((id: number, fn: (m: ChatMessage) => Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)));
  }, []);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setBusy(false);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (!apiKey) {
      appendMessage({ role: "assistant", content: "", error: "Proxy API key 未配置" });
      return;
    }
    setInput("");

    appendMessage({ role: "user", content: text });

    // Build OpenAI-compat messages
    const apiMessages: Array<{ role: string; content: string }> = [];
    if (system.trim()) apiMessages.push({ role: "system", content: system.trim() });
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.error || (!m.content && !m.reasoning)) continue;
      apiMessages.push({ role: m.role, content: m.content });
    }
    apiMessages.push({ role: "user", content: text });

    const assistantId = appendMessage({
      role: "assistant",
      content: "",
      model,
      streaming,
    });

    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const t0 = performance.now();
    let firstByteAt: number | null = null;

    const body: Record<string, unknown> = {
      model,
      messages: apiMessages,
      stream: streaming,
    };
    if (temperature >= 0) body.temperature = temperature;
    if (maxTokens > 0) body.max_tokens = maxTokens;
    if (streaming) body.stream_options = { include_usage: true };

    try {
      const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const txt = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(txt);
          msg = parsed?.error?.message || parsed?.message || JSON.stringify(parsed);
        } catch {
          if (txt) msg = txt;
        }
        updateMessage(assistantId, { streaming: false, error: msg, durationMs: Math.round(performance.now() - t0) });
        return;
      }

      if (!streaming) {
        const json = await res.json();
        const choice = json?.choices?.[0];
        const content: string = choice?.message?.content ?? "";
        const reasoning: string | undefined = choice?.message?.reasoning_content ?? choice?.message?.reasoning;
        const usage = json?.usage
          ? {
              promptTokens: json.usage.prompt_tokens,
              completionTokens: json.usage.completion_tokens,
            }
          : undefined;
        updateMessage(assistantId, {
          content,
          reasoning,
          usage,
          streaming: false,
          durationMs: Math.round(performance.now() - t0),
        });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        updateMessage(assistantId, { streaming: false, error: "No response body" });
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let terminated = false;

      // SSE event-frame parsing: events are separated by blank line (\n\n).
      // A single event may contain multiple `data:` lines that must be
      // concatenated with \n before JSON.parse (per the SSE spec).
      const processEvent = (evt: string): boolean => {
        const dataLines: string[] = [];
        for (const raw of evt.split("\n")) {
          const ln = raw.replace(/\r$/, "");
          if (!ln || ln.startsWith(":")) continue; // comment/heartbeat
          if (!ln.startsWith("data:")) continue;
          // Strip "data:" and at most one leading space (per spec)
          dataLines.push(ln.slice(5).replace(/^ /, ""));
        }
        if (dataLines.length === 0) return false;
        const payload = dataLines.join("\n");
        if (payload === "[DONE]") return true;
        let json: Record<string, unknown> | null = null;
        try {
          json = JSON.parse(payload);
        } catch {
          return false;
        }
        if (!json) return false;
        const choices = (json["choices"] as Array<Record<string, unknown>> | undefined) ?? [];
        const delta = choices[0]?.["delta"] as Record<string, unknown> | undefined;
        const usage = json["usage"] as { prompt_tokens?: number; completion_tokens?: number } | undefined;
        if (delta) {
          const dc = delta["content"];
          const dr = (delta["reasoning_content"] ?? delta["reasoning"]) as string | undefined;
          if (firstByteAt === null && (dc || dr)) {
            firstByteAt = performance.now();
            const ttft = Math.round(firstByteAt - t0);
            updateMessage(assistantId, { ttftMs: ttft });
          }
          if (typeof dc === "string" && dc.length > 0) {
            updateMessageContent(assistantId, (m) => ({ content: (m.content ?? "") + dc }));
          }
          if (typeof dr === "string" && dr.length > 0) {
            updateMessageContent(assistantId, (m) => ({ reasoning: (m.reasoning ?? "") + dr }));
          }
        }
        if (usage) {
          updateMessage(assistantId, {
            usage: {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
            },
          });
        }
        return false;
      };

      while (!terminated) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sepIdx: number;
        // Accept both \n\n and \r\n\r\n as event separators
        while (true) {
          const a = buffer.indexOf("\n\n");
          const b = buffer.indexOf("\r\n\r\n");
          if (a === -1 && b === -1) {
            sepIdx = -1;
            break;
          }
          let sepLen: number;
          if (a === -1) {
            sepIdx = b;
            sepLen = 4;
          } else if (b === -1) {
            sepIdx = a;
            sepLen = 2;
          } else if (a < b) {
            sepIdx = a;
            sepLen = 2;
          } else {
            sepIdx = b;
            sepLen = 4;
          }
          const evt = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + sepLen);
          if (processEvent(evt)) {
            terminated = true;
            break;
          }
        }
      }
      // Drain any final event without trailing blank line
      if (!terminated && buffer.trim().length > 0) {
        processEvent(buffer);
      }
      // Stop reader if server keeps the connection open after DONE
      if (terminated) {
        try { await reader.cancel(); } catch { /* ignore */ }
      }
      updateMessage(assistantId, {
        streaming: false,
        durationMs: Math.round(performance.now() - t0),
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        updateMessage(assistantId, { streaming: false, error: "(已停止)" });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      updateMessage(assistantId, {
        streaming: false,
        error: msg,
        durationMs: Math.round(performance.now() - t0),
      });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [apiKey, baseUrl, busy, input, maxTokens, messages, model, streaming, system, temperature, appendMessage, updateMessage, updateMessageContent]);

  if (!apiKey) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", color: "#64748b" }}>
        <div style={{ fontSize: "40px", marginBottom: "12px" }}>&#128274;</div>
        <div style={{ fontSize: "15px" }}>请先在 Settings 输入 Proxy Key</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* ─── Header ─────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
          padding: "10px 14px",
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
            Model
          </span>
          <input
            list="playground-models"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="例如 claude-opus-4-7-thinking-max"
            style={{
              flex: 1,
              minWidth: "260px",
              fontSize: "12.5px",
              padding: "5px 10px",
              borderRadius: "6px",
              background: "rgba(0,0,0,0.4)",
              color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,0.08)",
              outline: "none",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          />
          <datalist id="playground-models">
            {PRESET_MODELS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}{p.hint ? ` — ${p.hint}` : ""}</option>
            ))}
          </datalist>
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              fontSize: "11.5px",
              color: streaming ? "#a5b4fc" : "#64748b",
              cursor: "pointer",
              padding: "3px 9px",
              borderRadius: "12px",
              border: "1px solid",
              borderColor: streaming ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.08)",
              background: streaming ? "rgba(99,102,241,0.08)" : "transparent",
            }}
          >
            <input
              type="checkbox"
              checked={streaming}
              onChange={(e) => setStreaming(e.target.checked)}
              style={{ margin: 0 }}
            />
            stream
          </label>
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              fontSize: "11.5px",
              padding: "3px 10px",
              borderRadius: "6px",
              border: "1px solid rgba(255,255,255,0.08)",
              background: showSettings ? "rgba(99,102,241,0.12)" : "transparent",
              color: showSettings ? "#a5b4fc" : "#94a3b8",
              cursor: "pointer",
            }}
          >
            ⚙ params
          </button>
          <button
            onClick={() => {
              setMessages([]);
              setInput("");
            }}
            disabled={busy}
            style={{
              fontSize: "11.5px",
              padding: "3px 10px",
              borderRadius: "6px",
              border: "1px solid rgba(239,68,68,0.18)",
              background: "rgba(239,68,68,0.06)",
              color: "#f87171",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            清空
          </button>
        </div>
      </div>

      {/* ─── Params panel ───────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "12px",
                padding: "12px 14px",
                background: "rgba(0,0,0,0.25)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "12px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
                  System prompt
                </label>
                <textarea
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  placeholder="留空 = 不发送 system 消息"
                  style={{
                    minHeight: "60px",
                    background: "rgba(0,0,0,0.4)",
                    color: "#e2e8f0",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "6px",
                    padding: "6px 10px",
                    fontSize: "12.5px",
                    fontFamily: "'JetBrains Mono', monospace",
                    resize: "vertical",
                    outline: "none",
                  }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
                    Temperature: <span style={{ color: "#a5b4fc", fontFamily: "'JetBrains Mono', monospace" }}>{temperature.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
                    Max tokens: <span style={{ color: "#a5b4fc", fontFamily: "'JetBrains Mono', monospace" }}>{maxTokens === 0 ? "auto" : maxTokens}</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={256}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 0)}
                    placeholder="0 = auto"
                    style={{
                      background: "rgba(0,0,0,0.4)",
                      color: "#e2e8f0",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "6px",
                      padding: "5px 10px",
                      fontSize: "12.5px",
                      fontFamily: "'JetBrains Mono', monospace",
                      outline: "none",
                    }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Messages ──────────────────────────────────────── */}
      <div
        ref={scrollRef}
        style={{
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "12px",
          minHeight: "320px",
          maxHeight: "60vh",
          overflowY: "auto",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#475569", padding: "60px 0", fontSize: "13px" }}>
            <div style={{ fontSize: "32px", marginBottom: "10px" }}>💬</div>
            发起一次对话来验证模型 — 支持 OpenAI / Anthropic / Gemini / OpenRouter 别名
            <div style={{ marginTop: "8px", fontSize: "11.5px", color: "#334155" }}>
              带 <code style={inlineCodeStyle}>-thinking</code> /
              <code style={{ ...inlineCodeStyle, marginLeft: "4px" }}>-max</code>
              的后缀也支持，能看到思考链折叠。
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            msg={m}
            onCopy={() => navigator.clipboard.writeText(m.content || "")}
            onDelete={() => setMessages((prev) => prev.filter((x) => x.id !== m.id))}
          />
        ))}
      </div>

      {/* ─── Composer ──────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "flex-end",
          padding: "10px 12px",
          background: "rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "12px",
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (!busy) send();
            }
          }}
          placeholder={busy ? "生成中… (Ctrl/⌘+Enter 发送)" : "输入消息 — Ctrl/⌘+Enter 发送"}
          disabled={busy}
          style={{
            flex: 1,
            minHeight: "44px",
            maxHeight: "200px",
            background: "rgba(0,0,0,0.35)",
            color: "#e2e8f0",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "8px",
            padding: "9px 12px",
            fontSize: "13.5px",
            fontFamily: "inherit",
            resize: "vertical",
            outline: "none",
            opacity: busy ? 0.7 : 1,
          }}
        />
        {busy ? (
          <button
            onClick={stop}
            style={{
              padding: "10px 20px",
              borderRadius: "10px",
              border: "1px solid rgba(239,68,68,0.3)",
              background: "linear-gradient(135deg, rgba(239,68,68,0.2), rgba(220,38,38,0.18))",
              color: "#fca5a5",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            停止
          </button>
        ) : (
          <button
            onClick={send}
            disabled={!input.trim()}
            style={{
              padding: "10px 22px",
              borderRadius: "10px",
              border: "1px solid rgba(99,102,241,0.4)",
              background: input.trim()
                ? "linear-gradient(135deg, rgba(99,102,241,0.3), rgba(139,92,246,0.25))"
                : "rgba(255,255,255,0.04)",
              color: input.trim() ? "#c7d2fe" : "#475569",
              fontWeight: 700,
              fontSize: "13px",
              cursor: input.trim() ? "pointer" : "not-allowed",
              flexShrink: 0,
              transition: "all 0.15s",
            }}
          >
            发送 ↵
          </button>
        )}
      </div>
    </div>
  );
}
