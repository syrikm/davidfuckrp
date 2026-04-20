import { useState } from "react";

interface DocsSection {
  title: string;
  content: string;
}

interface PageDocsProps {
  sections?: DocsSection[];
  intro?: string;
}

const DEFAULT_SECTIONS: DocsSection[] = [
  {
    title: "网关定位",
    content: `这个 Portal 对外暴露的是一个统一接入入口。
你只需要准备 3 个信息：Base URL、访问密码、模型 ID。

它的主要价值不是讲复杂架构，而是让不同客户端都能按 OpenAI 兼容方式接入同一个入口，同时由后端去处理：
- 模型目录聚合
- 多厂商格式转换
- 节点路由与重试
- 流式输出与工具调用兼容`,
  },
  {
    title: "推荐认证方式",
    content: `推荐优先使用 Bearer Token：

Authorization: Bearer YOUR_PROXY_API_KEY

兼容方式：
- x-goog-api-key: YOUR_PROXY_API_KEY（适合部分 Gemini 风格客户端）
- ?key=YOUR_PROXY_API_KEY（适合浏览器或临时调试）

不再推荐混用 x-api-key 与 x-goog-api-key。
本门户统一建议优先使用 Bearer，Gemini 风格客户端再使用 x-goog-api-key。`,
  },
  {
    title: "推荐端点",
    content: `最常用的端点只有这几个：

GET /v1/models
- 读取当前可用模型目录
- 先在这里复制模型 ID，再去客户端填写

POST /v1/chat/completions
- 推荐默认端点
- 适合 new-api、SillyTavern、VCP、绝大多数 OpenAI 兼容客户端

POST /v1/messages
- Claude Messages 风格请求

POST /v1/models/:model:generateContent
POST /v1/models/:model:streamGenerateContent
- Gemini 原生格式请求

GET /api/healthz
- 健康检查，不需要认证`,
  },
  {
    title: "模型路由与命名",
    content: `模型命名请直接使用当前模型目录中展示的 ID，不要自己猜。

规则上：
- OpenAI、Anthropic、Gemini 直接用对应模型 ID
- 带 "/" 的模型通常会走 OpenRouter 侧模型路由
- thinking / thinking-visible 是当前门户提供的可选变体后缀
- Anthropic 4.x 统一使用点号版本，例如 claude-opus-4.6，而不是 claude-opus-4-6

最稳妥的做法始终是：
先打开 /v1/models，直接复制模型 ID。`,
  },
  {
    title: "接入心智",
    content: `大多数客户端真正要填的是：

1. URL
填写你的网关 root URL（客户端若要求 OpenAI Base URL，通常填写到 /v1 级别）

2. Key
填写 PROXY_API_KEY，也就是你在配置向导里设定的访问密码

3. Model
先从 /v1/models 复制，再粘贴到客户端

如果客户端支持 OpenAI Compatible / Custom OpenAI / OpenAI API，一般都优先走这条接入方式。`,
  },
  {
    title: "格式兼容说明",
    content: `这个网关会尽量把不同上游转换成统一接入体验：

- OpenAI 风格请求可路由到不同后端
- Claude 与 Gemini 的原生格式端点仍可保留给特定客户端
- 工具调用、流式输出、思考模式等能力会按后端能力尽量兼容

因此对大多数使用者来说，不需要理解底层 provider 细节；
只需要确认 URL、Key、Model 三项填写正确即可。`,
  },
];

export default function PageDocs({ sections = DEFAULT_SECTIONS, intro = "下面整理的是面向接入者的实用说明，重点回答 URL / Key / Model 应该怎么填。" }: PageDocsProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <p style={{ color: "#64748b", fontSize: "13px", margin: "0 0 8px" }}>
        {intro}
      </p>
      {sections.map((sec, i) => (
        <div key={i} style={{
          background: "rgba(0,0,0,0.25)", borderRadius: "10px",
          border: "1px solid rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}>
          <button
            onClick={() => toggle(i)}
            style={{
              width: "100%", padding: "14px 16px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              background: "none", border: "none", cursor: "pointer",
              color: "#e2e8f0", fontSize: "14px", fontWeight: 600,
              textAlign: "left",
            }}
          >
            <span>{sec.title}</span>
            <span style={{
              transform: expanded.has(i) ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.2s", fontSize: "12px", color: "#64748b",
            }}>&#9654;</span>
          </button>
          {expanded.has(i) && (
            <div style={{
              padding: "0 16px 16px",
              color: "#94a3b8", fontSize: "13px", lineHeight: "1.8",
              whiteSpace: "pre-wrap",
              borderTop: "1px solid rgba(255,255,255,0.04)",
            }}>
              {sec.content}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
