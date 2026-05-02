# AI Proxy Gateway — V1.1.9

## 项目概述

统一 AI API 网关，OpenAI 兼容格式，支持 OpenAI / Anthropic / Gemini / OpenRouter 四大后端。
通过 Replit Remix 分发，每位用户独立配置自己的 PROXY_API_KEY。

## 核心功能

- `/v1/chat/completions` — OpenAI 兼容接口（自动路由到 OpenAI / Claude / Gemini / OpenRouter）
- `/v1/messages` — Anthropic 原生接口（支持 Cherry Studio、Claude.ai 等 Anthropic 型客户端）
- `/v1/models` — 模型列表
- `/v1/stats` — 用量统计（含按节点 + 按模型 token 统计，支持按模型定价计算开销，含缓存 token 追踪，含 `responseCache` 命中统计）
- `/v1/admin/backends` — 动态管理 Friend Proxy 节点（添加后自动触发模型列表刷新）
- `/v1/admin/models/refresh` — 手动触发 OpenRouter 动态模型列表拉取（支持 Portal 按钮 + curl）
- `/v1/admin/logs` — 请求日志历史（ring buffer, 最近 200 条）
- `/v1/admin/logs/stream` — 实时日志 SSE 流（支持 `?key=` 查询参数认证）
- `/v1/admin/cache` — 响应缓存统计 + 配置（GET/PATCH/DELETE），非流式重复请求零调用 API
- SillyTavern 兼容模式（对 Claude 自动追加「继续」消息，通过 `/api/settings/sillytavern` 持久化）
- 版本检测与自动更新（`/api/update/version` + `/api/update/apply`，需配置 `UPDATE_CHECK_URL`）
- 设置向导（首次访问自动显示，引导 AI 集成初始化 + PROXY_API_KEY 设置）
- 假流式（Fake Streaming）— 将非流式 JSON 自动模拟为 SSE 流

## 省钱机制（双层缓存）

| 层次 | 实现 | 效果 |
|------|------|------|
| **L1 响应缓存** | `lib/responseCache.ts`：SHA-256 key，内存 Map，TTL=1h，最多 500 条 | 完全相同的非流式请求直接命中，**不消耗任何 Token** |
| **L2 Provider Prompt Cache** | Anthropic `cache_control: { type:"ephemeral", ttl:"1h" }`；注入覆盖全部 Claude 模型（`claude-*` + `anthropic/claude-*`）及 `/v1/messages` 原生路径；缓存亲和路由（Rendezvous Hashing）确保同系统 prompt 打到同节点 | 长对话/大系统 prompt 重复输入 token 降至 **0.1×** 价格 |

## Portal 前端 Tabs

| Tab | 组件 | 说明 |
|-----|------|------|
| 概览 | `PageHome` (inline) | 状态、连接信息、API Key 输入 |
| 统计 | `PageStats` (inline) | 节点用量、路由策略设置 |
| 模型 | `PageModels` (inline) | 模型启用/禁用管理 |
| 日志 | `PageLogs` | SSE 实时日志查看器，支持过滤/下载/清空 |
| 文档 | `PageDocs` | 技术文档手风琴式展示 |

## 路由架构

- **外部客户端**（CherryStudio 等）直接访问 api-server 域名，使用 `/v1/*` 路径
- **Portal 内部调用**通过 Replit 路由代理，使用 `/api/v1/*` 路径（api-server 双重挂载 proxyRouter 在 `/` 和 `/api`）

## 绝对 Provider 路由（Absolute Provider Routing）

**契约**：当请求模型 ID 携带路由前缀（如 `bedrock/claude-sonnet-4.5`、`vertex/gemini-2.5-pro`、`anthropic/claude-opus-4.5`、`openai/gpt-5-mini`、`groq/llama-3.3-70b`），网关必须将该请求**硬锁定**到对应的 OpenRouter 子通道：

```jsonc
"provider": {
  "only": ["<canonical-or-slug>"],
  "order": ["<canonical-or-slug>"],
  "allow_fallbacks": false
}
```

客户端无法绕过：任何客户端传入的 `provider.only` / `provider.order` / `provider.allow_fallbacks` 在前缀锁定生效时**会被强制覆盖**（`sort` 等其它字段保留）。

**单一真相源**：`artifacts/api-server/src/lib/gateway/provider.ts` 的 `PROVIDER_PREFIX_SPECS`（30+ 条目，覆盖所有 OpenRouter 文档化的 provider slug）。`modelRegistry.ts#PROVIDER_ROUTE_PREFIXES` 与 `routes/proxy.ts` 中的检测必须与之保持同步——通过共享的 `detectAbsoluteProviderRoute()` 与 `listAbsoluteProviderPrefixAliases()` 实现。

**三道防线**（深度防御）：
1. `mergeGatewayProviderConfig()`（`/api` 统一网关路径）
2. `buildAbsoluteProviderBlock()`（`/v1/chat/completions` 与 `/v1/messages` 旧路径）
3. `buildProvider()`（`openrouter.ts` 序列化层 — 即使前两道丢失也兜底）

**直通别名**：`openrouter/...` 与 `auto/...` 仅剥离前缀，不注入 provider 锁，让 OpenRouter 默认选择后端。

**后端能力门控**：当锁定生效时，`execute.ts`、`/v1/chat/completions` 和 `/v1/messages` 都会先调用 `checkAbsoluteRoutingCapability(slug)`：若全部子节点都没有声明对该 provider slug 的支持（`reportedModels[*].provider`），则直接返回 `422 provider_capability_missing`，避免悄悄违约。子节点在没有 reported-models 数据时按"未知 → 视为可服务"宽松处理（向下兼容）。响应头 `X-Gateway-Locked-Provider` / `X-Gateway-Allow-Fallbacks` / `X-Gateway-Provider-Prefix` 可被客户端用来自检锁定是否生效。

详见 `docs/vendors/ROUTING_AUDIT.md`、断言式回归测试 `scripts/test-absolute-routing.ts`，以及包装脚本 `scripts/test-absolute-routing.sh`。

### 供应商文档来源（vendor docs provenance）

下表列出本次绝对路由实现所依据的全部上游文档、原始 URL，以及抓取时间（UTC）。每个 markdown 文件首行的 HTML 注释也保留同样的元数据，便于核对。

| 文件 | 来源 URL | 抓取时间 (UTC) |
|------|---------|----------------|
| `docs/vendors/openrouter/01-chat-completions.md` | https://openrouter.ai/docs/api-reference/chat-completion | 2026-05-02T12:57:00.503Z |
| `docs/vendors/openrouter/02-provider-routing.md` | https://openrouter.ai/docs/features/provider-routing | 2026-05-02T12:57:01.615Z |
| `docs/vendors/openrouter/03-model-routing.md` | https://openrouter.ai/docs/features/model-routing | 2026-05-02T12:57:01.023Z |
| `docs/vendors/openrouter/04-api-overview.md` | https://openrouter.ai/docs/api-reference/overview | 2026-05-02T12:57:01.026Z |
| `docs/vendors/openai/01-chat-completions.md` | https://platform.openai.com/docs/api-reference/chat/create | 2026-05-02T12:57:02.009Z |
| `docs/vendors/openai/02-responses-api.md` | https://platform.openai.com/docs/api-reference/responses/create | 2026-05-02T12:57:04.058Z |
| `docs/vendors/openai/03-models.md` | https://platform.openai.com/docs/models | 2026-05-02T12:57:02.070Z |
| `docs/vendors/openai/04-reasoning.md` | https://platform.openai.com/docs/guides/reasoning | 2026-05-02T12:57:02.457Z |
| `docs/vendors/anthropic/01-messages-api.md` | https://docs.claude.com/en/api/messages | 2026-05-02T12:57:12.916Z |
| `docs/vendors/anthropic/02-prompt-caching.md` | https://docs.claude.com/en/docs/build-with-claude/prompt-caching | 2026-05-02T12:57:03.029Z |
| `docs/vendors/anthropic/03-models.md` | https://docs.claude.com/en/docs/about-claude/models/overview | 2026-05-02T12:57:03.550Z |
| `docs/vendors/anthropic/04-vertex.md` | https://docs.claude.com/en/api/claude-on-vertex-ai | 2026-05-02T12:57:06.109Z |
| `docs/vendors/anthropic/05-bedrock.md` | https://docs.claude.com/en/api/claude-on-amazon-bedrock | 2026-05-02T12:57:04.448Z |
| `docs/vendors/google/01-generate-content.md` | https://ai.google.dev/api/generate-content | 2026-05-02T12:57:05.401Z |
| `docs/vendors/google/02-models.md` | https://ai.google.dev/gemini-api/docs/models | 2026-05-02T12:57:05.855Z |
| `docs/vendors/google/03-vertex-ai.md` | https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference | 2026-05-02T12:57:08.733Z |
| `docs/vendors/replit-ai-integrations/01-overview.md` | Replit-internal skills (`.local/skills/ai-integrations-*`) — no external URL | 2026-05-02 |

## 后端路由

**全部流量通过 Friend Proxy 子节点转发；mother 内已无 LocalNode 概念，无任何上游 AI 厂商凭证依赖。**

| Provider | 路由方式 | 说明 |
|----------|---------|------|
| 所有 Provider | `handleFriendProxy()` | 直接 fetch 转发到 Friend Proxy 子节点 |

`Backend` 类型定义为 `{ kind: "friend"; ... }` 单一形式，编译期即杜绝本地调用路径。
已删除函数：`makeLocalOpenAI / makeLocalAnthropic / makeLocalGemini / makeLocalOpenRouter / handleOpenAI / handleGemini / handleClaude / handleLocalChatCompletion / buildLocalBackend / getLocalRouteForModel / buildFullBackendPool`，已删除接口 `LocalBackendPoolEntry`，已删除 settings 字段 `enableLocalNode` 与对应路由 `/api/settings/local-node`，已删除根 `package.json` 死依赖 `@replit/connectors-sdk`，已删除整个 `lib/integrations-openai-ai-server/` 包。

**脱离 Replit 平台规划 — 阶段 A 已完成（V1.1.9）：** mother 现在 100% 通过 friend proxy 出站，可在任何 Node.js 环境运行；不再依赖 Replit AI Integrations。无 friend proxy 时收到请求将硬返回 HTTP 503 + `error.code: "no_backends_available"`，无静默回退。后续阶段 B-H 处理 Storage 抽象、剩余 Replit 字面量与 GATEWAY_TIMEOUTS 参数化。

## 绝对路由契约（V1.1.9）

当模型 ID 含已注册的 provider prefix 时，gateway **强制**下发：
- `provider.only = [<prefix-provider>]`
- `provider.allow_fallbacks = false`

这两个字段**不可被 client 端的 `provider.allow_fallbacks: true` 或更宽松的 `only` 覆盖** —— prefix 永远赢。

支持的 lock prefix（节选）：`anthropic/`、`openai/`、`azure/`、`vertex/`、`google-ai-studio/`、`bedrock/`、`groq/`、`x-ai/`、`cerebras/`、`fireworks/`、`together/`、`deepinfra/`、`deepseek/`、`mistral/`、`cohere/`、`perplexity/`、`moonshot/`、`sambanova/`、`nvidia/` 等共 28 个 OpenRouter base slug（完整列表见 `provider.ts::PROVIDER_PREFIX_SPECS`）。

特殊 prefix：
- `openrouter/<inner-prefix>/<model>` —— 透传，递归解析 `<inner-prefix>` 的锁定语义
- `meta-llama/`、`mistralai/`、`qwen/`、`amazon/` —— 仅作为型号命名空间，不锁 provider（同一型号可由多家 provider 服务）

## 供应商文档（离线权威参考）

完整官方文档已抓取到 `docs/vendors/`，路由实现以这些文档为唯一权威来源：

| 供应商 | 关键文件 |
|--------|---------|
| OpenRouter | `provider-routing.md`（**绝对路由契约的源头**）、`api-reference-overview.md`、`parameters.md`、`providers-page.md`（69 家 provider 列表） |
| OpenAI | `chat-completions.md`、`responses.md`、`models.md`、`reasoning.md` |
| Anthropic | `messages.md`、`prompt-caching.md`、`vertex.md`、`bedrock.md`、`extended-thinking.md` |
| Gemini | `generate-content.md`、`openai-compat.md` |
| Replit AI Integrations | `ai-integrations*.md` + 4 份 SKILL.md |

审计报告与修复清单：`docs/vendors/ROUTING_AUDIT.md`

## 认证

所有 `/v1/*` 和 `/settings/*` 路由均受 `PROXY_API_KEY` 保护，支持：
- `Authorization: Bearer <key>`（OpenAI 风格）
- `x-api-key: <key>`（Anthropic 风格）
- `?key=<key>` 查询参数（仅限 SSE 日志流端点）

## 环境变量

| 变量 | 说明 |
|------|------|
| `PROXY_API_KEY` | 必填，保护代理的访问密钥 |
| `UPDATE_CHECK_URL` | 可选，远端 `version.json` URL，用于版本检测 |
| `FRIEND_PROXY_URL` / `FRIEND_PROXY_URL_2` ... | 可选，Friend Proxy 节点 URL（mother 100% 出站路径） |
| `AI_INTEGRATIONS_*_BASE_URL` / `AI_INTEGRATIONS_*_API_KEY` | **仅 sub-node（friend proxy）使用**；mother 不再读这些变量做出站，但 sub-node 在向 mother 注册时仍通过 `computeChildIntegrationsAllReady()` 读取这些变量自报状态 |
| `STORAGE_BACKEND` | 可选，持久化存储后端：`local`（默认）\| `s3` \| `r2` \| `gcs` \| `replit`。未设置时若检测到 `DEFAULT_OBJECT_STORAGE_BUCKET_ID` 则自动用 `replit`（向下兼容），否则 fallback 到 `local`。 |
| `STORAGE_LOCAL_DIR` | `local` 模式下的目录，默认 `./data` |
| `STORAGE_S3_BUCKET` / `STORAGE_S3_ACCESS_KEY_ID` / `STORAGE_S3_SECRET_ACCESS_KEY` | `s3`/`r2` 模式必填 |
| `STORAGE_S3_ENDPOINT` | `s3` 模式可选（AWS 默认无），R2/MinIO/B2 必填。R2 格式：`https://<account-id>.r2.cloudflarestorage.com` |
| `STORAGE_S3_REGION` | 默认 `auto`（适配 R2）；AWS S3 需设为真实 region 如 `us-east-1` |
| `STORAGE_S3_PREFIX` | S3 key 前缀，默认 `config/` |
| `STORAGE_S3_FORCE_PATH_STYLE` | 设为 `true` 启用 path-style URL（MinIO 等需要） |
| `STORAGE_GCS_BUCKET` / `STORAGE_GCS_PREFIX` / `GCS_PROJECT_ID` / `GOOGLE_APPLICATION_CREDENTIALS` | `gcs` 模式（标准服务账号，非 Replit sidecar） |

### 推荐云存储：Cloudflare R2（免费）

R2 完全 S3 兼容，10 GB 存储 + 无限出口流量免费，是 mother 脱离 Replit 后首选云存储方案。

```bash
STORAGE_BACKEND=r2
STORAGE_S3_BUCKET=ai-proxy-config
STORAGE_S3_ENDPOINT=https://<your-account-id>.r2.cloudflarestorage.com
STORAGE_S3_ACCESS_KEY_ID=<r2-access-key>
STORAGE_S3_SECRET_ACCESS_KEY=<r2-secret-key>
# STORAGE_S3_REGION 留空即可（默认 "auto"）
```

获取凭证：Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API Token → 选择 Object Read & Write 权限 → 选定 bucket → 创建后立即复制 Access Key ID / Secret Access Key。Account ID 在 R2 Overview 页面可见。

## 版本

当前版本：**V1.1.8**（见 `version.json`）

## 持久化文件

通过 `lib/cloudPersist.ts` 写入，背后实际由 `lib/storage/` adapter 层根据 `STORAGE_BACKEND` env 路由到本地磁盘 / S3 / R2 / GCS / Replit App Storage。

- `dynamic_backends.json` — 动态 Friend Proxy 节点列表
- `server_settings.json` — 服务器设置（含 SillyTavern 模式开关）
- `usage_stats.json` — 用量统计（按节点 + 按模型，含 cacheReadTokens / cacheWriteTokens，10s 去抖 + 5min 安全写入）
- `disabled_models.json` — 禁用模型列表
- `managed_models.json` / `custom_openrouter_models.json` / `model_routes.json` / `routing_settings.json` / `stability_state.json` — 模型管理与路由配置

**Stage B 完成（V1.1.9）：** 新增 `lib/storage/{adapter,local,s3,gcs,replit,index}.ts` 六文件 adapter 层，`cloudPersist.ts` 改为 30 行薄包装；mother 默认（无 env）即可在 vanilla Node 容器跑，写入 `./data/`。R2 通过 S3 adapter 完整支持。

## Workspace

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
