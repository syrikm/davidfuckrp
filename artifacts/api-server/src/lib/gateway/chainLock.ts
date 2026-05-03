// Chain-aware provider lock for the davidfuckrp gateway mesh.
//
// One function (`buildAbsoluteProviderBlock`) is shared by two role-distinct
// callsites in routes/proxy.ts:
//
//   1. Client-entry hop  — a real client called mother's `/v1/chat/completions`
//      or `/v1/messages`. The route-prefix lock is the contract; client-supplied
//      `provider.only` / `order` / `allow_fallbacks` is silently overwritten so
//      callers cannot widen or escape the lock.
//
//   2. Chain-relay hop  — the inbound request came from another node in the
//      gateway mesh, identified by the per-hop HTTP header
//      `X-DavidProxy-Chain: v1` set on every fetch out of mother → friend.
//      Here the upstream node already computed the route from the original
//      prefixed model id; the canonicalised model id reaching us no longer
//      carries that prefix and our local detectAbsoluteProviderRoute would
//      derive a DIFFERENT (wrong) lock. To preserve the upstream lock across
//      hops we honour client-supplied only/order/allow_fallbacks when set;
//      route-derived values fill any gaps.
//
// The header is a per-hop concern: every fetch in routes/proxy.ts sets its
// outbound headers from scratch (no req.headers splat), so the marker cannot
// leak to OpenRouter.

import type { Request } from "express";
import type { GatewayProviderRoute } from "./types";

export const CHAIN_HEADER = "x-davidproxy-chain";
export const CHAIN_VERSION = "v1";

export function isChainHop(req: Pick<Request, "headers">): boolean {
  return req.headers[CHAIN_HEADER] === CHAIN_VERSION;
}

export function buildAbsoluteProviderBlock(
  route: GatewayProviderRoute,
  clientProvider: unknown,
  opts?: { chainMode?: boolean },
): Record<string, unknown> {
  const chainMode = opts?.chainMode === true;
  const out: Record<string, unknown> = {};
  let clientOnly: unknown = undefined;
  let clientOrder: unknown = undefined;
  let clientAllowFallbacks: unknown = undefined;
  if (clientProvider && typeof clientProvider === "object" && !Array.isArray(clientProvider)) {
    for (const [k, v] of Object.entries(clientProvider as Record<string, unknown>)) {
      if (k === "only") { clientOnly = v; continue; }
      if (k === "order") { clientOrder = v; continue; }
      if (k === "allow_fallbacks") { clientAllowFallbacks = v; continue; }
      out[k] = v;
    }
  }

  // OpenRouter's documented hard-lock semantics (verified 2026-05-03 against
  // OR's own zod schema in https://openrouter.ai/docs/features/provider-routing):
  //   • `order`: ordered list; router tries first available, falls back if
  //     `allow_fallbacks=true` (the default).
  //   • `allow_fallbacks=false`: "use only the primary/custom provider, and
  //     return the upstream error if it's unavailable" — this is THE hard
  //     lock when combined with `order`.
  //   • `only`: allow-list filter merged with account-wide allowed providers
  //     — narrows the candidate pool further. Belt-and-suspenders alongside
  //     the order+allow_fallbacks lock.
  const onlyFromClient = chainMode && Array.isArray(clientOnly) && (clientOnly as unknown[]).length
    ? (clientOnly as string[])
    : null;
  const onlyFromRoute = route.only?.length
    ? route.only
    : (route.order?.length ? route.order : (route.provider ? [route.provider] : null));
  const finalOnly = onlyFromClient ?? onlyFromRoute;

  const orderFromClient = chainMode && Array.isArray(clientOrder) && (clientOrder as unknown[]).length
    ? (clientOrder as string[])
    : null;
  const orderFromRoute = route.order?.length ? route.order : null;
  const finalOrder = orderFromClient ?? orderFromRoute;

  if (finalOrder) out.order = [...finalOrder];
  if (finalOnly) out.only = [...finalOnly];
  // In chain-relay mode the upstream node may have explicitly opted back
  // into fallbacks (rare); honour it. In client-entry mode always force
  // false — the route lock is the contract.
  out.allow_fallbacks = chainMode && clientAllowFallbacks === true ? true : false;
  return out;
}
