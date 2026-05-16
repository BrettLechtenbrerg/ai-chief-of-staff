/**
 * Convert every available MCP tool into an AgentTool compatible with
 * `@kenkaiiii/gg-agent`, using the SDK's `rawInputSchema` escape hatch
 * so we pass the MCP server's native JSON Schema through unchanged
 * (no lossy Zod conversion).
 *
 * This is the bridge between `MCPServerManager` and `chat-tools.ts`.
 */

import { z } from 'zod';
import type { AgentTool, ToolContext } from '@kenkaiiii/gg-agent';
import { getMCPManager } from './manager';

/**
 * Build the agent-facing AgentTool array for every ready MCP server.
 * Returns an empty array if the manager hasn't been started or no
 * servers are connected (intentional — agent runs fine without MCP).
 */
export function buildMCPAgentTools(): AgentTool[] {
  const manager = getMCPManager();
  const descriptors = manager.getAllTools();
  if (descriptors.length === 0) return [];

  const tools: AgentTool[] = [];
  for (const d of descriptors) {
    tools.push({
      name: d.agentToolName,
      description: d.description,
      // gg-agent requires a parameters Zod schema, but when rawInputSchema
      // is set the runtime ignores it and uses the raw JSON Schema instead.
      // z.any() is the cheapest placeholder; the actual validation happens
      // at the MCP server.
      parameters: z.any(),
      rawInputSchema: d.inputSchema,
      execute: async (args: unknown, _context: ToolContext) => {
        try {
          const safeArgs = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
          return await manager.callTool(d.agentToolName, safeArgs);
        } catch (err) {
          // Tool errors are returned to the agent as text — letting it see
          // the failure and decide how to recover — rather than throwing,
          // which would abort the whole turn.
          return `MCP tool error (${d.agentToolName}): ${(err as Error).message}`;
        }
      },
    });
  }
  return tools;
}
