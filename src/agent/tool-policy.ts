import type { AgentTool, ToolContext } from '@kenkaiiii/gg-agent';
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

export type PolicyAwareAgentTool = AgentTool & {
  policy: ToolPolicy;
  /** Trusted adapter hook, never supplied by tool arguments or MCP metadata. */
  prepareApproval?: (args: unknown, context: ToolContext) => Promise<{
    executeArgs: unknown;
    preview: unknown;
  }>;
};

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
  task_output: 'local-read',
  task_stop: 'safe-local',
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

// Free-form execution is not local-only: programs can use network and credentials.
// Constrained file/memory operations remain unattended; unknown execution does not.
const CONFIRMATION_CAPABILITIES = new Set<ToolCapability>(['external-write', 'local-execute', 'unknown']);
// Choosing a project expands subsequent file access; it is an authority change.
const CONFIRMATION_TOOLS = new Set<string>(['fetch_aeo_visibility', 'set_project']);

const BROWSER_READ_ACTIONS = new Set(['navigate', 'extract', 'screenshot', 'tabs_list']);
const ARG_CONFIRMATION: Readonly<Record<string, (args: unknown) => boolean>> = {
  browser: (args) =>
    !BROWSER_READ_ACTIONS.has(String((args as { action?: unknown } | null)?.action ?? '')),
};

// Exact capabilities inspected in bundled Flo handlers. Unknown servers/tools
// require confirmation. Proposal handlers can load attachments; a staging verb
// alone cannot establish safety. Add reads here only after inspecting the sink.
const KNOWN_MCP_READS = new Set([
  'mcp__flo-gmail__gmail_search_emails',
  'mcp__flo-gmail__gmail_preview',
  'mcp__flo-calendar__calendar_preview',
  'mcp__flo-docs__docs_preview',
  'mcp__flo-calendar__calendar_list_events',
  'mcp__flo-calendar__calendar_check_conflicts',
  'mcp__flo-docs__docs_read_content',
  'mcp__flo-ghl__get_contact',
  'mcp__flo-ghl__search_contacts',
  'mcp__flo-ghl-brett__get_contact',
  'mcp__flo-ghl-brett__search_contacts',
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
  let capability = Object.hasOwn(TOOL_CAPABILITIES, toolName) ? TOOL_CAPABILITIES[toolName] : undefined;
  if (!capability && source === 'mcp') {
    // Annotations are hints only; a destructive hint can escalate, never downgrade.
    capability = KNOWN_MCP_READS.has(toolName) ? 'external-read' : 'external-write';
    if (annotations?.destructiveHint === true) capability = 'external-write';
  }
  capability ||= 'unknown';

  return {
    capability,
    confirmationRequired:
      CONFIRMATION_TOOLS.has(toolName) ||
      Object.hasOwn(ARG_CONFIRMATION, toolName) ||
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
  const originalExecute = tool.execute.bind(tool);
  const needsApproval = Object.hasOwn(ARG_CONFIRMATION, tool.name) ? ARG_CONFIRMATION[tool.name] : () => true;
  const { sessionId, channel } = execution;
  tool.execute = async (args, context) => {
    if (context.signal?.aborted) return 'Tool blocked: execution canceled.';
    if (!tool.policy.confirmationRequired || !needsApproval(args)) return originalExecute(args, context);
    // Capture before yielding: execute the reviewed destination/body, not a
    // caller-owned reference that can change while approval is pending.
    let approvedArgs: typeof args;
    try {
      approvedArgs = globalThis.structuredClone(args);
    } catch {
      return 'Tool blocked: arguments could not be captured for approval.';
    }
    let approvalDetails: unknown = approvedArgs;
    if (tool.prepareApproval) {
      // Remote/scheduled origins must not even read the proposal snapshot.
      if (channel !== 'desktop' || context.signal?.aborted) return 'Tool blocked: desktop approval required.';
      try {
        const prepared = await tool.prepareApproval(approvedArgs, context);
        if (context.signal?.aborted) return 'Tool blocked: execution canceled.';
        approvedArgs = globalThis.structuredClone(prepared.executeArgs);
        approvalDetails = { arguments: approvedArgs, proposals: globalThis.structuredClone(prepared.preview) };
        // The complete review must fit the UI. Never truncate a destination/body.
        if (JSON.stringify(approvalDetails, null, 2).length > 100_000) {
          return 'Tool blocked: complete proposal approval exceeds display limit.';
        }
      } catch {
        // Do not echo provider errors, proposal contents, or credentials.
        return 'Tool blocked: complete proposal preview unavailable or invalid.';
      }
    }
    const approved = await ApprovalManager.request({
      toolName: tool.name,
      capability: tool.policy.capability,
      args: approvalDetails,
      sessionId,
      channel,
      signal: context.signal,
    });
    if (!approved || context.signal?.aborted) return `Tool blocked: ${tool.name} requires user approval.`;
    return originalExecute(approvedArgs, context);
  };
  return tool;
}
