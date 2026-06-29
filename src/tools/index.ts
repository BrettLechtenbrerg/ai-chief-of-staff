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
import {
  getGenerateBlogImageToolDefinition,
  handleGenerateBlogImageTool,
} from './image-gen';
import {
  getSendTelegramToolDefinition,
  handleSendTelegramTool,
} from './telegram-tool';
import {
  getWriteDailyPostingPacketToolDefinition,
  handleWriteDailyPostingPacketTool,
} from './daily-posting-packet';
import {
  getFetchSeoDataToolDefinition,
  handleFetchSeoDataTool,
} from './seo-report';
import {
  getCampaignSmokeTestToolDefinition,
  handleCampaignSmokeTestTool,
} from './campaign-smoke-test';
import {
  getCampaignSetupContactToolDefinition,
  handleCampaignSetupContactTool,
} from './campaign-setup-contact';
import {
  getCampaignEnrollToolDefinition,
  handleCampaignEnrollTool,
} from './campaign-enroll';
import {
  getCampaignStatusToolDefinition,
  handleCampaignStatusTool,
} from './campaign-status';
import {
  getCampaignSendMessageToolDefinition,
  handleCampaignSendMessageTool,
} from './campaign-send-message';
import {
  getCampaignVerifyToolDefinition,
  handleCampaignVerifyTool,
} from './campaign-verify';
import {
  getScaffoldVideoProjectToolDefinition,
  handleScaffoldVideoProjectTool,
} from './video-scaffold';
import {
  getRenderVideoToolDefinition,
  handleRenderVideoTool,
} from './video-render';
import {
  getTrimVideoSilenceToolDefinition,
  handleTrimVideoSilenceTool,
} from './video-trim';

export { setTelegramBotForTools } from './telegram-tool';
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

  // Image generation tool — used by the weekly blog cron to produce hero
  // images via OpenAI gpt-image-1. Available in every mode so Brett can
  // also trigger it ad-hoc from chat (e.g. "generate a hero for the
  // ai-tools-coaches post").
  const imageGenDef = getGenerateBlogImageToolDefinition();
  tools.push({
    name: imageGenDef.name,
    description: imageGenDef.description,
    input_schema: imageGenDef.input_schema as Record<string, unknown>,
    handler: handleGenerateBlogImageTool,
  });

  // send_telegram_message — lets the agent ping Brett on his phone at the
  // end of a long routine (e.g. weekly blog cron sending the PR URL).
  const telegramDef = getSendTelegramToolDefinition();
  tools.push({
    name: telegramDef.name,
    description: telegramDef.description,
    input_schema: telegramDef.input_schema as Record<string, unknown>,
    handler: handleSendTelegramTool,
  });

  // write_daily_posting_packet — multi-brand weekly content cron output.
  // Writes a paste-ready packet file to ~/dev/_brand-profiles/_inbox/.
  const packetDef = getWriteDailyPostingPacketToolDefinition();
  tools.push({
    name: packetDef.name,
    description: packetDef.description,
    input_schema: packetDef.input_schema as Record<string, unknown>,
    handler: handleWriteDailyPostingPacketTool,
  });

  // fetch_seo_data — pulls Google Search Console data (read-only) for the
  // brand sites for the weekly SEO report cron. Always registered; it self-
  // gates on Google auth + the Search Console scope at call time.
  const seoDef = getFetchSeoDataToolDefinition();
  tools.push({
    name: seoDef.name,
    description: seoDef.description,
    input_schema: seoDef.input_schema as Record<string, unknown>,
    handler: handleFetchSeoDataTool,
  });

  // campaign_smoke_test — end-to-end check of GHL campaign wiring. Creates a
  // synthetic test contact, verifies tag/enrollment, then deletes it. Always
  // registered; self-gates on a connected GHL MCP server at call time.
  const smokeDef = getCampaignSmokeTestToolDefinition();
  tools.push({
    name: smokeDef.name,
    description: smokeDef.description,
    input_schema: smokeDef.input_schema as Record<string, unknown>,
    handler: handleCampaignSmokeTestTool,
  });

  // Campaign-operations wrappers (Phase 1): idempotent contact upsert, enroll
  // into a pre-built workflow/drip campaign, and a read-only status snapshot.
  // All self-gate on a connected GHL MCP server at call time.
  const setupDef = getCampaignSetupContactToolDefinition();
  tools.push({
    name: setupDef.name,
    description: setupDef.description,
    input_schema: setupDef.input_schema as Record<string, unknown>,
    handler: handleCampaignSetupContactTool,
  });
  const enrollDef = getCampaignEnrollToolDefinition();
  tools.push({
    name: enrollDef.name,
    description: enrollDef.description,
    input_schema: enrollDef.input_schema as Record<string, unknown>,
    handler: handleCampaignEnrollTool,
  });
  const statusDef = getCampaignStatusToolDefinition();
  tools.push({
    name: statusDef.name,
    description: statusDef.description,
    input_schema: statusDef.input_schema as Record<string, unknown>,
    handler: handleCampaignStatusTool,
  });
  const sendMsgDef = getCampaignSendMessageToolDefinition();
  tools.push({
    name: sendMsgDef.name,
    description: sendMsgDef.description,
    input_schema: sendMsgDef.input_schema as Record<string, unknown>,
    handler: handleCampaignSendMessageTool,
  });
  const verifyDef = getCampaignVerifyToolDefinition();
  tools.push({
    name: verifyDef.name,
    description: verifyDef.description,
    input_schema: verifyDef.input_schema as Record<string, unknown>,
    handler: handleCampaignVerifyTool,
  });

  // Video Studio tools — scaffold the external Remotion workspace and render
  // compositions to MP4 on the Desktop. Both shell out to ~/dev/_video-studio;
  // they never touch the app's native deps. self-gate at call time (scaffold
  // creates the workspace; render refuses if it's missing).
  const scaffoldVideoDef = getScaffoldVideoProjectToolDefinition();
  tools.push({
    name: scaffoldVideoDef.name,
    description: scaffoldVideoDef.description,
    input_schema: scaffoldVideoDef.input_schema as Record<string, unknown>,
    handler: handleScaffoldVideoProjectTool,
  });
  const renderVideoDef = getRenderVideoToolDefinition();
  tools.push({
    name: renderVideoDef.name,
    description: renderVideoDef.description,
    input_schema: renderVideoDef.input_schema as Record<string, unknown>,
    handler: handleRenderVideoTool,
  });
  // trim_video_silence — remove filler words + dead air from a video/audio file
  // via the bundled video-silence-trimmer Python skill. Self-gates on ffmpeg +
  // the transcription engine being installed on the user's machine.
  const trimVideoDef = getTrimVideoSilenceToolDefinition();
  tools.push({
    name: trimVideoDef.name,
    description: trimVideoDef.description,
    input_schema: trimVideoDef.input_schema as Record<string, unknown>,
    handler: handleTrimVideoSilenceTool,
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
