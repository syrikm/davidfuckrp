# davidfuckrp — AI Proxy Gateway (mother)

OpenAI / Anthropic 兼容的 AI 代理网关，**母节点**。
聚合多个 backend（OpenRouter / Anthropic native / Bedrock / Vertex / 自家子节点），统一 `/v1/chat/completions` 和 `/v1/messages` 入口。

- ✅ Claude 全系 + 推理模型（thinking、effort、max）正确处理 sampling 参数
- ✅ OpenRouter 855+ 模型自动发现 + 价格表
- ✅ SSE 流式 + fakeStream + 长任务保活
- ✅ 多 backend 健康检查 + 自动故障转移
- ✅ 持久化模型注册表 / 用法统计 / 响应缓存（local fs 或 S3）
- ✅ 子节点（friend proxy）注册 + 模型透传 / 重定向

---

## 一键部署（Render 免费层）

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/syrikm/davidfuckrp&branch=deploy/render)

**默认配置 = $0/月免费计划**：512 MB RAM、新加坡区、15 分钟无请求自动休眠（下次请求冷启动 ~30s）。

> **首次点击需要授权 Render 访问私有仓库**。Render → 头像 → Account Settings → GitHub → Configure → 给 Render 授予 `davidfuckrp` 访问权。
>
> 部署后必填一个 Secret：`PROXY_API_KEY`（任意随机串，例如 `openssl rand -hex 32` 生成）。

### ⚠️ 免费层两个限制

1. **没有持久磁盘** —— Render 免费层不支持 disk，容器重启 / 重新部署会丢本地数据（模型注册表、用法统计、缓存）。
2. **15 分钟空闲就 sleep**。

→ **要持久化就改用 R2 存储**（数据存对象存储里，容器死了不丢）。详细步骤见下面 [Cloudflare R2 配置](#cloudflare-r2-配置教程) 一节。

### 升级到付费（$7/mo Starter）

不想 sleep + 想要持久磁盘 → Render UI 里 **Settings → Instance Type → Starter**，然后取消 `render.yaml` 里 `disk:` 段的注释、`plan: free` 改 `plan: starter`，commit 推一下即可。

其他平台（Fly.io / Zeabur / Railway / 本地 Docker）：见 [`DEPLOY.md`](./DEPLOY.md)。

---

## Cloudflare R2 配置教程

R2 是 S3 兼容的对象存储，免费层给 10 GB 容量 + 100 万次/月 Class A 写、1000 万次 Class B 读，对这个网关绰绰有余（模型注册表、用法统计、缓存都是小文件 + 低频写）。

### 第 1 步：建 bucket

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → 左侧 **R2 Object Storage**
2. 第一次用会让你同意条款 / 绑信用卡（不超免费层不会扣）
3. **Create bucket** → 名字随便（例如 `davidfuckrp`），Location 选 `Automatic` 或 `Asia-Pacific`
4. 建完点进 bucket → **Settings** → 翻到下面记下 **S3 API** 的 endpoint，长这样：
   ```
   https://abc123def456.r2.cloudflarestorage.com
   ```
   开头那串 `abc123def456` 就是你的 Account ID

### 第 2 步：建 API Token

1. 回到 R2 主页 → 右上 **Manage R2 API Tokens**（或 R2 → API → Manage API tokens）
2. **Create API Token**
3. 配置：
   - **Token name**：随便，例如 `davidfuckrp-render`
   - **Permissions**：选 **Object Read & Write**
   - **Specify bucket(s)**：选 **Apply to specific buckets only** → 勾上你刚才建的 bucket（最小权限原则；也可以选 All buckets，懒人用）
   - **TTL**：Forever（除非你想定期轮换）
   - **Client IP Address Filtering**：留空
4. **Create API Token** → 这一页**只显示一次**，立刻复制：
   - **Access Key ID**
   - **Secret Access Key**

### 第 3 步：在 Render 加环境变量

Render Dashboard → 你的 service → **Environment** 标签 → **Add Environment Variable**，加这 5 个 + 改 1 个：

| Key | Value |
|---|---|
| `STORAGE_BACKEND` | `r2`（**改**，原来是 `local`） |
| `STORAGE_S3_BUCKET` | 你的 bucket 名（例如 `davidfuckrp`） |
| `STORAGE_S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com`（**不带 bucket 名**） |
| `STORAGE_S3_ACCESS_KEY_ID` | 第 2 步复制的 Access Key ID |
| `STORAGE_S3_SECRET_ACCESS_KEY` | 第 2 步复制的 Secret Access Key |

`STORAGE_S3_REGION` 不用设，默认 `auto` 就是 R2 用的。

**Save Changes** → Render 自动触发重新部署。

### 第 4 步：验证

1. Render service → **Logs** 标签，找到这一行：
   ```
   [storage] using adapter: S3StorageAdapter (selected via STORAGE_BACKEND env)
   ```
2. 浏览器打开 `https://<your-app>.onrender.com/api/healthz` → 200
3. 在管理后台 portal 添加一个 backend / 模型，然后回 Cloudflare R2 → 你的 bucket → 应该能看到 `models/`、`backends/`、`usage/` 这些目录被创建

如果日志里报 `Access Denied` / `403` —— 99% 是 token 没勾对 bucket 权限，回第 2 步重做。
如果报 `NoSuchBucket` —— 检查 `STORAGE_S3_BUCKET` 拼写。
如果报 `connect ENOTFOUND` —— `STORAGE_S3_ENDPOINT` 写错（最常见：把 bucket 名拼到 endpoint 里去了，**别拼**）。

---

## 环境变量速查

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `PROXY_API_KEY` | **是** | — | 没设直接拒启动。`/api/*` 后台 + `/v1/*` 代理鉴权 |
| `PORT` | 否 | `8080` | HTTP 端口 |
| `STORAGE_BACKEND` | 否 | `local` | `local` / `s3` / `r2`（s3 别名）/ `gcs` / `replit` |
| `STORAGE_S3_BUCKET` `STORAGE_S3_ENDPOINT` `STORAGE_S3_ACCESS_KEY_ID` `STORAGE_S3_SECRET_ACCESS_KEY` | 条件 | — | `STORAGE_BACKEND=s3` 或 `=r2` 时必填 |
| `STORAGE_S3_REGION` | 否 | `auto` | R2 用 `auto`；AWS S3 用真实 region |
| `STORAGE_S3_FORCE_PATH_STYLE` | 否 | `false` | MinIO 等需要 path-style URL 时设 `true` |
| `OPENROUTER_API_KEY` | 否 | — | OR 默认 backend；也可在 `/api/backends` 里配置 |
| `MOTHER_NODE_URL` | 否 | — | 留空表示自身就是母节点 |

---

## 本地跑

需要 Node 24 + pnpm 10。

```bash
pnpm install
pnpm --filter @workspace/api-server run dev
```

访问 `http://localhost:8080/api/health` 应返回 200。

或本地 Docker：

```bash
docker build -t davidfuckrp .
docker run -p 8080:8080 \
  -e PROXY_API_KEY=$(openssl rand -hex 32) \
  -v $(pwd)/data:/app/data \
  davidfuckrp
```

---

## 架构概览

- **`artifacts/api-server/`** — 网关服务本体，Express 5 + 自家路由层
- **`artifacts/api-portal/`** — 管理后台 UI（React + Vite）
- **`lib/api-spec/`** — OpenAPI / Zod 规范（mother↔portal 共享）
- **`lib/db/`** — Drizzle ORM schema

子节点（child / friend proxy）是**另一个项目**：`sayrui/vcpfuckcachefork`。母节点把请求转发给注册过来的子节点，子节点最终打上游（OpenRouter 等）。

---

## License

MIT.
