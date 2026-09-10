import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { AgentEvent, AgentTool } from '@kenkaiiii/gg-agent';

const settings = new Map<string, string>();
vi.mock('../../src/settings', () => ({
  SettingsManager: { get: (key: string) => settings.get(key) ?? '' },
}));

const queryCalls: Array<{ prompt: unknown; options: Record<string, unknown> }> = [];
let scripted: Array<Record<string, unknown>> = [];
let returned = 0;
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: unknown; options: Record<string, unknown> }) => {
    queryCalls.push({ prompt, options });
    const messages = scripted;
    const iterator = (async function* () {
      for (const message of messages) {
        if (typeof message.__call === 'function') await (message.__call as () => Promise<void>)();
        else yield message;
      }
    })();
    return Object.assign(iterator, {
      return: async () => {
        returned += 1;
        return { done: true, value: undefined };
      },
    });
  },
}));

vi.mock('../../src/agent/claude-code-route', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/agent/claude-code-route')>()),
  resolveClaudeCodeExecutable: () => '/opt/fake/claude',
}));

import { claudeCodeAgentLoop, claudeCodeComplete } from '../../src/agent/claude-code-loop';

async function collect(loop: AsyncGenerator<AgentEvent, unknown>): Promise<{ events: AgentEvent[]; result: unknown }> {
  const events: AgentEvent[] = [];
  let next = await loop.next();
  while (!next.done) {
    events.push(next.value);
    next = await loop.next();
  }
  return { events, result: next.value };
}

const usage = { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 };
const resultMessage = (overrides: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'done',
  num_turns: 1,
  usage,
  ...overrides,
});

beforeEach(() => {
  settings.clear();
  queryCalls.length = 0;
  scripted = [];
  returned = 0;
});

describe('claudeCodeAgentLoop', () => {
  it('runs through the installed binary with the owner setup isolated and no API key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-never-reach-claude-code';
    scripted = [
      { type: 'system', subtype: 'init' },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi ' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'there' } } },
      { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'Hi there' }], usage, stop_reason: 'end_turn' } },
      { type: 'stream_event', event: { type: 'message_stop' } },
      resultMessage(),
    ];
    const { events, result } = await collect(
      claudeCodeAgentLoop(
        [
          { role: 'system', content: 'Be brief. <!-- uncached -->' },
          { role: 'user', content: 'hello' },
        ],
        { provider: 'anthropic', model: 'claude-sonnet-4-6', tools: [], maxTurns: 7 },
        { cwd: '/workspace' }
      )
    );
    delete process.env.ANTHROPIC_API_KEY;

    const { options } = queryCalls[0];
    expect(options.pathToClaudeCodeExecutable).toBe('/opt/fake/claude');
    expect(options.model).toBe('claude-sonnet-4-6');
    expect(options.systemPrompt).toBe('Be brief.');
    expect(options.maxTurns).toBe(7);
    expect(options.cwd).toBe('/workspace');
    expect(options).toMatchObject({ tools: [], settingSources: [], strictMcpConfig: true, persistSession: false });
    expect((options.env as Record<string, string>).ANTHROPIC_API_KEY).toBeUndefined();
    expect((options.env as Record<string, string>).CLAUDE_AGENT_SDK_CLIENT_APP).toBe('ai-chief-of-staff');

    const canUseTool = options.canUseTool as (name: string) => Promise<{ behavior: string }>;
    expect((await canUseTool('mcp__acos__read')).behavior).toBe('allow');
    expect((await canUseTool('Bash')).behavior).toBe('deny');
    expect((await canUseTool('mcp__other__thing')).behavior).toBe('deny');

    expect(events.map((e) => e.type)).toEqual(['text_delta', 'text_delta', 'turn_end', 'agent_done']);
    expect(result).toMatchObject({
      message: { role: 'assistant', content: 'Hi there' },
      totalTurns: 1,
      totalUsage: { inputTokens: 10, outputTokens: 4, cacheRead: 2, cacheWrite: 1 },
    });
    expect(returned).toBeGreaterThanOrEqual(1);
  });

  it('replays earlier turns in the prompt and forwards images from the latest message', async () => {
    scripted = [resultMessage()];
    await collect(
      claudeCodeAgentLoop(
        [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'reply' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is this?' },
              { type: 'image', mediaType: 'image/png', data: 'AAAA' },
            ],
          },
        ],
        { provider: 'anthropic', model: 'claude-sonnet-4-6', tools: [] }
      )
    );
    const prompt = queryCalls[0].prompt as AsyncIterable<{ message: { content: Array<Record<string, unknown>> } }>;
    const sent: Array<{ message: { content: Array<Record<string, unknown>> } }> = [];
    for await (const m of prompt) sent.push(m);
    expect(sent).toHaveLength(1);
    const [text, image] = sent[0].message.content;
    expect(text.type).toBe('text');
    expect(String(text.text)).toContain('<user>\nfirst\n</user>');
    expect(String(text.text)).toContain('<assistant>\nreply\n</assistant>');
    expect(String(text.text)).toMatch(/what is this\?$/);
    expect(image).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
  });

  it('bridges app tools over MCP with the app names and ids the UI expects', async () => {
    const execute = vi.fn(async (args: unknown) => ({ content: `looked up ${JSON.stringify(args)}`, details: { hits: 1 } }));
    const tool = {
      name: 'mcp__flo-gmail__gmail_search_emails',
      description: 'Search mail',
      parameters: z.object({ q: z.string() }),
      execute,
    } as unknown as AgentTool;
    let pendingCall: Promise<unknown> | null = null;
    scripted = [
      {
        // The MCP call can reach the bridge before this loop has consumed the
        // assistant message that carries its tool_use id; it must wait for it.
        __call: async () => {
          const server = (queryCalls[0].options.mcpServers as Record<string, { instance: unknown }>).acos.instance as {
            _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
          };
          const list = await server._requestHandlers.get('tools/list')!({ method: 'tools/list', params: {} });
          expect(list).toMatchObject({
            tools: [{ name: 'ext__flo-gmail__gmail_search_emails', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }],
          });
          pendingCall = server._requestHandlers.get('tools/call')!({
            method: 'tools/call',
            params: { name: 'ext__flo-gmail__gmail_search_emails', arguments: { q: 'invoice' } },
          });
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__acos__ext__flo-gmail__gmail_search_emails', input: { q: 'invoice' } }],
          usage,
          stop_reason: 'tool_use',
        },
      },
      { type: 'stream_event', event: { type: 'message_stop' } },
      {
        __call: async () => {
          expect(await pendingCall).toEqual({ content: [{ type: 'text', text: 'looked up {"q":"invoice"}' }] });
        },
      },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'looked up {"q":"invoice"}' }] } },
      { type: 'assistant', message: { id: 'msg_2', content: [{ type: 'text', text: 'Found it' }], usage, stop_reason: 'end_turn' } },
      { type: 'stream_event', event: { type: 'message_stop' } },
      resultMessage({ num_turns: 2 }),
    ];
    const { events } = await collect(
      claudeCodeAgentLoop([{ role: 'user', content: 'find the invoice' }], { provider: 'anthropic', model: 'claude-sonnet-4-6', tools: [tool] })
    );
    expect(execute).toHaveBeenCalledWith({ q: 'invoice' }, expect.objectContaining({ toolCallId: 'toolu_1' }));
    expect(events.map((e) => e.type)).toEqual(['tool_call_start', 'turn_end', 'tool_call_end', 'turn_end', 'agent_done']);
    expect(events[0]).toMatchObject({ toolCallId: 'toolu_1', name: 'mcp__flo-gmail__gmail_search_emails', args: { q: 'invoice' } });
    expect(events[2]).toMatchObject({ toolCallId: 'toolu_1', result: 'looked up {"q":"invoice"}', details: { hits: 1 }, isError: false });
  });

  it('turns a sign-in failure into the one action the owner can take', async () => {
    scripted = [
      { type: 'assistant', error: 'authentication_failed', message: { id: 'msg_1', content: [{ type: 'text', text: 'Failed to authenticate: OAuth session expired and could not be refreshed' }], usage } },
      resultMessage({ is_error: true, result: 'Failed to authenticate' }),
    ];
    await expect(collect(claudeCodeAgentLoop([{ role: 'user', content: 'hi' }], { provider: 'anthropic', model: 'claude-sonnet-4-6', tools: [] })))
      .rejects.toThrow(/Run `claude login` in Terminal/);
    expect(returned).toBeGreaterThanOrEqual(1);
  });

  it('forwards abort to Claude Code and reports it as an abort, not a Claude Code failure', async () => {
    const controller = new AbortController();
    scripted = [
      { __call: async () => controller.abort(new Error('user stopped')) },
      {
        __call: async () => {
          throw new Error('Claude Code process exited with code 143');
        },
      },
    ];
    await expect(
      collect(claudeCodeAgentLoop([{ role: 'user', content: 'hi' }], { provider: 'anthropic', model: 'claude-sonnet-4-6', tools: [], signal: controller.signal }))
    ).rejects.toThrow(/aborted/);
    expect((queryCalls[0].options.abortController as AbortController).signal.aborted).toBe(true);
  });
});

describe('claudeCodeComplete', () => {
  it('returns the streamed text of a single tool-less turn', async () => {
    scripted = [
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Summary.' } } },
      { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'Summary.' }], usage, stop_reason: 'end_turn' } },
      resultMessage(),
    ];
    await expect(claudeCodeComplete('Summarize', { model: 'claude-haiku-4-5' })).resolves.toBe('Summary.');
    expect(queryCalls[0].options).toMatchObject({ maxTurns: 1, model: 'claude-haiku-4-5' });
  });
});
