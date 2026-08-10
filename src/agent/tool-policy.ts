import type { AgentTool } from '@kenkaiiii/gg-agent';
import type { AgentMode } from './agent-modes.js';
import type { MCPToolAnnotations } from '../mcp/types.js';
import { ApprovalManager } from '../security/approval-manager.js';

export type ToolCapability =
  | 'safe-local'
  | 'web-read'
  | 'local-read'
  | 'local-write'
  | 'local-execute'
  | 'delegation'
  | 'memory-read'
  | 'memory-write'
  | 'external-read'
  | 'external-write'
  | 'paid-action'
  | 'unknown';

export interface ToolPolicy {
  capability: ToolCapability;
  confirmationRequired: boolean;
  source: 'native' | 'custom' | 'mcp';
  annotations?: MCPToolAnnotations;
}

export type PolicyAwareAgentTool = AgentTool & { policy: ToolPolicy };

export interface ToolExecutionContext {
  sessionId: string;
  channel: string;
}

const TOOL_CAPABILITIES: Readonly<Record<string, ToolCapability>> = {
  read: 'local-read',
  find: 'local-read',
  grep: 'local-read',
  ls: 'local-read',
  write: 'local-write',
  edit: 'local-write',
  tasks: 'local-write',
  bash: 'local-execute',
  shell_command: 'local-execute',
  task_output: 'local-execute',
  task_stop: 'local-execute',
  subagent: 'delegation',
  web_fetch: 'web-read',
  web_search: 'web-read',
  skill: 'safe-local',
  enter_plan: 'safe-local',
  exit_plan: 'safe-local',
  browser: 'external-write',
  notify: 'external-write',
  send_telegram_message: 'external-write',
  set_project: 'local-write',
  get_project: 'local-read',
  clear_project: 'local-write',
  remember: 'memory-write',
  forget: 'memory-write',
  list_facts: 'memory-read',
  daily_log: 'memory-write',
  soul_set: 'memory-write',
  soul_get: 'memory-read',
  soul_list: 'memory-read',
  soul_delete: 'memory-write',
  create_reminder: 'external-write',
  create_routine: 'external-write',
  list_routines: 'local-read',
  delete_routine: 'external-write',
  switch_agent: 'safe-local',
  generate_blog_image: 'paid-action',
  write_daily_posting_packet: 'local-write',
  fetch_seo_data: 'external-read',
  fetch_aeo_visibility: 'paid-action',
  campaign_smoke_test: 'external-write',
  campaign_setup_contact: 'external-write',
  campaign_enroll: 'external-write',
  campaign_status: 'external-read',
  campaign_send_message: 'external-write',
  campaign_verify: 'external-read',
  scaffold_video_project: 'local-execute',
  render_video: 'local-execute',
  trim_video_silence: 'local-execute',
};

const CONFIRMATION_CAPABILITIES = new Set<ToolCapability>([
  'local-read',
  'local-write',
  'local-execute',
  'delegation',
  'external-write',
  'paid-action',
  'unknown',
]);

function isExternalMcpTool(name: string): boolean {
  return name.startsWith('mcp__') &&
    !name.startsWith('mcp__pocket-agent__') &&
    !name.startsWith('mcp__grep__');
}

export function isToolAllowedForMode(toolName: string, mode: AgentMode): boolean {
  if (mode.allowedTools.includes(toolName)) return true;
  return mode.allowedTools.includes('mcp__external__*') && isExternalMcpTool(toolName);
}

export function getToolPolicy(
  toolName: string,
  source: ToolPolicy['source'],
  annotations?: MCPToolAnnotations
): ToolPolicy {
  let capability = TOOL_CAPABILITIES[toolName];
  if (!capability && source === 'mcp') {
    capability = annotations?.readOnlyHint === true && annotations.destructiveHint !== true
      ? 'external-read'
      : 'unknown';
  }
  capability ||= 'unknown';

  // MCP annotations are preserved as useful hints, never as an authorization grant.
  const unknownExternal = source === 'mcp' && !(toolName in TOOL_CAPABILITIES);
  return {
    capability,
    confirmationRequired: unknownExternal || CONFIRMATION_CAPABILITIES.has(capability),
    source,
    ...(annotations ? { annotations: { ...annotations } } : {}),
  };
}

export function attachToolPolicy(
  tool: AgentTool,
  source: ToolPolicy['source'],
  annotations?: MCPToolAnnotations
): PolicyAwareAgentTool {
  return Object.assign(tool, { policy: getToolPolicy(tool.name, source, annotations) });
}

export function filterToolsForMode<T extends { name: string }>(tools: T[], mode: AgentMode): T[] {
  return tools.filter((tool) => isToolAllowedForMode(tool.name, mode));
}

export function guardToolWithApproval(
  tool: PolicyAwareAgentTool,
  execution: ToolExecutionContext
): PolicyAwareAgentTool {
  if (!tool.policy.confirmationRequired) return tool;
  const originalExecute = tool.execute.bind(tool);
  tool.execute = async (args, context) => {
    const approved = await ApprovalManager.request({
      toolName: tool.name,
      capability: tool.policy.capability,
      args,
      sessionId: execution.sessionId,
      channel: execution.channel,
      signal: context.signal,
    });
    if (!approved) return `Tool blocked: ${tool.name} requires user approval.`;
    return originalExecute(args, context);
  };
  return tool;
}
