# AI Proxy Gateway

## Overview

The AI Proxy Gateway is a unified AI API gateway compatible with OpenAI's format, supporting OpenAI, Anthropic, Gemini, and OpenRouter backends. It's distributed via Replit Remix, providing each user with an independently configured `PROXY_API_KEY`. The project aims to consolidate AI API access, optimize costs through a dual-layer caching mechanism, and provide a robust, platform-agnostic solution for managing AI model interactions. The long-term vision is to decouple the gateway from Replit's platform specifics, enabling broader deployment and enhanced portability.

Key capabilities include:
- OpenAI compatible `/v1/chat/completions` with intelligent routing.
- Anthropic native `/v1/messages` for full client compatibility.
- Comprehensive `/v1/stats` for usage, token, and cost tracking.
- Dynamic backend and model management via admin APIs.
- Response caching for cost savings and performance.
- SillyTavern compatibility and version update mechanisms.
- A web-based Portal for configuration and monitoring.

## User Preferences

- All `/v1/*` and `/settings/*` routes are protected by `PROXY_API_KEY`.
- Authentication supports `Authorization: Bearer <key>`, `x-api-key: <key>`, and `?key=<key>` for SSE log streams.
- The `GATEWAY_BRAND` environment variable can customize the brand string.
- The `GATEWAY_OWNED_BY` environment variable can override the `owned_by` field in OpenAI model manifests.
- Users can choose their preferred storage backend (`local`, `s3`, `r2`, `gcs`, `replit`) via the `STORAGE_BACKEND` environment variable.
- Cloudflare R2 is recommended for free, S3-compatible cloud storage.

## System Architecture

The gateway employs a robust routing architecture with a focus on cost efficiency and flexibility.

**Core Features:**
- **OpenAI Compatible Interface:** `/v1/chat/completions` automatically routes to various backends.
- **Anthropic Native Interface:** `/v1/messages` supports Anthropic-type clients.
- **Model Management:** `/v1/models` lists available models, `/v1/admin/models/refresh` updates OpenRouter models, and `/v1/admin/backends` manages Friend Proxy nodes.
- **Monitoring & Logging:** `/v1/stats` tracks usage and `/v1/admin/logs` provides request history with SSE streaming.
- **Settings & Utilities:** Includes SillyTavern compatibility, version detection, an initial setup wizard, and fake streaming for non-streaming JSON responses.

**Cost-Saving Mechanisms (Dual-Layer Caching):**
- **L1 Response Cache:** In-memory, TTL-based caching for identical non-streaming requests, eliminating token consumption.
- **L2 Provider Prompt Cache:** Utilizes Anthropic's `cache_control` for long conversations and large system prompts, significantly reducing token costs.

**Routing Architecture:**
- **External Client Access:** Clients directly access `/v1/*` paths.
- **Portal Internal Calls:** Use `/api/v1/*` paths via Replit's routing proxy.
- **Absolute Provider Routing:** Model IDs with specific prefixes (e.g., `anthropic/claude-opus-4.5`) enforce routing to a specific OpenRouter sub-channel, overriding client-side provider preferences. This is implemented with three layers of defense and capability checks.
- **Backend Routing:** All traffic is forwarded to Friend Proxy sub-nodes; the mother instance no longer handles local AI vendor credentials.

**UI/UX (Portal Front-End):**
- **Dashboard Tab:** Displays status, connection info, and KPI cards.
- **Cluster Tab:** Node management, routing policy, and embedded upgraded `PageLogs` real-time log viewer.
- **Models Tab:** Manages model enablement/disablement.
- **Playground Tab (NEW, 2026-05):** Built-in chat tester. Free-text model ID (any OpenAI/Anthropic/Gemini/OpenRouter alias including `-thinking-max` variants), SSE streaming with event-frame protocol parsing, separate `delta.content` / `delta.reasoning_content` tracks (Anthropic/DeepSeek style `<think>` collapsible blocks), tunable temperature / max_tokens / system prompt (persisted to localStorage), self-contained mini-Markdown renderer (streaming-safe code blocks with copy button), TTFT and token usage inline display.
- **Tutorial Tab:** Documentation and onboarding.
- **Settings Tab:** API Key, SillyTavern compatibility mode.
- **System Tab:** Maintenance center.

**Upgraded `PageLogs` (2026-05):** Server-side `RequestLog` fields `cacheReadTokens / cacheWriteTokens / cacheTier / msgSummary / priceUSD` previously dropped by the front-end are now surfaced. Each row is click-to-expand with full detail (request summary, error stack, cache tier, USD price). Top strip has 7 mini-KPI cards (Total / Errors / Avg / P95 / Tokens / Cache hit-rate / Total cost), 60-point latency sparkline (recharts), full-text search across path/model/backend/error/msgSummary, txt+json download, framer-motion expansion animation.

**Technical Implementations:**
- **Monorepo Structure:** Managed with `pnpm workspaces`.
- **Backend:** Node.js 24 with Express 5.
- **Database:** PostgreSQL with Drizzle ORM.
- **Validation:** Zod for schema validation.
- **API Codegen:** Orval for generating API hooks and Zod schemas from OpenAPI specs.
- **Build System:** esbuild for CJS bundling.
- **Platform Independence:** The gateway is designed to be platform-agnostic, running as a pure Node.js service without reliance on Replit-specific APIs.

**Persistence:**
- Persistent files like `dynamic_backends.json`, `server_settings.json`, `usage_stats.json`, `disabled_models.json`, and `model-groups.json` are managed through an adapter layer (`lib/storage/`) that supports local filesystem, S3, R2, GCS, and Replit App Storage.
- `responseCache.ts` uses a local file cache for performance and cost reasons, intentionally not using the cloud storage adapter.

## External Dependencies

- **AI Providers:** OpenAI, Anthropic, Gemini, OpenRouter.
- **Cloud Storage:**
    - **Amazon S3:** Used for `s3` storage backend.
    - **Cloudflare R2:** S3-compatible storage option for `r2` backend.
    - **Google Cloud Storage (GCS):** Used for `gcs` storage backend.
    - **Replit App Storage:** Supported for `replit` storage backend (legacy).
- **Database:** PostgreSQL.
- **Node.js Modules:**
    - `@aws-sdk/client-s3`: For S3 and R2 storage integration (requires Node.js >= 20).
- **APIs:**
    - OpenAI API (compatible format).
    - Anthropic Messages API.
    - Google Gemini Generate Content API.
    - OpenRouter API.
- **Version Update Mechanism:** External `version.json` URL for update checks (`UPDATE_CHECK_URL`).
- **GitHub:** For hot-update source (`GATEWAY_UPDATE_REPO`).