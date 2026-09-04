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
  cwd: string;
  approvedRoots: string[];
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
  browser: 'web-read',
  notify: 'safe-local',
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
  create_reminder: 'local-write',
  create_routine: 'local-write',
  list_routines: 'local-read',
  delete_routine: 'local-write',
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

// Only actions that leave the machine (send/post/modify external systems) or
// bill a batch of provider calls need a human. Local file/shell/memory work,
// reads of connected services, and single paid image renders run unattended.
const CONFIRMATION_CAPABILITIES = new Set<ToolCapability>(['external-write']);
const CONFIRMATION_TOOLS = new Set<string>(['fetch_aeo_visibility']);

// Per-call gate for tools whose side effects depend on arguments.
const BROWSER_ACTING_ACTIONS = new Set(['click', 'type', 'evaluate', 'upload']);
const ARG_CONFIRMATION: Readonly<Record<string, (args: unknown) => boolean>> = {
  browser: (args) =>
    BROWSER_ACTING_ACTIONS.has(String((args as { action?: unknown } | null)?.action ?? '')),
};

// MCP tool-name heuristics. Flo servers stage changes with `*_propose_*` and
// commit them with `*_execute`; GHL/Meta use verb_noun names. We inspect the
// first two words so `gmail_send` and `send_message` both classify as writes.
const READ_VERBS = new Set([
  'get', 'list', 'search', 'read', 'find', 'fetch', 'check', 'lookup', 'query',
  'describe', 'verify', 'debug', 'scrape', 'crawl', 'map', 'extract', 'propose',
]);
const WRITE_VERBS = new Set([
  'send', 'create', 'update', 'delete', 'remove', 'add', 'execute', 'schedule',
  'publish', 'post', 'insert', 'patch', 'put', 'void', 'record', 'move', 'upload',
  'block', 'sync', 'modify', 'cancel', 'reply', 'forward', 'archive', 'trash',
  'empty', 'pay', 'charge', 'enroll', 'assign', 'invite', 'share', 'grant',
  'revoke', 'rename', 'write', 'append', 'apply', 'replace', 'submit', 'trigger',
  'book', 'reschedule', 'merge', 'import', 'clear', 'reset', 'restore',
  'launch', 'start', 'stop', 'pause', 'resume', 'activate', 'deactivate',
  'enable', 'disable', 'set', 'mark', 'toggle', 'run', 'edit', 'purge', 'drop',
]);

function classifyMcpToolByName(toolName: string): ToolCapability {
  const bare = toolName.replace(/^mcp__.+?__/, '');
  const words = bare.toLowerCase().split(/[_-]+/).slice(0, 2);
  if (words.includes('propose')) return 'external-read';
  if (READ_VERBS.has(words[0] ?? '')) return 'external-read';
  return words.some((w) => WRITE_VERBS.has(w)) ? 'external-write' : 'external-read';
}

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
    // Annotations are hints only; a destructive hint can escalate, never downgrade.
    capability = classifyMcpToolByName(toolName);
    if (annotations?.destructiveHint === true) capability = 'external-write';
  }
  capability ||= 'unknown';

  return {
    capability,
    confirmationRequired:
      CONFIRMATION_TOOLS.has(toolName) ||
      toolName in ARG_CONFIRMATION ||
      CONFIRMATION_CAPABILITIES.has(capability),
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
  const needsApproval = ARG_CONFIRMATION[tool.name] ?? (() => true);
  tool.execute = async (args, context) => {
    if (!needsApproval(args)) return originalExecute(args, context);
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
