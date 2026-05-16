#!/usr/bin/env node
/**
 * Smoke test for the MCP client/manager.
 *
 * Reads <userData>/mcp-servers.json, starts every server, lists tools,
 * prints status table, then shuts everything down. No agent runtime,
 * no Electron \u2014 pure Node so you can iterate fast.
 *
 * Run with: node scripts/test-mcp.mjs
 *           (requires `npm run build` first so dist/ exists)
 */

import { fileURLToPath } from 'url';
import * as path from 'path';
import * as os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// Use compiled JS so we don't need ts-node. Requires `npm run build` first.
const { getMCPManager } = await import(path.join(repoRoot, 'dist/mcp/manager.js'));

const userDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'ai-chief-of-staff');
console.log(`[test-mcp] userData: ${userDataDir}`);

const manager = getMCPManager();
const t0 = Date.now();
await manager.start(userDataDir);
const t1 = Date.now();
console.log(`[test-mcp] manager.start() finished in ${t1 - t0}ms\n`);

const statuses = manager.getServerStatuses();
const longestName = Math.max(...statuses.map((s) => s.serverName.length), 'server'.length);

console.log('Server status:');
console.log('-'.repeat(longestName + 35));
console.log(
  `  ${'server'.padEnd(longestName)}  ${'status'.padEnd(10)}  tools`,
);
console.log('-'.repeat(longestName + 35));
for (const s of statuses) {
  const errSuffix = s.lastError ? `  \u2014 ${s.lastError}` : '';
  console.log(
    `  ${s.serverName.padEnd(longestName)}  ${s.status.padEnd(10)}  ${String(s.toolCount).padStart(3)}${errSuffix}`,
  );
}
console.log();

const tools = manager.getAllTools();
console.log(`Total tools available: ${tools.length}\n`);
if (tools.length > 0) {
  console.log('Tools by server:');
  const byServer = new Map();
  for (const t of tools) {
    if (!byServer.has(t.serverName)) byServer.set(t.serverName, []);
    byServer.get(t.serverName).push(t);
  }
  for (const [server, list] of byServer) {
    console.log(`\n  [${server}] \u2014 ${list.length} tool${list.length === 1 ? '' : 's'}`);
    for (const t of list) {
      const desc = (t.description || '').slice(0, 80);
      console.log(`    \u2022 ${t.toolName.padEnd(30)}  ${desc}`);
    }
  }
}

console.log('\n[test-mcp] shutting down servers...');
await manager.stop();
console.log('[test-mcp] done.');
process.exit(0);
