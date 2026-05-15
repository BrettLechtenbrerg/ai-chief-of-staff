/**
 * Status processing logic extracted from AgentManagerClass.
 * Handles SDK status messages and converts them to UI status events.
 */

import { getCurrentSessionId } from '../tools';
import {
  formatToolName,
  formatToolInput,
  isPocketCliCommand,
  formatPocketCommand,
  getSubagentMessage,
} from './display-formatting';

import type { AgentStatus } from './index';

// ── State interfaces ──

export interface StatusProcessingState {
  /** Per-session active subagent tracking */
  activeSubagentsBySession: Map<string, Map<string, { type: string; description: string }>>;
  /** Per-session last partial text (for dedup) */
  lastPartialTextBySession: Map<string, string>;
  /** Per-session background task tracking */
  backgroundTasksBySession: Map<
    string,
    Map<string, { type: string; description: string; toolUseId: string }>
  >;
  /** Per-tool-use timeout timers for SDK tools */
  sdkToolTimers: Map<string, { timer: ReturnType<typeof setTimeout>; sessionId: string }>;
}

/** Callback to emit status events (wraps EventEmitter) */
export type StatusEmitFn = (status: AgentStatus) => void;

/** Callback to extract screenshot paths from tool result blocks */
export type ExtractScreenshotPathsFn = (block: unknown, sessionId: string) => void;

// ── Per-tool timeouts for SDK built-in tools ──

export const SDK_TOOL_TIMEOUTS: Record<string, number> = {
  Bash: 120_000, // 2 min — commands can be long-running
  Read: 15_000,
  Write: 15_000,
  Edit: 15_000,
  Glob: 15_000,
  Grep: 30_000, // large codebases
  WebSearch: 30_000,
  WebFetch: 45_000,
  Task: 300_000, // 5 min — subagent work
};

export const SDK_TOOL_DEFAULT_TIMEOUT = 60_000; // 1 min default

// ── Helper accessors ──

export function getActiveSubagents(
  state: StatusProcessingState,
  sessionId: string
): Map<string, { type: string; description: string }> {
  let map = state.activeSubagentsBySession.get(sessionId);
  if (!map) {
    map = new Map();
    state.activeSubagentsBySession.set(sessionId, map);
  }
  return map;
}

export function getBackgroundTasks(
  state: StatusProcessingState,
  sessionId: string
): Map<string, { type: string; description: string; toolUseId: string }> {
  let map = state.backgroundTasksBySession.get(sessionId);
  if (!map) {
    map = new Map();
    state.backgroundTasksBySession.set(sessionId, map);
  }
  return map;
}

// ── Main status processor ──

/**
 * Process an SDK status message and emit appropriate UI status events.
 *
 * @param state  – shared Maps for tracking subagents, partial text, bg tasks, timers
 * @param emit   – callback to emit AgentStatus events
 * @param extractScreenshots – callback to extract screenshot paths from tool result blocks
 * @param message – raw SDK message
 */
export function processStatusFromMessage(
  state: StatusProcessingState,
  emit: StatusEmitFn,
  extractScreenshots: ExtractScreenshotPathsFn,
  message: unknown
): void {
  const sessionId = getCurrentSessionId();
  const activeSubagents = getActiveSubagents(state, sessionId);
  const backgroundTasks = getBackgroundTasks(state, sessionId);

  // Handle tool use from assistant messages
  const msg = message as { type?: string; subtype?: string; message?: { content?: unknown } };
  if (msg.type === 'assistant') {
    const content = msg.message?.content;
    if (Array.isArray(content)) {
      // Emit partial text for visibility while agent is composing
      const textBlocks = content
        .filter((block: unknown) => (block as { type?: string })?.type === 'text')
        .map((block: unknown) => (block as { text: string }).text);
      if (textBlocks.length > 0) {
        const fullText = textBlocks.join('\n').trim();
        const prevText = state.lastPartialTextBySession.get(sessionId) || '';
        if (fullText && fullText !== prevText) {
          state.lastPartialTextBySession.set(sessionId, fullText);
          emit({
            type: 'partial_text',
            sessionId,
            partialText: fullText,
            partialReplace: true,
            message: 'composing...',
          });
        }
      }

      for (const block of content) {
        if (block?.type === 'tool_use') {
          const rawName = block.name as string;
          const toolName = formatToolName(rawName);
          const toolInput = formatToolInput(block.input);
          const blockInput = block.input as Record<string, unknown>;
          const toolUseId = (block.id as string) || `bg-${Date.now()}`;

          // Detect background tasks (Bash or Task with run_in_background)
          if (blockInput?.run_in_background === true) {
            const bgId = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const description =
              (rawName === 'Bash'
                ? (blockInput.command as string)?.slice(0, 60)
                : (blockInput.description as string) ||
                  (blockInput.prompt as string)?.slice(0, 60)) || rawName;

            backgroundTasks.set(bgId, { type: rawName, description, toolUseId });
            console.log(
              `[AgentManager] Background task started: ${rawName} - ${description} (${backgroundTasks.size} active)`
            );

            emit({
              type: 'background_task_start',
              sessionId,
              backgroundTaskId: bgId,
              backgroundTaskDescription: description,
              backgroundTaskCount: backgroundTasks.size,
              toolName: rawName,
              message: `background: ${description}`,
            });
          }

          // Detect TaskOutput (checking on background tasks)
          if (rawName === 'TaskOutput') {
            emit({
              type: 'background_task_output',
              sessionId,
              backgroundTaskId: blockInput.task_id as string,
              backgroundTaskCount: backgroundTasks.size,
              message: 'checking background task...',
            });
          }

          // Detect TaskStop/KillBash — remove bg task from tracking
          // Note: SDK task IDs don't match our toolUseIds, so remove oldest matching type
          if (rawName === 'TaskStop' || rawName === 'KillBash') {
            const firstKey = backgroundTasks.keys().next().value;
            if (firstKey) {
              backgroundTasks.delete(firstKey);
              console.log(
                `[AgentManager] Background task removed via ${rawName}: ${firstKey} (${backgroundTasks.size} remaining)`
              );
              emit({
                type: 'background_task_end',
                sessionId,
                backgroundTaskId: firstKey,
                backgroundTaskCount: backgroundTasks.size,
                message: 'background task stopped',
              });
            }
          }

          // Check if this is a Task (subagent) tool
          if (rawName === 'Task') {
            const input = block.input as {
              subagent_type?: string;
              description?: string;
              prompt?: string;
            };
            const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const agentType = input.subagent_type || 'general';
            const description = input.description || input.prompt?.slice(0, 50) || 'working on it';

            activeSubagents.set(agentId, { type: agentType, description });

            emit({
              type: 'subagent_start',
              sessionId,
              agentId,
              agentType,
              toolInput: description,
              agentCount: activeSubagents.size,
              message: getSubagentMessage(agentType),
            });
          } else if (rawName === 'TeammateTool') {
            const input = block.input as {
              name?: string;
              team_name?: string;
              description?: string;
            };
            emit({
              type: 'teammate_start',
              sessionId,
              teammateName: input.name,
              teamName: input.team_name,
              toolName,
              toolInput: input.description || input.name || 'spawning teammate',
              message: `rallying ${input.name || 'a teammate'}`,
            });
          } else if (rawName === 'SendMessage') {
            const input = block.input as { to?: string; type?: string; message?: string };
            emit({
              type: 'teammate_message',
              sessionId,
              teammateName: input.to,
              toolName,
              toolInput: input.message?.slice(0, 80) || '',
              message:
                input.type === 'broadcast'
                  ? 'broadcasting to the squad'
                  : `messaging ${input.to || 'teammate'}`,
            });
          } else if (rawName === 'EnterPlanMode') {
            emit({
              type: 'plan_mode_entered',
              sessionId,
              message: 'planning the pounce...',
            });
          } else if (rawName === 'ExitPlanMode') {
            emit({
              type: 'plan_mode_exited',
              sessionId,
              message: 'plan ready for review',
            });
          } else if (rawName === 'Bash' && isPocketCliCommand(block.input)) {
            const pocketName = formatPocketCommand(block.input);
            emit({
              type: 'tool_start',
              sessionId,
              toolName: pocketName,
              toolInput,
              message: `batting at ${pocketName}...`,
              isPocketCli: true,
            });
          } else {
            emit({
              type: 'tool_start',
              sessionId,
              toolName,
              toolInput,
              message: `batting at ${toolName}...`,
            });
          }

          // Start timeout timer for SDK built-in tools (MCP tools have their own via wrapToolHandler)
          // NOTE: On timeout we only log a warning — we do NOT interrupt the session.
          // The SDK handles tool failures internally and returns error tool_results to the
          // model, letting it recover gracefully (e.g. retry or respond without the tool).
          // Interrupting kills the entire turn and leaves the user with no response.
          if (!rawName.startsWith('mcp__')) {
            const timeoutMs = SDK_TOOL_TIMEOUTS[rawName] ?? SDK_TOOL_DEFAULT_TIMEOUT;
            const timer = setTimeout(() => {
              console.warn(
                `[AgentManager] SDK tool ${rawName} (${toolUseId}) exceeded ${timeoutMs}ms — waiting for SDK to handle`
              );
              state.sdkToolTimers.delete(toolUseId);
            }, timeoutMs);
            state.sdkToolTimers.set(toolUseId, { timer, sessionId });
          }
        }
      }
    }
  }

  // Handle tool results
  if (msg.type === 'user' && msg.message?.content) {
    const content = msg.message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'tool_result') {
          // Clear SDK tool timeout timer if this result matches one
          const resultToolUseId = (block as { tool_use_id?: string }).tool_use_id;
          if (resultToolUseId) {
            const entry = state.sdkToolTimers.get(resultToolUseId);
            if (entry) {
              clearTimeout(entry.timer);
              state.sdkToolTimers.delete(resultToolUseId);
            }
          }

          // Extract screenshot paths and images from tool results
          extractScreenshots(block, sessionId);

          // Check if any subagents completed
          if (activeSubagents.size > 0) {
            // Remove one subagent (we don't have exact ID matching, so remove oldest)
            const firstKey = activeSubagents.keys().next().value;
            if (firstKey) {
              activeSubagents.delete(firstKey);
            }

            if (activeSubagents.size > 0) {
              // Still have active subagents
              emit({
                type: 'subagent_update',
                sessionId,
                agentCount: activeSubagents.size,
                message: `${activeSubagents.size} kitty${activeSubagents.size > 1 ? 'ies' : ''} still hunting`,
              });
            } else {
              emit({
                type: 'subagent_end',
                sessionId,
                agentCount: 0,
                message: 'squad done! cleaning up...',
              });
            }
          } else {
            emit({
              type: 'tool_end',
              sessionId,
              message: 'caught it! processing...',
            });
          }
        }
      }
    }
  }

  // Handle system messages
  if (msg.type === 'system') {
    if (msg.subtype === 'init') {
      emit({ type: 'thinking', sessionId, message: 'waking up from a nap...' });
    } else if (msg.subtype === 'status') {
      const statusMsg = msg as { status?: string };
      if (statusMsg.status === 'compacting') {
        console.log('[AgentManager] SDK auto-compaction triggered');
        emit({ type: 'thinking', sessionId, message: 'compacting context...' });
      }
    } else if (msg.subtype === 'compact_boundary') {
      const compactMsg = msg as { compact_metadata?: { trigger: string; pre_tokens: number } };
      const meta = compactMsg.compact_metadata;
      console.log(
        `[AgentManager] SDK compaction complete: trigger=${meta?.trigger}, pre_tokens=${meta?.pre_tokens}`
      );
    } else if (msg.subtype === 'task_notification') {
      const taskMsg = msg as { task_id?: string; status?: string; summary?: string };
      const taskStatus = taskMsg.status;
      if (taskStatus === 'completed' || taskStatus === 'failed' || taskStatus === 'stopped') {
        // Remove oldest tracked bg task (SDK task IDs don't map to our internal IDs)
        const firstKey = backgroundTasks.keys().next().value;
        if (firstKey) {
          backgroundTasks.delete(firstKey);
          console.log(
            `[AgentManager] Background task ${taskStatus} (notification): removed ${firstKey} (${backgroundTasks.size} remaining)`
          );
          emit({
            type: 'background_task_end',
            sessionId,
            backgroundTaskId: firstKey,
            backgroundTaskCount: backgroundTasks.size,
            message: `background task ${taskStatus}`,
          });
        } else {
          console.log(
            `[AgentManager] Background task ${taskStatus} (notification): ${taskMsg.task_id} (not tracked)`
          );
        }
      }
    }
  }
}
