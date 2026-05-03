import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAIN_HEADER,
  CHAIN_VERSION,
  isChainHop,
  buildAbsoluteProviderBlock,
} from "./chainLock";
import type { GatewayProviderRoute } from "./types";

const groqRoute: GatewayProviderRoute = {
  prefix: "groq",
  provider: "groq",
  order: ["groq"],
  allowFallbacks: false,
  source: "model-prefix",
};

const openaiRoute: GatewayProviderRoute = {
  prefix: "openai",
  provider: "openai",
  order: ["openai"],
  allowFallbacks: false,
  source: "model-prefix",
};

const bedrockRoute: GatewayProviderRoute = {
  prefix: "bedrock",
  provider: "amazon-bedrock",
  order: ["amazon-bedrock"],
  allowFallbacks: false,
  source: "model-prefix",
};

// ─── isChainHop ────────────────────────────────────────────────────────────

test("isChainHop: header present with v1 → true", () => {
  assert.equal(isChainHop({ headers: { [CHAIN_HEADER]: CHAIN_VERSION } }), true);
});

test("isChainHop: header absent → false", () => {
  assert.equal(isChainHop({ headers: {} }), false);
});

test("isChainHop: header present with wrong version → false (forward-compat)", () => {
  assert.equal(isChainHop({ headers: { [CHAIN_HEADER]: "v2" } }), false);
});

test("isChainHop: header set to empty string → false", () => {
  assert.equal(isChainHop({ headers: { [CHAIN_HEADER]: "" } }), false);
});

// ─── client-entry mode (chainMode=false / default) ─────────────────────────

test("client-entry: empty client provider → route fills only+order, allow_fallbacks=false", () => {
  const out = buildAbsoluteProviderBlock(groqRoute, undefined);
  assert.deepEqual(out, {
    order: ["groq"],
    only: ["groq"],
    allow_fallbacks: false,
  });
});

test("client-entry: client supplies only:[openai] → STRIPPED, route lock enforced", () => {
  const out = buildAbsoluteProviderBlock(groqRoute, { only: ["openai"] });
  assert.deepEqual(out, {
    order: ["groq"],
    only: ["groq"],
    allow_fallbacks: false,
  });
});

test("client-entry: client supplies order:[openai]+allow_fallbacks:true → STRIPPED, locked", () => {
  const out = buildAbsoluteProviderBlock(groqRoute, {
    order: ["openai"],
    allow_fallbacks: true,
  });
  assert.deepEqual(out, {
    order: ["groq"],
    only: ["groq"],
    allow_fallbacks: false,
  });
});

test("client-entry: non-lock client fields (e.g. data_collection) pass through", () => {
  const out = buildAbsoluteProviderBlock(groqRoute, {
    only: ["openai"],
    data_collection: "deny",
    require_parameters: true,
  });
  assert.deepEqual(out, {
    data_collection: "deny",
    require_parameters: true,
    order: ["groq"],
    only: ["groq"],
    allow_fallbacks: false,
  });
});

test("client-entry: explicit chainMode=false same as default", () => {
  const a = buildAbsoluteProviderBlock(groqRoute, { only: ["openai"] });
  const b = buildAbsoluteProviderBlock(groqRoute, { only: ["openai"] }, { chainMode: false });
  assert.deepEqual(a, b);
});

// ─── chain-relay mode (chainMode=true) ─────────────────────────────────────

test("chain-relay: empty client provider → route fills both", () => {
  const out = buildAbsoluteProviderBlock(openaiRoute, undefined, { chainMode: true });
  assert.deepEqual(out, {
    order: ["openai"],
    only: ["openai"],
    allow_fallbacks: false,
  });
});

test("chain-relay: upstream only:[groq] PRESERVED, route order fills gap", () => {
  const out = buildAbsoluteProviderBlock(openaiRoute, { only: ["groq"] }, { chainMode: true });
  assert.deepEqual(out, {
    order: ["openai"],
    only: ["groq"],
    allow_fallbacks: false,
  });
});

test("chain-relay: full upstream lock {only,order,allow_fallbacks} all PRESERVED", () => {
  const out = buildAbsoluteProviderBlock(
    openaiRoute,
    { only: ["groq"], order: ["groq"], allow_fallbacks: false },
    { chainMode: true },
  );
  assert.deepEqual(out, {
    order: ["groq"],
    only: ["groq"],
    allow_fallbacks: false,
  });
});

test("chain-relay: upstream allow_fallbacks=true honoured (rare opt-back-in)", () => {
  const out = buildAbsoluteProviderBlock(
    openaiRoute,
    { allow_fallbacks: true },
    { chainMode: true },
  );
  assert.equal(out.allow_fallbacks, true);
});

test("chain-relay: upstream allow_fallbacks=false honoured (the lock)", () => {
  const out = buildAbsoluteProviderBlock(
    openaiRoute,
    { allow_fallbacks: false },
    { chainMode: true },
  );
  assert.equal(out.allow_fallbacks, false);
});

test("chain-relay: upstream non-lock fields pass through alongside preserved lock", () => {
  const out = buildAbsoluteProviderBlock(
    openaiRoute,
    {
      only: ["groq"],
      order: ["groq"],
      allow_fallbacks: false,
      data_collection: "deny",
    },
    { chainMode: true },
  );
  assert.deepEqual(out, {
    data_collection: "deny",
    order: ["groq"],
    only: ["groq"],
    allow_fallbacks: false,
  });
});

// ─── edge cases ────────────────────────────────────────────────────────────

test("edge: empty arrays for only/order are ignored (treated as not supplied)", () => {
  // chain-relay mode, but client supplies empty arrays — should fall through
  // to route-derived values.
  const out = buildAbsoluteProviderBlock(
    groqRoute,
    { only: [], order: [] },
    { chainMode: true },
  );
  assert.deepEqual(out, {
    order: ["groq"],
    only: ["groq"],
    allow_fallbacks: false,
  });
});

test("edge: non-array only/order in client provider ignored", () => {
  const out = buildAbsoluteProviderBlock(
    groqRoute,
    { only: "openai" as unknown, order: 42 as unknown },
    { chainMode: true },
  );
  assert.deepEqual(out, {
    order: ["groq"],
    only: ["groq"],
    allow_fallbacks: false,
  });
});

test("edge: clientProvider is array → entirely ignored, route-only output", () => {
  const out = buildAbsoluteProviderBlock(
    groqRoute,
    ["weird"],
    { chainMode: true },
  );
  assert.deepEqual(out, {
    order: ["groq"],
    only: ["groq"],
    allow_fallbacks: false,
  });
});

test("edge: clientProvider is null → route-only output", () => {
  const out = buildAbsoluteProviderBlock(groqRoute, null);
  assert.deepEqual(out, {
    order: ["groq"],
    only: ["groq"],
    allow_fallbacks: false,
  });
});

test("edge: route with no `only`, no `order`, only `provider` → derive only from provider", () => {
  const minimalRoute: GatewayProviderRoute = {
    prefix: "x",
    provider: "x-vendor",
    source: "model-prefix",
  };
  const out = buildAbsoluteProviderBlock(minimalRoute, undefined);
  assert.deepEqual(out, {
    only: ["x-vendor"],
    allow_fallbacks: false,
  });
});

// ─── route-equality cases (canonical mappings) ─────────────────────────────

test("client-entry: bedrock route locks to amazon-bedrock", () => {
  const out = buildAbsoluteProviderBlock(bedrockRoute, undefined);
  assert.deepEqual(out, {
    order: ["amazon-bedrock"],
    only: ["amazon-bedrock"],
    allow_fallbacks: false,
  });
});

// ─── header trust-boundary semantics ───────────────────────────────────────

test("isChainHop: assumes Express-normalized lower-case keys (documented contract)", () => {
  // Express lower-cases all incoming header keys before exposing req.headers,
  // so isChainHop deliberately uses the lowercase constant. A raw uppercase
  // key in the test object should NOT match — that's by design (callers
  // must always use Express-normalized headers).
  assert.equal(isChainHop({ headers: { "X-DavidProxy-Chain": CHAIN_VERSION } as Record<string, string> }), false);
  assert.equal(isChainHop({ headers: { [CHAIN_HEADER]: CHAIN_VERSION } }), true);
});

test("trust-boundary: malicious client setting chain header CAN escape lock — documented behaviour", () => {
  // The trust signal is gated by requireApiKey at the Express layer:
  // anyone holding a valid PROXY_API_KEY is considered trusted to assert
  // chain-relay role. This test pins the documented behaviour so any future
  // tightening of the trust model is a deliberate, observable change.
  const out = buildAbsoluteProviderBlock(
    groqRoute,
    { only: ["openai"] },
    { chainMode: true },  // simulating malicious client that set the header
  );
  // In chain-relay mode the client's only:[openai] DOES override route's
  // only:[groq]. If you want to defend against header spoofing, strip the
  // header in a middleware BEFORE requireApiKey or use a per-node shared
  // secret instead of the api key.
  assert.deepEqual(out.only, ["openai"], "documented: chain-mode honours client only");
  assert.deepEqual(out.order, ["groq"], "documented: route fills missing order even in chain mode");
});

test("returned object is a fresh copy — does not mutate input arrays", () => {
  const clientProvider = { only: ["groq"], order: ["groq"] };
  const out = buildAbsoluteProviderBlock(openaiRoute, clientProvider, { chainMode: true });
  (out.only as string[]).push("MUTATED");
  assert.deepEqual(clientProvider.only, ["groq"], "input only must not be mutated");
  assert.deepEqual(clientProvider.order, ["groq"], "input order must not be mutated");
});
