# Absolute Provider Routing — Audit Report

> 对照 `docs/vendors/` 下的供应商官方文档逐条审计 `artifacts/api-server/src/lib/gateway/` 的路由实现。
> 抓取时间：2026-05-02。

## 1. OpenRouter `provider` 路由契约（权威来源）

来源：`docs/vendors/openrouter/provider-routing.md`

| 字段 | 默认值 | 关键语义 |
|------|--------|---------|
| `order` | — | 按顺序优先尝试的 provider 列表，**仍允许 fallback**（除非 `allow_fallbacks=false`） |
| `only` | — | **白名单**，只允许其中的 provider；与 `order` 可叠加 |
| `allow_fallbacks` | **`true`** | `false` 时，列表里的 provider 全挂就直接 4xx，不会跳到其他 provider |
| `ignore` | — | 黑名单 |
| `sort` | — | 设了之后默认负载均衡被禁用 |

**绝对路由的等价定义**（来自文档 §"Disabling Fallbacks" + §"Allowing Only Specific Providers"）：
> `provider.only = [<slug>]` **且** `provider.allow_fallbacks = false`，必要时配合 `provider.order`。

**Base slug 通配语义**（§"Targeting Specific Provider Endpoints"）：
> 用 base slug（如 `google-vertex`）会匹配该 provider 的全部子端点（`google-vertex/us-east5` 等）；
> 用全 slug（如 `google-vertex/us-east5`）只匹配指定 region。

## 2. 现有代码 vs 文档 — 偏差清单

### ❌ Bug #1 — `mergeGatewayProviderConfig` 允许 request 端覆盖 prefix 的 `allow_fallbacks:false`

文件：`artifacts/api-server/src/lib/gateway/provider.ts:316-318`

```ts
if (typeof merged.allowFallbacks !== "boolean" && typeof route?.allowFallbacks === "boolean") {
  merged.allowFallbacks = route.allowFallbacks;
}
```

**问题**：当 client 显式传 `provider.allow_fallbacks: true` 时（很多 SDK 默认就这么传），`merged.allowFallbacks` 已经是 `true`，导致 prefix 的 `false` 被静默吞掉。`only` 数组同理（line 312-314 仅在 request 端没设时才覆盖），但 `only` 至少不会被冲淡——而 `allow_fallbacks` 被 client 翻成 `true` 就直接破防。

**修法**：当 prefix 声明了绝对路由时，**强制**把 `allowFallbacks` 锁成 `false`，并把 `only` **取交集**（如果 client 也传了 `only`）；任何冲突以 prefix 为准并把 client 的原值搬到 `raw` 里以备审计。

### ❌ Bug #2 — `PROVIDER_PREFIX_SPECS` 只覆盖 5 个 prefix，OpenRouter 有 69 个

文件：`artifacts/api-server/src/lib/gateway/provider.ts:31-63`

当前只识别：`bedrock` / `amazon-bedrock`、`vertex` / `google-vertex`、`google`、`anthropic`、`openrouter`。

**问题**：用户写 `openai/gpt-5`、`azure/gpt-5`、`groq/llama-3.3-70b`、`x-ai/grok-2`、`deepinfra/...`、`fireworks/...`、`together/...`、`cerebras/...` 时全部走"无 prefix"逻辑，**根本没有 provider lock**，OpenRouter 会按价格负载均衡选别的 provider。最典型的例子：用户想要"通过 Azure 跑 GPT-5"，写 `azure/gpt-5`，但因为 `azure` 不在 spec 表里，请求会被剥成 `openai/gpt-5` 然后由 OpenRouter 自由路由。

**修法**：扩表覆盖 OpenRouter 文档里有路由意义的全部 base slug（OpenRouter 文档 §"Base Slug Matching" 明确说 base slug 会匹配所有变体）。

### ❌ Bug #3 — `KNOWN_VENDOR_PREFIXES` 与 `PROVIDER_PREFIX_SPECS` 概念混淆

文件：`artifacts/api-server/src/lib/gateway/provider.ts:17-29` vs `:31-63`

`KNOWN_VENDOR_PREFIXES`（型号厂商：`openai`/`anthropic`/`google`/`x-ai`/...）会被 `stripVendorPrefix` **剥掉**用于规整化；`PROVIDER_PREFIX_SPECS`（供应商通道：`bedrock`/`vertex`/`anthropic`/...）会触发路由锁定。但 `anthropic` / `google` 同时出现在两边，语义重叠：用户写 `anthropic/claude-...` 时 `findProviderPrefixSpec("anthropic")` 命中了 spec ✅；但写 `meta-llama/llama-...` 时 vendor 被剥但没有 lock。

**修法**：把两个集合合并为一张表 `PROVIDER_PREFIX_SPECS`，其中所有 base slug 都既能用于 vendor 剥离也能用于 lock。`KNOWN_VENDOR_PREFIXES` 退化为从 spec 表派生的 view。

### ❌ Bug #4 — `openrouter/` prefix 不锁 provider（且会吞掉真实 provider 信息）

文件：`artifacts/api-server/src/lib/gateway/provider.ts:60-63`

```ts
{ aliases: ["openrouter"] },  // 只识别为 prefix，但 spec 里没有 provider/order/only
```

**问题**：用户写 `openrouter/anthropic/claude-sonnet-4.5` 时——
- `segments[0]` = `openrouter`，匹配到 spec
- `payload` = `anthropic/claude-sonnet-4.5`
- 因为 spec 没有 `provider` 字段，`buildProviderRoute` 返回 `undefined`
- 即使 `payload` 含 `anthropic/` 也不再二次解析 → **嵌套 prefix 的 provider lock 完全丢失**

**修法**：当外层 prefix 是 `openrouter` 时，对 `payload` 递归一次 `resolveGatewayModelRoute`，把内层 prefix 提取出来作为 providerRoute。

### ⚠️ Bug #5 — `/v1/messages` Anthropic 原生入口不接受子通道 prefix

文件：`artifacts/api-server/src/lib/gateway/normalize.ts:149-182`（`applyModelResolution`）

`applyModelResolution` 在所有协议下都会跑，理论上 Anthropic-native 客户端写 `model: "vertex/claude-sonnet-4-5"` 也能被识别为 vertex prefix → 锁路由。**但**当前 `provider.ts` 的 prefix 表里没有 `vertex` → `claude-sonnet-4-5` 这种"prefix + Anthropic 模型名"的组合的回退；inferVendorModelPath 会把它变成 `anthropic/claude-sonnet-4-5`，然后 prefix 是 `vertex` → only=`google-vertex`，**模型名却变成了 `anthropic/claude-sonnet-4-5` 而不是 OpenRouter 实际期望的 `anthropic/claude-sonnet-4-5`**——巧合是对的，但这是因为 OpenRouter 在 google-vertex 通道下也用 `anthropic/...` 作为 model id。需要文档化这个隐式契约并写测试钉死。

### ⚠️ Bug #6 — backendPool 不感知 provider prefix

文件：`artifacts/api-server/src/lib/backendPool.ts:1-441` + `artifacts/api-server/src/lib/gateway/execute.ts`（`pickBackendForCache`）

**问题**：所有 friend backend 被一视同仁，路由按 rendezvous hash 选节点。如果某个 friend 节点的上游 OpenRouter key 因为账户限制不能跑 `anthropic` 通道，请求会失败而不是切到能跑的节点。

**修法**（V2 范畴，不在本任务必修项）：给 backend 加 `capabilities: { providers: string[] }`，pickBackend 时按 `providerRoute.provider` 过滤。**本任务**先记录为 follow-up。

### ✅ 没问题的部分

- `buildOpenRouterRequest` 把 `allowFallbacks` → `allow_fallbacks` 命名转换正确（`openrouter.ts:174`）。
- `provider.only` / `order` / `sort` 字段拼装方向正确（`openrouter.ts:170-178`）。
- Claude 型号的小数点规范化（`canonicalizeLogicalModel`）符合 OpenRouter `anthropic/claude-sonnet-4.5` 的规范命名。

## 3. 修复后行为契约（"绝对路由"最终定义）

1. 当 model 含已注册的 provider prefix（任意一个 OpenRouter base slug），生成的 OpenRouter 请求体 **必须**包含：
   - `provider.only = [<spec.provider>]`（如果 spec 同时声明 `order`，附加 `provider.order`）
   - `provider.allow_fallbacks = false`
2. 这两个字段**不可被 client 传入的 `provider.allow_fallbacks: true` 或更宽松的 `only` 覆盖**——prefix 永远赢。
3. 若 client 传入更严格的 `only`（与 prefix only 的交集仍非空），取交集；若交集为空，直接 4xx 而不是静默放行。
4. `openrouter/<inner-prefix>/<model>` 透传 `<inner-prefix>` 的锁定语义。
5. `/v1/messages` 原生路径下，含 prefix 的 model 字段同样下发锁定。

## 4. 文档来源索引

| 供应商 | 关键文件 |
|--------|---------|
| OpenRouter | `openrouter/provider-routing.md`、`openrouter/api-reference-overview.md`、`openrouter/parameters.md`、`openrouter/providers-page.md` |
| OpenAI | `openai/chat-completions.md`、`openai/responses.md`、`openai/models.md` |
| Anthropic | `anthropic/messages.md`、`anthropic/prompt-caching.md`、`anthropic/vertex.md`、`anthropic/bedrock.md` |
| Gemini | `gemini/generate-content.md`、`gemini/openai-compat.md` |
| Replit | `replit/ai-integrations*.md`、`replit/ai-integrations-{openai,anthropic,gemini,openrouter}-skill.md` |
