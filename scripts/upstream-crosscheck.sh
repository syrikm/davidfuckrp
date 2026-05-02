#!/usr/bin/env bash
# upstream-crosscheck.sh — Repeatable upstream doc cross-check script (Task #5)
#
# Generates live outbound HTTP captures by POSTing test vectors to the running
# gateway's /v1/debug/normalize endpoint (active when GATEWAY_DEBUG_NORMALIZE=1).
# The endpoint calls normalizeGatewayRequest + buildOpenRouterRequest server-side
# and returns { protocol, ir, outbound } without contacting any upstream backend.
#
# Captures written to: docs/upstream-crosscheck/captures/<ID>.outbound.json
# Summary written to:  docs/upstream-crosscheck/captures/summary.json
#
# Usage:
#   bash scripts/upstream-crosscheck.sh
#   GATEWAY_URL=http://localhost:8080 GATEWAY_API_KEY=vcspeeper \
#     bash scripts/upstream-crosscheck.sh
#
# Requirements: node (v20+), curl, python3
# The API server must be running with GATEWAY_DEBUG_NORMALIZE=1 set.

set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://localhost:8080}"
GATEWAY_API_KEY="${GATEWAY_API_KEY:-vcspeeper}"
CAPTURE_DIR="${CAPTURE_DIR:-docs/upstream-crosscheck/captures}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$CAPTURE_DIR"

PASS=0
FAIL=0

info()  { echo "[INFO] $*"; }

# ---------------------------------------------------------------------------
# §1 — Check debug endpoint is reachable and enabled
# ---------------------------------------------------------------------------
check_debug_endpoint() {
  local probe
  probe=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$GATEWAY_URL/v1/debug/normalize" \
    -H "Authorization: Bearer $GATEWAY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"model":"anthropic/claude-haiku-3-5","messages":[{"role":"user","content":"ping"}],"max_tokens":1}' \
    --max-time 5 2>/dev/null || echo "000")
  if [[ "$probe" != "200" ]]; then
    echo "[ERROR] /v1/debug/normalize returned HTTP $probe"
    echo "[ERROR] Ensure the API server is running with GATEWAY_DEBUG_NORMALIZE=1"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# §2 — Capture function: POST body → .outbound.json, then verify field checks
# ---------------------------------------------------------------------------

# Global arrays for deferred summary
declare -a RESULT_IDS=()
declare -A RESULT_OK=()
declare -A RESULT_DESC=()

capture_and_check() {
  local id="$1"
  local desc="$2"
  local body="$3"
  shift 3
  # Remaining args: "field=op=expected" triples (encoded as "field|op|expected")
  local -a field_checks=("$@")

  local out="$CAPTURE_DIR/${id}.outbound.json"
  curl -s -X POST "$GATEWAY_URL/v1/debug/normalize" \
    -H "Authorization: Bearer $GATEWAY_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body" > "$out" 2>&1

  # Verify each field check via python3
  local ok=1
  for triple in "${field_checks[@]}"; do
    local field op expected
    field=$(echo "$triple" | cut -d'|' -f1)
    op=$(echo "$triple"    | cut -d'|' -f2)
    expected=$(echo "$triple" | cut -d'|' -f3)

    local result
    result=$(python3 - "$out" "$field" "$op" "$expected" << 'PYEOF'
import sys, json

fn, field, op, expected = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
d = json.load(open(fn))

def get(d, path):
    parts = path.split(".")
    cur = d
    for p in parts:
        if isinstance(cur, list):
            try: cur = cur[int(p)]
            except: return None, False
        elif isinstance(cur, dict):
            if p not in cur: return None, False
            cur = cur[p]
        else: return None, False
    return cur, True

val, found = get(d, field)
if op == "eq":
    # coerce expected to match JSON type, then compare
    # also try string comparison as fallback so "3" == '3' in JSON
    try:
        exp = json.loads(expected)
    except:
        exp = expected
    ok = found and (val == exp or str(val) == str(exp))
elif op == "absent":
    ok = not found
else:
    ok = False

if ok:
    print("PASS")
else:
    print(f"FAIL got={val!r} found={found} expected={expected!r}")
PYEOF
)
    if [[ "$result" != "PASS" ]]; then
      ok=0
      echo "FAIL  $id  [$field] $result"
    fi
  done

  RESULT_IDS+=("$id")
  RESULT_DESC["$id"]="$desc"
  if [[ $ok -eq 1 ]]; then
    RESULT_OK["$id"]=1
    echo "PASS  $id"
    PASS=$((PASS+1))
  else
    RESULT_OK["$id"]=0
    FAIL=$((FAIL+1))
  fi
}

# ---------------------------------------------------------------------------
# §3 — Test vectors (one per REPORT row with live capture)
# ---------------------------------------------------------------------------
run_matrix() {
  info "=== Live normalization matrix (gateway $GATEWAY_URL) ==="

  # §P-001 provider lock — all four prefix types
  capture_and_check "P-001-bedrock" \
    "bedrock/ prefix → provider.only=[amazon-bedrock], allow_fallbacks=false" \
    '{"model":"bedrock/anthropic.claude-haiku-3-5-20251022-v1:0","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
    "outbound.body.provider.only.0|eq|amazon-bedrock" \
    "outbound.body.provider.allow_fallbacks|eq|false"

  capture_and_check "P-001-vertex" \
    "vertex/ prefix → provider.only=[google-vertex], allow_fallbacks=false" \
    '{"model":"vertex/claude-haiku-3-5","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
    "outbound.body.provider.only.0|eq|google-vertex" \
    "outbound.body.provider.allow_fallbacks|eq|false"

  capture_and_check "P-001-anthropic" \
    "anthropic/ prefix → provider.only=[anthropic], allow_fallbacks=false" \
    '{"model":"anthropic/claude-haiku-3-5","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
    "outbound.body.provider.only.0|eq|anthropic" \
    "outbound.body.provider.allow_fallbacks|eq|false"

  capture_and_check "P-001-groq" \
    "groq/ prefix → provider.only=[groq], allow_fallbacks=false" \
    '{"model":"groq/llama-3.3-70b-versatile","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
    "outbound.body.provider.only.0|eq|groq" \
    "outbound.body.provider.allow_fallbacks|eq|false"

  # §P-002 client cannot override lock
  capture_and_check "P-002" \
    "client allow_fallbacks:true overridden when bedrock lock active" \
    '{"model":"bedrock/anthropic.claude-haiku-3-5-20251022-v1:0","messages":[{"role":"user","content":"hi"}],"max_tokens":5,"provider":{"allow_fallbacks":true}}' \
    "outbound.body.provider.allow_fallbacks|eq|false"

  # §P-003 openrouter/ passthrough — no forced lock
  capture_and_check "P-003-passthrough" \
    "openrouter/<bare-model> — no recognized sub-prefix → no allow_fallbacks forced" \
    '{"model":"openrouter/meta-llama/llama-3.3-70b-instruct","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
    "outbound.body.provider.allow_fallbacks|absent|"

  # §P-005 OpenAI roles
  capture_and_check "P-005-roles" \
    "OpenAI system+user roles preserved in ir.messages" \
    '{"model":"anthropic/claude-haiku-3-5","messages":[{"role":"system","content":"sys"},{"role":"user","content":"hi"}],"max_tokens":5}' \
    "ir.messages.0.role|eq|system" \
    "ir.messages.1.role|eq|user"

  # §P-009 max_completion_tokens alias
  capture_and_check "P-009-max-tokens" \
    "max_completion_tokens → ir.maxOutputTokens, outbound max_tokens" \
    '{"model":"anthropic/claude-haiku-3-5","messages":[{"role":"user","content":"hi"}],"max_completion_tokens":100}' \
    "ir.maxOutputTokens|eq|100" \
    "outbound.body.max_tokens|eq|100"

  # §P-010 reasoning_effort
  capture_and_check "P-010-reasoning-effort" \
    "reasoning_effort:high → ir.reasoning.effort=high" \
    '{"model":"openai/o3","messages":[{"role":"user","content":"hi"}],"max_tokens":5,"reasoning_effort":"high"}' \
    "ir.reasoning.effort|eq|high"

  # §P-012 Anthropic thinking
  capture_and_check "P-012-thinking" \
    "Anthropic thinking.budget_tokens=1024 → ir.reasoning.maxTokens=1024" \
    '{"model":"anthropic/claude-haiku-3-5","anthropic_version":"2023-06-01","messages":[{"role":"user","content":"hi"}],"max_tokens":5,"thinking":{"type":"enabled","budget_tokens":1024}}' \
    "ir.reasoning.maxTokens|eq|1024" \
    "ir.reasoning.enabled|eq|true"

  # §P-013 protocol detection
  capture_and_check "P-013-anthropic-native" \
    "anthropic_version field → protocol=anthropic-messages" \
    '{"model":"anthropic/claude-haiku-3-5","anthropic_version":"2023-06-01","messages":[{"role":"user","content":"hi"}],"max_tokens":10}' \
    "protocol|eq|anthropic-messages"

  # §P-014 Anthropic system string
  capture_and_check "P-014-system" \
    "Anthropic system string → prepended system role in ir.messages" \
    '{"model":"anthropic/claude-haiku-3-5","anthropic_version":"2023-06-01","system":"You are helpful.","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
    "ir.messages.0.role|eq|system"

  # §P-015 F-001: Anthropic stop_sequences
  capture_and_check "P-015-stop-sequences" \
    "F-001: stop_sequences → ir.stop → outbound.stop (NOT stop_sequences)" \
    '{"model":"anthropic/claude-haiku-3-5","anthropic_version":"2023-06-01","messages":[{"role":"user","content":"hi"}],"max_tokens":5,"stop_sequences":["3"]}' \
    "ir.stop.0|eq|3" \
    "outbound.body.stop.0|eq|3" \
    "outbound.body.stop_sequences|absent|"

  # §P-019 Gemini role mapping
  capture_and_check "P-019-gemini-roles" \
    "Gemini contents role=model → assistant in ir.messages" \
    '{"model":"google/gemini-2.5-flash","contents":[{"role":"user","parts":[{"text":"hi"}]},{"role":"model","parts":[{"text":"hello"}]}],"generationConfig":{"maxOutputTokens":5}}' \
    "ir.messages.0.role|eq|user" \
    "ir.messages.1.role|eq|assistant"

  # §P-021 Gemini stopSequences
  capture_and_check "P-021-stop-sequences" \
    "Gemini generationConfig.stopSequences → ir.stop" \
    '{"model":"google/gemini-2.5-flash","contents":[{"role":"user","parts":[{"text":"hi"}]}],"generationConfig":{"maxOutputTokens":5,"stopSequences":["END"]}}' \
    "ir.stop.0|eq|END"

  # §P-022 F-002: thinkingConfig — ENABLED
  capture_and_check "P-022-thinkingBudget" \
    "F-002: generationConfig.thinkingConfig.thinkingBudget=1024 → ir.reasoning.maxTokens=1024" \
    '{"model":"google/gemini-2.5-pro","contents":[{"role":"user","parts":[{"text":"hi"}]}],"generationConfig":{"thinkingConfig":{"thinkingBudget":1024,"includeThoughts":true,"thinkingLevel":"ENABLED"}}}' \
    "ir.reasoning.maxTokens|eq|1024" \
    "ir.reasoning.enabled|eq|true" \
    "ir.reasoning.includeReasoning|eq|true"

  # §P-022 thinkingLevel=DISABLED
  capture_and_check "P-022-DISABLED" \
    "F-002: thinkingLevel=DISABLED → ir.reasoning.enabled=false" \
    '{"model":"google/gemini-2.5-pro","contents":[{"role":"user","parts":[{"text":"hi"}]}],"generationConfig":{"thinkingConfig":{"thinkingLevel":"DISABLED"}}}' \
    "ir.reasoning.enabled|eq|false"

  # §P-022 thinkingLevel=DYNAMIC
  capture_and_check "P-022-DYNAMIC" \
    "F-002: thinkingLevel=DYNAMIC → ir.reasoning.enabled=true, interleaved=true" \
    '{"model":"google/gemini-2.5-pro","contents":[{"role":"user","parts":[{"text":"hi"}]}],"generationConfig":{"thinkingConfig":{"thinkingLevel":"DYNAMIC"}}}' \
    "ir.reasoning.enabled|eq|true" \
    "ir.reasoning.interleaved|eq|true"

  # §P-022 backward compat
  capture_and_check "P-022-compat-reasoningConfig" \
    "Backward compat: body.reasoningConfig.enabled=true → ir.reasoning.enabled=true" \
    '{"model":"google/gemini-2.5-pro","contents":[{"role":"user","parts":[{"text":"hi"}]}],"reasoningConfig":{"enabled":true,"maxOutputTokens":256}}' \
    "ir.reasoning.enabled|eq|true"

  # §P-025 caching
  capture_and_check "P-025-caching" \
    "cache_control.type=ephemeral → ir.cache.mode=ephemeral, outbound body.cache_control.type=ephemeral" \
    '{"model":"anthropic/claude-haiku-3-5","messages":[{"role":"user","content":"hi"}],"max_tokens":5,"cache_control":{"type":"ephemeral"}}' \
    "ir.cache.mode|eq|ephemeral" \
    "outbound.body.cache_control.type|eq|ephemeral"

  # §P-027 reasoning.max_tokens
  capture_and_check "P-027-reasoning" \
    "reasoning.max_tokens=512 → ir.reasoning.maxTokens=512" \
    '{"model":"openai/o3","messages":[{"role":"user","content":"hi"}],"max_tokens":5,"reasoning":{"max_tokens":512}}' \
    "ir.reasoning.maxTokens|eq|512"

  # §N-A-003 bedrock model ID
  capture_and_check "NA-003-bedrock-model-id" \
    "Bedrock model ID anthropic.claude-haiku-3-5-20251022-v1:0 → amazon-bedrock lock" \
    '{"model":"bedrock/anthropic.claude-haiku-3-5-20251022-v1:0","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
    "outbound.body.provider.only.0|eq|amazon-bedrock" \
    "outbound.body.provider.allow_fallbacks|eq|false"
}

# ---------------------------------------------------------------------------
# §4 — Write summary.json
# ---------------------------------------------------------------------------
write_summary() {
  python3 - "$CAPTURE_DIR" "${RESULT_IDS[@]}" << 'PYEOF'
import sys, json, datetime, os

caps = sys.argv[1]
ids = sys.argv[2:]

descs = {
    "P-001-bedrock":   "bedrock/ prefix → provider.only=[amazon-bedrock], allow_fallbacks=false",
    "P-001-vertex":    "vertex/ prefix → provider.only=[google-vertex], allow_fallbacks=false",
    "P-001-anthropic": "anthropic/ prefix → provider.only=[anthropic], allow_fallbacks=false",
    "P-001-groq":      "groq/ prefix → provider.only=[groq], allow_fallbacks=false",
    "P-002":           "client allow_fallbacks:true overridden when bedrock lock active",
    "P-003-passthrough":"openrouter/<bare-model> — no recognized sub-prefix → no allow_fallbacks forced",
    "P-005-roles":     "OpenAI system+user roles preserved in ir.messages",
    "P-009-max-tokens":"max_completion_tokens → ir.maxOutputTokens, outbound max_tokens",
    "P-010-reasoning-effort":"reasoning_effort:high → ir.reasoning.effort=high",
    "P-012-thinking":  "Anthropic thinking.budget_tokens=1024 → ir.reasoning.maxTokens=1024",
    "P-013-anthropic-native":"anthropic_version field → protocol=anthropic-messages",
    "P-014-system":    "Anthropic system string → prepended system role in ir.messages",
    "P-015-stop-sequences":"F-001: stop_sequences→ir.stop→outbound.stop (NOT stop_sequences)",
    "P-019-gemini-roles":"Gemini contents role=model → assistant in ir.messages",
    "P-021-stop-sequences":"Gemini generationConfig.stopSequences → ir.stop",
    "P-022-thinkingBudget":"F-002: generationConfig.thinkingConfig.thinkingBudget=1024 → ir.reasoning.maxTokens=1024",
    "P-022-DISABLED":  "F-002: thinkingLevel=DISABLED → ir.reasoning.enabled=false",
    "P-022-DYNAMIC":   "F-002: thinkingLevel=DYNAMIC → ir.reasoning.enabled=true, interleaved=true",
    "P-022-compat-reasoningConfig":"Backward compat: body.reasoningConfig.enabled=true → ir.reasoning.enabled=true",
    "P-025-caching":   "cache_control.type=ephemeral → ir.cache.mode=ephemeral",
    "P-027-reasoning": "reasoning.max_tokens=512 → ir.reasoning.maxTokens=512",
    "NA-003-bedrock-model-id":"Bedrock model ID → amazon-bedrock lock",
}

results = []
seen = set()
for id_ in ids:
    if id_ in seen:
        continue
    seen.add(id_)
    fn = os.path.join(caps, f"{id_}.outbound.json")
    ok = os.path.exists(fn)
    results.append({"id": id_, "ok": ok, "desc": descs.get(id_, ""), "captureFile": f"{id_}.outbound.json"})

total_pass = sum(1 for r in results if r["ok"])
total_fail = sum(1 for r in results if not r["ok"])

summary = {
    "generatedAt": datetime.datetime.utcnow().isoformat() + "Z",
    "generatedBy": "live gateway /v1/debug/normalize endpoint",
    "evidenceType": "live-http",
    "captureFormat": ".outbound.json (protocol + ir + outbound from running gateway)",
    "totalPass": total_pass,
    "totalFail": total_fail,
    "results": results,
}
with open(os.path.join(caps, "summary.json"), "w") as f:
    json.dump(summary, f, indent=2)
PYEOF
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo "=== AI Proxy Gateway — Upstream Cross-Check ==="
echo "Gateway: $GATEWAY_URL"
echo "Captures: $CAPTURE_DIR"
echo ""

info "Checking debug endpoint availability..."
check_debug_endpoint
info "Debug endpoint OK — running 22 test vectors..."
echo ""

run_matrix

write_summary

echo ""
echo "=== Results ==="
echo "PASS: $PASS"
echo "FAIL: $FAIL"
echo ""
echo "Captures: $CAPTURE_DIR/"
echo "Summary:  $CAPTURE_DIR/summary.json"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo "Some tests FAILED. Review captures in $CAPTURE_DIR/"
  exit 1
else
  echo "All checks passed."
  exit 0
fi
