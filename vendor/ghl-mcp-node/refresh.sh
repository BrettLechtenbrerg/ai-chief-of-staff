#!/usr/bin/env bash
# Refresh / (re)install the vendored GHL Node MCP server's runtime deps.
#
# index.js is HAND-MAINTAINED, ported 1:1 from ../ghl-mcp/main.py. It is NOT
# generated — when main.py's tool set or REST mapping changes, edit index.js to
# match and re-run the parity check in tests/unit/ghl-node-server.test.ts plus
# the name/arg extraction described below.
#
# This script only (re)installs the single runtime dependency
# (@modelcontextprotocol/sdk) into ./node_modules so the server is
# self-contained and ships inside the code-signed seal via electron-builder
# extraResources (no afterPack symlink needed — pure JS, global fetch, no native
# modules).
#
# Usage: ./refresh.sh
# Idempotent — safe to re-run.

set -euo pipefail

VENDOR_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$VENDOR_DIR"

echo "==> Installing runtime deps for ghl-mcp-node (omit dev)"
# --omit=dev: only @modelcontextprotocol/sdk; pinned to ^0.5.0 to match the
# version the Flo servers vendor (proven to work under ELECTRON_RUN_AS_NODE).
npm install --omit=dev --no-audit --no-fund

echo "==> Syntax check"
node --check index.js

echo "==> Boot check (lists tools over stdio, then exits)"
GHL_PRIVATE_TOKEN=pit-refresh-check GHL_LOCATION_ID=loc-refresh-check \
node - <<'JS'
import { spawn } from 'child_process';
const p = spawn(process.execPath, ['index.js'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['pipe', 'pipe', 'inherit'],
});
let buf = '';
p.stdout.on('data', (d) => (buf += d.toString()));
const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'refresh', version: '1' } } });
setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }), 300);
setTimeout(() => {
  for (const l of buf.split('\n').filter(Boolean)) {
    try { const m = JSON.parse(l); if (m.id === 2) console.log(`    tools/list -> ${m.result.tools.length} tools`); } catch {}
  }
  p.kill();
  process.exit(0);
}, 900);
JS

echo "==> Done. ghl-mcp-node is ready to ship via extraResources."
echo "    Reminder: keep index.js in lockstep with ../ghl-mcp/main.py."
echo "    Parity gate: npx vitest run tests/unit/ghl-node-server.test.ts"
