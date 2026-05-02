#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Absolute Provider Routing — assertive regression suite.
#
# Thin wrapper that runs scripts/test-absolute-routing.ts via tsx so the
# offline (§1, §2) and live (§3) checks can run from a single shell entry.
#
# Required for offline checks (§1, §2): nothing — pure unit-style assertions
# against artifacts/api-server/src/lib/gateway/provider.ts.
#
# Required for live checks (§3 — optional):
#   GATEWAY_URL      e.g. http://localhost:3000
#   GATEWAY_API_KEY  the gateway's proxy api key
#
# Exits non-zero on the first failed assertion.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Node ≥22 ships native TypeScript-stripping, so we don't need tsx/ts-node.
# This keeps the test runnable without pulling extra devDependencies into
# the api-server workspace.
exec node --experimental-strip-types "$SCRIPT_DIR/test-absolute-routing.ts" "$@"
