#!/usr/bin/env bash
# Storage adapter factory regression smoke test.
#
# Runs 8 self-contained assertions against artifacts/api-server/src/lib/storage/
# covering every backend selection path. No external credentials needed —
# uses fake AWS keys + real Replit IDs only to confirm the factory routes
# correctly. Networked calls are NOT made (we never actually hit S3/R2/GCS).
#
# Exit code 0 on all-PASS; non-zero on any FAIL.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$REPO_ROOT/artifacts/api-server"
TEST_TMP="$API_DIR/.test-tmp"
BUNDLE="$TEST_TMP/storage-bundle.mjs"
DATA_TMP="$(mktemp -d)"

trap 'rm -rf "$TEST_TMP" "$DATA_TMP"' EXIT

mkdir -p "$TEST_TMP"

echo "[bundle] compiling storage layer with esbuild (externals: AWS + GCS SDKs)"
( cd "$API_DIR" && pnpm exec esbuild src/lib/storage/index.ts \
    --bundle --format=esm --platform=node \
    --outfile="$BUNDLE" \
    --external:@aws-sdk/client-s3 --external:@google-cloud/storage \
    --log-level=warning )

run() {
  local name="$1" script="$2"
  echo "--- $name ---"
  ( cd "$API_DIR" && node --input-type=module -e "$script" ) || { echo "FAIL: $name"; exit 1; }
  echo
}

run "explicit STORAGE_BACKEND=local writes through adapter" "
delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
process.env.STORAGE_BACKEND='local';
process.env.STORAGE_LOCAL_DIR='$DATA_TMP/d1';
const m = await import('./.test-tmp/storage-bundle.mjs');
const a = m.getStorageAdapter();
if (!a.displayName.startsWith('local-fs:')) throw new Error('expected local-fs');
await a.write('x.json', { ok: true });
const r = await a.read('x.json');
if (!r?.ok) throw new Error('round-trip failed');
console.log('PASS', a.displayName);
"

run "no env + DEFAULT_OBJECT_STORAGE_BUCKET_ID auto-detects replit (back-compat)" "
process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID='replit-objstore-test-id';
delete process.env.STORAGE_BACKEND;
delete process.env.REPLIT_DEPLOYMENT;
const m = await import('./.test-tmp/storage-bundle.mjs');
const a = m.getStorageAdapter();
if (!a.displayName.startsWith('replit-app-storage:')) throw new Error('expected replit');
if (!a.displayName.includes('config_dev/')) throw new Error('expected dev prefix');
console.log('PASS', a.displayName);
"

run "invalid STORAGE_BACKEND throws clear error" "
delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
process.env.STORAGE_BACKEND='garbage';
const m = await import('./.test-tmp/storage-bundle.mjs');
try { m.getStorageAdapter(); throw new Error('did not throw'); }
catch (e) {
  if (!e.message.includes('Invalid STORAGE_BACKEND')) throw new Error('wrong message: ' + e.message);
  console.log('PASS - threw:', e.message);
}
"

run "STORAGE_BACKEND=r2 missing required S3 env throws with hint" "
delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
delete process.env.STORAGE_S3_BUCKET;
delete process.env.STORAGE_S3_ACCESS_KEY_ID;
delete process.env.STORAGE_S3_SECRET_ACCESS_KEY;
process.env.STORAGE_BACKEND='r2';
const m = await import('./.test-tmp/storage-bundle.mjs');
try { m.getStorageAdapter(); throw new Error('did not throw'); }
catch (e) {
  if (!e.message.includes('STORAGE_S3_BUCKET')) throw new Error('wrong message');
  console.log('PASS - threw with S3 env hint');
}
"

run "STORAGE_BACKEND=r2 with full env builds s3 adapter pointed at R2 endpoint" "
delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
process.env.STORAGE_BACKEND='r2';
process.env.STORAGE_S3_BUCKET='my-bucket';
process.env.STORAGE_S3_ACCESS_KEY_ID='AKIAFAKE';
process.env.STORAGE_S3_SECRET_ACCESS_KEY='secretfake';
process.env.STORAGE_S3_ENDPOINT='https://abc123.r2.cloudflarestorage.com';
const m = await import('./.test-tmp/storage-bundle.mjs');
const a = m.getStorageAdapter();
if (!a.displayName.startsWith('s3:')) throw new Error('expected s3');
if (!a.displayName.includes('r2.cloudflarestorage.com')) throw new Error('missing R2 endpoint');
if (!a.displayName.includes('my-bucket')) throw new Error('missing bucket');
console.log('PASS', a.displayName);
"

run "STORAGE_BACKEND=replit with REPLIT_DEPLOYMENT uses prod prefix" "
process.env.STORAGE_BACKEND='replit';
process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID='prod-bucket';
process.env.REPLIT_DEPLOYMENT='1';
const m = await import('./.test-tmp/storage-bundle.mjs');
const a = m.getStorageAdapter();
if (!a.displayName.includes('config/') || a.displayName.includes('config_dev/'))
  throw new Error('expected prod prefix config/');
console.log('PASS', a.displayName);
"

run "no env + no Replit bucket → defaults to local-fs:./data" "
delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
delete process.env.STORAGE_BACKEND;
delete process.env.STORAGE_LOCAL_DIR;
const m = await import('./.test-tmp/storage-bundle.mjs');
const a = m.getStorageAdapter();
if (!a.displayName.startsWith('local-fs:') || !a.displayName.endsWith('/data'))
  throw new Error('expected local-fs ./data, got ' + a.displayName);
console.log('PASS', a.displayName);
"

run "factory returns adapter that round-trips a real config-shaped JSON" "
delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
process.env.STORAGE_BACKEND='local';
process.env.STORAGE_LOCAL_DIR='$DATA_TMP/d2';
const m = await import('./.test-tmp/storage-bundle.mjs');
const a = m.getStorageAdapter();
await a.write('dynamic_backends.json', { entries: [{ label: 'X', url: 'https://example.com' }] });
const r = await a.read('dynamic_backends.json');
if (r?.entries?.[0]?.label !== 'X') throw new Error('round-trip mismatch');
console.log('PASS');
"

run "concurrent same-key writes serialize via per-key mutex (no ENOENT, last-write-wins) — 5 iterations" "
delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
process.env.STORAGE_BACKEND='local';
process.env.STORAGE_LOCAL_DIR='$DATA_TMP/d3';
const fs = await import('node:fs/promises');
const m = await import('./.test-tmp/storage-bundle.mjs');
const a = m.getStorageAdapter();
const ITER = 5;
const N = 50;
for (let it = 0; it < ITER; it++) {
  const writes = [];
  for (let i = 0; i < N; i++) writes.push(a.write('contended.json', { it, i }));
  await Promise.all(writes);
  const final = await a.read('contended.json');
  if (final?.i !== N - 1 || final?.it !== it) {
    throw new Error('last-write-wins broken at iter ' + it + ': got ' + JSON.stringify(final));
  }
  const files = await fs.readdir('$DATA_TMP/d3');
  const stale = files.filter(f => f.includes('.tmp.'));
  if (stale.length !== 0) throw new Error('stale temp files at iter ' + it + ': ' + stale.join(','));
}
console.log('PASS - ' + ITER + 'x' + N + ' concurrent writes serialized, last-write-wins, no stale tmp');
"

echo "=== ALL 9 STORAGE FACTORY ASSERTIONS PASS ==="
