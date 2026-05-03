/**
 * gatewayConfig — central, env-driven runtime configuration for the gateway.
 *
 * Stage C/D output: previously the codebase had hard-coded references to
 * Replit (brand string "replit-proxy", upstream-repo "Akatsuki03/Replit2Api",
 * timeouts tuned to Replit's reverse-proxy 300s/600s cuts). This module
 * isolates every such value behind an environment variable so the server can
 * be redeployed on any platform without code changes.
 *
 * All values keep their previous defaults so existing Replit deployments are
 * byte-for-byte unaffected — only operators on other platforms need to set
 * the relevant env vars.
 */

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[gatewayConfig] invalid ${name}="${raw}" — falling back to ${fallback}`);
    return fallback;
  }
  return n;
}

const brand = process.env["GATEWAY_BRAND"] ?? "ai-proxy-gateway";

export const gatewayConfig = {
  /**
   * Brand identifier — used in HTTP User-Agent strings for outbound update
   * checks. Override with GATEWAY_BRAND env var.
   */
  brand,

  /**
   * Value used in the `owned_by` field of OpenAI-compatible model-listing
   * responses for models that don't carry an explicit upstream provider.
   * Defaults to the brand string. Override with GATEWAY_OWNED_BY.
   */
  ownedBy: process.env["GATEWAY_OWNED_BY"] ?? brand,

  /**
   * GitHub `owner/repo` for the hot-update / version-check subsystem.
   * Default is the historical upstream so existing deployments keep
   * receiving updates from the same place; override with GATEWAY_UPDATE_REPO.
   */
  updateRepo: process.env["GATEWAY_UPDATE_REPO"] ?? "Akatsuki03/Replit2Api",
} as const;

/**
 * Platform-tied timeouts. All four were originally tuned to Replit's reverse-
 * proxy limits (300s outgoing / 600s incoming HTTP cut, 300s idle cut).
 *
 * On other platforms — bare-metal, fly.io, Render, GCE, etc. — operators may
 * want larger values. Override via env if your hosting provider has a
 * different (or no) hard HTTP limit.
 *
 * Defaults preserve the original Replit-tuned behaviour.
 */
export const gatewayTimeoutOverrides = {
  /**
   * Leg B (mother → client) wall timer. Fires this many ms after the client
   * connection opens, then closes TCP cleanly so the next reconnect can
   * resume from the same in-memory job. Tune to fire ~30s before whatever
   * hard incoming-HTTP limit your platform enforces (Replit: 600s → 570s).
   */
  legBWallMs: readPositiveInt("GATEWAY_LEG_B_WALL_MS", 570_000),

  /**
   * Per-connection wall on the mother-proxy → sub-node SSE leg. Fires before
   * the platform's hard outgoing-connection cut so we can reconnect with
   * Last-Event-ID without losing chunks. (Replit: ~300s → 270s.)
   */
  subNodeStreamWallMs: readPositiveInt("GATEWAY_SUBNODE_STREAM_WALL_MS", 270_000),

  /**
   * SSE keepalive cadence on the GET /v1/jobs/:id/stream endpoint. Must be
   * lower than the platform's idle-connection cut. (Replit idle cut: 300s →
   * 200s.)
   */
  keepaliveJobMs: readPositiveInt("GATEWAY_KEEPALIVE_JOB_MS", 200_000),

  /**
   * Cadence of Anthropic-format `event: ping` heartbeats sent on streaming
   * /v1/messages responses. Lower bound is whatever your upstream proxy
   * counts as idle.
   */
  keepaliveAnthropicMs: readPositiveInt("GATEWAY_KEEPALIVE_ANTHROPIC_MS", 10_000),

  /**
   * Cadence of OpenAI-format empty-choices heartbeats on Leg B
   * (mother → client) for chat-completions streams.
   */
  keepaliveClientMs: readPositiveInt("GATEWAY_KEEPALIVE_CLIENT_MS", 5_000),
} as const;

export type GatewayConfig = typeof gatewayConfig;
export type GatewayTimeoutOverrides = typeof gatewayTimeoutOverrides;
