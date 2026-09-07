/**
 * Sub-Agent Tool — spawns a clean, isolated in-process sub-agent using agentLoop().
 *
 * Sub-agents are stateless workers. They get:
 * - A task (user message)
 * - A minimal system prompt (no personality, no memory, no context)
 * - A small set of utility tools (web_fetch, shell, browser)
 * - Turn and output limits
 *
 * They do NOT get: facts, soul, conversation history, memory tools, scheduler, etc.
 * Clean slate. Do the job. Report back.
 */

import { z } from 'zod';
import { agentLoop } from '@kenkaiiii/gg-agent';
import type { AgentTool, AgentOptions, ToolContext } from '@kenkaiiii/gg-agent';
import type { Message } from '@kenkaiiii/gg-ai';
import type { StreamConfig } from '../agent/chat-providers';
import { registerSubAgent, updateSubAgent, removeSubAgent } from './subagent-registry';
import { SettingsManager } from '../settings';

// ── Constants ──

const SUB_AGENT_MAX_TURNS = 15;
const SUB_AGENT_MAX_OUTPUT_CHARS = 100_000;
const SUB_AGENT_TIMEOUT_MS = 300_000; // 5 minutes

/** Only these tools are available to sub-agents. Everything else is parent-only. */
const ALLOWED_SUB_AGENT_TOOLS = new Set([
  'read',
  'write',
  'edit',
  'browser',
  'notify',
  'web_fetch',
  'shell_command',
  'mcp__pocket-agent__browser',
  'mcp__pocket-agent__notify',
]);

const SUB_AGENT_SYSTEM_PROMPT =
  "You are a task worker. Execute the given task completely and efficiently. No small talk, no explanations unless asked. Do the work, report what you did and the result. If something fails, say what failed and why. That's it.";

// ── Parameters ──

const SubAgentParams = z.object({
  task: z.string().describe('The task to delegate to the sub-agent'),
});

// ── Factory ──

/**
 * Create the sub-agent tool.
 *
 * @param parentTools - The parent agent's full tool array (we pick only allowed ones)
 * @param getStreamConfig - Async function returning current provider/model config
 */
export function createSubAgentTool(
  parentTools: AgentTool[],
  getStreamConfig: (model: string) => Promise<StreamConfig>
): AgentTool<typeof SubAgentParams> {
  return {
    name: 'subagent',
    description:
      'Spawn a clean, isolated sub-agent to handle a focused task. The sub-agent has no memory, no personality, no conversation context — just tools (web_fetch, shell, browser) and a task. Use for work that benefits from isolation or parallelism. Blocks until complete.',
    parameters: SubAgentParams,
    execute: async (
      args: z.infer<typeof SubAgentParams>,
      context: ToolContext
    ): Promise<string> => {
      const { task } = args;
      const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Register for tracking
      registerSubAgent({
        id,
        task,
        status: 'running',
        startedAt: new Date(),
        toolUseCount: 0,
        tokenUsage: { input: 0, output: 0 },
        currentActivity: 'starting',
      });

      const child = new AbortController();
      const abortChild = (): void => child.abort(new Error('Sub-agent aborted'));
      context.signal.addEventListener('abort', abortChild, { once: true });
      if (context.signal.aborted) abortChild();
      const timer = setTimeout(() => {
        child.abort(new Error(`Sub-agent timed out after ${SUB_AGENT_TIMEOUT_MS}ms`));
      }, SUB_AGENT_TIMEOUT_MS);
      const childContext = { ...context, signal: child.signal };
      try {
        child.signal.throwIfAborted();
        // Build sub-agent tool set — only explicitly allowed tools
        const subTools = parentTools.filter((t) => ALLOWED_SUB_AGENT_TOOLS.has(t.name));

        // Get provider config (same model as parent)
        const model = SettingsManager.get('agent.model') || 'claude-sonnet-4-6';
        const streamConfig = await getStreamConfig(model);
        child.signal.throwIfAborted();

        // Clean agent options — no context, no facts, no memory, no soul
        const agentOptions: AgentOptions = {
          provider: streamConfig.provider,
          model,
          system: SUB_AGENT_SYSTEM_PROMPT,
          tools: subTools,
          webSearch: true,
          maxTurns: SUB_AGENT_MAX_TURNS,
          maxTokens: 8192,
          apiKey: streamConfig.apiKey,
          baseUrl: streamConfig.baseUrl,
          signal: child.signal,
        };

        // Fresh messages — just the task, nothing else
        const messages: Message[] = [{ role: 'user', content: task }];

        // Keep ownership until the loop settles; abort the actual child on deadline.
        const result = await runSubAgent(id, messages, agentOptions, childContext);
        child.signal.throwIfAborted();

        // Truncate output
        const output = truncateOutput(result);

        updateSubAgent(id, { status: 'done', result: output });
        return output;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        updateSubAgent(id, { status: 'error', error: errorMsg });

        if (errorMsg.includes('aborted') || errorMsg.includes('timed out')) {
          return `Sub-agent was stopped: ${errorMsg}`;
        }
        return `Sub-agent failed: ${errorMsg}`;
      } finally {
        clearTimeout(timer);
        context.signal.removeEventListener('abort', abortChild);
        child.abort();
        // Clean up after a delay to allow status reads without keeping the process alive.
        setTimeout(() => removeSubAgent(id), 60_000).unref();
      }
    },
  };
}

// ── Helpers ──

/**
 * Run the sub-agent loop and collect the response text.
 */
async function runSubAgent(
  id: string,
  messages: Message[],
  options: AgentOptions,
  context: ToolContext
): Promise<string> {
  const loop = agentLoop(messages, options);
  let response = '';
  let toolUseCount = 0;
  let totalInput = 0;
  let totalOutput = 0;

  for await (const event of loop) {
    // Check abort
    if (context.signal.aborted) {
      throw new Error('Sub-agent aborted');
    }

    switch (event.type) {
      case 'text_delta':
        response += event.text;
        break;

      case 'tool_call_start':
        toolUseCount++;
        updateSubAgent(id, {
          toolUseCount,
          currentActivity: `Using ${event.name}`,
        });
        break;

      case 'tool_call_end':
        updateSubAgent(id, { currentActivity: 'processing' });
        break;

      case 'turn_end':
        totalInput += event.usage.inputTokens;
        totalOutput += event.usage.outputTokens;
        updateSubAgent(id, {
          tokenUsage: { input: totalInput, output: totalOutput },
        });
        break;

      case 'agent_done':
        console.log(
          `[SubAgent:${id}] Done — ${event.totalTurns} turns, ${event.totalUsage.inputTokens + event.totalUsage.outputTokens} tokens`
        );
        break;

      case 'error':
        console.error(`[SubAgent:${id}] Error:`, event.error);
        throw event.error;
    }
  }

  return response || 'Sub-agent completed with no text output.';
}

/**
 * Truncate output to fit within parent context limits.
 */
function truncateOutput(text: string): string {
  if (text.length <= SUB_AGENT_MAX_OUTPUT_CHARS) return text;
  return (
    text.slice(0, SUB_AGENT_MAX_OUTPUT_CHARS) +
    `\n\n[Output truncated at ${SUB_AGENT_MAX_OUTPUT_CHARS.toLocaleString()} chars]`
  );
}