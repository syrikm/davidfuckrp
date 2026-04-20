# 统一缓存键与模型管理 — 开发指南

> **适用范围**: davidfuckrp-github (v1.1.9, 母代理) 与 vcpfuckcachefork-github (v1.2.0, 子代理)
> **目标**: 两个代理共享相同的缓存键格式和模型管理机制，实现跨代理缓存命中和互相学习。

---

## 1. 统一缓存键模块 (`unifiedCacheKey.ts`)

### 位置
- `davidfuckrp-github/artifacts/api-server/src/lib/unifiedCacheKey.ts`
- `vcpfuckcachefork-github/artifacts/api-server/src/lib/unifiedCacheKey.ts`

### 关键特性
- **SHA-256 哈希**: 两个文件内容完全一致，对同一请求体产生相同的 40 字符十六进制缓存键
- **黑名单排除**: `HASH_EXCLUDE_FIELDS` 排除了仅影响路由/计费/可观测性的字段（`stream`, `cache_control`, `cachePoint`, `provider` 等）
- **内容块规范化**: `stripMessageBlockCacheControl()` 剥离消息块内的 `cache_control`/`cachePoint` 标记，确保内部缓存断点变化不影响键的稳定性
- **独立 Bedrock 过滤**: 如果消息块仅包含 `cachePoint` 键，则从数组中完全过滤

### 使用方式
```typescript
import { hashRequest, generateCacheKey, stableReplacer } from "./unifiedCacheKey";

const key = hashRequest(requestBody); // 40-char hex SHA-256
```

### ⚠️ 重要约束
- 修改 `HASH_EXCLUDE_FIELDS` 或 `stripMessageBlockCacheControl()` 时，**必须同步更新两个仓库**，否则会导致跨代理缓存不匹配
- 两个文件必须保持 **逐字节相同**（byte-for-byte identical）

---

## 2. 统一模型管理模块 (`unifiedModelManager.ts`)

### 位置
- `davidfuckrp-github/artifacts/api-server/src/lib/unifiedModelManager.ts`
- `vcpfuckcachefork-github/artifacts/api-server/src/lib/unifiedModelManager.ts`

### 支持的配置格式
| 配置文件 | 格式 | 用途 |
|---|---|---|
| `disabled_models.json` | `["model-a", "model-b"]` | 简单禁用列表（母代理原始格式） |
| `model-groups.json` | `[{id, name, enabled, models: [{id, enabled}]}]` | 结构化分组管理（子代理格式） |

### 优先级规则
1. 如果 `model-groups.json` 存在且模型在其中，以分组级别 `enabled` 为准
2. 如果模型不在任何分组中，回退检查 `disabled_models.json`
3. 两者都不包含的模型 → 默认允许（enabled）

### 导出的 API
| 函数 | 说明 |
|---|---|
| `isModelEnabled(modelId)` | 检查模型是否允许处理请求 |
| `getEnabledModelIds()` | 返回所有当前启用的模型 ID |
| `getDisabledModels()` | 返回禁用模型 Set（合并两种配置） |
| `disableModel(modelId)` | 禁用模型（同时更新两种配置） |
| `enableModel(modelId)` | 启用模型（同时更新两种配置） |
| `readGroups()` | 读取模型分组（用于 admin API） |
| `writeGroups(groups)` | 写入模型分组 |
| `invalidateCache()` | 清空内存缓存 |
| `DEFAULT_GROUPS` | 默认模型定义（Anthropic/OpenAI/Gemini/OpenRouter） |

### 使用方式
```typescript
import { isModelEnabled, disableModel } from "./unifiedModelManager";

if (!isModelEnabled(model)) {
  return res.status(403).json({ error: "Model disabled" });
}
```

### ⚠️ 重要约束
- `model-groups.json` 优先于 `disabled_models.json`；两者同时存在时，模型组中的模型以组内 `enabled` 字段为准
- `disableModel()` / `enableModel()` 会同时更新两个配置文件以保持向后兼容
- 修改 `DEFAULT_GROUPS` 时**必须同步更新两个仓库**

---

## 3. 响应缓存模块 (`responseCache.ts`)

### 位置
- `davidfuckrp-github/artifacts/api-server/src/lib/responseCache.ts`
- `vcpfuckcachefork-github/artifacts/api-server/src/lib/responseCache.ts`

### 变更
两个仓库的 `responseCache.ts` 均已从 `unifiedCacheKey.ts` 导入 `hashRequest`，不再内联定义。旧接口通过 `export { hashRequest }` 重新导出以保持向后兼容。

---

## 4. 路由文件变更

### 母代理 (davidfuckrp-github)
| 文件 | 变更 |
|---|---|
| `src/routes/proxy.ts` | 从 `unifiedModelManager` 导入 `isModelEnabled, getDisabledModels, saveDisabledModels`；删除本地 `isModelEnabled` 函数 |

### 子代理 (vcpfuckcachefork-github)
| 文件 | 变更 |
|---|---|
| `src/routes/v1/chat.ts` | `isModelEnabled` 改为从 `unifiedModelManager` 导入 |
| `src/routes/v1/models.ts` | `getEnabledModelIds` 改为从 `unifiedModelManager` 导入 |
| `src/routes/v1/jobs.ts` | `isModelEnabled` 改为从 `unifiedModelManager.js` 导入 |
| `src/routes/model-groups.ts` | `readGroups, writeGroups, ModelGroup` 改为从 `unifiedModelManager` 导入 |

---

## 5. 跨代理开发工作流

### 添加/修改缓存键排除字段
1. 在两个仓库的 `unifiedCacheKey.ts` 中同步修改 `HASH_EXCLUDE_FIELDS`
2. 测试: 发送相同请求到两个代理，验证缓存键相同

### 添加/修改默认模型
1. 在两个仓库的 `unifiedModelManager.ts` 中同步修改 `DEFAULT_GROUPS`
2. 测试: 调用 `/v1/models` 验证两个代理返回相同的模型列表

### 禁用/启用模型
- 使用 `model-groups.json`（推荐）或 `disabled_models.json`
- 修改后调用 `invalidateCache()` 或重启服务