#!/usr/bin/env node
/**
 * End-to-end MCP tool-call test. Calls flo-calendar's "list upcoming events"
 * tool and prints the result. Proves the full path: spawn -> initialize ->
 * list_tools -> call_tool -> stringify -> return to agent.
 *
 * Run with: node scripts/test-mcp-call.mjs
 *           (requires `npm run build` first)
 */

import { fileURLToPath } from 'url';
import * as path from 'path';
import * as os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const { getMCPManager } = await import(path.join(repoRoot, 'dist/mcp/manager.js'));
const { buildMCPAgentTools } = await import(path.join(repoRoot, 'dist/mcp/proxy.js'));

const userDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'ai-chief-of-staff');

const manager = getMCPManager();
await manager.start(userDataDir);

const agentTools = buildMCPAgentTools();
console.log(`\nbuildMCPAgentTools() returned ${agentTools.length} AgentTool(s).`);

// Confirm rawInputSchema is set
const withSchema = agentTools.filter((t) => t.rawInputSchema).length;
console.log(`  ${withSchema}/${agentTools.length} have rawInputSchema set (should equal total).`);

// Pick a safe, read-only tool to invoke. Calendar list is a good smoke test.
const calendarTool = agentTools.find((t) => t.name === 'mcp__flo-calendar__calendar_list_events');
if (!calendarTool) {
  console.error('\nCould not find mcp__flo-calendar__calendar_list_events. Available calendar tools:');
  for (const t of agentTools.filter((t) => t.name.includes('calendar'))) {
    console.error(`  - ${t.name}`);
  }
  await manager.stop();
  process.exit(1);
}

console.log(`\nCalling ${calendarTool.name} with empty args...`);
try {
  const result = await calendarTool.execute({}, { signal: new AbortController().signal });
  const preview = String(result).slice(0, 800);
  console.log('\nResult (first 800 chars):');
  console.log('-'.repeat(80));
  console.log(preview);
  console.log('-'.repeat(80));
} catch (err) {
  console.error('Tool call threw:', err.message);
}

await manager.stop();
console.log('\n[test-mcp-call] done.');
process.exit(0);
