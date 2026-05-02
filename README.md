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

## 一键部署

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/syrikm/davidfuckrp&branch=deploy/render)

> **首次点击需要授权 Render 访问私有仓库**。Render → Account Settings → GitHub → Configure → 授予 `davidfuckrp` 访问权限。
>
> 部署后必填：环境变量 `PROXY_API_KEY`（Render UI 会提示）。其他环境变量按需配（`OPENROUTER_API_KEY`、`S3_*` 等）。

其他平台（Fly.io / Zeabur / Railway / 本地 Docker）：见 [`DEPLOY.md`](./DEPLOY.md)。

---

## 环境变量速查

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `PROXY_API_KEY` | **是** | — | 没设直接拒启动。`/api/*` 后台 + `/v1/*` 代理鉴权 |
| `PORT` | 否 | `8080` | HTTP 端口 |
| `STORAGE_BACKEND` | 否 | `local` | `local`（挂卷到 `/app/data`）或 `s3` |
| `S3_ENDPOINT` `S3_REGION` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` | 条件 | — | `STORAGE_BACKEND=s3` 时必填 |
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
