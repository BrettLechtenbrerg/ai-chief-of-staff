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

// Owner policy: only actions that leave this machine (send, publish, create,
// modify or delete in an external account) or bill a batch of provider calls
// need a human. Local file, shell, memory, video and project work runs
// unattended; the shell already runs with a credential-stripped environment.
// Unclassified tools still fail closed.
const CONFIRMATION_CAPABILITIES = new Set<ToolCapability>(['external-write', 'unknown']);
const CONFIRMATION_TOOLS = new Set<string>(['fetch_aeo_visibility']);

// Prompt-injection egress guard (the "lethal trifecta"). Once a session has
// both taken in untrusted content (web pages, email, CRM, any MCP result) and
// touched private data (local files, shell output, email, CRM), a request to a
// new URL could carry that data out inside the address. From then on, egress
// URLs need the owner. Pure research (web only) and pure local work stay
// unattended. Tracked for the life of the process, per session.
interface SessionExposure { untrusted: boolean; privateData: boolean }
const sessionExposure = new Map<string, SessionExposure>();
const UNTRUSTED_CAPABILITIES = new Set<ToolCapability>(['web-read', 'external-read', 'external-write']);
const PRIVATE_CAPABILITIES = new Set<ToolCapability>(['local-read', 'local-execute', 'external-read']);

function recordToolExposure(sessionId: string, policy: ToolPolicy): void {
  const untrusted = UNTRUSTED_CAPABILITIES.has(policy.capability) || policy.source === 'mcp';
  const privateData = PRIVATE_CAPABILITIES.has(policy.capability);
  if (!untrusted && !privateData) return;
  const current = sessionExposure.get(sessionId) ?? { untrusted: false, privateData: false };
  sessionExposure.set(sessionId, {
    untrusted: current.untrusted || untrusted,
    privateData: current.privateData || privateData,
  });
}

export function sessionCanLeakPrivateData(sessionId: string): boolean {
  const exposure = sessionExposure.get(sessionId);
  return Boolean(exposure?.untrusted && exposure.privateData);
}

/** Test hook: forget exposure for one session, or all sessions. */
export function resetSessionExposure(sessionId?: string): void {
  if (sessionId === undefined) sessionExposure.clear();
  else sessionExposure.delete(sessionId);
}

// Browser: observing and moving around a page is unattended; anything that can
// submit, run script or upload asks. Unknown actions ask. Opening a new URL
// asks once the session could leak private data (see above).
const BROWSER_READ_ACTIONS = new Set([
  'navigate', 'extract', 'screenshot', 'scroll', 'hover',
  'tabs_list', 'tabs_open', 'tabs_focus', 'tabs_close',
]);
const BROWSER_URL_ACTIONS = new Set(['navigate', 'tabs_open']);
// Shell: commands run inside the OS sandbox (shell-sandbox.ts) with no network
// and no access to credential folders. Commands that need the network (transfer
// tools, remote shells, mail, deploy/publish, package installs, Apple events,
// handing work to launchd/cron) ask, and only then get network access. A command
// this list misses is not a leak: it simply runs offline. Matched at command
// position (start, or after ; & | ( ` newline), so `ls | grep curl` does not trip it.
const SHELL_NETWORK_COMMAND =
  /(?:^|[;&|(`\n])\s*(?:sudo\s+)?(?:(?:curl|wget|ssh|scp|sftp|rsync|sendmail|mailx?|osascript|open|launchctl|crontab|nc|ncat|socat|telnet|ftp|ping|dig|nslookup|host|gh|vercel|netlify|aws|gcloud|az|firebase|heroku|fly|flyctl|s3cmd|brew|docker|npx|pnpx|bunx)|(?:git\s+(?:push|pull|fetch|clone|ls-remote|submodule)|(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|add|update|upgrade|up|outdated|view|info|audit|publish|login|exec|dlx|create|init)|pip3?\s+(?:install|download|upload)|python3?\s+-m\s+pip|twine\s+upload))(?=\s|$)/i;

/** True when a shell command needs the network; such commands require approval. */
export function shellCommandNeedsNetwork(command: unknown): boolean {
  return typeof command !== 'string' || SHELL_NETWORK_COMMAND.test(command);
}
const shellNeedsApproval = (args: unknown): boolean =>
  shellCommandNeedsNetwork((args as { command?: unknown } | null)?.command);
const ARG_CONFIRMATION: Readonly<Record<string, (args: unknown, sessionId: string) => boolean>> = {
  browser: (args, sessionId) => {
    const action = String((args as { action?: unknown } | null)?.action ?? '');
    if (!BROWSER_READ_ACTIONS.has(action)) return true;
    return BROWSER_URL_ACTIONS.has(action) && sessionCanLeakPrivateData(sessionId);
  },
  web_fetch: (_args, sessionId) => sessionCanLeakPrivateData(sessionId),
  shell_command: shellNeedsApproval,
  bash: shellNeedsApproval,
};

// Exact tools inspected in the vendored Flo servers (vendor/flo-mcp-servers).
// Reads and `propose_*` staging never touch Google: nothing leaves until the
// matching `*_execute`, which asks with a full proposal preview. Direct writers
// (`*_execute`, `gmail_send`, `gmail_delete_by_search`, label create/delete)
// are deliberately absent. Unknown servers/tools require confirmation.
const KNOWN_MCP_READS = new Set([
  // flo-gmail
  'mcp__flo-gmail__gmail_search_emails',
  'mcp__flo-gmail__gmail_get_message',
  'mcp__flo-gmail__gmail_list_labels',
  'mcp__flo-gmail__gmail_list_pending',
  'mcp__flo-gmail__gmail_preview',
  'mcp__flo-gmail__gmail_propose_send',
  'mcp__flo-gmail__gmail_propose_delete',
  'mcp__flo-gmail__gmail_propose_empty_trash',
  'mcp__flo-gmail__gmail_propose_modify_labels',
  // flo-calendar
  'mcp__flo-calendar__calendar_list_events',
  'mcp__flo-calendar__calendar_check_conflicts',
  'mcp__flo-calendar__calendar_find_best_time',
  'mcp__flo-calendar__calendar_list_pending',
  'mcp__flo-calendar__calendar_preview',
  'mcp__flo-calendar__calendar_propose_event',
  'mcp__flo-calendar__calendar_propose_recurring_event',
  'mcp__flo-calendar__calendar_propose_delete',
  'mcp__flo-calendar__calendar_block_focus_time',
  'mcp__flo-calendar__calendar_sync_docs_deadlines',
  // flo-docs (Docs + Drive)
  'mcp__flo-docs__docs_read_content',
  'mcp__flo-docs__docs_debug_structure',
  'mcp__flo-docs__docs_verify_change',
  'mcp__flo-docs__docs_list_pending',
  'mcp__flo-docs__docs_preview',
  'mcp__flo-docs__docs_propose_create',
  'mcp__flo-docs__docs_propose_append_text',
  'mcp__flo-docs__docs_propose_replace_text',
  'mcp__flo-docs__docs_propose_delete_content',
  'mcp__flo-docs__docs_propose_move_content',
  'mcp__flo-docs__docs_propose_insert_at_position',
  'mcp__flo-docs__docs_propose_apply_formatting',
  'mcp__flo-docs__drive_list_folder',
  'mcp__flo-docs__drive_search',
  'mcp__flo-docs__drive_propose_create_folder',
  'mcp__flo-docs__drive_propose_move_file',
  'mcp__flo-docs__drive_propose_upload',
  // flo-bookmarks (local Chrome bookmarks file only)
  'mcp__flo-bookmarks__bookmarks_list',
]);

// GoHighLevel CRM: reads run unattended; every create/update/delete/send asks.
// Server aliases come from bundled and hand-built MCP entries.
const GHL_SERVER_ALIASES = ['ghl-mcp', 'flo-ghl', 'flo-ghl-brett'];
const GHL_READ_PREFIX = /^(?:get|list|search)_/;

function isKnownMcpRead(name: string): boolean {
  if (KNOWN_MCP_READS.has(name)) return true;
  for (const alias of GHL_SERVER_ALIASES) {
    const prefix = `mcp__${alias}__`;
    if (name.startsWith(prefix)) return GHL_READ_PREFIX.test(name.slice(prefix.length));
  }
  return false;
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
  let capability = Object.hasOwn(TOOL_CAPABILITIES, toolName) ? TOOL_CAPABILITIES[toolName] : undefined;
  if (!capability && source === 'mcp') {
    // Annotations are hints only; a destructive hint can escalate, never downgrade.
    capability = isKnownMcpRead(toolName) ? 'external-read' : 'external-write';
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
  const run: typeof originalExecute = async (args, context) => {
    try {
      return await originalExecute(args, context);
    } finally {
      recordToolExposure(sessionId, tool.policy);
    }
  };
  tool.execute = async (args, context) => {
    if (context.signal?.aborted) return 'Tool blocked: execution canceled.';
    if (!tool.policy.confirmationRequired || !needsApproval(args, sessionId)) return run(args, context);
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
    return run(approvedArgs, context);
  };
  return tool;
}
