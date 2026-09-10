/**
 * Claude Code agent loop — drop-in replacement for gg-agent's `agentLoop`
 * that runs the turn inside the owner's installed Claude Code binary via the
 * Agent SDK, so Claude is billed to the Max subscription Claude Code is
 * signed in to.
 *
 * Shape: same `Message[]` in, same `AgentEvent` stream out, same
 * `AgentResult` at the end, so chat-engine and the sub-agent tool need no
 * knowledge of the transport.
 *
 * Isolation: Claude Code's own tools, settings, CLAUDE.md files, hooks and
 * MCP servers are all disabled. The only tools it sees are the app's own,
 * bridged through an in-process MCP server, so the app's approval policy
 * still gates every call. Sessions are not persisted to ~/.claude.
 */

import type { AgentEvent, AgentOptions, AgentResult, AgentTool } from '@kenkaiiii/gg-agent';
import type { Message, StopReason, Usage } from '@kenkaiiii/gg-ai';
import type { Options as ClaudeCodeOptions, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { claudeCodeEnv, explainClaudeCodeError, resolveClaudeCodeExecutable } from './claude-code-route';

const MCP_SERVER_NAME = 'acos';
const TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;
/** gg-ai marker that keeps a system prompt out of the provider cache; meaningless here. */
const UNCACHED_MARKER = /<!--\s*uncached\s*-->/g;

export interface ClaudeCodeLoopExtras {
  cwd?: string;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

/** Tool names must satisfy MCP's ^[A-Za-z0-9_-]{1,64}$; proxied MCP tools already carry `mcp__`. */
function exposedToolName(name: string): string {
  return name.startsWith('mcp__') ? `ext__${name.slice(5)}` : name;
}

function textOf(content: Message['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'image') return '[image]';
      if (part.type === 'tool_call') return `[called ${part.name}]`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Claude Code takes one user prompt per turn. Earlier turns are replayed as a
 * transcript inside that prompt so the app stays the owner of conversation
 * memory (compaction, summaries) exactly as it is for every other provider.
 */
function buildPrompt(messages: Message[], options: AgentOptions): { system: string; blocks: ContentBlock[] } {
  let system = options.system ?? '';
  const turns: Message[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      system = system ? `${system}\n\n${message.content}` : message.content;
    } else if (message.role !== 'tool') {
      turns.push(message);
    }
  }
  system = system.replace(UNCACHED_MARKER, '').trim();

  const last = turns[turns.length - 1];
  const latestIsUser = last?.role === 'user';
  const history = latestIsUser ? turns.slice(0, -1) : turns;
  const blocks: ContentBlock[] = [];
  const textParts: string[] = [];

  if (history.length > 0) {
    const transcript = history
      .map((m) => `<${m.role}>\n${textOf(m.content)}\n</${m.role}>`)
      .join('\n\n');
    textParts.push(
      `Earlier turns of this same conversation, oldest first:\n\n${transcript}\n\n` +
        (latestIsUser
          ? 'Now reply to the latest user message below.'
          : 'Continue from where the conversation left off.')
    );
  }

  if (latestIsUser && last) {
    if (typeof last.content === 'string') {
      textParts.push(last.content);
    } else {
      for (const part of last.content) {
        if (part.type === 'text') textParts.push(part.text);
        else if (part.type === 'image') {
          blocks.push({ type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.data } });
        }
      }
    }
  }

  const text = textParts.join('\n\n').trim();
  blocks.unshift({ type: 'text', text: text || '(no message)' });
  return { system, blocks };
}

function toolInputSchema(tool: AgentTool): Record<string, unknown> {
  if (tool.rawInputSchema) return tool.rawInputSchema;
  try {
    const schema = { ...(z.toJSONSchema(tool.parameters) as Record<string, unknown>) };
    delete schema.$schema;
    return schema;
  } catch {
    return { type: 'object', properties: {} };
  }
}

function mcpContentFromResult(result: Awaited<ReturnType<AgentTool['execute']>>): {
  content: Array<Record<string, unknown>>;
  text: string;
  details?: unknown;
} {
  const structured = typeof result === 'string' ? { content: result } : result;
  const raw = structured.content;
  if (typeof raw === 'string') {
    return { content: [{ type: 'text', text: raw }], text: raw, details: (structured as { details?: unknown }).details };
  }
  const content = raw.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image', data: part.data, mimeType: part.mediaType }
  );
  const text = raw.map((part) => (part.type === 'text' ? part.text : '[image]')).join('\n');
  return { content, text, details: (structured as { details?: unknown }).details };
}

function mapUsage(usage: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): Usage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  };
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: { type?: string; text?: string }) => (part.type === 'text' ? part.text ?? '' : `[${part.type}]`))
    .join('\n');
}

/** Loads the SDK lazily: personal builds only, and never on the startup path. */
async function loadSdk(): Promise<typeof import('@anthropic-ai/claude-agent-sdk')> {
  return import('@anthropic-ai/claude-agent-sdk');
}

export async function* claudeCodeAgentLoop(
  messages: Message[],
  options: AgentOptions,
  extras: ClaudeCodeLoopExtras = {}
): AsyncGenerator<AgentEvent, AgentResult> {
  const executable = resolveClaudeCodeExecutable();
  if (!executable) {
    throw new Error('Claude Code is not installed. Install it and run `claude login` in Terminal.');
  }

  const tools = options.tools ?? [];
  const byExposedName = new Map<string, AgentTool>();
  for (const tool of tools) byExposedName.set(exposedToolName(tool.name), tool);

  // Correlate Claude's tool_use ids (seen in assistant messages) with the
  // MCP calls that follow, so tool events carry the ids the UI expects. The
  // MCP call can arrive before this loop has consumed the assistant message,
  // so a call briefly waits for its id before falling back to a local one.
  const pendingCallIds = new Map<string, string[]>();
  const callIdWaiters = new Map<string, Array<() => void>>();
  const detailsByCallId = new Map<string, unknown>();
  let fallbackCallSeq = 0;
  const takeCallId = async (appName: string): Promise<string> => {
    const queued = pendingCallIds.get(appName)?.shift();
    if (queued) return queued;
    await new Promise<void>((resolve) => {
      const waiters = callIdWaiters.get(appName) ?? [];
      waiters.push(resolve);
      callIdWaiters.set(appName, waiters);
      setTimeout(resolve, 1_000);
    });
    return pendingCallIds.get(appName)?.shift() ?? `cc_${++fallbackCallSeq}`;
  };

  const abortController = new AbortController();
  const forwardAbort = (): void => abortController.abort(options.signal?.reason);
  if (options.signal?.aborted) forwardAbort();
  else options.signal?.addEventListener('abort', forwardAbort, { once: true });

  const server = new Server({ name: MCP_SERVER_NAME, version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...byExposedName.entries()].map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: toolInputSchema(tool),
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byExposedName.get(request.params.name);
    if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true };
    const toolCallId = await takeCallId(tool.name);
    try {
      const result = await tool.execute(request.params.arguments ?? {}, {
        signal: abortController.signal,
        toolCallId,
      });
      const mapped = mcpContentFromResult(result);
      if (mapped.details !== undefined) detailsByCallId.set(toolCallId, mapped.details);
      return { content: mapped.content };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  });

  const { system, blocks } = buildPrompt(messages, options);
  const thinkingLevel = options.thinking;
  const sdkOptions: ClaudeCodeOptions = {
    pathToClaudeCodeExecutable: executable,
    cwd: extras.cwd,
    env: claudeCodeEnv(),
    model: options.model,
    systemPrompt: system,
    maxTurns: options.maxTurns,
    thinking: thinkingLevel ? { type: 'adaptive' } : { type: 'disabled' },
    effort: thinkingLevel,
    // Nothing from the owner's Claude Code setup leaks in: no built-in tools,
    // no settings/CLAUDE.md/hooks, no other MCP servers, no session files.
    tools: [],
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    includePartialMessages: true,
    mcpServers: { [MCP_SERVER_NAME]: { type: 'sdk', name: MCP_SERVER_NAME, instance: server as never } },
    // Fail closed: only the bridged app tools may run.
    canUseTool: async (toolName) =>
      toolName.startsWith(TOOL_PREFIX)
        ? { behavior: 'allow' as const }
        : { behavior: 'deny' as const, message: 'Only AI Chief of Staff tools are available.' },
    abortController,
  };

  const prompt = (async function* (): AsyncGenerator<SDKUserMessage> {
    yield {
      type: 'user',
      message: { role: 'user', content: blocks as never },
      parent_tool_use_id: null,
      session_id: '',
    } as SDKUserMessage;
  })();

  const { query } = await loadSdk();
  const stream = query({ prompt, options: sdkOptions });

  let text = '';
  let turn = 0;
  let currentTurnId: string | null = null;
  let currentTurnUsage: Usage | null = null;
  let currentStopReason: string | null = null;
  const toolStartTimes = new Map<string, number>();

  const finishTurn = (): AgentEvent | null => {
    if (!currentTurnId || !currentTurnUsage) return null;
    turn += 1;
    const event: AgentEvent = {
      type: 'turn_end',
      turn,
      stopReason: (currentStopReason ?? 'end_turn') as StopReason,
      usage: currentTurnUsage,
    };
    currentTurnId = null;
    currentTurnUsage = null;
    currentStopReason = null;
    return event;
  };

  try {
    for await (const message of stream as AsyncIterable<SDKMessage>) {
      if (message.type === 'stream_event') {
        const event = message.event;
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            text += event.delta.text;
            yield { type: 'text_delta', text: event.delta.text };
          } else if (event.delta.type === 'thinking_delta') {
            yield { type: 'thinking_delta', text: event.delta.thinking };
          }
        } else if (event.type === 'message_delta') {
          currentStopReason = event.delta.stop_reason ?? currentStopReason;
          if (currentTurnUsage && event.usage?.output_tokens) currentTurnUsage.outputTokens = event.usage.output_tokens;
        } else if (event.type === 'message_stop') {
          // The API turn is complete; tools (if any) run after this point.
          const done = finishTurn();
          if (done) yield done;
        }
        continue;
      }

      if (message.type === 'assistant') {
        if (message.error) {
          throw new Error(explainClaudeCodeError(textOf(message.message.content as never) || message.error));
        }
        if (currentTurnId && currentTurnId !== message.message.id) {
          const done = finishTurn();
          if (done) yield done;
        }
        currentTurnId = message.message.id;
        currentTurnUsage = mapUsage(message.message.usage);
        currentStopReason = message.message.stop_reason ?? currentStopReason;
        for (const block of message.message.content) {
          if (block.type !== 'tool_use') continue;
          const exposed = block.name.startsWith(TOOL_PREFIX) ? block.name.slice(TOOL_PREFIX.length) : block.name;
          const appName = byExposedName.get(exposed)?.name ?? exposed;
          const queue = pendingCallIds.get(appName) ?? [];
          queue.push(block.id);
          pendingCallIds.set(appName, queue);
          for (const wake of callIdWaiters.get(appName) ?? []) wake();
          callIdWaiters.delete(appName);
          toolStartTimes.set(block.id, Date.now());
          yield {
            type: 'tool_call_start',
            toolCallId: block.id,
            name: appName,
            args: (block.input ?? {}) as Record<string, unknown>,
          };
        }
        continue;
      }

      if (message.type === 'user') {
        const content = message.message.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const startedAt = toolStartTimes.get(block.tool_use_id) ?? Date.now();
          toolStartTimes.delete(block.tool_use_id);
          yield {
            type: 'tool_call_end',
            toolCallId: block.tool_use_id,
            result: toolResultText(block.content),
            details: detailsByCallId.get(block.tool_use_id),
            isError: block.is_error === true,
            durationMs: Date.now() - startedAt,
          };
          detailsByCallId.delete(block.tool_use_id);
        }
        continue;
      }

      if (message.type === 'result') {
        const done = finishTurn();
        if (done) yield done;
        if (message.is_error || message.subtype !== 'success') {
          const reason =
            message.subtype === 'success'
              ? message.result
              : (message as { errors?: string[] }).errors?.join('; ') || message.subtype.replace(/_/g, ' ');
          throw new Error(explainClaudeCodeError(reason || 'Claude Code returned an error'));
        }
        const totalUsage = mapUsage(message.usage);
        yield { type: 'agent_done', totalTurns: message.num_turns, totalUsage };
        return {
          message: { role: 'assistant', content: text || message.result },
          totalTurns: message.num_turns,
          totalUsage,
        };
      }
    }
    throw new Error(abortController.signal.aborted ? 'Request aborted' : 'Claude Code ended without a result');
  } catch (error) {
    // Callers match on "aborted"; keep that word whatever the SDK said.
    if (abortController.signal.aborted) throw new Error('Request aborted', { cause: error });
    throw new Error(explainClaudeCodeError(error instanceof Error ? error.message : String(error)), { cause: error });
  } finally {
    options.signal?.removeEventListener('abort', forwardAbort);
    abortController.abort();
    await stream.return(undefined).catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

/**
 * One-shot prompt → text on the Claude Code route (summaries, compaction).
 * No tools, single turn. Output length is governed by Claude Code, not a
 * max-tokens knob, so callers should ask for brevity in the prompt.
 */
export async function claudeCodeComplete(
  prompt: string,
  options: { model: string; cwd?: string; signal?: AbortSignal }
): Promise<string> {
  const loop = claudeCodeAgentLoop(
    [{ role: 'user', content: prompt }],
    { provider: 'anthropic', model: options.model, tools: [], maxTurns: 1, signal: options.signal },
    { cwd: options.cwd }
  );
  let text = '';
  for await (const event of loop) {
    if (event.type === 'text_delta') text += event.text;
  }
  return text;
}
