/**
 * Tool configurations for the agent
 *
 * Available capabilities:
 * - File/Terminal: Built-in via gg-coder tools (coder mode) or shell_command (chat modes)
 * - Browser: Three-tier system (HTTP, Electron, CDP)
 * - Desktop: Anthropic computer use tool (Docker recommended)
 *
 * Custom tools are exposed via getCustomTools() for ChatEngine consumption.
 */

import { execSync } from 'child_process';
import { getBrowserToolDefinition, handleBrowserTool } from '../browser';
import { getMemoryTools } from './memory-tools';
import { getSoulTools } from './soul-tools';
import { getSchedulerTools } from './scheduler-tools';
import { getNotifyToolDefinition, handleNotifyTool } from './macos';
import { getProjectTools } from './project-tools';
import { getSwitchAgentTool } from './agent-mode-tools';
import { logActiveToolsStatus } from './diagnostics';

export { logActiveToolsStatus } from './diagnostics';

// Start periodic check for stuck tools (every 30 seconds)
setInterval(() => {
  logActiveToolsStatus();
}, 30000);

export { setMemoryManager } from './memory-tools';
export { setSoulMemoryManager } from './soul-tools';
export { getSchedulerTools } from './scheduler-tools';
export { showNotification } from './macos';
export { setCurrentSessionId, getCurrentSessionId, runWithSessionId } from './session-context';

export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ToolsConfig {
  mcpServers: Record<string, MCPServerConfig>;
  computerUse: {
    enabled: boolean;
    dockerized: boolean;
    displaySize?: { width: number; height: number };
  };
  browser: {
    enabled: boolean;
    cdpUrl?: string; // Default: http://localhost:9222
  };
}

/**
 * Default tools configuration
 */
export function getDefaultToolsConfig(): ToolsConfig {
  return {
    mcpServers: {},
    computerUse: {
      enabled: false,
      dockerized: true,
      displaySize: { width: 1920, height: 1080 },
    },
    browser: {
      enabled: true,
      cdpUrl: 'http://localhost:9222',
    },
  };
}

/**
 * Build MCP server configurations (for child process MCP servers)
 */
export function buildMCPServers(config: ToolsConfig): Record<string, MCPServerConfig> {
  const servers: Record<string, MCPServerConfig> = {};

  // Computer use server (for desktop automation) - runs as child process
  if (config.computerUse.enabled) {
    if (config.computerUse.dockerized) {
      servers['computer'] = {
        command: 'docker',
        args: [
          'run',
          '-i',
          '--rm',
          '-e',
          `DISPLAY_WIDTH=${config.computerUse.displaySize?.width || 1920}`,
          '-e',
          `DISPLAY_HEIGHT=${config.computerUse.displaySize?.height || 1080}`,
          'ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest',
        ],
      };
    } else {
      servers['computer'] = {
        command: 'npx',
        args: ['-y', '@anthropic-ai/computer-use-server'],
      };
    }
  }

  // Merge with any custom servers
  return { ...servers, ...config.mcpServers };
}

/**
 * Get custom tools for the agent
 */
export function getCustomTools(config: ToolsConfig): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: (input: unknown) => Promise<string>;
}> {
  const tools: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    handler: (input: unknown) => Promise<string>;
  }> = [];

  // Memory tools (always enabled)
  const memoryTools = getMemoryTools();
  for (const tool of memoryTools) {
    tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Record<string, unknown>,
      handler: tool.handler,
    });
  }

  // Soul tools (always enabled)
  const soulTools = getSoulTools();
  for (const tool of soulTools) {
    tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Record<string, unknown>,
      handler: tool.handler,
    });
  }

  // Browser tool
  if (config.browser.enabled) {
    const browserDef = getBrowserToolDefinition();
    tools.push({
      name: browserDef.name,
      description: browserDef.description,
      input_schema: browserDef.input_schema as Record<string, unknown>,
      handler: handleBrowserTool,
    });
  }

  // Scheduler tools (always enabled - scheduler availability checked at runtime)
  const schedulerTools = getSchedulerTools();
  for (const tool of schedulerTools) {
    tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Record<string, unknown>,
      handler: tool.handler,
    });
  }

  // macOS tools (notifications and PTY exec)
  const notifyDef = getNotifyToolDefinition();
  tools.push({
    name: notifyDef.name,
    description: notifyDef.description,
    input_schema: notifyDef.input_schema as Record<string, unknown>,
    handler: handleNotifyTool,
  });

  // Project tools
  const projectTools = getProjectTools();
  for (const tool of projectTools) {
    tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Record<string, unknown>,
      handler: tool.handler,
    });
  }

  // switch_agent tool (available in all modes)
  const switchDef = getSwitchAgentTool();
  tools.push({
    name: switchDef.name,
    description: switchDef.description,
    input_schema: switchDef.input_schema as Record<string, unknown>,
    handler: switchDef.handler as (input: unknown) => Promise<string>,
  });

  return tools;
}

/**
 * Validate that required environment variables are set
 */
export function validateToolsConfig(config: ToolsConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.computerUse.enabled && config.computerUse.dockerized) {
    // Check if Docker is available
    try {
      execSync('docker --version', { stdio: 'ignore' });
    } catch {
      errors.push('Docker not available (required for safe computer use)');
    }
  }

  return { valid: errors.length === 0, errors };
}
