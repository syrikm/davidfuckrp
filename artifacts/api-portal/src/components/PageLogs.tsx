import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";
import { AnimatePresence, motion } from "framer-motion";

interface LogEntry {
  id: number;
  time: string;
  method: string;
  path: string;
  model?: string;
  backend?: string;
  status: number;
  duration: number;
  stream: boolean;
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheTier?: string;
  msgSummary?: string;
  priceUSD?: number;
  level: "info" | "warn" | "error";
  error?: string;
}

const LEVEL_COLORS: Record<string, string> = {
  info: "#22c55e",
  warn: "#f59e0b",
  error: "#ef4444",
};

const STATUS_COLOR = (s: number) => (s >= 500 ? "#ef4444" : s >= 400 ? "#f59e0b" : "#22c55e");

const fmtUSD = (n: number) => {
  if (n === 0) return "$0";
  if (n < 0.000_01) return `$${n.toExponential(1)}`;
  if (n < 0.01) return `$${n.toFixed(5)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
};

const fmtTok = (n: number) => {
  if (n < 1_000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
};

const fmtMs = (n: number) => {
  if (n < 1_000) return `${n}ms`;
  return `${(n / 1_000).toFixed(2)}s`;
};

function MiniKpi({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        flex: "1 1 110px",
        minWidth: "110px",
        background: "rgba(0,0,0,0.25)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: "10px",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "3px",
      }}
    >
      <div style={{ fontSize: "10.5px", color: "#64748b", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: "17px", fontWeight: 700, color: color ?? "#e2e8f0", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "-0.02em" }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: "10.5px", color: "#475569", marginTop: "1px" }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function LogRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: LogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const totalIn = entry.promptTokens ?? 0;
  const totalOut = entry.completionTokens ?? 0;
  const cacheIn = entry.cacheReadTokens ?? 0;
  const cacheOut = entry.cacheWriteTokens ?? 0;
  const hasCache = cacheIn > 0 || cacheOut > 0;
  const hasUsage = totalIn > 0 || totalOut > 0;

  const hue = expanded ? "rgba(99,102,241,0.06)" : "transparent";

  return (
    <div
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        background: hue,
        transition: "background 0.15s",
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          padding: "6px 10px",
          cursor: "pointer",
          display: "flex",
          gap: "8px",
          alignItems: "center",
          color: "inherit",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "12px",
          lineHeight: 1.6,
        }}
      >
        <span style={{ color: "#475569", flexShrink: 0, width: "62px" }}>{entry.time.slice(11, 19)}</span>
        <span
          style={{
            color: LEVEL_COLORS[entry.level],
            fontWeight: 700,
            width: "44px",
            flexShrink: 0,
            fontSize: "10.5px",
            letterSpacing: "0.04em",
          }}
        >
          {entry.level.toUpperCase()}
        </span>
        <span style={{ color: "#94a3b8", flexShrink: 0, width: "44px" }}>{entry.method}</span>
        <span
          style={{
            color: "#cbd5e1",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
          title={entry.path}
        >
          {entry.path}
        </span>
        {entry.model && (
          <span
            style={{
              color: "#a5b4fc",
              flexShrink: 0,
              maxWidth: "180px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "11.5px",
            }}
            title={entry.model}
          >
            {entry.model}
          </span>
        )}
        {entry.stream && (
          <span
            style={{
              color: "#818cf8",
              flexShrink: 0,
              fontSize: "9.5px",
              fontWeight: 700,
              border: "1px solid rgba(129,140,248,0.3)",
              borderRadius: "3px",
              padding: "0 4px",
            }}
          >
            SSE
          </span>
        )}
        {hasCache && (
          <span
            style={{
              color: "#34d399",
              flexShrink: 0,
              fontSize: "9.5px",
              fontWeight: 700,
              border: "1px solid rgba(52,211,153,0.3)",
              borderRadius: "3px",
              padding: "0 4px",
            }}
            title={`cache read ${cacheIn} / write ${cacheOut}${entry.cacheTier ? ` · tier ${entry.cacheTier}` : ""}`}
          >
            CACHE
          </span>
        )}
        <span style={{ color: STATUS_COLOR(entry.status), flexShrink: 0, fontWeight: 600, width: "32px", textAlign: "right" }}>
          {entry.status}
        </span>
        <span style={{ color: "#64748b", flexShrink: 0, width: "60px", textAlign: "right" }}>{fmtMs(entry.duration)}</span>
        <span style={{ color: "#475569", flexShrink: 0, width: "16px", textAlign: "center", transition: "transform 0.2s", transform: expanded ? "rotate(90deg)" : "rotate(0)" }}>
          ›
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                padding: "10px 14px 16px 80px",
                background: "rgba(0,0,0,0.25)",
                borderTop: "1px solid rgba(255,255,255,0.04)",
                fontFamily: "'Inter', -apple-system, sans-serif",
                fontSize: "12px",
                color: "#94a3b8",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "8px" }}>
                <KV k="time" v={entry.time} />
                {entry.backend && <KV k="backend" v={entry.backend} />}
                {entry.model && <KV k="model" v={entry.model} mono />}
                {hasUsage && <KV k="prompt" v={`${fmtTok(totalIn)} tok`} mono />}
                {hasUsage && <KV k="completion" v={`${fmtTok(totalOut)} tok`} mono />}
                {hasCache && <KV k="cache read" v={`${fmtTok(cacheIn)} tok`} color="#34d399" mono />}
                {hasCache && <KV k="cache write" v={`${fmtTok(cacheOut)} tok`} color="#34d399" mono />}
                {entry.cacheTier && <KV k="cache tier" v={entry.cacheTier} mono />}
                {typeof entry.priceUSD === "number" && <KV k="cost" v={fmtUSD(entry.priceUSD)} color="#fbbf24" mono />}
                <KV k="latency" v={fmtMs(entry.duration)} mono />
                <KV k="stream" v={entry.stream ? "yes" : "no"} mono />
              </div>
              {entry.msgSummary && (
                <div>
                  <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px", fontWeight: 600 }}>
                    request
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: "8px 10px",
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid rgba(255,255,255,0.05)",
                      borderRadius: "6px",
                      fontSize: "11.5px",
                      color: "#cbd5e1",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: "180px",
                      overflow: "auto",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {entry.msgSummary}
                  </pre>
                </div>
              )}
              {entry.error && (
                <div>
                  <div style={{ fontSize: "10.5px", color: "#f87171", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px", fontWeight: 600 }}>
                    error
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: "8px 10px",
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.2)",
                      borderRadius: "6px",
                      fontSize: "11.5px",
                      color: "#fca5a5",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: "180px",
                      overflow: "auto",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {entry.error}
                  </pre>
                </div>
              )}
              <div style={{ display: "flex", gap: "8px", marginTop: "2px" }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
                  }}
                  style={{
                    fontSize: "10.5px",
                    padding: "3px 10px",
                    borderRadius: "6px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.04)",
                    color: "#94a3b8",
                    cursor: "pointer",
                  }}
                >
                  copy json
                </button>
                {entry.path && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(entry.path);
                    }}
                    style={{
                      fontSize: "10.5px",
                      padding: "3px 10px",
                      borderRadius: "6px",
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "rgba(255,255,255,0.04)",
                      color: "#94a3b8",
                      cursor: "pointer",
                    }}
                  >
                    copy path
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function KV({ k, v, color, mono }: { k: string; v: string; color?: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      <div style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>{k}</div>
      <div
        style={{
          fontSize: "11.5px",
          color: color ?? "#cbd5e1",
          fontFamily: mono ? "'JetBrains Mono', monospace" : undefined,
          wordBreak: "break-all",
        }}
      >
        {v}
      </div>
    </div>
  );
}

export default function PageLogs({ baseUrl, apiKey }: { baseUrl: string; apiKey: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "info" | "warn" | "error">("all");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);
  const unmounted = useRef(false);

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const connectStream = useCallback(async () => {
    if (!apiKey || unmounted.current) return;
    cleanup();

    try {
      const histRes = await fetch(`${baseUrl}/api/v1/admin/logs`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!histRes.ok) {
        const body = await histRes.json().catch(() => ({}));
        const msg = body?.error?.message || `HTTP ${histRes.status}`;
        setConnError(msg);
        setConnected(false);
        scheduleReconnect();
        return;
      }
      const histData = await histRes.json();
      if (histData.logs && !unmounted.current) setLogs(histData.logs);
    } catch {
      /* fall through */
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`${baseUrl}/api/v1/admin/logs/stream?key=${encodeURIComponent(apiKey)}`, {
        headers: { Accept: "text/event-stream" },
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body?.error?.message || `HTTP ${res.status}`;
        setConnError(msg);
        setConnected(false);
        scheduleReconnect();
        return;
      }

      setConnected(true);
      setConnError(null);
      retryCount.current = 0;

      const reader = res.body?.getReader();
      if (!reader) {
        scheduleReconnect();
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done || unmounted.current) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const entry = JSON.parse(line.slice(6)) as LogEntry;
              setLogs((prev) => {
                const next = [...prev, entry];
                return next.length > 200 ? next.slice(-200) : next;
              });
            } catch {
              /* ignore malformed frame */
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }

    if (!unmounted.current) {
      setConnected(false);
      scheduleReconnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, apiKey, cleanup]);

  const scheduleReconnect = useCallback(() => {
    if (unmounted.current) return;
    const delay = Math.min(2000 * Math.pow(2, retryCount.current), 30000);
    retryCount.current++;
    reconnectTimer.current = setTimeout(() => {
      if (!unmounted.current) connectStream();
    }, delay);
  }, [connectStream]);

  useEffect(() => {
    unmounted.current = false;
    connectStream();
    return () => {
      unmounted.current = true;
      cleanup();
      setConnected(false);
    };
  }, [connectStream, cleanup]);

  useEffect(() => {
    if (autoScroll && scrollRef.current && expandedId === null) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll, expandedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (filter !== "all" && l.level !== filter) return false;
      if (q) {
        const hay = `${l.path} ${l.model ?? ""} ${l.backend ?? ""} ${l.method} ${l.status} ${l.error ?? ""} ${l.msgSummary ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, filter, search]);

  const stats = useMemo(() => {
    const total = filtered.length;
    let errors = 0;
    let durSum = 0;
    let costSum = 0;
    let promptSum = 0;
    let completionSum = 0;
    let cacheReadSum = 0;
    let cacheWriteSum = 0;
    const durs: number[] = [];
    for (const l of filtered) {
      if (l.status >= 400) errors++;
      durSum += l.duration;
      durs.push(l.duration);
      costSum += l.priceUSD ?? 0;
      promptSum += l.promptTokens ?? 0;
      completionSum += l.completionTokens ?? 0;
      cacheReadSum += l.cacheReadTokens ?? 0;
      cacheWriteSum += l.cacheWriteTokens ?? 0;
    }
    durs.sort((a, b) => a - b);
    const p95 = durs.length > 0 ? durs[Math.floor(durs.length * 0.95)] : 0;
    const avg = total > 0 ? Math.round(durSum / total) : 0;
    const errorRate = total > 0 ? (errors / total) * 100 : 0;
    const cacheTotal = cacheReadSum + promptSum;
    const cacheHitRate = cacheTotal > 0 ? (cacheReadSum / cacheTotal) * 100 : 0;
    return {
      total,
      errors,
      errorRate,
      avg,
      p95,
      costSum,
      promptSum,
      completionSum,
      cacheReadSum,
      cacheWriteSum,
      cacheHitRate,
    };
  }, [filtered]);

  const sparkData = useMemo(
    () =>
      filtered.slice(-60).map((l, i) => ({
        idx: i,
        duration: l.duration,
        status: l.status,
      })),
    [filtered],
  );

  const downloadLogs = (fmt: "txt" | "json") => {
    let blob: Blob;
    if (fmt === "json") {
      blob = new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
    } else {
      const text = filtered
        .map(
          (l) =>
            `[${l.time}] ${l.level.toUpperCase()} ${l.method} ${l.path} → ${l.status} ${l.duration}ms ${l.model ?? ""} (${l.backend ?? ""})${l.priceUSD ? ` ${fmtUSD(l.priceUSD)}` : ""}${l.error ? ` ERROR=${l.error}` : ""}`,
        )
        .join("\n");
      blob = new Blob([text], { type: "text/plain" });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proxy-logs-${new Date().toISOString().slice(0, 10)}.${fmt}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!apiKey) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px", color: "#64748b" }}>
        <div style={{ fontSize: "40px", marginBottom: "12px" }}>&#128274;</div>
        <div style={{ fontSize: "15px" }}>请先在首页输入 Proxy Key</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* ─── Top control bar ─────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: connected ? "#22c55e" : "#ef4444",
              boxShadow: connected ? "0 0 8px #22c55e" : "none",
            }}
          />
          <span style={{ fontSize: "12.5px", color: connected ? "#22c55e" : "#ef4444" }}>
            {connected ? "已连接" : connError ? `连接失败: ${connError}` : "重连中..."}
          </span>
          {!connected && (
            <button
              onClick={() => {
                retryCount.current = 0;
                setConnError(null);
                connectStream();
              }}
              style={{
                fontSize: "11.5px",
                padding: "3px 10px",
                borderRadius: "6px",
                background: "rgba(99,102,241,0.2)",
                color: "#a5b4fc",
                border: "1px solid rgba(99,102,241,0.3)",
                cursor: "pointer",
              }}
            >
              立即重连
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜 path / model / backend / error…"
            style={{
              fontSize: "11.5px",
              padding: "4px 10px",
              borderRadius: "6px",
              background: "rgba(0,0,0,0.3)",
              color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,0.08)",
              outline: "none",
              width: "210px",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          />
          {(["all", "info", "warn", "error"] as const).map((lv) => (
            <button
              key={lv}
              onClick={() => setFilter(lv)}
              style={{
                fontSize: "10.5px",
                padding: "3px 9px",
                borderRadius: "12px",
                border: "1px solid",
                fontWeight: 600,
                letterSpacing: "0.03em",
                borderColor: filter === lv ? LEVEL_COLORS[lv] ?? "#6366f1" : "rgba(255,255,255,0.1)",
                background: filter === lv ? `${LEVEL_COLORS[lv] ?? "#6366f1"}22` : "transparent",
                color: filter === lv ? LEVEL_COLORS[lv] ?? "#a5b4fc" : "#64748b",
                cursor: "pointer",
              }}
            >
              {lv === "all" ? "全部" : lv.toUpperCase()}
            </button>
          ))}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              color: "#64748b",
              marginLeft: "4px",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            自动滚动
          </label>
          <button
            onClick={() => downloadLogs("txt")}
            style={{
              fontSize: "11px",
              padding: "3px 10px",
              borderRadius: "6px",
              background: "rgba(255,255,255,0.05)",
              color: "#94a3b8",
              border: "1px solid rgba(255,255,255,0.1)",
              cursor: "pointer",
            }}
          >
            txt
          </button>
          <button
            onClick={() => downloadLogs("json")}
            style={{
              fontSize: "11px",
              padding: "3px 10px",
              borderRadius: "6px",
              background: "rgba(255,255,255,0.05)",
              color: "#94a3b8",
              border: "1px solid rgba(255,255,255,0.1)",
              cursor: "pointer",
            }}
          >
            json
          </button>
          <button
            onClick={() => {
              setLogs([]);
              setExpandedId(null);
            }}
            style={{
              fontSize: "11px",
              padding: "3px 10px",
              borderRadius: "6px",
              background: "rgba(239,68,68,0.1)",
              color: "#f87171",
              border: "1px solid rgba(239,68,68,0.2)",
              cursor: "pointer",
            }}
          >
            清空
          </button>
        </div>
      </div>

      {/* ─── Stats strip ──────────────────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <MiniKpi label="Total" value={`${stats.total}`} hint={`/ ${logs.length}`} />
        <MiniKpi
          label="Errors"
          value={`${stats.errors}`}
          hint={`${stats.errorRate.toFixed(1)}%`}
          color={stats.errors > 0 ? "#f87171" : "#22c55e"}
        />
        <MiniKpi label="Avg" value={fmtMs(stats.avg)} />
        <MiniKpi label="P95" value={fmtMs(stats.p95)} />
        <MiniKpi
          label="Tokens"
          value={fmtTok(stats.promptSum + stats.completionSum)}
          hint={`in ${fmtTok(stats.promptSum)} / out ${fmtTok(stats.completionSum)}`}
          color="#a5b4fc"
        />
        <MiniKpi
          label="Cache"
          value={`${stats.cacheHitRate.toFixed(0)}%`}
          hint={`r ${fmtTok(stats.cacheReadSum)} / w ${fmtTok(stats.cacheWriteSum)}`}
          color={stats.cacheReadSum > 0 ? "#34d399" : undefined}
        />
        <MiniKpi label="Cost" value={fmtUSD(stats.costSum)} color="#fbbf24" />
      </div>

      {/* ─── Sparkline ────────────────────────────────────────────── */}
      {sparkData.length > 1 && (
        <div
          style={{
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "10px",
            padding: "8px 12px 4px",
            height: "84px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: "10.5px",
              color: "#64748b",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              fontWeight: 600,
              marginBottom: "2px",
            }}
          >
            Latency · last {sparkData.length}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData} margin={{ top: 2, right: 4, bottom: 2, left: 0 }}>
                <Line
                  type="monotone"
                  dataKey="duration"
                  stroke="#818cf8"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <Tooltip
                  cursor={{ stroke: "rgba(129,140,248,0.3)", strokeWidth: 1 }}
                  contentStyle={{
                    background: "rgba(15,23,42,0.95)",
                    border: "1px solid rgba(99,102,241,0.3)",
                    borderRadius: "6px",
                    fontSize: "11px",
                    color: "#e2e8f0",
                  }}
                  labelFormatter={() => ""}
                  formatter={(v: number) => [fmtMs(v), "latency"]}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ─── Log list ─────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        style={{
          background: "rgba(0,0,0,0.4)",
          borderRadius: "12px",
          border: "1px solid rgba(255,255,255,0.06)",
          maxHeight: "560px",
          overflowY: "auto",
        }}
      >
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "#475569", padding: "40px 0", fontSize: "12.5px" }}>
            {connected
              ? search
                ? "没有匹配的日志"
                : "等待日志输入..."
              : connError
                ? "请检查 API Key 是否正确，或服务器是否已配置 PROXY_API_KEY"
                : "正在尝试连接服务器..."}
          </div>
        )}
        {filtered.map((l) => (
          <LogRow
            key={l.id}
            entry={l}
            expanded={expandedId === l.id}
            onToggle={() => setExpandedId(expandedId === l.id ? null : l.id)}
          />
        ))}
      </div>

      <div style={{ fontSize: "11px", color: "#475569", textAlign: "right" }}>
        显示 {filtered.length} 条 / 共 {logs.length} 条 · 点击任一行查看详情
      </div>
    </div>
  );
}
