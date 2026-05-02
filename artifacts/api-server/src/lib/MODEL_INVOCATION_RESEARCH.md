# 模型调用调研报告：OpenAI / AWS Bedrock / Google Vertex AI / OpenRouter / Replit AI Integrations

---

**标题**: 五大模型调用协议调研与本网关差异分析  
**生成日期**: 2026-05-02 (UTC)  
**版本**: v1.0  
**抓取范围**: OpenAI、AWS Bedrock、Google Vertex AI、OpenRouter 官方文档；Replit AI Integrations 内部 skill 文件  
**阅读建议**:
- 工程师 → 按章节顺序阅读，重点关注"四段式"结构中的"关键字段对照"与"对照我们网关"两节
- 决策者 → 直接跳至文末「§7 五家能力对照矩阵」及「§8 落地建议清单（按 ROI 排序）」

---

## 目录

- [§1 参考资料](#1-参考资料)
- [§2 本工作区现状基线](#2-本工作区现状基线)
  - [2.1 协议识别 (detect.ts)](#21-协议识别-detectts)
  - [2.2 归一化 IR (normalize.ts)](#22-归一化-ir-normalizets)
  - [2.3 Provider 路由锁 (provider.ts)](#23-provider-路由锁-providerts)
  - [2.4 上游执行与 Prompt Cache (execute.ts)](#24-上游执行与-prompt-cache-executets)
  - [2.5 流式传输 (stream.ts / openrouter.ts)](#25-流式传输-streamts--openrouterts)
  - [2.6 模型注册表 (openrouter/)](#26-模型注册表-openrouter)
  - [2.7 响应缓存与缓存键 (responseCache.ts / unifiedCacheKey.ts)](#27-响应缓存与缓存键-responsecachets--unifiedcachekeyts)
  - [2.8 Friend Proxy 后端池 (backendPool.ts)](#28-friend-proxy-后端池-backendpoolts)
  - [2.9 对外入口 (proxy.ts / settings.ts)](#29-对外入口-proxytssettingsts)
  - [2.10 小结：当前缺口一览](#210-小结当前缺口一览)
- [§3 OpenAI](#3-openai)
  - [3.1 协议与端点](#31-协议与端点)
  - [3.2 关键字段对照](#32-关键字段对照)
  - [3.3 认证与运行环境](#33-认证与运行环境)
  - [3.4 对照我们网关](#34-对照我们网关)
- [§4 AWS Bedrock](#4-aws-bedrock)
  - [4.1 协议与端点](#41-协议与端点)
  - [4.2 关键字段对照](#42-关键字段对照)
  - [4.3 认证与运行环境](#43-认证与运行环境)
  - [4.4 对照我们网关](#44-对照我们网关)
- [§5 Google Vertex AI](#5-google-vertex-ai)
  - [5.1 协议与端点](#51-协议与端点)
  - [5.2 关键字段对照](#52-关键字段对照)
  - [5.3 认证与运行环境](#53-认证与运行环境)
  - [5.4 对照我们网关](#54-对照我们网关)
- [§6 OpenRouter](#6-openrouter)
  - [6.1 协议与端点](#61-协议与端点)
  - [6.2 关键字段对照](#62-关键字段对照)
  - [6.3 认证与运行环境](#63-认证与运行环境)
  - [6.4 对照我们网关](#64-对照我们网关)
- [§6b Replit AI Integrations](#6b-replit-ai-integrations)
  - [6b.1 代理端点与环境变量](#6b1-代理端点与环境变量)
  - [6b.2 支持的模型与能力](#6b2-支持的模型与能力)
  - [6b.3 直连 vs Replit 代理差异](#6b3-直连-vs-replit-代理差异)
  - [6b.4 对照我们网关](#6b4-对照我们网关)
- [§7 五家能力对照矩阵](#7-五家能力对照矩阵)
- [§8 落地建议清单（按 ROI 排序）](#8-落地建议清单按-roi-排序)
  - [8.1 对现有缓存键的影响分析](#81-对现有缓存键的影响分析)
  - [8.2 对 Friend Proxy 的影响分析](#82-对-friend-proxy-的影响分析)

---

## §1 参考资料

以下资料于 **2026-05-02 UTC** 抓取/阅读，是本报告事实声明的来源依据。

| # | 供应商 | 文档标题 | URL |
|---|--------|---------|-----|
| R1 | OpenAI | Chat Completions API Reference | https://platform.openai.com/docs/api-reference/chat |
| R2 | OpenAI | Responses API (新一代推理 API) | https://platform.openai.com/docs/api-reference/responses |
| R3 | OpenAI | Streaming (SSE) | https://platform.openai.com/docs/api-reference/streaming |
| R4 | OpenAI | Function Calling / Tool Calling | https://platform.openai.com/docs/guides/function-calling |
| R5 | OpenAI | Structured Outputs | https://platform.openai.com/docs/guides/structured-outputs |
| R6 | OpenAI | Reasoning Models (o1/o3/o4) | https://platform.openai.com/docs/guides/reasoning |
| R7 | OpenAI | Prompt Caching | https://platform.openai.com/docs/guides/prompt-caching |
| R8 | OpenAI | Vision / Multimodal | https://platform.openai.com/docs/guides/vision |
| R9 | OpenAI | Errors & Rate Limits | https://platform.openai.com/docs/guides/error-codes |
| R10 | OpenAI | Authentication | https://platform.openai.com/docs/api-reference/authentication |
| R11 | AWS Bedrock | InvokeModel API | https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html |
| R12 | AWS Bedrock | InvokeModelWithResponseStream | https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModelWithResponseStream.html |
| R13 | AWS Bedrock | Converse API | https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html |
| R14 | AWS Bedrock | Cross-Region Inference Profiles | https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html |
| R15 | AWS Bedrock | Prompt Caching | https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html |
| R16 | AWS Bedrock | Guardrails | https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html |
| R17 | AWS Bedrock | SigV4 Authentication | https://docs.aws.amazon.com/general/latest/gr/signing-aws-api-requests.html |
| R18 | Google Vertex AI | generateContent / streamGenerateContent | https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.publishers.models/generateContent |
| R19 | Google Vertex AI | Anthropic on Vertex (rawPredict) | https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude |
| R20 | Google Vertex AI | Gemini Native Schema | https://ai.google.dev/api/generate-content |
| R21 | Google Vertex AI | Context Caching | https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview |
| R22 | Google Vertex AI | OAuth2 / ADC Auth | https://cloud.google.com/docs/authentication/application-default-credentials |
| R23 | OpenRouter | Chat Completions API | https://openrouter.ai/docs/api-reference/chat-completion |
| R24 | OpenRouter | Models & Endpoints | https://openrouter.ai/docs/api-reference/list-available-models |
| R25 | OpenRouter | Provider Routing | https://openrouter.ai/docs/features/provider-routing |
| R26 | OpenRouter | Reasoning (透传) | https://openrouter.ai/docs/features/reasoning |
| R27 | OpenRouter | Prompt Caching | https://openrouter.ai/docs/features/prompt-caching |
| R28 | OpenRouter | Errors | https://openrouter.ai/docs/api-reference/errors |
| R29 | Replit | AI Integrations OpenAI SKILL.md | `.local/skills/ai-integrations-openai/SKILL.md` (内部) |
| R30 | Replit | AI Integrations Anthropic SKILL.md | `.local/skills/ai-integrations-anthropic/SKILL.md` (内部) |
| R31 | Replit | AI Integrations Gemini SKILL.md | `.local/skills/ai-integrations-gemini/SKILL.md` (内部) |
| R32 | Replit | AI Integrations OpenRouter SKILL.md | `.local/skills/ai-integrations-openrouter/SKILL.md` (内部) |

---

## §2 本工作区现状基线

> **重要前提**：本网关当前所有出站流量均通过 **Friend Proxy 子节点 → OpenRouter**。没有任何直连 SDK（OpenAI 直连、Bedrock SigV4、Vertex OAuth、Replit AI Integrations 代理），所有非 OpenRouter 供应商的模型均通过 OpenRouter 的多供应商路由间接访问。

### 2.1 协议识别 (detect.ts)

文件：`artifacts/api-server/src/lib/gateway/detect.ts`

`detectGatewayProtocol(body)` 用内容特征区分三种协议：

| 识别优先级 | 判断依据 | 输出协议 | 置信度 |
|-----------|---------|---------|-------|
| 1 | 存在 `contents` 数组 | `gemini-generate-content` | 0.98 |
| 2 | 存在 `messages` 数组 + `anthropic_version` 字段，或 Anthropic 风格 content block | `anthropic-messages` | 0.99 / 0.82 |
| 3 | 存在 `messages` 数组（兜底） | `openai-chat` | 0.92 |
| 4 | 无法识别 | `unknown` | 0.1 |

**现有局限**：
- 仅识别三种入站协议，无 Bedrock 原生（`Converse` / `InvokeModel`）识别路径
- Gemini 识别依赖 `contents` 字段，其余 Gemini-specific 字段（如 `system_instruction`）不参与置信度判断

### 2.2 归一化 IR (normalize.ts)

文件：`artifacts/api-server/src/lib/gateway/normalize.ts`

核心：把三种协议的请求都转换为统一内部表示（`GatewayRequestIR`）。

**OpenAI → IR 映射**（`normalizeOpenAI`）：

| 原始字段 | IR 字段 | 备注 |
|---------|--------|------|
| `messages` | `ir.messages` | 每条含 parts，支持 image_url、tool_calls、reasoning_details |
| `tools` | `ir.tools` | 转换为 `GatewayToolDefinition[]` |
| `response_format` | `ir.responseFormat` | 支持 `json_object` / `json_schema` |
| `reasoning` / `reasoning_effort` / `include_reasoning` | `ir.reasoning` | 三种写法合并 |
| `provider` | `ir.provider` | OpenRouter 路由偏好 |
| `cache_control` | `ir.cache` | 顶层缓存控制 |
| `max_tokens` / `max_completion_tokens` / `max_output_tokens` | `ir.maxOutputTokens` | 三合一，取首个有效数值 |
| `temperature`, `top_p`, `stop` | 对应 IR 字段 | 直通 |
| `verbosity` | `ir.verbosity` | 自定义扩展字段 |

**Anthropic → IR 映射**（`normalizeAnthropic`）：

| 原始字段 | IR 字段 | 备注 |
|---------|--------|------|
| `system` | `ir.messages[0]` (role=system) | 系统提示被注入为首条 message |
| `messages` | `ir.messages` | 支持 thinking/redacted_thinking/tool_use/tool_result 块 |
| `thinking` (Anthropic 格式) | `ir.reasoning` | `type:enabled/disabled/adaptive` + `budget_tokens` |
| `max_tokens` | `ir.maxOutputTokens` | Anthropic 的 max_tokens 必填字段映射 |
| `tools` | `ir.tools` | `input_schema` → `inputSchema` |
| `anthropic_version` | `ir.metadata.rawHints.anthropicVersion` | 记录但不透传到 OpenRouter |
| `anthropic_beta` | `ir.metadata.rawHints.anthropicBeta` | 记录但不透传 |

**Gemini → IR 映射**（`normalizeGemini`）：

| 原始字段 | IR 字段 | 备注 |
|---------|--------|------|
| `contents` (role=model→assistant) | `ir.messages` | role 映射：`model` → `assistant` |
| `generationConfig.responseMimeType` | `ir.responseFormat` | JSON 模式检测 |
| `generationConfig.responseSchema` | `ir.responseFormat.jsonSchema` | 结构化输出 schema |
| `generationConfig.maxOutputTokens` | `ir.maxOutputTokens` | 兼容路径 |
| `reasoningConfig` | `ir.reasoning` | Gemini 特有推理配置 |
| `tools[].functionDeclarations` | `ir.tools` | 展平为 `GatewayToolDefinition[]` |

**现有局限**：
- Gemini 的 `system_instruction` 字段没有被显式识别和映射（会落入 `unknownFields`）
- Bedrock 的 `Converse` 消息格式无原生解析路径
- `cachePoint`（Bedrock 显式缓存标记）虽然在 `unifiedCacheKey.ts` 里有过滤逻辑，但在归一化层没有正式处理

### 2.3 Provider 路由锁 (provider.ts)

文件：`artifacts/api-server/src/lib/gateway/provider.ts`

`PROVIDER_PREFIX_SPECS` 定义了所有前缀别名到 OpenRouter provider slug 的映射，共约 40 个条目，涵盖：

```
bedrock/    → amazon-bedrock (only: ["amazon-bedrock"], allow_fallbacks: false)
vertex/     → google-vertex  (only: ["google-vertex"],  allow_fallbacks: false)
anthropic/  → anthropic      (only: ["anthropic"],      allow_fallbacks: false)
aistudio/   → google-ai-studio
google/     → google-vertex
openai/     → openai
azure/      → azure
groq/       → groq
deepseek/   → deepseek
... (共约 40 个条目)
```

**关键机制**：
- 当 model id 带前缀（如 `bedrock/claude-sonnet-4.5`）时，网关自动提取前缀，注入 `provider: { only: [...], allow_fallbacks: false }` 到 OpenRouter 请求体
- `openrouter/` 和 `auto/` 是穿透前缀，不注入 provider 锁
- `meta-llama/`、`qwen/`、`amazon/` 是 vendor-only 前缀，只剥离，不锁供应商

**Claude 模型 ID 规范化** (`canonicalizeLogicalModel`)：
- 把 Anthropic/Vertex/Bedrock 的 dash 格式（`claude-sonnet-4-5`）转为 OpenRouter dot 格式（`claude-sonnet-4.5`）
- 剥离 Vertex `@20250929` 日期后缀、Bedrock `-v1:0` 版本后缀
- ⚠️ 仅在目的地是 OpenRouter 时正确；直连时需反向还原

### 2.4 上游执行与 Prompt Cache (execute.ts)

文件：`artifacts/api-server/src/lib/gateway/execute.ts`（共约 2000 行）

**System Sinking + Rendezvous Hashing 策略**：

网关实现了一套复杂的 Anthropic `cache_control: { type: "ephemeral" }` 自动注入机制：

1. **分层系统提示分析** (`LayeredSystemAnalysis`)：把 system prompt 拆分为 `stable`（静态）、`low`（低频变化）、`volatile`（高频动态）三层，依据约 18 条正则规则（`SYSTEM_LAYER_RULES`）识别：
   - `volatile`: RAG 块、记忆块、日期天气、async 结果等
   - `low`: VCP 工具箱、表情包系统、时间线块等
   - `stable`: 其余所有内容

2. **Rendezvous Hashing** (`pickBackendForCache`)：用 `model + system_prefix` 的 FNV-1a hash 在 Friend Proxy 后端池中选择"最佳"节点，使相同 system prompt 的请求固定打到同一子节点，最大化跨请求的 Anthropic Prompt Cache 命中率。

3. **历史断点缓存** (`applyHistoryBreakpoint`)：对历史消息自动注入 `cache_control: { type: "ephemeral" }` 标记，把之前的对话轮次变为可缓存前缀。

**当前缺口**：所有这些 prompt cache 注入逻辑只适配了 OpenAI 兼容（`cache_control` 块标记）和 Anthropic SSE 格式，不支持：
- Bedrock 的 `cachePoint` 块标记格式
- Vertex 的 `cachedContent` 资源 API

### 2.5 流式传输 (stream.ts / openrouter.ts)

文件：`artifacts/api-server/src/lib/gateway/stream.ts`，`openrouter.ts`

`GatewayStreamEventInspector` 能处理两种 SSE 格式：
- `openai-compatible`：解析 `choices[].delta.content/reasoning/tool_calls/reasoning_details`
- `anthropic-sse`：解析 `content_block_start/delta/stop`、`message_delta`、`ping`

`buildOpenRouterRequest` / `buildGatewayBridgeRequest`：
- 把 IR 序列化为 OpenRouter 兼容的 JSON 请求体
- 推理字段以 `reasoning` 对象透传（`effort`, `max_tokens`, `exclude`, `enabled`, `include_reasoning`）
- 工具以 OpenAI `function` 格式序列化
- 消息中的 thinking/redacted_thinking 块通过 `reasoning_details` 数组透传

**当前缺口**：
- 无 Bedrock `InvokeModelWithResponseStream` 的 binary framing 解析
- 无 Vertex `streamRawPredict` 的 Anthropic SSE over HTTP/2 解析
- 无 Vertex Gemini `streamGenerateContent?alt=sse` 的 SSE 流解析

### 2.6 模型注册表 (openrouter/)

文件：`artifacts/api-server/src/lib/openrouter/registry.ts`，`capabilities.ts`，`schema.ts`

`OPENROUTER_CAPABILITIES` 定义了 12 种能力位：`chat`, `messages`, `streaming`, `tool_calling`, `reasoning`, `prompt_caching`, `multimodal_image_input`, `multimodal_pdf_input`, `audio_io`, `video_jobs`, `embeddings`, `model_endpoints`。

`OpenRouterModelMetadata` 包含模型的 `pricing`、`architecture`（`input_modalities`, `output_modalities`）、`capabilities` 位。

**当前缺口**：能力位没有区分"我们直接支持"和"需要通过 OpenRouter 中转才支持"。无直连 provider 专属的能力声明。

### 2.7 响应缓存与缓存键 (responseCache.ts / unifiedCacheKey.ts)

文件：`artifacts/api-server/src/lib/responseCache.ts`，`unifiedCacheKey.ts`

**缓存实现**：
- 16 分片内存 Map + 磁盘持久化（`responses.json`），TTL 默认 1 小时，最多 500 条
- 飞行中请求去重（`markInflight` / `waitForInflight`）

**缓存键生成** (`hashRequest`)：
- SHA-256 of 规范化 JSON（key 字母序排列）
- 排除字段（`HASH_EXCLUDE_FIELDS`）：`stream`, `cache_control`, `cachePoint`, `provider`, `route`, `session_id`, `trace`, `metadata`, `service_tier`, `speed`, `user`, `x_use_prompt_tools`, `stream_options`, `transforms`, `extra_headers`
- `stripMessageBlockCacheControl`：剥离消息块内 `cache_control` / `cachePoint`，保证内部缓存断点移动不影响键稳定性
- 模型 ID 通过 `normaliseORModelId` 规范化别名（如 thinking 后缀）

**关键设计**：使用黑名单（排除路由/计费字段）而非白名单，使得新内容参数（reasoning、verbosity 等）自动参与缓存键，无需手工变更。

**当前缺口**：缓存键不含 `provider` 维度。这在单后端场景下正确（相同内容在不同 provider 给出相同响应），但在直连多 provider 场景下需要重新评估：OpenAI 直连和 Bedrock 直连对同一 model 可能返回不同结果（不同 provider 的 Anthropic Claude 版本可能有行为差异）。

### 2.8 Friend Proxy 后端池 (backendPool.ts)

文件：`artifacts/api-server/src/lib/backendPool.ts`

**架构**：支持三种 backend 来源：
- `env`：`FRIEND_PROXY_URL` / `FRIEND_PROXY_URL_2..20` 环境变量
- `dynamic`：通过 settings API 动态添加（持久化到 `dynamic_backends.json`）
- `register`：子节点主动注册 + 心跳（TTL 90 秒）

**能力感知** (`BackendPoolEntry.providerSlugs`)：
- 来自子节点上报的 `reportedModels[*].provider`，用于过滤能否服务某个 OpenRouter provider slug
- `undefined` → 未知，兼容模式（视为可服务任何 provider）
- `[]` → 明确空，视为可服务（还没同步）
- `[slug, ...]` → 只有列出的 slugs 已知可服务

**虚拟本地 backend** (`LocalBackendPoolEntry`，已声明接口但未完整实现路由逻辑）：用于路由到 Replit AI Integrations。

**当前缺口**：
- 真正的直连（Bedrock、Vertex、OpenAI direct）需要专属的 backend 类型，现有 `BackendPoolEntry.kind = "friend"` 无法携带 SigV4 credentials、OAuth token cache 等直连信息
- `LocalBackendPoolEntry` 只是接口声明，没有配套的执行路径

### 2.9 对外入口 (proxy.ts / settings.ts)

文件：`artifacts/api-server/src/routes/proxy.ts`（约 7300 行）

对外暴露：
- `POST /v1/chat/completions`：OpenAI Chat Completions 格式入口，经 gateway 处理后转发到 Friend Proxy→OpenRouter
- `POST /v1/messages`：Anthropic Messages 格式入口，同路径
- `/api/settings`：配置端点（Friend Proxy 节点管理、缓存控制等）

入口流程：`detectGatewayProtocol` → `normalizeGatewayRequest` → `buildGatewayBridgeRequest` → `executeGatewayRequest`（选后端 + HTTP 请求 + SSE 中继）

### 2.10 小结：当前缺口一览

| 缺口类别 | 具体缺口 |
|---------|---------|
| 直连 OpenAI | 无 OpenAI SDK 直连；只通过 OpenRouter `openai` provider slug 间接访问 |
| 直连 Bedrock | 无 SigV4 签名；无 `Converse` / `InvokeModel` 适配；无 `cachePoint` Prompt Cache 支持 |
| 直连 Vertex | 无 OAuth2/ADC token 管理；无 `rawPredict`/`streamRawPredict` 解析；无 `cachedContent` 资源 API |
| Replit AI Integrations | 无 base URL 改写路径；`LocalBackendPoolEntry` 只有接口声明无执行路径 |
| 缓存键 | 无 provider 维度；直连多 provider 接入后需重新评估 |
| 模型 ID 规范化 | dot 格式规范化仅适用于 OpenRouter；直连需反向还原 |

---

## §3 OpenAI

### 3.1 协议与端点

**Chat Completions API（当前主流）**

```
POST https://api.openai.com/v1/chat/completions
Content-Type: application/json
Authorization: Bearer <OPENAI_API_KEY>
```

响应（非流式）格式：
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1706700000,
  "model": "gpt-4o-2024-11-20",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "..." },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150,
    "prompt_tokens_details": { "cached_tokens": 80 }
  }
}
```

流式（SSE）事件序列（`stream: true`）：
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"},"finish_reason":null}]}
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{...}}
data: [DONE]
```

**Responses API（推理模型新 API）**

```
POST https://api.openai.com/v1/responses
```

使用 `input`（而非 `messages`）和 `max_output_tokens`（而非 `max_tokens`）。支持 `previous_response_id` 维持多轮推理上下文。流式事件类型为 `response.created`、`response.in_progress`、`response.done`、`output_item.delta`。

> 注：OpenAI 官方文档（[R2]）推荐新推理模型（o3、o4-mini 等）使用 Responses API，而非 Chat Completions API。但 OpenRouter 仍以 Chat Completions 格式透传这些模型。

**文档来源**：[R1] [R2] [R3]

### 3.2 关键字段对照

**消息结构**：

```json
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Describe this image:" },
        { "type": "image_url", "image_url": { "url": "https://...", "detail": "high" } }
      ]
    }
  ]
}
```

多模态 `image_url.detail` 三档：`"low"`（固定 65 token）/ `"high"`（按 512×512 tile 分块）/ `"auto"`（自动选择）。

**工具定义与选择**：

```json
{
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "Get weather info",
      "parameters": { "type": "object", "properties": {...} },
      "strict": true
    }
  }],
  "tool_choice": "auto",
  "parallel_tool_calls": true
}
```

`strict: true` 启用结构化工具参数输出（保证 JSON Schema 合规）。`tool_choice` 可取 `"none"` / `"auto"` / `"required"` / `{"type":"function","function":{"name":"..."}}`.

**Structured Outputs**：

```json
{
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "CalendarEvent",
      "strict": true,
      "schema": { "type": "object", "properties": {...} }
    }
  }
}
```

**推理字段（o1/o3/o4 系列）**：

Chat Completions API 中：
```json
{
  "reasoning_effort": "high"
}
```
取值：`"low"` / `"medium"` / `"high"`。此字段映射为 `reasoning_tokens` 的使用预算。

Responses API 中：
```json
{
  "reasoning": { "effort": "high", "summary": "auto" }
}
```

流式响应中，推理内容通过 `delta.reasoning_details` 数组传递，包含类型为 `reasoning.text`（明文）、`reasoning.summary`（摘要）或 `reasoning.encrypted`（加密）的块。推理 token 计入 `usage.completion_tokens_details.reasoning_tokens`，**按 output token 价格计费**，但不在最终响应中可见（除非使用支持的模型和摘要模式）。

**Prompt Cache**：

OpenAI 的 Prompt Cache 是**全自动**的，无需请求方指定任何字段。系统自动缓存 prompt 前缀（按 128 token 对齐的前缀），缓存命中时 `usage.prompt_tokens_details.cached_tokens` 中体现命中数量，缓存 token 价格通常为标准输入价格的 **50%**。

```json
"usage": {
  "prompt_tokens": 1200,
  "completion_tokens": 300,
  "prompt_tokens_details": { "cached_tokens": 1024 }
}
```

**Token 控制**：

| 参数 | 适用 API | 含义 |
|------|---------|------|
| `max_tokens` | Chat Completions（旧） | 最大输出 token |
| `max_completion_tokens` | Chat Completions（推理模型）| 包含 reasoning token 的总上限 |
| `max_output_tokens` | Responses API | 可见输出 token 上限 |
| `temperature` | 仅 GPT 系列（o 系列不支持） | 0.0~2.0，o 系列固定 1 |
| `top_p` | 仅 GPT 系列 | nucleus sampling |

**文档来源**：[R1]~[R10]

### 3.3 认证与运行环境

**主认证**：
```
Authorization: Bearer sk-proj-xxxxx
```

**多租户头部**（可选）：
```
OpenAI-Organization: org-xxxxx   // 按组织计费/限流
OpenAI-Project: proj-xxxxx       // 精细化资源管理
```

**Beta 功能**（按需）：
```
OpenAI-Beta: assistants=v2
```

**错误码速查**：

| HTTP 状态 | 错误类型 | 触发条件 |
|---------|---------|---------|
| 400 | `invalid_request_error` | 参数非法、模型不支持某参数 |
| 401 | `authentication_error` | API Key 无效 |
| 403 | `permission_error` | 无访问权限（Tier 限制） |
| 429 | `rate_limit_error` | 超 TPM/RPM/RPD 限制 |
| 500 | `server_error` | OpenAI 内部错误 |
| 503 | `engine_overloaded` | 服务过载 |

**限流维度**：TPM（每分钟 token）、RPM（每分钟请求）、RPD（每日请求），各模型 Tier 不同。

**文档来源**：[R9] [R10]

### 3.4 对照我们网关

**当前状态**：通过 OpenRouter `openai` provider slug 间接访问 OpenAI 模型（在模型 id 前缀为 `openai/` 时，`provider.ts` 注入 `provider: { only: ["openai"], allow_fallbacks: false }`）。

**可透传的内容**：
- `messages`（含 image_url 多模态）：`openrouter.ts` 的 `messageToOpenAICompatible` 正确序列化
- `tools`/`tool_choice`：`toolsToOpenAICompatible` 序列化
- `response_format`（json_object/json_schema）：`buildOpenRouterRequest` 直接透传
- `reasoning`（`effort` 字段）：`buildReasoning` 透传
- `temperature`、`max_tokens`、`top_p`、`stop`：直接透传

**需要新增或调整的内容**（直连 OpenAI）：

| 项目 | 所需改动 | 难度 |
|------|---------|------|
| Bearer Key 注入 | 在请求头注入 `Authorization: Bearer $OPENAI_API_KEY` | 低 |
| `OpenAI-Organization` / `OpenAI-Project` 头 | 在 execute 层按 provider 类型条件注入 | 低 |
| Prompt Cache 透明 | 无需改动（OpenAI 自动缓存，`stream.ts` 已能解析 `cached_tokens`） | 无 |
| Responses API 适配 | 若需使用原生 Responses API（`/v1/responses`），需单独 execute 路径；目前 Chat Completions 可正常调用 o 系列 | 高 |
| `reasoning_effort` 字段 | 当前 IR `reasoning.effort` 在 `buildOpenRouterRequest` 里以 `reasoning.effort` 透传，OpenRouter → OpenAI 转换正确 | 已支持 |
| `parallel_tool_calls` | 在 `unknownFields` 里透传，已有支持 | 已支持 |
| `strict` 工具参数 | 在 `unknownFields` 里透传 | 已支持 |

**直连 OpenAI 接入 Replit AI Integrations 代理的更低成本方案**：  
见 §6b。只需把 `base_url` 改写到 `AI_INTEGRATIONS_OPENAI_BASE_URL`，使用 `AI_INTEGRATIONS_OPENAI_API_KEY` 作为 Bearer token，即可在不修改核心代码的前提下直接调用 OpenAI 兼容接口（无需 OpenRouter 中转、无加价）。

**缓存键影响**：直连 OpenAI 时，`provider` 字段当前被排除在缓存键之外。若 OpenAI 直连返回的结果和 OpenRouter 透传的结果内容完全一致（同一模型版本），则缓存键不需要变化。但如果存在模型版本差异或 OpenRouter 的中间处理导致细微差异，建议在直连时考虑在 `HASH_EXCLUDE_FIELDS` 中保留 `provider`（即不排除），或引入一个 provider 维度前缀到缓存键。

---

## §4 AWS Bedrock

### 4.1 协议与端点

AWS Bedrock 提供两代 API：

**第一代：InvokeModel（各模型原生 payload，已逐渐退出主推）**

```
POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/invoke
POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/invoke-with-response-stream
Content-Type: application/json
X-Amzn-Bedrock-GuardrailIdentifier: <guardrailId>   // 可选
X-Amzn-Bedrock-GuardrailVersion: <version>           // 可选
```

payload 格式取决于 `modelId`；Anthropic 模型的 payload 格式遵循 Anthropic Messages API（但需包含 `anthropic_version: "bedrock-2023-05-31"`）。

`InvokeModelWithResponseStream` 返回 binary-framed 事件流（AWS Event Stream 格式，非 SSE）。

**请求体大小限制**：20 MB（[R11]）。

**第二代：Converse / ConverseStream（统一多模型 API，推荐）**

```
POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse
POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse-stream
Content-Type: application/json
```

Converse API 使用统一消息格式，无需了解底层模型细节：
```json
{
  "modelId": "anthropic.claude-sonnet-4-5-20251009-v1:0",
  "messages": [
    {
      "role": "user",
      "content": [{ "text": "Hello" }]
    }
  ],
  "system": [{ "text": "System prompt" }],
  "inferenceConfig": {
    "maxTokens": 1024,
    "temperature": 0.7,
    "topP": 0.9
  }
}
```

**跨区域 Inference Profiles**（[R14]）：

- **全局端点**（推荐）：model id 加 `global.` 前缀（如 `global.anthropic.claude-opus-4-6-v1`），Bedrock 自动路由到有容量的区域
- **区域端点（CRIS）**：指定区域，保证数据驻留合规，有 **10% 价格溢价**

**文档来源**：[R11]~[R17]

### 4.2 关键字段对照

**Anthropic on Bedrock（InvokeModel payload）**：

与 Anthropic Messages API 几乎相同，但有以下差异：

| 字段 | Anthropic Messages API | Anthropic on Bedrock |
|-----|----------------------|---------------------|
| `anthropic_version` | 请求头 `anthropic-version: 2023-06-01` | **请求体** `"anthropic_version": "bedrock-2023-05-31"` |
| 认证 | `Authorization: Bearer $KEY` | AWS SigV4 签名 |
| 端点 | `https://api.anthropic.com/v1/messages` | `https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/invoke` |
| 模型 ID | `claude-sonnet-4-5-20251009` | `anthropic.claude-sonnet-4-5-20251009-v1:0` |
| Streaming | SSE（HTTP/1.1）| AWS Event Stream（binary framing，非 SSE）|

**Bedrock Prompt Caching（[R15]）**：

使用 `cachePoint` 标记而非 `cache_control`：

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        { "text": "Long system context here..." },
        { "cachePoint": { "type": "default" } },
        { "text": "User question?" }
      ]
    }
  ]
}
```

或在系统提示中：
```json
{
  "system": [
    { "text": "Long static system prompt..." },
    { "cachePoint": { "type": "default" } }
  ]
}
```

- **TTL**：默认 5 分钟（1.25x 写入成本），可选 1 小时（2x 写入成本）
- **缓存命中成本**：0.1x 基础输入价格
- **最小可缓存长度**：因模型而异（Sonnet 4.6 需 2048 token，其余通常 1024）
- `cachePoint` 在 `unifiedCacheKey.ts` 中已有过滤逻辑（`stripMessageBlockCacheControl` 会过滤独立 `cachePoint` 块），确保本地响应缓存键稳定

**Bedrock 工具调用**：

Converse API 工具格式：
```json
{
  "toolConfig": {
    "tools": [{
      "toolSpec": {
        "name": "get_weather",
        "description": "...",
        "inputSchema": {
          "json": { "type": "object", "properties": {...} }
        }
      }
    }],
    "toolChoice": { "auto": {} }
  }
}
```

InvokeModel（Anthropic 格式）工具与 Anthropic Messages API 相同（`input_schema`）。

**Converse API 多模态**：

```json
{
  "content": [{
    "image": {
      "format": "jpeg",
      "source": { "bytes": "<base64>" }
    }
  }]
}
```

或 PDF（需开启引用时才支持 Converse 的视觉分析；InvokeModel 支持完整 PDF 控制）：
```json
{
  "content": [{
    "document": {
      "format": "pdf",
      "name": "doc",
      "source": { "bytes": "<base64>" }
    }
  }]
}
```

**错误码**：

| HTTP | Bedrock 错误类型 | 含义 |
|------|----------------|------|
| 400 | `ValidationException` | 请求参数非法 |
| 403 | `AccessDeniedException` | IAM 权限不足 |
| 404 | `ResourceNotFoundException` | 模型 ID 不存在 |
| 429 | `ThrottlingException` | 请求速率超限 |
| 500 | `InternalServerException` | Bedrock 内部错误 |
| 503 | `ServiceUnavailableException` | 服务不可用 |

**文档来源**：[R11]~[R16]

### 4.3 认证与运行环境

**AWS SigV4 签名（必须）**：

所有 Bedrock 请求必须用 AWS SigV4 算法签名：
1. 生成规范请求（canonical request）：HTTP 方法 + URI + 参数 + 头部哈希 + 请求体哈希
2. 创建待签名字符串（string to sign）：算法 + 时间戳 + 凭证范围 + 规范请求哈希
3. 计算签名（使用 AWS Secret Access Key 派生密钥）
4. 构造 `Authorization` 头部

```
Authorization: AWS4-HMAC-SHA256
  Credential=AKIAIOSFODNN7EXAMPLE/20260502/us-east-1/bedrock/aws4_request,
  SignedHeaders=content-type;host;x-amz-date,
  Signature=<hex_signature>
X-Amz-Date: 20260502T120000Z
```

**SDK 支持**：Anthropic 的 TypeScript SDK 内置了 Bedrock 适配器（`AnthropicBedrock` 类），自动处理 SigV4 签名。AWS SDK（`@aws-sdk/client-bedrock-runtime`）原生支持。

**运行环境要求**：
- `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY` 环境变量（或 IAM 角色/EC2 实例 profile）
- 可选 `AWS_SESSION_TOKEN`（临时凭证）
- 区域：`AWS_REGION` 或 `AWS_DEFAULT_REGION`（如 `us-east-1`）
- IAM 权限：`bedrock:InvokeModel`、`bedrock:InvokeModelWithResponseStream`、`bedrock:Converse`、`bedrock:ConverseStream`

**Bearer Token 认证（替代方案）**：C#、Go、Java SDK 还支持 Bearer Token 认证，但 TypeScript 和 Python SDK 只支持 SigV4（[R17]）。

**文档来源**：[R17]

### 4.4 对照我们网关

**当前状态**：通过 OpenRouter `amazon-bedrock` slug 间接访问（模型前缀 `bedrock/`）。OpenRouter 在其后端用自己的 AWS 凭证调用 Bedrock，透明给我们。

**直连 Bedrock 所需的主要工作**：

| 组件 | 改动内容 | 预估工作量 | 风险 |
|------|---------|-----------|------|
| SigV4 签名层 | 新增 `sigv4.ts` 工具函数，或引入 `@aws-sdk/signature-v4` | 中（2~3 天） | SigV4 实现错误会导致 403 |
| Converse 适配器 | 新增 `bedrockConverse.ts`：IR → Converse 请求，Converse 响应 → IR | 中（3~4 天） | 字段映射差异 |
| Event Stream 解码 | AWS binary-framed event stream 不是 SSE，需 `@aws-sdk/eventstream-codec` 或自行实现 | 高（2~3 天） | 协议复杂 |
| `cachePoint` 注入 | 在 `execute.ts` 的 Prompt Cache 注入逻辑里增加 Bedrock 路径 | 中（1~2 天） | |
| 模型 ID 还原 | `provider.ts` 的 dot→dash 规范化需要为 Bedrock 反向：`claude-sonnet-4.5` → `anthropic.claude-sonnet-4-5-20251009-v1:0` | 中（1 天） | 需维护 Bedrock 模型 ID 映射表 |
| `backendPool.ts` 扩展 | 增加 `kind: "bedrock"` 类型，携带 AWS credentials 和 region | 低（1 天） | |
| `provider.ts` 新 prefix | 无需改动，`bedrock/` 前缀已有 | 无 | |

**Converse vs InvokeModel 选择建议**：
- 建议优先适配 **Converse API**（统一格式，跨模型兼容，无需了解各家 payload 差异）
- 仅在需要 PDF 视觉分析（无 citations）或特殊 Anthropic 能力（如 advanced tool_choice）时才回退到 InvokeModel

**对缓存键的影响**：
- Bedrock 直连时，`provider` 当前被排除在键之外。由于 Bedrock Claude 和 Anthropic direct Claude 同版本行为一致，通常可接受
- `cachePoint` 块已经被 `stripMessageBlockCacheControl` 过滤，**无需修改**缓存键逻辑

---

## §5 Google Vertex AI

### 5.1 协议与端点

Vertex AI 上有两类调用路径：

**路径 A：Gemini 原生 API（Google 自有模型）**

```
POST https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent
POST https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:streamGenerateContent?alt=sse
```

流式使用 SSE（`Content-Type: text/event-stream`，事件无 `event:` 字段，每个 `data:` 是一个 `GenerateContentResponse` JSON）。

**路径 B：Anthropic Claude on Vertex（第三方 partner 模型）**

```
POST https://{region}-aiplatform.googleapis.com/v1beta1/projects/{project}/locations/{location}/publishers/anthropic/models/{model}:rawPredict
POST https://{region}-aiplatform.googleapis.com/v1beta1/projects/{project}/locations/{location}/publishers/anthropic/models/{model}:streamRawPredict
```

- `rawPredict`：同步，响应为 Anthropic Messages API 格式
- `streamRawPredict`：流式，Anthropic SSE over HTTP/2

请求体中需包含 `anthropic_version: "vertex-2023-10-16"`（位于请求**体**，不是头部）（[R19]）。

模型 ID 格式：`claude-sonnet-4-5@20250929`（含 `@` 日期后缀）。

**Google AI Studio（开发用替代端点）**：

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=YOUR_API_KEY
```

更简单的 API key 认证，适合原型阶段。

**文档来源**：[R18]~[R22]

### 5.2 关键字段对照

**Gemini 原生消息格式**：

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        { "text": "Analyze this:" },
        {
          "inlineData": {
            "mimeType": "image/jpeg",
            "data": "<base64>"
          }
        }
      ]
    },
    {
      "role": "model",
      "parts": [{ "text": "This is..." }]
    }
  ],
  "system_instruction": {
    "parts": [{ "text": "You are a helpful assistant." }]
  }
}
```

角色只有 `user` / `model`（无 `system`，系统提示用 `system_instruction` 独立字段）。

**generationConfig 完整字段表**：

| 字段 | 类型 | 说明 |
|------|-----|------|
| `temperature` | float | 生成多样性（0.0~2.0） |
| `topP` | float | nucleus sampling |
| `topK` | int | top-k sampling（Gemini 特有） |
| `maxOutputTokens` | int | 最大输出 token 数 |
| `stopSequences` | string[] | 停止序列 |
| `responseMimeType` | string | `"text/plain"` 或 `"application/json"` |
| `responseSchema` | object | JSON Schema，与 `responseMimeType:application/json` 配合 |
| `thinkingConfig.thinkingBudget` | int | 思考 token 预算（Gemini 2.5+ 原生推理） |
| `thinkingConfig.thinkingLevel` | enum | 推理强度（部分模型） |
| `presencePenalty` | float | 存在惩罚 |
| `frequencyPenalty` | float | 频率惩罚 |
| `seed` | int | 确定性采样种子 |

**工具调用**：

```json
{
  "tools": [{
    "functionDeclarations": [{
      "name": "get_weather",
      "description": "...",
      "parameters": {
        "type": "OBJECT",
        "properties": { "city": { "type": "STRING" } }
      }
    }]
  }],
  "toolConfig": {
    "functionCallingConfig": {
      "mode": "AUTO"
    }
  }
}
```

模型返回 `functionCall` part，开发者用 `functionResponse` part 回复：
```json
{
  "parts": [{
    "functionResponse": {
      "name": "get_weather",
      "response": { "temperature": "22C" }
    }
  }]
}
```

**Grounding（搜索增强）**：

```json
{
  "tools": [{ "googleSearchRetrieval": {
    "dynamicRetrievalConfig": {
      "mode": "MODE_DYNAMIC",
      "dynamicThreshold": 0.7
    }
  }}]
}
```

**Context Caching（Vertex 版本）**（[R21]）：

不同于 Anthropic 的块级 `cache_control`，Vertex 使用独立的 **Cache 资源 API**：

1. 创建缓存资源：
```
POST https://us-central1-aiplatform.googleapis.com/v1beta1/projects/{project}/locations/us-central1/cachedContents
Body: { "model": "...", "contents": [...], "ttl": "3600s" }
Response: { "name": "projects/.../cachedContents/{cacheId}", ... }
```

2. 在请求中引用缓存：
```json
{
  "cachedContent": "projects/{project}/locations/us-central1/cachedContents/{cacheId}",
  "contents": [...]
}
```

这是一种**显式、预创建**的缓存机制，与 Anthropic 的内联 `cache_control` 完全不同。

**Vertex Anthropic 的 Prompt Cache**：

在 Vertex 上使用 Claude 时，Prompt Cache 的开启方式与直连 Anthropic 相同（`cache_control: { type: "ephemeral" }`，块级标记）。

**文档来源**：[R18]~[R22]

### 5.3 认证与运行环境

**OAuth2 / Application Default Credentials（ADC）**：

Vertex AI 不使用 API Key，使用 Google Cloud OAuth2：

```
Authorization: Bearer <access_token>
```

获取 access token 的方式：
1. **服务账号 JSON + JWT** → 换取短期 access token（有效期 1 小时）
2. **ADC（Application Default Credentials）**：在 GCP 环境中自动使用实例/工作负载身份
3. **gcloud CLI**：`gcloud auth application-default print-access-token`

TypeScript 中使用 `google-auth-library`：
```typescript
import { GoogleAuth } from 'google-auth-library';
const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
const client = await auth.getClient();
const token = await client.getAccessToken();
```

**Token 缓存**：access token 有效期约 3600 秒，SDK 通常自动处理刷新。但自行实现时，需要一个 token cache + 刷新机制（提前 60 秒刷新以防止边缘情况）。

**运行环境要求**：
- `GOOGLE_APPLICATION_CREDENTIALS` 指向服务账号 JSON 文件，或
- 在 GCP 实例上使用工作负载身份（Workload Identity）
- `project`：Google Cloud 项目 ID
- `location`（区域）：影响可用模型，常用 `us-central1`、`europe-west1`、`global`（Claude 支持）

**Quota**：按 Google Cloud Console 项目配额管理（RPM/TPM），超限返回 HTTP 429。

**错误**：

| HTTP | 错误 | 含义 |
|------|------|------|
| 400 | `INVALID_ARGUMENT` | 请求参数错误 |
| 401 | `UNAUTHENTICATED` | Token 无效或过期 |
| 403 | `PERMISSION_DENIED` | 权限不足 |
| 429 | `RESOURCE_EXHAUSTED` | 配额耗尽 |
| 503 | `UNAVAILABLE` | 服务暂时不可用 |

**文档来源**：[R22]

### 5.4 对照我们网关

**当前状态**：
- `vertex/` 前缀 → OpenRouter `google-vertex` slug（Claude on Vertex）
- `aistudio/` 或 `google/` 前缀 → `google-vertex` 或 `google-ai-studio` slug

**直连 Vertex 所需的主要工作**：

| 组件 | 改动内容 | 预估工作量 | 风险 |
|------|---------|-----------|------|
| OAuth token cache | `vertexAuth.ts`：加载 service account JSON → JWT → access token，带 TTL 缓存 | 高（3~4 天） | Token 刷新逻辑复杂 |
| Gemini 原生请求组装 | IR → `contents` + `system_instruction` + `generationConfig`（含 `thinkingConfig`） | 中（2~3 天） | IR 无 `system_instruction` 字段 |
| `streamGenerateContent` SSE 解析 | Gemini 流式每个 data 是完整 `GenerateContentResponse`（非 delta），解析模式不同 | 中（2 天） | |
| Anthropic rawPredict 路径 | `anthropic_version: "vertex-2023-10-16"` 注入请求体；URL pattern 与 Gemini 不同 | 低（1 天） | |
| Context Cache 集成 | 在 execute.ts 增加 Vertex `cachedContent` 资源预创建 + 引用逻辑 | 非常高（5~7 天） | 生命周期管理复杂 |
| `system_instruction` 提取 | `normalize.ts` 需为 Gemini 直连路径提取 system message 到独立 `system_instruction` 字段 | 低（0.5 天） | |
| 模型 ID 还原 | `claude-sonnet-4.5` → `claude-sonnet-4-5@20250929` | 中（1 天） | 需维护版本映射 |

**Gemini vs Claude on Vertex 的协议分叉**：这是 Vertex 直连最复杂的地方——同一"Vertex"后端需要两套完全不同的请求格式（Gemini 原生格式 vs Anthropic Messages 格式）和不同的端点路径。建议在 `provider.ts` 新增 `vertex-gemini/` 和 `vertex-anthropic/` 两个前缀来区分。

**Gemini Context Cache 对缓存键的影响**：Vertex 的 Context Cache 是在 Google 侧预创建的资源，引用时在请求体中加入 `cachedContent` 资源名（是路由/计费字段）。`cachedContent` 应加入 `HASH_EXCLUDE_FIELDS`，否则每次预创建不同资源名都会导致本地响应缓存 miss。

---

## §6 OpenRouter

### 6.1 协议与端点

OpenRouter 以 OpenAI 兼容格式为统一接口，聚合 300+ 模型。

**主端点**：

```
POST https://openrouter.ai/api/v1/chat/completions
Content-Type: application/json
Authorization: Bearer <OPENROUTER_API_KEY>
HTTP-Referer: https://yourapp.com      // 可选，显示在排行榜
X-Title: My App                         // 可选，应用名
```

**模型查询端点**：

```
GET https://openrouter.ai/api/v1/models
GET https://openrouter.ai/api/v1/models?supported_parameters=tools
GET https://openrouter.ai/api/v1/models/{model_id}/endpoints
```

`/models` 返回每个模型的 `id`、`context_length`、`pricing`（per token）、`architecture`（`input_modalities`, `output_modalities`）、`supported_parameters`（如 `tools`、`structured_outputs`、`reasoning`）。

**生成 ID**：响应头 `X-Generation-Id` 可用于查询 `/api/v1/generation?id=...` 获取详细统计。

**文档来源**：[R23]~[R28]

### 6.2 关键字段对照

**消息格式**：与 OpenAI Chat Completions API 完全兼容，额外支持：
- `reasoning` / `reasoning_content`：推理内容（OpenRouter 扩展字段，在响应 `choices[].message` 中）
- `reasoning_details` 数组：详细推理块（类型 `reasoning.text` / `reasoning.summary` / `reasoning.encrypted`）
- 消息块级 `cache_control`：`{ "type": "ephemeral", "ttl": "5m" | "1h" }` （Anthropic 风格显式缓存）

**Provider 路由参数**（`provider` 字段）（[R25]）：

```json
{
  "provider": {
    "order": ["anthropic", "openai"],
    "only": ["anthropic"],
    "allow_fallbacks": false,
    "quantizations": ["int4", "int8"],
    "sort": "price"
  }
}
```

| 参数 | 类型 | 说明 |
|------|-----|------|
| `order` | string[] | 供应商尝试顺序 |
| `only` | string[] | 只允许的供应商，排除其他所有 |
| `allow_fallbacks` | boolean | 默认 `true`；设 `false` 则失败即报错 |
| `quantizations` | string[] | 量化精度过滤（`"int4"`, `"int8"`, `"fp8"`, `"fp16"`, `"bf16"`） |
| `sort` | string/object | `"price"`, `"throughput"`, `"latency"`；对象形式支持 `{ by, partition }` |

**推理字段（Reasoning）**（[R26]）：

OpenRouter 统一推理接口（抽象多家推理实现）：
```json
{
  "reasoning": {
    "effort": "high",
    "max_tokens": 10000,
    "exclude": false,
    "enabled": true
  }
}
```

`effort` 取值：`"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`。

推理 token 在响应 `choices[].message.reasoning` 或 `reasoning_content` 字段出现（两者同值）。流式时通过 `delta.reasoning` 字段渐进输出。

保持多轮推理连续性：需把 `reasoning_details` 数组原样回传给下一轮请求的 assistant 消息。

**Caching（[R27]）**：

- **Sticky Routing（隐式）**：OpenRouter 按会话初始消息 hash 固定供应商，最大化供应商侧缓存命中
- **自动 Prompt Cache（供应商透明）**：OpenAI、DeepSeek、Gemini 模型自动缓存，无需配置
- **显式 Prompt Cache（Anthropic 风格）**：在消息块上加 `cache_control: { type: "ephemeral" }`，适用于 Anthropic 模型（直接转发到 Anthropic）
- 顶层 `cache_control` 字段：作为自动断点提示

**Streaming（[R23]）**：

- 标准 SSE，`stream: true` 触发
- 发送 `: OPENROUTER PROCESSING` keep-alive 注释（约每 15 秒一次，防止连接超时）
- 流结束时最后一个 chunk 包含 `usage` 且 `choices[]` 为空
- 流中途错误：发送含 `error` 顶级字段的最终 chunk，`finish_reason: "error"`
- 中止连接：OpenAI、Anthropic、DeepSeek 等支持客户端中止后停止计费；Bedrock、Google、Groq 不支持

**错误模型**（[R28]）：

```json
{
  "error": {
    "code": 429,
    "message": "Rate limit exceeded",
    "metadata": { "provider_name": "anthropic", "raw": "..." }
  }
}
```

| HTTP | 含义 |
|------|------|
| 400 | 请求格式错误 |
| 401 | API Key 无效 |
| 402 | 余额不足 |
| 429 | 速率限制 |
| 503 | 无可用供应商 |

**文档来源**：[R23]~[R28]

### 6.3 认证与运行环境

**Bearer Token**：
```
Authorization: Bearer sk-or-v1-xxxxx
```

**信息头**（可选，影响 OpenRouter 排行榜展示）：
```
HTTP-Referer: https://yourapp.com
X-Title: Your App Name
```

**Rate Limits**：按账户信用余额和 Tier 管理，可在 Dashboard 查看。

### 6.4 对照我们网关

**当前状态**：**完全通过 OpenRouter**。这是当前的唯一出站路径，所有供应商都通过 OpenRouter 间接访问。

**已支持能力（通过 OpenRouter 间接）**：

| 能力 | 支持状态 | 实现位置 |
|------|---------|---------|
| Chat Completions SSE | ✅ 完整支持 | `stream.ts` + `execute.ts` |
| 工具调用 | ✅ 完整支持 | `openrouter.ts` toolsToOpenAICompatible |
| Reasoning 透传 | ✅ 完整支持 | `buildReasoning` + `reasoning_details` 透传 |
| Prompt Caching（Anthropic 风格） | ✅ 自动注入 | `execute.ts` System Sinking + 历史断点 |
| 多模态图像（image_url） | ✅ 支持 | `partToOpenAICompatible` |
| response_format | ✅ 支持 | `buildOpenRouterRequest` |
| Provider 路由锁（`provider.only`）| ✅ 强制注入 | `provider.ts` PROVIDER_PREFIX_SPECS |
| `:OPENROUTER PROCESSING` 心跳 | ✅ 透传 | SSE 中继直通 |

**尚未覆盖的 OpenRouter 能力**：

| 能力 | 状态 | 说明 |
|------|------|------|
| `provider.quantizations` | ⚠️ 可通过 unknownFields 透传 | 未在 IR 中明确建模 |
| `provider.sort` 对象形式 | ⚠️ 部分支持 | `normalizeProvider` 只提取 `sort` 为字符串 |
| `HTTP-Referer` / `X-Title` 头 | ❌ 未注入 | execute 层未注入这两个头部 |
| `X-Generation-Id` 记录 | ❌ 未记录 | 响应头未被捕获/日志 |
| `/api/v1/models/:id/endpoints` | ❌ 未集成 | 只用了 `/api/v1/models` |
| `include_reasoning` 字段（旧） | ✅ IR 支持 | `normalizeReasoningShorthand` 处理 |

---

## §6b Replit AI Integrations

### 6b.1 代理端点与环境变量

Replit 为四家主要 AI 提供商提供托管代理，通过以下环境变量配置：

| 供应商 | base URL 环境变量 | API Key 环境变量 |
|--------|----------------|----------------|
| OpenAI | `AI_INTEGRATIONS_OPENAI_BASE_URL` | `AI_INTEGRATIONS_OPENAI_API_KEY` |
| Anthropic | `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | `AI_INTEGRATIONS_ANTHROPIC_API_KEY` |
| Gemini | `AI_INTEGRATIONS_GEMINI_BASE_URL` | `AI_INTEGRATIONS_GEMINI_API_KEY` |
| OpenRouter | `AI_INTEGRATIONS_OPENROUTER_BASE_URL` | `AI_INTEGRATIONS_OPENROUTER_API_KEY` |

**关键特性**（[R29]~[R32]）：
- `AI_INTEGRATIONS_*_API_KEY` 是**虚拟 key**（dummy string），仅为兼容 SDK 的 `apiKey` 参数；真实认证由 Replit 代理层透明处理
- 费用计入 Replit 账户 credits，无需用户自备 API Key
- 通过 `setupReplitAIIntegrations` 函数（Replit sandbox 提供）自动配置这些环境变量

**使用方式**：将对应 SDK 的 `baseURL` 改写为 Replit 代理地址即可：

```typescript
// OpenAI
import OpenAI from 'openai';
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Anthropic
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

// Gemini
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL },
});

// OpenRouter（使用 OpenAI SDK）
import OpenAI from 'openai';
const openrouter = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
});
```

### 6b.2 支持的模型与能力

**OpenAI via Replit**（[R29]）：

支持的 API：chat-completions、Responses API、audio transcriptions、images generations、images edits

主要可用模型（截至 2026-05-02）：
- gpt-5.4, gpt-5.2, gpt-5.1, gpt-5, gpt-5-mini, gpt-5-nano（最新系列）
- gpt-5.3-codex, gpt-5.2-codex（仅 Responses API）
- o4-mini, o3（推理模型）
- gpt-image-1（图像生成）
- gpt-audio, gpt-audio-mini（语音对话）

不支持：embeddings、fine-tuning、files、images variations、OpenAI Realtime API

**Anthropic via Replit**（[R30]）：

支持的 API：messages 接口

主要可用模型：claude-opus-4-7, claude-opus-4-6, claude-sonnet-4-6, claude-sonnet-4-5, claude-haiku-4-5

不支持：Batch API、Files API

特殊限制：
- claude-opus-4-7：`temperature`、`top_p`、`top_k` 已废弃（设置非默认值返回 400）
- claude-opus-4-7：默认省略 thinking 内容；需用 `thinking display: "summarized"` 才能看到摘要
- 不支持 `thinking type: "enabled"` 与显式 budget_tokens（返回 400）；改用 adaptive thinking

**Gemini via Replit**（[R31]）：

支持的 API：generateContent / generateContentStream

主要可用模型：gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-3-pro-image-preview, gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-image

不支持：Live API、embeddings、fine-tuning、files、audio/video generation

特殊限制：
- 只支持 inline 数据（无 Files API），最大输入 8 MB
- Audio/video 处理需分块 + 重试 + 限流

**OpenRouter via Replit**（[R32]）：

支持的 API：chat completions

主要用途：访问 xAI Grok、Meta Llama、Microsoft Phi、Mistral、Qwen、DeepSeek、Nvidia 等长尾模型

不支持：image generation、audio、embeddings、fine-tuning、files

### 6b.3 直连 vs Replit 代理差异

| 维度 | 自备 Key 直连 | Replit AI Integrations 代理 |
|------|------------|--------------------------|
| 认证 | 自备 API Key | 虚拟 Key + Replit 代理透明认证 |
| 计费 | 直接到供应商账户 | 计入 Replit credits |
| 模型可用性 | 供应商全量目录 | 仅 Skill 文档列出的子集 |
| 限流 | 供应商账户 Tier 限流 | Replit 平台级别限流（具体未公开） |
| 延迟 | 直连延迟最低 | 经 Replit 代理略高 |
| 复杂能力 | 完整支持（Batch、Files、Realtime 等） | 不支持 Batch、Files、Realtime API 等 |
| 特殊限制 | 无 | Anthropic claude-opus-4-7 有 thinking 限制 |
| 部署复杂度 | 需管理密钥安全 | 自动配置，无需密钥管理 |

### 6b.4 对照我们网关

**当前状态**：网关代码中有 `LocalBackendPoolEntry` 接口声明（`backendPool.ts` 第 95~101 行），但没有配套的执行路径。实际上，`kind: "local"` 的 backend 从未被路由到任何实际 HTTP 调用。

**接入 Replit AI Integrations 所需的工作**：

这是**所有接入方案中改动成本最低**的方案：

| 组件 | 改动内容 | 预估工作量 | 风险 |
|------|---------|-----------|------|
| `backendPool.ts` | 实现 `LocalBackendPoolEntry` 的执行路径（从 env 读取 `AI_INTEGRATIONS_*` 变量，注入到 pool） | 低（0.5 天） | |
| `execute.ts` | 为 `kind: "local"` backend 添加直接 HTTP 调用路径（改写 base URL + 注入对应 Bearer key）| 中（1 天） | |
| `provider.ts` | 新增 `replit-openai/`, `replit-anthropic/`, `replit-gemini/`, `replit-openrouter/` 前缀别名（各自指向对应的 Replit 代理端点） | 低（0.5 天） | |
| 环境变量配置 | 调用 `setupReplitAIIntegrations` 自动配置 4 个 env vars | 极低（10 分钟） | |

由于 Replit AI Integrations 代理端点兼容原生 SDK 接口（OpenAI compatible、Anthropic Messages、Gemini generateContent），**不需要修改 `normalize.ts`、`detect.ts`、`stream.ts`**。仅需在执行层根据 backend 类型选择正确的 base URL 和认证方式。

**对 OpenRouter 的影响**：接入 Replit OpenRouter 代理后，可以绕过 Friend Proxy 子节点直接访问 OpenRouter（无双重代理延迟），但需要注意 Replit 代理只支持 chat completions，不支持 OpenRouter 全部端点（如 `/models`、`/generation`）。

---

## §7 五家能力对照矩阵

下表对比五家供应商的主要能力与我们网关当前的支持状态。

**图例**：✅ = 完整支持  ⚠️ = 部分支持/需适配  ❌ = 当前不支持

### 7.1 协议 / 认证能力

| 维度 | OpenAI | AWS Bedrock | Google Vertex | OpenRouter | Replit 代理 | 我们网关当前 |
|------|--------|------------|--------------|-----------|------------|------------|
| **主协议** | OpenAI Chat Completions / Responses API | InvokeModel / Converse API | generateContent / rawPredict | OpenAI 兼容 Chat Completions | 各供应商原生格式 | OpenAI Chat Completions（对外暴露） |
| **认证方式** | Bearer Token | AWS SigV4 | OAuth2 / ADC | Bearer Token | 虚拟 Bearer Token | 透传（由 Friend Proxy 处理） |
| **直连支持** | ❌ 仅通过 OR | ❌ 仅通过 OR | ❌ 仅通过 OR | ✅ 完整直连 | ❌ 未接入 | ✅（仅 OpenRouter）|

### 7.2 流式 / 传输能力

| 维度 | OpenAI | AWS Bedrock | Google Vertex | OpenRouter | Replit 代理 | 我们网关当前 |
|------|--------|------------|--------------|-----------|------------|------------|
| **流式协议** | SSE（`data: {...}\n\n`） | Binary Event Stream（InvokeModel）/ SSE（Converse 部分）| SSE（`?alt=sse`，每条是完整响应体） | SSE（OpenAI 兼容） | SSE（各供应商原生） | ✅ SSE 解析（OpenAI compat + Anthropic SSE） |
| **流式推理内容** | ✅ `delta.reasoning_details[]` | ⚠️ 取决于底层模型 | ✅ `parts[].thought` | ✅ `delta.reasoning` | ✅ | ✅ 已支持解析 |
| **Keep-alive 心跳** | ❌ | ❌ | ❌ | ✅ `: OPENROUTER PROCESSING` | 透传 | ✅ 已中继 |
| **中止后停止计费** | ✅ | ❌ | ❌ | 取决于底层供应商 | 取决于供应商 | N/A（由 OR 决定）|
| **Fake Streaming（非流式模拟）** | N/A | N/A | N/A | N/A | N/A | ⚠️ execute.ts 有该逻辑 |

### 7.3 工具调用能力

| 维度 | OpenAI | AWS Bedrock | Google Vertex | OpenRouter | Replit 代理 | 我们网关当前 |
|------|--------|------------|--------------|-----------|------------|------------|
| **工具定义格式** | `function.parameters`（JSON Schema） | `toolSpec.inputSchema.json`（Converse）/ `input_schema`（InvokeModel）| `functionDeclarations[].parameters`（OpenAPI-style Schema，大写 type）| 兼容 OpenAI 格式 | 各原生格式 | ✅ 已转为 OpenAI 格式透传 |
| **tool_choice** | `"none"/"auto"/"required"/{function}` | `toolChoice: { auto/any/tool }` | `functionCallingConfig.mode: AUTO/ANY/NONE` | ✅ 兼容 OpenAI | 各原生 | ⚠️ 透传 unknownFields |
| **parallel_tool_calls** | ✅ | ❌ | ❌ | ✅（部分模型）| ⚠️ | ⚠️ 通过 unknownFields 透传 |
| **strict 模式** | ✅（`strict: true`）| ❌ | ❌ | ✅（部分模型）| ⚠️ | ⚠️ 通过 unknownFields 透传 |

### 7.4 推理 (Reasoning) 能力

| 维度 | OpenAI | AWS Bedrock | Google Vertex | OpenRouter | Replit 代理 | 我们网关当前 |
|------|--------|------------|--------------|-----------|------------|------------|
| **推理 Token** | ✅ `reasoning_tokens`（o 系列） | ✅（Anthropic Claude 透传） | ✅ `thinkingConfig`（Gemini 2.5+）| ✅ `reasoning` 统一接口 | ✅ | ✅ IR 支持，`execute.ts`透传 |
| **推理控制参数** | `reasoning_effort: low/medium/high`（Chat）/ `reasoning.effort`（Responses）| Anthropic 格式 `thinking: {type, budget_tokens}` | `generationConfig.thinkingConfig.thinkingBudget` | `reasoning.effort: none~xhigh` | ⚠️ 各供应商限制 | ✅ IR 统一 `reasoning.effort/maxTokens` |
| **推理内容返回** | `delta.reasoning_details[]` (Responses) / `delta.reasoning` | `thinking` content block | `parts[].thought` | `delta.reasoning` / `reasoning_details[]` | ⚠️ 部分有限制 | ✅ `stream.ts` 已解析 |
| **加密推理块** | ✅ `reasoning.encrypted` | ✅ `redacted_thinking` | ❌ | ✅ 透传 | ⚠️ | ✅ `redacted_thinking` part 支持 |

### 7.5 Prompt Caching 能力

| 维度 | OpenAI | AWS Bedrock | Google Vertex (Gemini) | OpenRouter | Replit 代理 | 我们网关当前 |
|------|--------|------------|----------------------|-----------|------------|------------|
| **开启方式** | 全自动（无需配置） | `cachePoint` 块标记（显式）| `cachedContent` 资源 API（预创建）| 自动 + `cache_control`（Anthropic 风格）| 透传各供应商 | ⚠️ 仅注入 OpenAI 兼容块级 `cache_control` |
| **TTL 控制** | 不可控（自动） | 5min 或 1h（`cachePoint.type` 扩展支持）| 可配置（`ttl`）| `ttl: "5m"/"1h"` | 各供应商 | ✅ IR `cache.ttl` 字段支持 |
| **命中计量** | `prompt_tokens_details.cached_tokens` | `usage.cacheReadInputTokens` | `usageMetadata.cachedContentTokenCount` | 各供应商字段，OR 部分抹平 | 透传 | ✅ `stream.ts` 解析 `cacheReadTokens` |
| **系统提示 Cache 自动注入** | N/A（自动） | ❌（需 cachePoint）| ❌（需 cachedContent 资源）| ✅（OpenRouter 处理 sticky routing）| N/A | ✅ `execute.ts` System Sinking 策略 |
| **历史消息 Cache 断点** | N/A（自动） | ❌ | ❌ | ✅（通过 Anthropic 格式透传）| N/A | ✅ `execute.ts` `applyHistoryBreakpoint` |

### 7.6 多模态能力

| 维度 | OpenAI | AWS Bedrock | Google Vertex | OpenRouter | Replit 代理 | 我们网关当前 |
|------|--------|------------|--------------|-----------|------------|------------|
| **图像输入** | ✅ `image_url`（URL/base64）| ✅ `image.source.bytes`（base64，Converse）| ✅ `inlineData`（base64）/ `fileData`（URI）| ✅ `image_url` 统一 | ✅ | ✅ `image_url` part |
| **PDF/文档输入** | ✅（gpt-4o+）| ✅ Converse `document` 块 | ✅ `inlineData` mimeType=pdf | ✅ `input_file` 块 | ⚠️（Anthropic 无 Files API）| ⚠️ `input_file` IR part 存在但未充分测试 |
| **音频输入** | ✅（gpt-audio）| ⚠️ 取决于模型 | ✅ Gemini 原生 | ⚠️（部分模型）| ⚠️ Replit OpenAI 支持 | ❌ `audio_io` 为 planned 状态 |
| **图像生成** | ✅ gpt-image-1 | ⚠️ 通过 Stability AI 等 | ✅ Gemini image model | ✅（部分模型）| ✅（Gemini/OpenAI）| ❌ 未接入 |

### 7.7 结构化输出

| 维度 | OpenAI | AWS Bedrock | Google Vertex | OpenRouter | Replit 代理 | 我们网关当前 |
|------|--------|------------|--------------|-----------|------------|------------|
| **JSON Object 模式** | ✅ `response_format.type:"json_object"` | ⚠️ 部分模型 | ✅ `responseMimeType:"application/json"` | ✅ 透传 | ⚠️ | ✅ IR `responseFormat.type:"json_object"` |
| **JSON Schema（严格）** | ✅ `json_schema` + `strict:true` | ⚠️ 通过 Anthropic 工具实现 | ✅ `responseSchema` | ✅ 透传 | ⚠️ | ✅ IR `responseFormat.type:"json_schema"` |

---

## §8 落地建议清单（按 ROI 排序）

以下建议按**改动成本低、收益高**到**改动成本高、收益高**的顺序排列，供工程决策参考。

---

### 建议 P1：接入 Replit AI Integrations OpenAI / Anthropic / Gemini / OpenRouter 代理

**优先级**：🔴 最高（ROI 最佳）  
**收益**：无需 Friend Proxy 中转，直接调用各大供应商；无需自备 API Key；无 OpenRouter 加价（对 OpenAI/Anthropic/Gemini 直连而言）  
**改动成本**：极低（预计 2~3 天）

**具体步骤**：

1. **环境变量配置**：调用 `setupReplitAIIntegrations` 设置 4 个 provider 的 `AI_INTEGRATIONS_*_BASE_URL` 和 `AI_INTEGRATIONS_*_API_KEY`
2. **`backendPool.ts`**：实现 `LocalBackendPoolEntry` 的具体路由逻辑，从环境变量中读取各 provider 的代理 URL 和虚拟 key
3. **`execute.ts`**：为 `kind: "local"` + provider type 的后端添加直接 HTTP fetch 路径（改写 base URL，注入对应 Bearer key），绕过 Friend Proxy
4. **`provider.ts`**：新增前缀别名（如 `replit-openai/`、`replit-anthropic/` 等）指向 local backend 类型

**涉及文件**：
- `artifacts/api-server/src/lib/backendPool.ts`（扩展 LocalBackendPoolEntry 路由）
- `artifacts/api-server/src/lib/gateway/execute.ts`（新增 local backend 执行分支）
- `artifacts/api-server/src/lib/gateway/provider.ts`（新增前缀别名，可选）

**风险**：
- Replit 代理有模型子集限制（不是供应商全量目录），需提前确认目标模型是否在 Skill 列表内
- Anthropic claude-opus-4-7 有 thinking 参数限制，需在文档中注明

**缓存键影响**：无需修改（代理接口与直连协议兼容）

---

### 建议 P2：完善 HTTP-Referer / X-Title 头注入

**优先级**：🟡 中等  
**收益**：提升 OpenRouter 排行榜曝光；助于调试（`X-Generation-Id` 关联）  
**改动成本**：极低（半天）

**具体步骤**：在 `execute.ts` 的 OpenRouter 请求组装阶段，条件注入：
```typescript
'HTTP-Referer': process.env.OPENROUTER_REFERER ?? 'https://your-gateway.replit.app',
'X-Title': process.env.OPENROUTER_TITLE ?? 'Unified AI Gateway',
```
同时捕获响应头 `X-Generation-Id` 并写入请求日志（便于追踪）。

**涉及文件**：`artifacts/api-server/src/lib/gateway/execute.ts`

---

### 建议 P3：接入 OpenAI 直连（含 Replit 代理路径）

**优先级**：🟡 中等  
**收益**：省去 OpenRouter ~5% 加价；可使用 `OpenAI-Organization`/`OpenAI-Project` 头部实现精细计费；可访问 OpenAI 原生 Responses API  
**改动成本**：低~中（3~5 天，取决于是否需要 Responses API 支持）

**具体步骤**（仅 Chat Completions 直连，不含 Responses API）：
1. 在 `backendPool.ts` 新增 `kind: "openai-direct"` backend 类型，携带 `OPENAI_API_KEY`
2. 在 `execute.ts` 为该类型添加执行路径：base URL `https://api.openai.com`，注入 `Authorization: Bearer $OPENAI_API_KEY`、可选注入 `OpenAI-Organization`、`OpenAI-Project`
3. 在 `provider.ts` 保留 `openai/` 前缀，新增一个路由规则：当 `OPENAI_API_KEY` 环境变量存在时优先使用直连，否则回退到 OpenRouter

如果需要原生 Responses API（`/v1/responses`）：
- 新增 `normalizeOpenAIResponses()` 处理 `input`（vs `messages`）和 `max_output_tokens`（vs `max_tokens`）字段
- 新增 Responses API SSE 事件类型解析（`response.created`、`output_item.delta` 等）
- 新增 `previous_response_id` 多轮推理管理（复杂度高）

**涉及文件**：
- `artifacts/api-server/src/lib/backendPool.ts`
- `artifacts/api-server/src/lib/gateway/execute.ts`
- `artifacts/api-server/src/lib/gateway/provider.ts`
- `artifacts/api-server/src/lib/gateway/normalize.ts`（Responses API 需要）

**缓存键影响**：
- 如果 OpenAI 直连和 OpenRouter→OpenAI 路径对同一模型给出语义等价的响应，缓存键无需变化（`provider` 已排除在键之外）
- 若发现版本差异导致的响应不一致，需在 `HASH_EXCLUDE_FIELDS` 中移除 `provider`，或引入 `direct_openai_` 前缀到 model 字段

---

### 建议 P4：完善 `provider.sort` 对象形式支持

**优先级**：🟢 低  
**收益**：解锁 OpenRouter `sort: { by: "price", partition: "none" }` 全局排序功能  
**改动成本**：极低（2 小时）

在 `normalize.ts` 的 `normalizeProvider` 函数中，把 `value.sort` 的处理从 `typeof value.sort === "string"` 改为也接受 object 形式，并在 `GatewayProviderConfig` 的 `sort` 类型从 `string` 改为 `string | Record<string, unknown>`。

**涉及文件**：`artifacts/api-server/src/lib/gateway/normalize.ts`、`types.ts`

---

### 建议 P5：接入 AWS Bedrock 直连

**优先级**：🟠 中高  
**收益**：省去 OpenRouter 加价；可直接控制 `cachePoint` Prompt Cache（更精确的缓存策略）；可访问 Bedrock 专属能力（Guardrails）  
**改动成本**：高（10~15 天）

**具体步骤**：
1. 新增 `sigv4.ts`：实现 AWS SigV4 签名（或引入 `@aws-sdk/signature-v4`），接收 `region`、`service`（`bedrock`）、`credentials`、`request`，输出签名头部
2. 新增 `bedrockConverse.ts`：IR → Converse API 请求格式（`contents` → `messages`，`tools` → `toolConfig.tools`，`reasoning` → Anthropic `thinking`，`cache` → `cachePoint`）
3. 修改 `execute.ts`：新增 `kind: "bedrock"` backend 执行分支，调用 `sigv4.ts` 签名，发送 `Converse` 或 `ConverseStream` 请求
4. 新增 AWS Event Stream 解码（`InvokeModelWithResponseStream` 使用，`ConverseStream` 也是类似格式）：可使用 `@aws-sdk/eventstream-codec`
5. 修改 `provider.ts` 模型 ID 还原逻辑：从 dot 格式（`claude-sonnet-4.5`）反向生成 Bedrock ID（`anthropic.claude-sonnet-4-5-20251009-v1:0`）
6. 在 `execute.ts` 的 Prompt Cache 注入逻辑里，为 Bedrock 路径生成 `cachePoint` 块而非 `cache_control` 块

**涉及文件**（新增或大幅修改）：
- `artifacts/api-server/src/lib/gateway/execute.ts`（新增 bedrock 执行分支）
- 新增 `artifacts/api-server/src/lib/providers/bedrock/sigv4.ts`
- 新增 `artifacts/api-server/src/lib/providers/bedrock/converse.ts`
- `artifacts/api-server/src/lib/backendPool.ts`（新增 `kind: "bedrock"` 类型）
- `artifacts/api-server/src/lib/gateway/provider.ts`（保持 `bedrock/` 前缀，修改路由 target）

**风险**：
- SigV4 实现错误导致所有请求 403
- Converse 和 InvokeModel 格式混用（建议先只支持 Converse）
- Binary Event Stream 解码复杂

**缓存键影响**：无需修改（`cachePoint` 已被 `stripMessageBlockCacheControl` 过滤）

---

### 建议 P6：接入 Google Vertex AI 直连

**优先级**：🔵 低~中（建议作为第二阶段）  
**收益**：省去 OpenRouter 加价；可使用 Vertex Context Cache（长上下文成本节省）；可访问 Gemini 完整能力（Grounding、泛化视频输入等）  
**改动成本**：非常高（15~20 天）

**建议拆分为两个子任务**：

**子任务 6a：Anthropic Claude on Vertex**（相对简单）：
- 新增 `vertexAuth.ts`：使用 `google-auth-library` 加载 service account JSON → access token（带 1 小时 TTL 缓存 + 提前 60 秒刷新）
- 修改 `execute.ts`：新增 `kind: "vertex-anthropic"` backend，base URL 拼装为 `https://{region}-aiplatform.googleapis.com/v1beta1/projects/{project}/locations/{region}/publishers/anthropic/models/{model}:rawPredict`（或 `streamRawPredict`）
- `anthropic_version` 注入：把 `"vertex-2023-10-16"` 注入请求体（不是头部）
- 模型 ID 还原：`claude-sonnet-4.5` → `claude-sonnet-4-5@20250929`

**子任务 6b：Gemini 原生 Vertex**（复杂）：
- 修改 `normalize.ts`：为 Gemini 直连路径提取 system message 至 `system_instruction` 字段（IR 需新增该字段或放 `unknownFields`）
- 新增 `geminiVertex.ts`：IR → `contents` + `system_instruction` + `generationConfig`（含 `thinkingConfig`）
- 流式解析：Gemini `streamGenerateContent` 的每个 SSE `data:` 是完整 `GenerateContentResponse`（非增量 delta），需要新的解析逻辑
- Context Cache（可选，高难度）：独立资源创建 + 引用，需管理 `cachedContent` 生命周期

**涉及文件**（新增或修改）：
- 新增 `artifacts/api-server/src/lib/providers/vertex/auth.ts`
- 新增 `artifacts/api-server/src/lib/providers/vertex/anthropic.ts`
- 新增 `artifacts/api-server/src/lib/providers/vertex/gemini.ts`
- `artifacts/api-server/src/lib/gateway/execute.ts`（两个新执行分支）
- `artifacts/api-server/src/lib/gateway/normalize.ts`（Gemini `system_instruction` 提取）

**缓存键影响**：
- Vertex Context Cache 的 `cachedContent` 资源名应加入 `HASH_EXCLUDE_FIELDS`（路由/计费字段，不影响响应内容）

---

### 建议 P7：把 provider 维度加入缓存键（可选/按需）

**优先级**：🟢 低（当前单后端场景无需）  
**触发条件**：同时开启多个直连 provider（如既有 Replit 代理 Anthropic、又有 OpenRouter Anthropic），且两者对同一模型的响应存在实质差异

**改动方案**：

方案 A（保守）：在 `hashRequest` 中，若请求体包含特定直连 provider 标记（如 `_provider_type: "bedrock-direct"`），则把该字段加入哈希（而非在 `HASH_EXCLUDE_FIELDS` 中排除 `provider`）。

方案 B（激进）：从 `HASH_EXCLUDE_FIELDS` 中移除 `provider`，使整个 provider 对象参与缓存键。副作用：不同 OpenRouter provider 路由参数（`order`、`only`）会导致本地缓存 miss，降低命中率。

**建议**：优先使用方案 A，且仅在实际观察到跨 provider 响应差异时激活。

**涉及文件**：`artifacts/api-server/src/lib/unifiedCacheKey.ts`（需同步更新两个仓库）

---

### 建议 P8：Friend Proxy 能力声明扩展

**优先级**：🟢 低  
**背景**：当前 `BackendPoolEntry.providerSlugs` 用于过滤子节点能否服务某 OpenRouter provider slug。当引入直连 provider 后，需要扩展能力声明字段。

**建议改动**：
- 在 `BackendPoolEntry` 增加 `directProviders?: string[]` 字段，声明该节点支持哪些直连 provider（`"openai-direct"`, `"bedrock"`, `"vertex-anthropic"` 等）
- 在 `filterBackendPoolByProvider` 的直连场景中，优先选择声明了对应 `directProviders` 的节点

**涉及文件**：`artifacts/api-server/src/lib/backendPool.ts`

---

### 8.1 对现有缓存键的影响分析

| 接入方案 | 缓存键影响 | 推荐处置 |
|---------|---------|---------|
| Replit AI Integrations 代理 | ✅ 无影响 | 无需修改 `unifiedCacheKey.ts` |
| OpenAI 直连（同模型版本）| ✅ 无影响（`provider` 已排除）| 无需修改，但需监控响应差异 |
| Bedrock 直连 | ✅ 无影响（`cachePoint` 已过滤）| 无需修改 |
| Vertex Anthropic 直连 | ✅ 无影响 | 无需修改 |
| Vertex Gemini 直连（Context Cache）| ⚠️ `cachedContent` 字段需排除 | 在 `HASH_EXCLUDE_FIELDS` 中加入 `cachedContent` |

### 8.2 对 Friend Proxy 的影响分析

| 接入方案 | Friend Proxy 影响 | 推荐处置 |
|---------|----------------|---------|
| Replit AI Integrations 代理 | 新增 `kind: "local"` 执行路径，绕过 Friend Proxy | 实现 `LocalBackendPoolEntry` 执行逻辑 |
| OpenAI 直连 | 新增 `kind: "openai-direct"` 类型 | 扩展 `BackendPoolEntry` union 类型 |
| Bedrock 直连 | 新增 `kind: "bedrock"` 类型，携带 AWS credentials + region | 大幅扩展 pool 数据结构 |
| Vertex 直连 | 新增 `kind: "vertex-anthropic"` / `kind: "vertex-gemini"` | 同上 |
| Rendezvous Hashing（Prompt Cache 节点亲和性）| 新类型 backend 需参与哈希 | `pickBackendForCache` 需对新类型 backend 生成稳定 URL（可用 `"bedrock://us-east-1"` 等伪 URL）|

---

*报告结束*

*本文档所有事实声明均基于上述参考资料（§1 资料表），建议在实施前重新验证官方文档的最新状态。*
