/**
 * Agent mode registry — defines all available agent personas.
 *
 * Each mode specifies its engine, system prompt, tool access, and UI metadata.
 * The `switch_agent` tool and options builder both reference this registry.
 */

// ── Types ──

export type AgentModeId = 'general' | 'coder' | 'researcher' | 'writer' | 'therapist';

export interface AgentMode {
  id: AgentModeId;
  name: string;
  icon: string;
  engine: 'chat';
  systemPrompt: string;
  allowedTools: string[];
  mcpServers?: string[];
  description: string;
  /** LLM-facing description of when to hand off to this mode */
  handoffDescription: string;
  /** Which modes this agent can hand off to */
  canHandoffTo: AgentModeId[];
  /** Whether this mode produces technical artifacts (tool calls, file contents, etc.) */
  technicalMode: boolean;
}

/** Context passed to on_handoff callbacks */
export interface HandoffContext {
  sessionId: string;
  fromMode: AgentModeId;
  toMode: AgentModeId;
  reason: string;
  timestamp: Date;
}

export type OnHandoffCallback = (context: HandoffContext) => void | Promise<void>;

// ── Shared tool lists ──

/** Tools available in chat-engine modes (general, researcher, etc.) */
const CHAT_CORE_TOOLS = ['web_fetch', 'shell_command', 'subagent', 'read', 'write', 'edit'];

/** gg-coder native tools (read, write, edit, bash, etc.) */
const CODER_NATIVE_TOOLS = [
  'read',
  'write',
  'edit',
  'bash',
  'find',
  'grep',
  'ls',
  'web_fetch',
  'subagent',
  'tasks',
  'task_output',
  'task_stop',
  'skill',
  'enter_plan',
  'exit_plan',
];

const BROWSER_TOOLS = ['browser'];
const NOTIFY_TOOLS = ['notify'];
const PROJECT_TOOLS = ['set_project', 'get_project', 'clear_project'];
const MEMORY_TOOLS = ['remember', 'forget', 'list_facts', 'daily_log'];
const SOUL_TOOLS = ['soul_set', 'soul_get', 'soul_list', 'soul_delete'];
const SCHEDULER_TOOLS = ['create_reminder', 'create_routine', 'list_routines', 'delete_routine'];
const BUSINESS_TOOLS = [
  'generate_blog_image',
  'send_telegram_message',
  'write_daily_posting_packet',
  'fetch_seo_data',
  'fetch_aeo_visibility',
  'campaign_smoke_test',
  'campaign_setup_contact',
  'campaign_enroll',
  'campaign_status',
  'campaign_send_message',
  'campaign_verify',
  'scaffold_video_project',
  'render_video',
  'trim_video_silence',
];
const EXTERNAL_MCP_TOOLS = ['mcp__external__*'];
const GREP_TOOLS = ['mcp__grep__searchGitHub'];
const SWITCH_TOOL = ['switch_agent'];

// ── System prompts ──

const GENERAL_PROMPT = `## General Mode

You are the user's personal assistant. You handle their day-to-day: scheduling, reminders, quick lookups, task management, conversations, and anything that doesn't require deep specialist work. You have shell access, browser, web search, and all external services.

**How you operate:**
- You're a companion, not a search engine — be conversational, remember context, reference past conversations
- Handle requests end-to-end: don't just tell the user how to do something, do it for them
- Save new information about the user immediately — preferences, plans, people, decisions
- Be proactive — suggest reminders, follow up on past topics, anticipate needs
- If the user needs deep coding, research, writing, or emotional support, switch to the appropriate agent`;

const CODER_PROMPT = ''; // Coder uses gg-coder's buildSystemPrompt() — see chat-engine.ts

const RESEARCHER_PROMPT = `## Researcher Mode

You are in deep research mode. Unlike quick lookups, your job is thorough investigation: multiple sources, cross-verification, and structured findings with explicit confidence levels.

**How you operate:**
- Verify before presenting — cross-reference claims across multiple sources
- Use every tool aggressively: web search for discovery, browser for deep reading, shell and Pocket CLI for data extraction
- Structure output: lead with the answer, then evidence, then what you couldn't verify
- Distinguish between established facts, expert opinion, and speculation
- When sources conflict, present both sides — don't pick one silently
- If the request falls outside research, switch back to the appropriate agent`;

const WRITER_PROMPT = `## Writer Mode

You are in focused writing mode. You draft, edit, and refine content that matches the user's voice. You deliberately have no web search or browser — you write from what you know, using memory and soul context for the user's style and preferences.

**How you operate:**
- Clarify audience, tone, and purpose before drafting if not obvious from context
- Check soul memory for the user's communication style and match it — not generic AI voice
- Produce complete drafts, not outlines or bullet points (unless asked)
- Every sentence earns its place — cut filler, be direct, be specific
- When editing existing text, explain what you changed and why
- If the request falls outside writing, switch back to the appropriate agent`;

const THERAPIST_PROMPT = `## Therapist Mode

You are in supportive listening mode. The user wants to talk through something — stress, decisions, feelings, relationships, life direction. You have access to their memory and soul context, so you know their life, goals, struggles, and history.

**How you operate:**
- Listen first. Reflect back what you hear before offering perspective
- Ask thoughtful questions — help them think, don't think for them
- Don't jump to solutions unless they explicitly ask for advice
- Reference what you know about their life, goals, and past conversations when relevant — show you remember
- Validate emotions without being patronizing — no "that must be really hard" on repeat
- Be honest, not just agreeable. If they're avoiding something obvious, gently point it out
- If the conversation shifts to tasks, coding, or research, switch back to the appropriate agent`;

// ── Mode registry ──

export const AGENT_MODES: Record<AgentModeId, AgentMode> = {
  general: {
    id: 'general',
    name: 'General',
    icon: '🐾',
    engine: 'chat',
    systemPrompt: GENERAL_PROMPT,
    allowedTools: [
      ...CHAT_CORE_TOOLS,
      ...BROWSER_TOOLS,
      ...NOTIFY_TOOLS,
      ...PROJECT_TOOLS,
      ...MEMORY_TOOLS,
      ...SOUL_TOOLS,
      ...SCHEDULER_TOOLS,
      ...BUSINESS_TOOLS,
      ...EXTERNAL_MCP_TOOLS,
      ...SWITCH_TOOL,
    ],
    mcpServers: ['pocket-agent'],
    description: 'Personal assistant — remembers, schedules, browses, manages life',
    handoffDescription: 'General conversation, scheduling, reminders, task management',
    canHandoffTo: ['coder', 'researcher', 'writer', 'therapist'],
    technicalMode: false,
  },
  coder: {
    id: 'coder',
    name: 'Coder',
    icon: '🔧',
    engine: 'chat',
    systemPrompt: CODER_PROMPT,
    allowedTools: [...CODER_NATIVE_TOOLS, ...PROJECT_TOOLS, ...GREP_TOOLS, ...SWITCH_TOOL],
    mcpServers: ['pocket-agent', 'grep'],
    description: 'Full coding agent with file access and GitHub search',
    handoffDescription: 'Code, file edits, debugging, programming tasks',
    canHandoffTo: ['general', 'researcher'],
    technicalMode: true,
  },
  researcher: {
    id: 'researcher',
    name: 'Researcher',
    icon: '🔍',
    engine: 'chat',
    systemPrompt: RESEARCHER_PROMPT,
    allowedTools: [
      'web_fetch',
      'subagent',
      ...BROWSER_TOOLS,
      ...NOTIFY_TOOLS,
      ...PROJECT_TOOLS,
      ...MEMORY_TOOLS,
      'fetch_seo_data',
      'fetch_aeo_visibility',
      ...EXTERNAL_MCP_TOOLS,
      ...SWITCH_TOOL,
    ],
    mcpServers: ['pocket-agent'],
    description: 'Deep research — web search, browsing, note-taking',
    handoffDescription: 'Deep multi-source research, fact-checking, investigation',
    canHandoffTo: ['general', 'coder', 'writer'],
    technicalMode: false,
  },
  writer: {
    id: 'writer',
    name: 'Writer',
    icon: '✍️',
    engine: 'chat',
    systemPrompt: WRITER_PROMPT,
    allowedTools: [
      ...MEMORY_TOOLS,
      ...SOUL_TOOLS,
      ...NOTIFY_TOOLS,
      'write_daily_posting_packet',
      'generate_blog_image',
      ...SWITCH_TOOL,
    ],
    mcpServers: ['pocket-agent'],
    description: 'Focused writing — no web search, no browser distractions',
    handoffDescription: 'Drafting, editing, content creation — no web distractions',
    canHandoffTo: ['general', 'researcher'],
    technicalMode: false,
  },
  therapist: {
    id: 'therapist',
    name: 'Therapist',
    icon: '💬',
    engine: 'chat',
    systemPrompt: THERAPIST_PROMPT,
    allowedTools: [...MEMORY_TOOLS, ...SOUL_TOOLS, ...NOTIFY_TOOLS, ...SWITCH_TOOL],
    mcpServers: ['pocket-agent'],
    description: 'Supportive listening — talk through stress, decisions, feelings',
    handoffDescription: 'Talk through feelings, stress, decisions, personal matters',
    canHandoffTo: ['general'],
    technicalMode: false,
  },
};

/** All valid mode IDs */
export const ALL_MODE_IDS: AgentModeId[] = Object.keys(AGENT_MODES) as AgentModeId[];

/** Check if a string is a valid mode ID */
export function isValidModeId(mode: string): mode is AgentModeId {
  return mode in AGENT_MODES;
}

/** Get the mode config, falling back to 'general' for invalid IDs */
export function getModeConfig(mode: string): AgentMode {
  return AGENT_MODES[mode as AgentModeId] || AGENT_MODES.general;
}

/** Get all modes as an array (for UI rendering) */
export function getAllModes(): AgentMode[] {
  return ALL_MODE_IDS.map((id) => AGENT_MODES[id]);
}

/** Build dynamic routing instructions for injection into system prompt */
export function buildRoutingInstructions(currentMode: AgentModeId): string {
  const config = AGENT_MODES[currentMode];
  const targets = config.canHandoffTo;

  if (targets.length === 0) return '';

  const targetList = targets
    .map((id) => `\`${id}\` — ${AGENT_MODES[id].handoffDescription}`)
    .join('; ');

  return `You can use \`switch_agent\` to hand off when the conversation shifts: ${targetList}. Transfers are seamless — do not announce or draw attention to them.`;
}
