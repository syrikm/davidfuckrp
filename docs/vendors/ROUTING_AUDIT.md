# Absolute Provider Routing — Audit Report

**Scope:** AI Proxy Gateway (`artifacts/api-server`) — task #1.

**Goal:** When an incoming model id carries a routing prefix (e.g.
`bedrock/claude-sonnet-4.5`, `vertex/gemini-2.5-pro`,
`anthropic/claude-opus-4.5`, `openai/gpt-5-mini`, `groq/llama-3.3-70b`),
the request must be hard-locked to the corresponding OpenRouter
sub-channel via `provider.only` + `allow_fallbacks: false`, with no
silent fallback possible.

Source documentation that frames the contract:

- OpenRouter — Provider Routing
  (`docs/vendors/openrouter/02-provider-routing.md`)
- OpenRouter — Chat Completions API
  (`docs/vendors/openrouter/01-chat-completions.md`)
- Anthropic — Messages API + Bedrock + Vertex docs
  (`docs/vendors/anthropic/01-messages-api.md`,
  `docs/vendors/anthropic/04-vertex.md`,
  `docs/vendors/anthropic/05-bedrock.md`)
- Google — Gemini AI Studio + Vertex AI docs
  (`docs/vendors/google/01-generate-content.md`,
  `docs/vendors/google/03-vertex-ai.md`)
- OpenAI — Chat Completions / Responses API
  (`docs/vendors/openai/01-chat-completions.md`,
  `docs/vendors/openai/02-responses-api.md`)

The vendor-fact baseline established by those docs:

> Setting `provider.only = ["amazon-bedrock"]` together with
> `provider.allow_fallbacks = false` on an OpenRouter chat-completions or
> messages request guarantees the call is served by Bedrock or fails — no
> silent fallback to Anthropic-direct, Vertex, or any other sub-channel.
> The same pattern is documented for every other provider slug
> (`google-vertex`, `google-ai-studio`, `anthropic`, `openai`, `groq`,
> `cerebras`, `sambanova`, `fireworks`, `deepinfra`, `together`,
> `novita`, `hyperbolic`, `lambda`, `cloudflare`, `friendli`,
> `featherless`, `mancer`, `parasail`, `baseten`, `replicate`, `nebius`,
> `chutes`, `azure`, `x-ai`, `deepseek`, `mistral`, `cohere`,
> `perplexity`, `moonshotai`, `z-ai`, `lambda`, …).

---

## §1 — Findings

### §1.1 (CRITICAL) Syntax-corrupted prefix table

`artifacts/api-server/src/lib/gateway/provider.ts` contained a stray
Chinese-character key (`别名:`) inside the `openrouter` entry of
`PROVIDER_PREFIX_SPECS`. The file would not type-check, and the
`openrouter/...` prefix never produced a route record at runtime —
silently letting OpenRouter's default provider order win.

**Fix:** rewrote the spec with an `aliases:` key and removed the broken
entry. The `openrouter` and new `auto` aliases are now declared as
explicit pass-through entries (no `provider` lock — OpenRouter is
allowed to pick).

### §1.2 (HIGH) Permissive merge in `mergeGatewayProviderConfig`

The original implementation only filled `only` / `allow_fallbacks` when
the request had not already supplied them:

```ts
if (!merged.only?.length && route?.only?.length) merged.only = [...route.only];
if (typeof merged.allowFallbacks !== "boolean" && typeof route?.allowFallbacks === "boolean") {
  merged.allowFallbacks = route.allowFallbacks;
}
```

This means a client sending `provider: { allow_fallbacks: true }`
together with `bedrock/claude-...` would silently bypass the lock — the
exact failure mode the task forbids.

**Fix:** when a `providerRoute` is present, the merge now FORCE-sets
`only`, `order`, and `allowFallbacks=false`, discarding any conflicting
client values. Other unrelated keys (`sort`, custom `raw` entries) are
preserved.

A subsequent design iteration tried an "intersection" strategy
(`only = client.only ∩ route.only`) but it had the same escape hatch:
a client sending `only: []` widens the lock back to "any provider".
Force-overwrite is the only correct strategy.

### §1.3 (HIGH) `buildProvider` did not enforce the lock at serialization

`artifacts/api-server/src/lib/gateway/openrouter.ts#buildProvider` only
serialized whatever was on `ir.provider`. If a normalization regression
ever cleared `ir.provider`, the wire payload would lose the lock.

**Fix:** `buildProvider` now also reads `ir.modelResolution.providerRoute`
and force-overwrites the wire fields. This is a defence-in-depth check —
the merge step is the primary enforcement, but the serializer is now
self-sufficient too.

### §1.4 (HIGH) Lossy `normalizeFriendModel` rewrite

`artifacts/api-server/src/routes/proxy.ts#normalizeFriendModel` rewrote
`bedrock/claude-*` → `anthropic/claude-*`, `vertex/gemini-*` →
`google/gemini-*`, and so on, before forwarding to a sub-node. That
threw away the routing intent — the sub-node could only see
`anthropic/claude-...` and would fall back to OpenRouter's default
provider order (which is Anthropic-direct first, Bedrock second).

**Fix:** `normalizeFriendModel` is now a pass-through. The prefix is
preserved end-to-end and is detected immediately downstream by
`handleFriendProxy` to inject the absolute lock.

### §1.5 (HIGH) `handleFriendProxy` only locked `anthropic/...`

The legacy `/v1/chat/completions` path injected
`provider: { order: ["amazon-bedrock"], allow_fallbacks: false }` only
for ids starting with `anthropic/`. Every other absolute prefix
(`bedrock/`, `vertex/`, `aistudio/`, `groq/`, `cerebras/`, `openai/`,
`x-ai/`, …) was forwarded with no provider lock at all.

**Fix:** `handleFriendProxy` now calls `detectAbsoluteProviderRoute()`
on every model id and, when a route matches, calls
`buildAbsoluteProviderBlock()` to set `only`, `order`, and
`allow_fallbacks=false`. The historical `anthropic/...` →
`amazon-bedrock` default is kept for ids that do not match an
explicit absolute prefix (so existing traffic keeps the Bedrock cache
benefit).

### §1.6 (HIGH) `/v1/messages` had no prefix detection at all

The Anthropic-native `/v1/messages` route forwarded the body verbatim to
the sub-node's `/v1/messages`. Prefixes like `bedrock/claude-...` were
ignored.

**Fix:** `/v1/messages` now runs the same
`detectAbsoluteProviderRoute()` + `buildAbsoluteProviderBlock()` pair on
the body before forwarding, so the lock is applied for both the
OpenAI-compat and the Anthropic-native surfaces.

### §1.7 (MEDIUM) `PROVIDER_PREFIX_SPECS` covered five providers

Original entries: `bedrock`, `vertex`, `google`, `anthropic`,
`openrouter` (broken). OpenRouter publishes 30+ provider slugs and
clients commonly send `groq/`, `cerebras/`, `sambanova/`, `fireworks/`,
`deepinfra/`, `together/`, `novita/`, `hyperbolic/`, `aistudio/`,
`openai/`, `x-ai/`, `deepseek/`, `mistral/`, `cohere/`, `perplexity/`,
`moonshotai/`, `azure/`, `replicate/`, `baseten/`, `lambda/`,
`cloudflare/`, `friendli/`, `featherless/`, `mancer/`, `parasail/`,
`nebius/`, `chutes/`, `z-ai/`, … Every one of these went unlocked.

**Fix:** `PROVIDER_PREFIX_SPECS` now enumerates every documented OR
provider slug with the correct canonical mapping. Each entry sets
`order`, `only`, and (redundantly, for clarity) `allowFallbacks: false`.
The parallel HEAD branch (fdc0209) added four further slugs
(`nvidia`, `minimax`, `alibaba`, `baidu`) and three vendor-only
namespaces (`meta-llama`/`meta`/`llama`, `qwen`, `amazon`); both sets
are merged into the canonical table.

### §1.8 (MEDIUM) `PROVIDER_ROUTE_PREFIXES` in `modelRegistry.ts` was out of sync

`resolveRegistryAlias()` consulted a hard-coded set of five prefixes to
decide whether to treat the first segment of a model id as a routing
prefix vs. a vendor namespace. The set diverged from
`PROVIDER_PREFIX_SPECS`, so registry alias lookups for e.g. `groq/...`
or `cerebras/...` silently returned `null`.

**Fix:** `PROVIDER_ROUTE_PREFIXES` now mirrors the full prefix list with
an explicit comment pointing to this audit doc as the canonical source.

### §1.9 (LOW) Pass-through prefixes were undocumented

The `openrouter` alias should mean "let OpenRouter's default order
pick" — not "lock to a non-existent `openrouter` slug". `auto` is
sometimes used for the same intent.

**Fix:** Both aliases are now first-class pass-through entries in
`PROVIDER_PREFIX_SPECS`. They consume the prefix (so it is stripped
from the forwarded model id) but do not inject any `only` /
`allow_fallbacks` fields.

---

## §2 — Files changed

| File | Change |
|------|--------|
| `artifacts/api-server/src/lib/gateway/provider.ts` | Repaired syntax bug; expanded `PROVIDER_PREFIX_SPECS` to 30+ entries; rewrote `mergeGatewayProviderConfig` to force-overwrite lock fields; exported `detectAbsoluteProviderRoute()` and `listAbsoluteProviderPrefixAliases()`. |
| `artifacts/api-server/src/lib/gateway/openrouter.ts` | `buildProvider()` now force-applies the lock from `ir.modelResolution.providerRoute` even if `ir.provider` is missing. |
| `artifacts/api-server/src/lib/modelRegistry.ts` | `PROVIDER_ROUTE_PREFIXES` expanded to mirror the gateway prefix table. |
| `artifacts/api-server/src/routes/proxy.ts` | Imported new helpers; replaced lossy `normalizeFriendModel` with a pass-through; added `buildAbsoluteProviderBlock()`; `handleFriendProxy` and `/v1/messages` now inject the lock universally. |
| `docs/vendors/**` | Vendor reference docs (OpenRouter, OpenAI, Anthropic, Google, Replit AI Integrations) saved with the original source URL preserved. |
| `scripts/test-absolute-routing.sh` | Smoke tests verifying the lock is on the wire for every documented prefix. |
| `replit.md` | Added the absolute-routing contract section. |

---

## §3 — Cross-file invariants

1. **Single source of truth.** `PROVIDER_PREFIX_SPECS` in
   `lib/gateway/provider.ts` is canonical. `PROVIDER_ROUTE_PREFIXES` in
   `lib/modelRegistry.ts` and the prefix detection inside
   `routes/proxy.ts` MUST stay in sync. The shared
   `listAbsoluteProviderPrefixAliases()` export exists to make that easy.

2. **Two enforcement points.** The lock is applied at:
   - `mergeGatewayProviderConfig()` for the unified `/api` gateway path;
   - `buildAbsoluteProviderBlock()` for the legacy `/v1/chat/completions`
     and `/v1/messages` paths.
   `buildProvider()` is a third defence-in-depth point at serialization
   time.

3. **Client cannot escape.** Any client-supplied `provider.only`,
   `provider.order`, or `provider.allow_fallbacks` is discarded when a
   prefix lock applies. Other client `provider.*` keys are preserved.

4. **Pass-through aliases.** `openrouter/...` and `auto/...` strip the
   prefix and let OpenRouter's default order pick. They still appear in
   `PROVIDER_ROUTE_PREFIXES` so that the registry alias lookup treats
   them as routing prefixes (and not as a vendor namespace).

---

## §4 — Verification

`scripts/test-absolute-routing.sh` exercises a representative subset of
prefixes against a running API server and asserts that:

- The outgoing request body (logged at INFO) contains
  `provider.only = [<expected slug>]` and
  `provider.allow_fallbacks = false`.
- A client request with `provider: { allow_fallbacks: true }` does NOT
  override the lock.
- The pass-through `openrouter/...` and `auto/...` prefixes do NOT
  inject a `provider` block.

Run with:

```bash
bash scripts/test-absolute-routing.sh
```

Set `GATEWAY_URL` and `GATEWAY_API_KEY` env vars first.

---

## §5 — Historical audit (Chinese, parallel HEAD branch)

> This section preserves the original Chinese-language audit performed on
> the parallel HEAD branch (commit `fdc0209`). It overlaps with §1 but
> additionally documents Bug #6 (Claude model-id canonicalisation), which
> is implemented in `canonicalizeLogicalModel`/`canonicalizeModelIdentifier`
> and not duplicated in §1 above.

> 对照 `docs/vendors/` 下的供应商官方文档逐条审计 `artifacts/api-server/src/lib/gateway/` 的路由实现。
> 抓取时间：2026-05-02。

### §5.1 OpenRouter `provider` 路由契约（权威来源）

来源：`docs/vendors/openrouter/02-provider-routing.md`

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

### §5.2 Bug #6 — `canonicalizeLogicalModel` 对 Anthropic 模型 ID 的规范化不完整且无架构注释

文件：`artifacts/api-server/src/lib/gateway/provider.ts`（已修）

**问题（基于文档对照）**：

| 输入（Anthropic / Vertex / Bedrock 官方写法） | 旧实现输出 | 应输出（OpenRouter ID） |
|----------------------------------------------|----------|-----------------------|
| `claude-sonnet-4-5` (Anthropic API alias) | `claude-sonnet-4.5` ✅ | `claude-sonnet-4.5` |
| `claude-sonnet-4-5-20250929` (Anthropic / Bedrock 日期) | `claude-sonnet-4.5-20250929` ❌ | `claude-sonnet-4.5` |
| `claude-haiku-4-5@20251001` (Vertex) | `claude-haiku-4.5@20251001` ❌ | `claude-haiku-4.5` |
| `anthropic.claude-sonnet-4-5-20250929-v1:0` (Bedrock) | 原样透传 ❌ | （需先剥 vendor 段）`claude-sonnet-4.5` |
| `claude-3-5-sonnet` (Anthropic 3.x dash) | 原样透传 ❌ | `claude-3.5-sonnet` |
| `claude-3-7-sonnet@20250219` (Vertex 3.x) | 原样透传 ❌ | `claude-3.7-sonnet` |

**根因**：旧正则 `^(claude-(?:opus|sonnet|haiku)-)(\d+)[._-](\d+)(.*)$` 假设 sonnet/opus/haiku 在数字之前（4.x 命名顺序），但 3.x 系列是反过来的（`claude-3.7-sonnet`）。同时**完全没有**剥离日期/版本后缀的逻辑。

**架构耦合隐患**：该函数被 `normalize.ts` 入口、`/v1/messages` 入口和 `inferVendorModelPath` 三处共用，把所有 Claude ID 都变成 OpenRouter 的 dot 形式。**这只在"出站走 OpenRouter"的当前架构下正确**——若未来恢复 Anthropic / Vertex / Bedrock 直连，dot 形式会被上游 4xx 拒绝。代码里**没有任何注释**提醒这个假设。

**修法**：
1. Step 1：先剥日期/版本后缀（`@YYYYMMDD`、`-YYYYMMDD`、`-vN(:N)?`）
2. Step 2：保留 4.x 形态正则（`claude-{name}-X-Y`）
3. Step 3：新增 3.x 形态正则（`claude-X-Y-{name}`）
4. 在函数顶部用大段注释明确"仅在目的地=OpenRouter 时正确"的架构假设，并指向源文档

**验证**：27 条来自 `docs/vendors/anthropic/{models,vertex,bedrock}.md` 与 `docs/vendors/openrouter/{provider-routing,quickstart,models}.md` 的真实 ID 全部规范化到 OpenRouter 接受的 base 别名。

### §5.3 修复后行为契约（"绝对路由"最终定义，与 §3 一致）

1. 当 model 含已注册的 provider prefix（任意一个 OpenRouter base slug），生成的 OpenRouter 请求体 **必须**包含：
   - `provider.only = [<spec.provider>]`（如果 spec 同时声明 `order`，附加 `provider.order`）
   - `provider.allow_fallbacks = false`
2. 这两个字段**不可被 client 传入的 `provider.allow_fallbacks: true` 或更宽松的 `only` 覆盖**——prefix 永远赢（force-overwrite，不取交集）。
3. `openrouter/<inner-prefix>/<model>` 透传 `<inner-prefix>` 的锁定语义。
4. `/v1/messages` 原生路径下，含 prefix 的 model 字段同样下发锁定。

### §5.4 文档来源索引

| 供应商 | 关键文件 |
|--------|---------|
| OpenRouter | `openrouter/02-provider-routing.md`、`openrouter/04-api-overview.md`、`openrouter/01-chat-completions.md`、`openrouter/03-model-routing.md` |
| OpenAI | `openai/01-chat-completions.md`、`openai/02-responses-api.md`、`openai/03-models.md` |
| Anthropic | `anthropic/01-messages-api.md`、`anthropic/02-prompt-caching.md`、`anthropic/04-vertex.md`、`anthropic/05-bedrock.md` |
| Gemini | `google/01-generate-content.md`、`google/03-vertex-ai.md` |
| Replit | `replit-ai-integrations/01-overview.md` |
